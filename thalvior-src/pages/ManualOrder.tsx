// 手工创建订单 - 后台补单 / 异常处理
import { useState } from 'react';
import {
  Card,
  Form,
  Input,
  Select,
  InputNumber,
  Button,
  Space,
  Typography,
  Table,
  Row,
  Col,
  Divider,
  message,
  Modal,
  Tag,
} from 'antd';
import { PlusOutlined, DeleteOutlined, SaveOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { orderApi, shopApi, productApi } from '../api';
import AuthButton from '../components/AuthButton';
import { useTranslation } from '../i18n';

const { Title, Text } = Typography;

interface OrderItem {
  sku: string;
  quantity: number;
  price: number;
}

export default function ManualOrder() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [items, setItems] = useState<OrderItem[]>([{ sku: '', quantity: 1, price: 0 }]);

  // 店铺列表
  const { data: shopsResp } = useQuery({
    queryKey: ['shops-all-manual'],
    queryFn: () => shopApi.list({ page: 1, pageSize: 200 }),
  });
  const shops = shopsResp?.items || [];

  // 商品列表 (用于 SKU 自动补全)
  const { data: productsResp } = useQuery({
    queryKey: ['products-all-manual'],
    queryFn: () => productApi.list({ page: 1, pageSize: 500 }),
  });
  const products = productsResp?.items || [];

  // 商品 SKU 候选 (按 SKU 前缀模糊)
  const productMap: Record<string, any> = {};
  products.forEach((p: any) => (productMap[p.sku] = p));

  const createMut = useMutation({
    mutationFn: orderApi.createManual,
    onSuccess: (res: any) => {
      message.success(t('pages.manualOrder.createSuccess', { no: res.platformNo }));
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order-stats'] });
      Modal.success({
        title: t('pages.manualOrder.modalTitleSuccess'),
        content: (
          <div>
            <p>{t('pages.manualOrder.orderNoLabel')}: <code>{res.platformNo}</code></p>
            <p>{t('pages.manualOrder.amountLabel')}: <b>{res.totalAmount} {res.currency}</b></p>
            <p>{t('pages.manualOrder.itemCountLabel')}: {res.items?.length || 0} {t('pages.manualOrder.skuUnit')}</p>
          </div>
        ),
        onOk: () => nav('/order/list'),
      });
    },
    onError: (e: any) => {
      message.error(e?.response?.data?.message || e?.message || t('pages.manualOrder.createFailed'));
    },
  });

  // 添加商品行
  const addItem = () => setItems([...items, { sku: '', quantity: 1, price: 0 }]);
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i: number, k: keyof OrderItem, v: any) => {
    const next = [...items];
    (next[i] as any)[k] = v;
    // 当 SKU 改变时, 自动带出价格
    if (k === 'sku') {
      const p = productMap[v];
      if (p) next[i].price = p.salePrice;
    }
    setItems(next);
  };

  // 计算总金额
  const totalAmount = items.reduce((s, it) => s + (it.quantity || 0) * (it.price || 0), 0);

  const onSubmit = async () => {
    try {
      const vals = await form.validateFields();
      const validItems = items.filter((it) => it.sku && it.quantity > 0);
      if (!validItems.length) {
        message.error(t('pages.manualOrder.needAtLeastOneItem'));
        return;
      }
      // 校验 SKU 全部存在
      const unknownSku = validItems.filter((it) => !productMap[it.sku]);
      if (unknownSku.length) {
        message.error(t('pages.manualOrder.skuNotFound', { list: unknownSku.map((u) => u.sku).join(', ') }));
        return;
      }
      createMut.mutate({
        ...vals,
        items: validItems,
      });
    } catch (e: any) {
      // 表单校验失败
    }
  };

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>
        <Space>
          <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => nav('/order/list')}>
            {t('common.back')}
          </Button>
          {t('pages.manualOrder.title')}
        </Space>
      </Title>
      <Text type="secondary">{t('pages.manualOrder.subtitle')}</Text>

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col span={16}>
          <Card title={t('pages.manualOrder.cardOrderInfo')} bordered={false}>
            <Form form={form} layout="vertical">
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label={t('order.shop')} name="shopId" rules={[{ required: true, message: t('pages.manualOrder.pleaseSelectShop') }]}>
                    <Select
                      placeholder={t('pages.manualOrder.selectShop')}
                      showSearch
                      optionFilterProp="label"
                      options={shops.map((s: any) => ({
                        value: s.id,
                        label: `${s.name} (${s.platform?.name} - ${s.region})`,
                      }))}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label={t('order.platformOrderNo')} name="platformNo">
                    <Input placeholder={t('pages.manualOrder.autoGenerateIfEmpty')} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label={t('pages.manualOrder.buyerName')} name="buyerName" rules={[{ required: true, message: t('pages.manualOrder.pleaseInputBuyerName') }]}>
                    <Input placeholder={t('pages.manualOrder.buyerName')} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label={t('auth.email')} name="buyerEmail">
                    <Input placeholder="buyer@example.com" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label={t('pages.manualOrder.country')} name="country">
                    <Input placeholder="US / DE / JP ..." />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label={t('common.currency')} name="currency" initialValue="USD">
                    <Select
                      options={['USD', 'EUR', 'JPY', 'GBP', 'CNY', 'MYR', 'SGD', 'THB'].map((c) => ({ value: c, label: c }))}
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label={t('order.freight')} name="shipFee" initialValue={0}>
                    <InputNumber min={0} step={0.01} style={{ width: '100%' }} addonAfter={t('pages.manualOrder.amountSuffix')} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label={t('pages.manualOrder.initialStatus')} name="status" initialValue="pending">
                    <Select
                      options={[
                        { value: 'pending', label: t('order.statusPending') },
                        { value: 'pay', label: t('order.statusPaid') },
                        { value: 'toship', label: t('pages.manualOrder.statusToship') },
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col span={24}>
                  <Form.Item label={t('pages.manualOrder.remark')} name="remark">
                    <Input.TextArea rows={2} placeholder={t('pages.manualOrder.remarkPlaceholder')} />
                  </Form.Item>
                </Col>
              </Row>
            </Form>
          </Card>

          <Card title={t('pages.manualOrder.cardProductDetail')} bordered={false} style={{ marginTop: 16 }} extra={
            <Button type="dashed" icon={<PlusOutlined />} onClick={addItem}>
              {t('pages.manualOrder.addProduct')}
            </Button>
          }>
            <Table
              size="small"
              pagination={false}
              dataSource={items.map((it, i) => ({ ...it, key: i }))}
              columns={[
                {
                  title: '#',
                  dataIndex: 'key',
                  width: 50,
                  render: (k: number) => <Tag>{k + 1}</Tag>,
                },
                {
                  title: 'SKU',
                  dataIndex: 'sku',
                  render: (v: string, r: any) => (
                    <Select
                      style={{ width: 220 }}
                      placeholder={t('pages.manualOrder.selectSku')}
                      showSearch
                      value={v || undefined}
                      onChange={(val) => updateItem(r.key, 'sku', val)}
                      optionFilterProp="label"
                      options={products.map((p: any) => ({
                        value: p.sku,
                        label: `${p.sku} - ${p.name}`,
                      }))}
                    />
                  ),
                },
                {
                  title: t('order.productName'),
                  width: 280,
                  render: (_: any, r: any) => productMap[r.sku]?.name || <Text type="secondary">-</Text>,
                },
                {
                  title: t('order.quantity'),
                  dataIndex: 'quantity',
                  width: 120,
                  render: (v: number, r: any) => (
                    <InputNumber min={1} value={v} onChange={(val) => updateItem(r.key, 'quantity', val || 1)} style={{ width: '100%' }} />
                  ),
                },
                {
                  title: t('order.unitPrice'),
                  dataIndex: 'price',
                  width: 160,
                  render: (v: number, r: any) => (
                    <InputNumber min={0} step={0.01} value={v} onChange={(val) => updateItem(r.key, 'price', val || 0)} style={{ width: '100%' }} addonBefore="$" />
                  ),
                },
                {
                  title: t('pages.orderList.subtotal'),
                  width: 120,
                  align: 'right',
                  render: (_: any, r: any) => `${((r.quantity || 0) * (r.price || 0)).toFixed(2)}`,
                },
                {
                  title: t('common.operation'),
                  width: 60,
                  render: (_: any, r: any) => items.length > 1 ? (
                    <Button type="link" danger size="small" icon={<DeleteOutlined />} onClick={() => removeItem(r.key)} />
                  ) : null,
                },
              ]}
            />
          </Card>
        </Col>

        <Col span={8}>
          <Card title={t('pages.manualOrder.cardSummary')} bordered={false}>
            <Space direction="vertical" style={{ width: '100%' }} size={12}>
              <Row><Col span={12}>{t('pages.manualOrder.itemCount')}:</Col><Col span={12} style={{ textAlign: 'right' }}><b>{items.reduce((s, it) => s + (it.quantity || 0), 0)}</b></Col></Row>
              <Row><Col span={12}>{t('pages.manualOrder.productTotal')}:</Col><Col span={12} style={{ textAlign: 'right' }}><b>{totalAmount.toFixed(2)}</b></Col></Row>
              <Divider style={{ margin: '8px 0' }} />
              <Row><Col span={12}>{t('pages.manualOrder.totalAmount')}:</Col><Col span={12} style={{ textAlign: 'right' }}>
                <span style={{ fontSize: 22, color: '#1677ff', fontWeight: 600 }}>{totalAmount.toFixed(2)}</span>
              </Col></Row>
            </Space>
            <Divider />
            <AuthButton
              block
              type="primary"
              size="large"
              icon={<SaveOutlined />}
              perm="order:manual:create"
              loading={createMut.isPending}
              onClick={onSubmit}
            >
              {t('pages.manualOrder.createOrder')}
            </AuthButton>
            <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
              {t('pages.manualOrder.createdStatusHint', { status: form.getFieldValue('status') || t('order.statusPending') })}
            </Text>
          </Card>

          <Card title={t('pages.manualOrder.cardUsageGuide')} bordered={false} style={{ marginTop: 16 }}>
            <ul style={{ paddingLeft: 20, margin: 0, color: '#666' }}>
              <li>{t('pages.manualOrder.guide1')}</li>
              <li>{t('pages.manualOrder.guide2')}</li>
              <li>{t('pages.manualOrder.guide3')}</li>
              <li>{t('pages.manualOrder.guide4')}</li>
            </ul>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
