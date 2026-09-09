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

const { Title, Text } = Typography;

const STATUS = [
  { value: 'pending', label: '待付款', color: 'orange' },
  { value: 'pay', label: '已付款', color: 'blue' },
  { value: 'toship', label: '待发货', color: 'gold' },
  { value: 'shipped', label: '已发货', color: 'cyan' },
  { value: 'done', label: '已完成', color: 'green' },
  { value: 'cancel', label: '已取消', color: 'default' },
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
  const { confirmModal, runWithConfirm } = useConfirmAction();

  const { data, isLoading } = useQuery({
    queryKey: ['orders', filters],
    queryFn: () => orderApi.list(filters),
  });

  // 批量操作 mutations
  const batchShipMut = useMutation({
    mutationFn: orderApi.batchShip,
    onSuccess: (res: any) => {
      message.success(`批量发货: 成功 ${res.success}, 失败 ${res.failed}`);
      setShipModal({ open: false, ids: [] });
      setSelectedRowKeys([]);
      shipForm.resetFields();
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order-stats'] });
    },
    onError: (e: any) => message.error(e?.message || '批量发货失败'),
  });
  const batchCancelMut = useMutation({
    mutationFn: orderApi.batchCancel,
    onSuccess: (res: any) => {
      message.success(`批量取消: 成功 ${res.success}, 失败 ${res.failed}`);
      setCancelModal({ open: false, ids: [] });
      setSelectedRowKeys([]);
      cancelForm.resetFields();
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order-stats'] });
    },
    onError: (e: any) => message.error(e?.message || '批量取消失败'),
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
    if (!selectedRowKeys.length) return message.warning('请先选择订单');
    setShipModal({ open: true, ids: selectedRowKeys as string[] });
  };
  const triggerBatchCancel = () => {
    if (!selectedRowKeys.length) return message.warning('请先选择订单');
    setCancelModal({ open: true, ids: selectedRowKeys as string[] });
  };

  // 提交批量取消 - 走二次确认
  const submitBatchCancel = (vals: any) => {
    const ids = cancelModal.ids;
    const reason = vals.reason;
    runWithConfirm(
      {
        action: 'order.cancel',
        description: `即将批量取消 ${ids.length} 个订单。已付款订单将自动退款, 请谨慎操作。`,
        keyword: 'BATCH-CANCEL',
        payload: { count: ids.length, reason, ids: ids.slice(0, 3).join(',') },
        highlight: [
          { label: '取消订单数', value: ids.length, danger: true },
          { label: '取消原因', value: reason },
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
      title: '订单号',
      dataIndex: 'platformNo',
      width: 180,
      fixed: 'left' as const,
      render: (v: string, r: any) => (
        <a onClick={() => setDetail(r)}>{v}</a>
      ),
    },
    {
      title: '平台',
      dataIndex: ['shop', 'platform', 'name'],
      width: 110,
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    { title: '店铺', dataIndex: ['shop', 'name'], width: 180, ellipsis: true },
    { title: '买家', dataIndex: 'buyerName', width: 130 },
    { title: '国家', dataIndex: 'country', width: 80 },
    {
      title: '商品',
      dataIndex: 'items',
      width: 220,
      ellipsis: true,
      render: (items: any[]) => items?.map((i) => i.productName).join(' / '),
    },
    {
      title: '数量',
      dataIndex: 'items',
      width: 70,
      align: 'right' as const,
      render: (items: any[]) => items?.reduce((s, i) => s + i.quantity, 0) || 0,
    },
    {
      title: '金额',
      dataIndex: 'totalAmount',
      width: 120,
      align: 'right' as const,
      render: (v: number, r: any) => `${r.currency} ${(+v).toFixed(2)}`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => {
        const s = STATUS_MAP[v] || { label: v, color: 'default' };
        return <Tag color={s.color}>{s.label}</Tag>;
      },
    },
    {
      title: '下单时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'op',
      width: 110,
      fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Button type="link" icon={<EyeOutlined />} onClick={() => setDetail(r)}>
          详情
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
      <Title level={4} style={{ marginTop: 0 }}>订单列表</Title>
      <Text type="secondary">跨平台多店铺订单统一管理 · 共 {total} 笔</Text>

      <Row gutter={16} style={{ marginTop: 12 }}>
        <Col span={6}><Card bordered={false}><Text type="secondary">当前页订单数</Text><div style={{ fontSize: 22, fontWeight: 600 }}>{items.length}</div></Card></Col>
        <Col span={6}><Card bordered={false}><Text type="secondary">商品件数</Text><div style={{ fontSize: 22, fontWeight: 600 }}>{totalQty}</div></Card></Col>
        <Col span={6}><Card bordered={false}><Text type="secondary">当前页总额</Text><div style={{ fontSize: 22, fontWeight: 600 }}>{totalAmount.toFixed(2)}</div></Card></Col>
        <Col span={6}><Card bordered={false}><Text type="secondary">待发货</Text><div style={{ fontSize: 22, fontWeight: 600, color: '#1677ff' }}>{toship}</div></Card></Col>
      </Row>

      <Card style={{ marginTop: 16 }} bordered={false}>
        <Form form={form} layout="inline" onFinish={onSearch}>
          <Form.Item name="platformNo"><Input placeholder="订单号" allowClear prefix={<SearchOutlined />} /></Form.Item>
          <Form.Item name="status">
            <Select placeholder="状态" allowClear style={{ width: 140 }} options={STATUS.map((s) => ({ label: s.label, value: s.value }))} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" icon={<FilterOutlined />}>筛选</Button>
              <Button onClick={onReset} icon={<ReloadOutlined />}>重置</Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      <Card
        style={{ marginTop: 16 }}
        bordered={false}
        title="订单数据"
        extra={
          <Space wrap>
            {selectedRowKeys.length > 0 && (
              <Space>
                <Tag color="blue">已选 {selectedRowKeys.length} 单</Tag>
                <Button size="small" icon={<SendOutlined />} onClick={triggerBatchShip}>批量发货</Button>
                <Button size="small" danger icon={<CloseCircleOutlined />} onClick={triggerBatchCancel}>批量取消</Button>
              </Space>
            )}
            <Button icon={<PrinterOutlined />}>批量打印</Button>
            <ExportButton type="orders" filters={filters} variant="default" />
            <Button icon={<RollbackOutlined />} onClick={() => nav('/order/handle/toship')}>订单处理</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => nav('/order/manual')}>手工订单</Button>
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
            showTotal: (t) => `共 ${t} 条`,
            onChange: (page, pageSize) => setFilters((f: any) => ({ ...f, page, pageSize })),
          }}
          bordered={false}
        />
      </Card>

      <Drawer
        title={detail ? `订单详情 - ${detail.platformNo}` : '订单详情'}
        open={!!detail}
        onClose={() => setDetail(null)}
        width={560}
      >
        {detail && (
          <>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="平台">{detail.shop?.platform?.name}</Descriptions.Item>
              <Descriptions.Item label="店铺">{detail.shop?.name}</Descriptions.Item>
              <Descriptions.Item label="买家">{detail.buyerName}</Descriptions.Item>
              <Descriptions.Item label="邮箱">{detail.buyerEmail}</Descriptions.Item>
              <Descriptions.Item label="国家">{detail.country}</Descriptions.Item>
              <Descriptions.Item label="状态"><Tag color={STATUS_MAP[detail.status]?.color}>{STATUS_MAP[detail.status]?.label}</Tag></Descriptions.Item>
              <Descriptions.Item label="下单时间">{dayjs(detail.createdAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
              <Descriptions.Item label="付款时间">{detail.payTime ? dayjs(detail.payTime).format('YYYY-MM-DD HH:mm') : '-'}</Descriptions.Item>
              <Descriptions.Item label="发货时间">{detail.shipTime ? dayjs(detail.shipTime).format('YYYY-MM-DD HH:mm') : '-'}</Descriptions.Item>
              {detail.remark && <Descriptions.Item label="备注">{detail.remark}</Descriptions.Item>}
            </Descriptions>
            <Divider>商品信息</Divider>
            <Table
              size="small"
              pagination={false}
              dataSource={detail.items}
              rowKey="id"
              columns={[
                { title: 'SKU', dataIndex: 'sku', width: 110 },
                { title: '商品', dataIndex: 'productName' },
                { title: '数量', dataIndex: 'quantity', width: 70, align: 'right' },
                { title: '单价', dataIndex: 'price', width: 100, align: 'right', render: (v) => (+v).toFixed(2) },
                { title: '小计', dataIndex: 'amount', width: 100, align: 'right', render: (v) => (+v).toFixed(2) },
              ]}
            />
            <Divider>金额汇总</Divider>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="商品总额">{detail.currency} {(+(detail.totalAmount) - (+detail.shipFee)).toFixed(2)}</Descriptions.Item>
              <Descriptions.Item label="物流费">{detail.currency} {(+detail.shipFee).toFixed(2)}</Descriptions.Item>
              <Descriptions.Item label="合计"><b style={{ color: '#1677ff', fontSize: 16 }}>{detail.currency} {(+detail.totalAmount).toFixed(2)}</b></Descriptions.Item>
            </Descriptions>
          </>
        )}
      </Drawer>

      {/* 批量发货弹窗 */}
      <Modal
        title={`批量发货 - 共 ${shipModal.ids.length} 单`}
        open={shipModal.open}
        onCancel={() => setShipModal({ open: false, ids: [] })}
        onOk={() => shipForm.submit()}
        okText="确认发货"
        confirmLoading={batchShipMut.isPending}
      >
        <Form form={shipForm} layout="vertical" initialValues={{ carrier: 'UPS' }} onFinish={(v) => batchShipMut.mutate({ ids: shipModal.ids, ...v })}>
          <Form.Item label="物流公司" name="carrier" rules={[{ required: true }]}>
            <Select options={[
              { value: 'UPS', label: 'UPS' },
              { value: 'FedEx', label: 'FedEx' },
              { value: 'USPS', label: 'USPS' },
              { value: 'DHL', label: 'DHL' },
              { value: '顺丰国际', label: '顺丰国际' },
              { value: 'JNE', label: 'JNE (印尼)' },
              { value: 'Shopee Express', label: 'Shopee Express' },
            ]} />
          </Form.Item>
          <Form.Item label="统一运单号" name="trackingNo" rules={[{ required: true, message: '请输入运单号' }]}>
            <Input placeholder="物流单号 - 将用于所有选中订单" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 批量取消弹窗 */}
      <Modal
        title={`批量取消 - 共 ${cancelModal.ids.length} 单`}
        open={cancelModal.open}
        onCancel={() => setCancelModal({ open: false, ids: [] })}
        onOk={() => cancelForm.submit()}
        okText="确认取消"
        okButtonProps={{ danger: true }}
        confirmLoading={batchCancelMut.isPending}
      >
        <Form form={cancelForm} layout="vertical" onFinish={submitBatchCancel}>
          <Form.Item label="取消原因" name="reason" rules={[{ required: true, message: '请输入取消原因' }]}>
            <Input.TextArea rows={3} placeholder="请输入取消原因, 将写入订单备注" />
          </Form.Item>
        </Form>
      </Modal>

      {confirmModal}
    </div>
  );
}
