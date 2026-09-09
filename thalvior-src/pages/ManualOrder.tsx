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

const { Title, Text } = Typography;

interface OrderItem {
  sku: string;
  quantity: number;
  price: number;
}

export default function ManualOrder() {
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
      message.success(`订单创建成功: ${res.platformNo}`);
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order-stats'] });
      Modal.success({
        title: '订单创建成功',
        content: (
          <div>
            <p>订单号: <code>{res.platformNo}</code></p>
            <p>金额: <b>{res.totalAmount} {res.currency}</b></p>
            <p>商品数: {res.items?.length || 0} 个 SKU</p>
          </div>
        ),
        onOk: () => nav('/order/list'),
      });
    },
    onError: (e: any) => {
      message.error(e?.response?.data?.message || e?.message || '创建失败');
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
        message.error('请至少添加一个有效商品');
        return;
      }
      // 校验 SKU 全部存在
      const unknownSku = validItems.filter((it) => !productMap[it.sku]);
      if (unknownSku.length) {
        message.error(`SKU 不存在: ${unknownSku.map((u) => u.sku).join(', ')}`);
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
            返回
          </Button>
          手工创建订单
        </Space>
      </Title>
      <Text type="secondary">用于补单 / 异常处理 / 测试订单, 创建后可在订单列表查看</Text>

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col span={16}>
          <Card title="订单信息" bordered={false}>
            <Form form={form} layout="vertical">
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label="店铺" name="shopId" rules={[{ required: true, message: '请选择店铺' }]}>
                    <Select
                      placeholder="选择店铺"
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
                  <Form.Item label="平台订单号" name="platformNo">
                    <Input placeholder="留空自动生成" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="买家姓名" name="buyerName" rules={[{ required: true, message: '请填写买家姓名' }]}>
                    <Input placeholder="买家姓名" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="邮箱" name="buyerEmail">
                    <Input placeholder="buyer@example.com" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="国家" name="country">
                    <Input placeholder="US / DE / JP ..." />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="货币" name="currency" initialValue="USD">
                    <Select
                      options={['USD', 'EUR', 'JPY', 'GBP', 'CNY', 'MYR', 'SGD', 'THB'].map((c) => ({ value: c, label: c }))}
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="运费" name="shipFee" initialValue={0}>
                    <InputNumber min={0} step={0.01} style={{ width: '100%' }} addonAfter="金额" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="初始状态" name="status" initialValue="pending">
                    <Select
                      options={[
                        { value: 'pending', label: '待付款' },
                        { value: 'pay', label: '已付款' },
                        { value: 'toship', label: '待发货' },
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col span={24}>
                  <Form.Item label="备注" name="remark">
                    <Input.TextArea rows={2} placeholder="订单备注 / 异常说明" />
                  </Form.Item>
                </Col>
              </Row>
            </Form>
          </Card>

          <Card title="商品明细" bordered={false} style={{ marginTop: 16 }} extra={
            <Button type="dashed" icon={<PlusOutlined />} onClick={addItem}>
              添加商品
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
                      placeholder="选择 SKU"
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
                  title: '商品名称',
                  width: 280,
                  render: (_: any, r: any) => productMap[r.sku]?.name || <Text type="secondary">-</Text>,
                },
                {
                  title: '数量',
                  dataIndex: 'quantity',
                  width: 120,
                  render: (v: number, r: any) => (
                    <InputNumber min={1} value={v} onChange={(val) => updateItem(r.key, 'quantity', val || 1)} style={{ width: '100%' }} />
                  ),
                },
                {
                  title: '单价',
                  dataIndex: 'price',
                  width: 160,
                  render: (v: number, r: any) => (
                    <InputNumber min={0} step={0.01} value={v} onChange={(val) => updateItem(r.key, 'price', val || 0)} style={{ width: '100%' }} addonBefore="$" />
                  ),
                },
                {
                  title: '小计',
                  width: 120,
                  align: 'right',
                  render: (_: any, r: any) => `${((r.quantity || 0) * (r.price || 0)).toFixed(2)}`,
                },
                {
                  title: '操作',
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
          <Card title="订单汇总" bordered={false}>
            <Space direction="vertical" style={{ width: '100%' }} size={12}>
              <Row><Col span={12}>商品件数:</Col><Col span={12} style={{ textAlign: 'right' }}><b>{items.reduce((s, it) => s + (it.quantity || 0), 0)}</b></Col></Row>
              <Row><Col span={12}>商品总额:</Col><Col span={12} style={{ textAlign: 'right' }}><b>{totalAmount.toFixed(2)}</b></Col></Row>
              <Divider style={{ margin: '8px 0' }} />
              <Row><Col span={12}>总金额:</Col><Col span={12} style={{ textAlign: 'right' }}>
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
              创建订单
            </AuthButton>
            <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
              创建后状态: {form.getFieldValue('status') || '待付款'}, 进入相应处理流程
            </Text>
          </Card>

          <Card title="使用说明" bordered={false} style={{ marginTop: 16 }}>
            <ul style={{ paddingLeft: 20, margin: 0, color: '#666' }}>
              <li>用于补录线下成交订单、测试订单、异常订单</li>
              <li>SKU 自动补全, 价格自动带出, 可手动调整</li>
              <li>支持选择初始状态, 立即进入处理流程</li>
              <li>创建后可在订单列表统一管理</li>
            </ul>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
