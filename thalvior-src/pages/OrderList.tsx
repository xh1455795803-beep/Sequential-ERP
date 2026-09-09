import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Table,
  Tag,
  Space,
  Button,
  Input,
  Select,
  Form,
  Row,
  Col,
  Typography,
  Drawer,
  Descriptions,
  Divider,
  Modal,
  message,
} from 'antd';
import {
  SearchOutlined,
  ReloadOutlined,
  DownloadOutlined,
  PrinterOutlined,
  FilterOutlined,
  EyeOutlined,
  SendOutlined,
  CloseCircleOutlined,
  RollbackOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { orderApi } from '../api';
import { ExportButton } from '../components/ExportButton';
import { useConfirmAction } from '../hooks/useConfirmAction.tsx';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../i18n';

const { Title, Text } = Typography;

const STATUS = [
  { value: 'pending', labelKey: 'pages.orderList.status.pending', color: 'orange' },
  { value: 'pay', labelKey: 'pages.orderList.status.pay', color: 'blue' },
  { value: 'toship', labelKey: 'pages.orderList.status.toship', color: 'gold' },
  { value: 'shipped', labelKey: 'pages.orderList.status.shipped', color: 'cyan' },
  { value: 'done', labelKey: 'pages.orderList.status.done', color: 'green' },
  { value: 'cancel', labelKey: 'pages.orderList.status.cancel', color: 'default' },
];
const STATUS_MAP = Object.fromEntries(STATUS.map((s) => [s.value, s]));

export default function OrderList() {
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 10 });
  const [detail, setDetail] = useState<any | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [shipModal, setShipModal] = useState<{ open: boolean; ids: string[] }>({ open: false, ids: [] });
  const [cancelModal, setCancelModal] = useState<{ open: boolean; ids: string[] }>({ open: false, ids: [] });
  const [shipForm] = Form.useForm();
  const [cancelForm] = Form.useForm();
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { t } = useTranslation();
  const { confirmModal, runWithConfirm } = useConfirmAction();

  const { data, isLoading } = useQuery({
    queryKey: ['orders', filters],
    queryFn: () => orderApi.list(filters),
  });

  // 批量操作 mutations
  const batchShipMut = useMutation({
    mutationFn: orderApi.batchShip,
    onSuccess: (res: any) => {
      message.success(t('pages.orderList.batchShipResult', { success: res.success, failed: res.failed }));
      setShipModal({ open: false, ids: [] });
      setSelectedRowKeys([]);
      shipForm.resetFields();
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order-stats'] });
    },
    onError: (e: any) => message.error(e?.message || t('pages.orderList.batchShipFailed')),
  });
  const batchCancelMut = useMutation({
    mutationFn: orderApi.batchCancel,
    onSuccess: (res: any) => {
      message.success(t('pages.orderList.batchCancelResult', { success: res.success, failed: res.failed }));
      setCancelModal({ open: false, ids: [] });
      setSelectedRowKeys([]);
      cancelForm.resetFields();
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order-stats'] });
    },
    onError: (e: any) => message.error(e?.message || t('pages.orderList.batchCancelFailed')),
  });

  const onSearch = (vals: any) => {
    setFilters((f: any) => ({
      ...f,
      ...vals,
      page: 1,
      range: undefined,
    }));
  };
  const onReset = () => {
    form.resetFields();
    setFilters({ page: 1, pageSize: 10 });
  };

  // 批量操作触发
  const triggerBatchShip = () => {
    if (!selectedRowKeys.length) return message.warning(t('pages.orderList.selectOrderFirst'));
    setShipModal({ open: true, ids: selectedRowKeys as string[] });
  };
  const triggerBatchCancel = () => {
    if (!selectedRowKeys.length) return message.warning(t('pages.orderList.selectOrderFirst'));
    setCancelModal({ open: true, ids: selectedRowKeys as string[] });
  };

  // 提交批量取消 - 走二次确认
  const submitBatchCancel = (vals: any) => {
    const ids = cancelModal.ids;
    const reason = vals.reason;
    runWithConfirm(
      {
        action: 'order.cancel',
        description: t('pages.orderList.cancelConfirmDescription', { count: ids.length }),
        keyword: 'BATCH-CANCEL',
        payload: { count: ids.length, reason, ids: ids.slice(0, 3).join(',') },
        highlight: [
          { label: t('pages.orderList.cancelOrderCount'), value: ids.length, danger: true },
          { label: t('pages.orderList.cancelReason'), value: reason },
        ],
        countdownSec: 3,
      },
      async (token) => {
        await batchCancelMut.mutateAsync({ ids, reason, confirmToken: token });
      },
    );
  };

  const columns = [
    {
      title: t('pages.orderList.orderNo'),
      dataIndex: 'platformNo',
      width: 180,
      fixed: 'left' as const,
      render: (v: string, r: any) => (
        <a onClick={() => setDetail(r)}>{v}</a>
      ),
    },
    {
      title: t('pages.orderList.platform'),
      dataIndex: ['shop', 'platform', 'name'],
      width: 110,
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    { title: t('pages.orderList.shop'), dataIndex: ['shop', 'name'], width: 180, ellipsis: true },
    { title: t('pages.orderList.buyer'), dataIndex: 'buyerName', width: 130 },
    { title: t('pages.orderList.country'), dataIndex: 'country', width: 80 },
    {
      title: t('pages.orderList.product'),
      dataIndex: 'items',
      width: 220,
      ellipsis: true,
      render: (items: any[]) => items?.map((i) => i.productName).join(' / '),
    },
    {
      title: t('pages.orderList.quantity'),
      dataIndex: 'items',
      width: 70,
      align: 'right' as const,
      render: (items: any[]) => items?.reduce((s, i) => s + i.quantity, 0) || 0,
    },
    {
      title: t('pages.orderList.amount'),
      dataIndex: 'totalAmount',
      width: 120,
      align: 'right' as const,
      render: (v: number, r: any) => `${r.currency} ${(+v).toFixed(2)}`,
    },
    {
      title: t('pages.orderList.status'),
      dataIndex: 'status',
      width: 100,
      render: (v: string) => {
        const s = STATUS_MAP[v];
        return <Tag color={s?.color || 'default'}>{s ? t(s.labelKey) : v}</Tag>;
      },
    },
    {
      title: t('pages.orderList.createdAt'),
      dataIndex: 'createdAt',
      width: 160,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: t('pages.orderList.actions'),
      key: 'op',
      width: 110,
      fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Button type="link" icon={<EyeOutlined />} onClick={() => setDetail(r)}>
          {t('pages.orderList.detail')}
        </Button>
      ),
    },
  ];

  const total = data?.total || 0;
  const items = data?.items || [];
  const totalAmount = items.reduce((s, x) => s + (x.totalAmount || 0), 0);
  const totalQty = items.reduce((s, x) => s + (x.items?.reduce((ss: number, i: any) => ss + i.quantity, 0) || 0), 0);
  const toship = items.filter((x) => x.status === 'toship').length;

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>{t('pages.orderList.title')}</Title>
      <Text type="secondary">{t('pages.orderList.subtitle', { total })}</Text>

      <Row gutter={16} style={{ marginTop: 12 }}>
        <Col span={6}><Card bordered={false}><Text type="secondary">{t('pages.orderList.statCurrentPageOrders')}</Text><div style={{ fontSize: 22, fontWeight: 600 }}>{items.length}</div></Card></Col>
        <Col span={6}><Card bordered={false}><Text type="secondary">{t('pages.orderList.statProductCount')}</Text><div style={{ fontSize: 22, fontWeight: 600 }}>{totalQty}</div></Card></Col>
        <Col span={6}><Card bordered={false}><Text type="secondary">{t('pages.orderList.statCurrentPageTotal')}</Text><div style={{ fontSize: 22, fontWeight: 600 }}>{totalAmount.toFixed(2)}</div></Card></Col>
        <Col span={6}><Card bordered={false}><Text type="secondary">{t('pages.orderList.statToship')}</Text><div style={{ fontSize: 22, fontWeight: 600, color: '#1677ff' }}>{toship}</div></Card></Col>
      </Row>

      <Card style={{ marginTop: 16 }} bordered={false}>
        <Form form={form} layout="inline" onFinish={onSearch}>
          <Form.Item name="platformNo"><Input placeholder={t('pages.orderList.orderNo')} allowClear prefix={<SearchOutlined />} /></Form.Item>
          <Form.Item name="status">
            <Select placeholder={t('pages.orderList.status')} allowClear style={{ width: 140 }} options={STATUS.map((s) => ({ label: t(s.labelKey), value: s.value }))} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" icon={<FilterOutlined />}>{t('pages.orderList.filter')}</Button>
              <Button onClick={onReset} icon={<ReloadOutlined />}>{t('pages.orderList.reset')}</Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      <Card
        style={{ marginTop: 16 }}
        bordered={false}
        title={t('pages.orderList.orderData')}
        extra={
          <Space wrap>
            {selectedRowKeys.length > 0 && (
              <Space>
                <Tag color="blue">{t('pages.orderList.selectedCount', { count: selectedRowKeys.length })}</Tag>
                <Button size="small" icon={<SendOutlined />} onClick={triggerBatchShip}>{t('pages.orderList.batchShip')}</Button>
                <Button size="small" danger icon={<CloseCircleOutlined />} onClick={triggerBatchCancel}>{t('pages.orderList.batchCancel')}</Button>
              </Space>
            )}
            <Button icon={<PrinterOutlined />}>{t('pages.orderList.batchPrint')}</Button>
            <ExportButton type="orders" filters={filters} variant="default" />
            <Button icon={<RollbackOutlined />} onClick={() => nav('/order/handle/toship')}>{t('pages.orderList.orderHandle')}</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => nav('/order/manual')}>{t('pages.orderList.manualOrder')}</Button>
          </Space>
        }
      >
        <Table
          size="middle"
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
            preserveSelectedRowKeys: true,
          }}
          columns={columns as any}
          dataSource={items}
          loading={isLoading}
          rowKey="id"
          scroll={{ x: 1500 }}
          pagination={{
            current: filters.page,
            pageSize: filters.pageSize,
            total,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (count) => t('pages.orderList.totalCount', { total: count }),
            onChange: (page, pageSize) => setFilters((f: any) => ({ ...f, page, pageSize })),
          }}
          bordered={false}
        />
      </Card>

      <Drawer
        title={detail ? t('pages.orderList.detailTitleWithNo', { platformNo: detail.platformNo }) : t('pages.orderList.detailTitle')}
        open={!!detail}
        onClose={() => setDetail(null)}
        width={560}
      >
        {detail && (
          <>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label={t('pages.orderList.platform')}>{detail.shop?.platform?.name}</Descriptions.Item>
              <Descriptions.Item label={t('pages.orderList.shop')}>{detail.shop?.name}</Descriptions.Item>
              <Descriptions.Item label={t('pages.orderList.buyer')}>{detail.buyerName}</Descriptions.Item>
              <Descriptions.Item label={t('pages.orderList.email')}>{detail.buyerEmail}</Descriptions.Item>
              <Descriptions.Item label={t('pages.orderList.country')}>{detail.country}</Descriptions.Item>
              <Descriptions.Item label={t('pages.orderList.status')}><Tag color={STATUS_MAP[detail.status]?.color}>{STATUS_MAP[detail.status] ? t(STATUS_MAP[detail.status].labelKey) : detail.status}</Tag></Descriptions.Item>
              <Descriptions.Item label={t('pages.orderList.createdAt')}>{dayjs(detail.createdAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
              <Descriptions.Item label={t('pages.orderList.payTime')}>{detail.payTime ? dayjs(detail.payTime).format('YYYY-MM-DD HH:mm') : '-'}</Descriptions.Item>
              <Descriptions.Item label={t('pages.orderList.shipTime')}>{detail.shipTime ? dayjs(detail.shipTime).format('YYYY-MM-DD HH:mm') : '-'}</Descriptions.Item>
              {detail.remark && <Descriptions.Item label={t('pages.orderList.remark')}>{detail.remark}</Descriptions.Item>}
            </Descriptions>
            <Divider>{t('pages.orderList.productInfo')}</Divider>
            <Table
              size="small"
              pagination={false}
              dataSource={detail.items}
              rowKey="id"
              columns={[
                { title: 'SKU', dataIndex: 'sku', width: 110 },
                { title: t('pages.orderList.product'), dataIndex: 'productName' },
                { title: t('pages.orderList.quantity'), dataIndex: 'quantity', width: 70, align: 'right' },
                { title: t('pages.orderList.unitPrice'), dataIndex: 'price', width: 100, align: 'right', render: (v) => (+v).toFixed(2) },
                { title: t('pages.orderList.subtotal'), dataIndex: 'amount', width: 100, align: 'right', render: (v) => (+v).toFixed(2) },
              ]}
            />
            <Divider>{t('pages.orderList.amountSummary')}</Divider>
            <Descriptions column={1} size="small">
              <Descriptions.Item label={t('pages.orderList.productTotal')}>{detail.currency} {(+(detail.totalAmount) - (+detail.shipFee)).toFixed(2)}</Descriptions.Item>
              <Descriptions.Item label={t('pages.orderList.shipFee')}>{detail.currency} {(+detail.shipFee).toFixed(2)}</Descriptions.Item>
              <Descriptions.Item label={t('pages.orderList.total')}><b style={{ color: '#1677ff', fontSize: 16 }}>{detail.currency} {(+detail.totalAmount).toFixed(2)}</b></Descriptions.Item>
            </Descriptions>
          </>
        )}
      </Drawer>

      {/* 批量发货弹窗 */}
      <Modal
        title={t('pages.orderList.batchShipTitle', { count: shipModal.ids.length })}
        open={shipModal.open}
        onCancel={() => setShipModal({ open: false, ids: [] })}
        onOk={() => shipForm.submit()}
        okText={t('pages.orderList.confirmShip')}
        confirmLoading={batchShipMut.isPending}
      >
        <Form form={shipForm} layout="vertical" initialValues={{ carrier: 'UPS' }} onFinish={(v) => batchShipMut.mutate({ ids: shipModal.ids, ...v })}>
          <Form.Item label={t('pages.orderList.carrier')} name="carrier" rules={[{ required: true }]}>
            <Select options={[
              { value: 'UPS', label: 'UPS' },
              { value: 'FedEx', label: 'FedEx' },
              { value: 'USPS', label: 'USPS' },
              { value: 'DHL', label: 'DHL' },
              { value: '顺丰国际', label: t('pages.orderList.carrierSfExp') },
              { value: 'JNE', label: t('pages.orderList.carrierJne') },
              { value: 'Shopee Express', label: 'Shopee Express' },
            ]} />
          </Form.Item>
          <Form.Item label={t('pages.orderList.trackingNo')} name="trackingNo" rules={[{ required: true, message: t('pages.orderList.trackingNoRequired') }]}>
            <Input placeholder={t('pages.orderList.trackingPlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 批量取消弹窗 */}
      <Modal
        title={t('pages.orderList.batchCancelTitle', { count: cancelModal.ids.length })}
        open={cancelModal.open}
        onCancel={() => setCancelModal({ open: false, ids: [] })}
        onOk={() => cancelForm.submit()}
        okText={t('pages.orderList.confirmCancel')}
        okButtonProps={{ danger: true }}
        confirmLoading={batchCancelMut.isPending}
      >
        <Form form={cancelForm} layout="vertical" onFinish={submitBatchCancel}>
          <Form.Item label={t('pages.orderList.cancelReason')} name="reason" rules={[{ required: true, message: t('pages.orderList.cancelReasonRequired') }]}>
            <Input.TextArea rows={3} placeholder={t('pages.orderList.cancelReasonPlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>

      {confirmModal}
    </div>
  );
}
