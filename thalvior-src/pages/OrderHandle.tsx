// 订单处理中心 - 一个页面内 tabs 切换 6 个子状态
import { useState, useMemo } from 'react';
import {
  Table,
  Tag,
  Space,
  Button,
  Input,
  Form,
  Row,
  Col,
  Card,
  Typography,
  Statistic,
  Drawer,
  Descriptions,
  Empty,
  Modal,
  message,
  Select,
  InputNumber,
  Badge,
  Divider,
} from 'antd';
import {
  SearchOutlined,
  ReloadOutlined,
  SendOutlined,
  PayCircleOutlined,
  DollarOutlined,
  CheckOutlined,
  RollbackOutlined,
  EyeOutlined,
  ExclamationCircleOutlined,
  CloseCircleOutlined,
  PrinterOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { orderApi, shopApi, printApi } from '../api';
import { useConfirmAction } from '../hooks/useConfirmAction.tsx';
import { useSearchParams, useLocation } from 'react-router-dom';
import AuthButton from '../components/AuthButton';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

// 把后端返回的 HTML 写到新窗口, 让用户打印
function openPrintWindow(html: string, title = '打印') {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) {
    message.error('浏览器拦截了弹窗, 请允许弹窗后重试');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.document.title = title;
}

const TAB_DEFS: Array<{
  key: string;
  label: string;
  icon: any;
  color: string;
  statusLabel: string;
}> = [
  { key: 'pending', label: '待收款', icon: <PayCircleOutlined />, color: '#fa8c16', statusLabel: 'pending' },
  { key: 'pay', label: '已付款', icon: <DollarOutlined />, color: '#2db7f5', statusLabel: 'pay' },
  { key: 'toship', label: '待发货', icon: <SendOutlined />, color: '#1677ff', statusLabel: 'toship' },
  { key: 'shipped', label: '已发货', icon: <SendOutlined rotate={180} />, color: '#13c2c2', statusLabel: 'shipped' },
  { key: 'done', label: '已完成', icon: <CheckOutlined />, color: '#52c41a', statusLabel: 'done' },
  { key: 'cancel', label: '已取消', icon: <CloseCircleOutlined />, color: '#999', statusLabel: 'cancel' },
  { key: 'abnormal', label: '异常订单', icon: <ExclamationCircleOutlined />, color: '#ff4d4f', statusLabel: 'refund' },
];

const STATUS_BADGE: Record<string, { color: string; label: string }> = {
  pending: { color: 'orange', label: '待付款' },
  pay: { color: 'gold', label: '已付款' },
  toship: { color: 'blue', label: '待发货' },
  shipped: { color: 'cyan', label: '已发货' },
  done: { color: 'green', label: '已完成' },
  cancel: { color: 'default', label: '已取消' },
  refund: { color: 'red', label: '退款中' },
};

export default function OrderHandle() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  // 根据当前路径推断 active tab
  const pathKey: Record<string, string> = {
    '/order/handle/pending': 'pending',
    '/order/handle/pay': 'pay',
    '/order/handle/toship': 'toship',
    '/order/handle/ship': 'toship',
    '/order/handle/shipped': 'shipped',
    '/order/handle/done': 'done',
    '/order/handle/cancel': 'cancel',
    '/order/handle/abnormal': 'abnormal',
  };
  const pathTab = pathKey[location.pathname];
  const activeTab = pathTab || searchParams.get('tab') || 'pending';
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 15 });
  const [detail, setDetail] = useState<any | null>(null);
  const [shipOrder, setShipOrder] = useState<any | null>(null);
  const [cancelOrder, setCancelOrder] = useState<any | null>(null);
  const [refundOrder, setRefundOrder] = useState<any | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [printingPick, setPrintingPick] = useState(false);
  const qc = useQueryClient();
  const { confirmModal, runWithConfirm } = useConfirmAction();

  const currentTab = TAB_DEFS.find((t) => t.key === activeTab) || TAB_DEFS[1];

  const apiParams = useMemo(
    () => ({ ...filters, status: currentTab.statusLabel }),
    [filters, currentTab.statusLabel],
  );
  const { data, isLoading } = useQuery({
    queryKey: ['orders', apiParams],
    queryFn: () => orderApi.list(apiParams),
  });
  const { data: stats } = useQuery({
    queryKey: ['order-stats'],
    queryFn: () => orderApi.stats(),
    refetchInterval: 15000,
  });
  const { data: shopsResp } = useQuery({
    queryKey: ['shops-all'],
    queryFn: () => shopApi.list({ page: 1, pageSize: 200 }),
  });
  const shopMap: Record<string, any> = useMemo(() => {
    const m: Record<string, any> = {};
    for (const s of (shopsResp?.items || [])) m[s.id] = s;
    return m;
  }, [shopsResp]);

  const items = data?.items || [];
  const total = data?.total || 0;
  const totalAmount = items.reduce((s: number, o: any) => s + (o.totalAmount || 0), 0);

  const handleShip = async (id: string, values: any) => {
    try {
      await orderApi.ship(id, values);
      message.success('发货成功, 库存已扣减');
      setShipOrder(null);
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order-stats'] });
    } catch (e: any) {
      message.error(e?.message || '发货失败');
    }
  };
  const handleCancel = async (id: string, reason: string) => {
    runWithConfirm(
      {
        action: 'order.cancel',
        description: `即将取消订单 (${id.slice(0, 8)}). 已付款订单将自动退款, 请确认。`,
        keyword: 'CANCEL',
        payload: { orderId: id, reason },
        highlight: [
          { label: '订单 ID', value: id.slice(0, 8) + '...' },
          { label: '原因', value: reason },
        ],
        countdownSec: 3,
      },
      async (token) => {
        try {
          await orderApi.cancel(id, { reason, confirmToken: token });
          message.success('订单已取消');
          setCancelOrder(null);
          qc.invalidateQueries({ queryKey: ['orders'] });
          qc.invalidateQueries({ queryKey: ['order-stats'] });
        } catch (e: any) {
          message.error(e?.message || '取消失败');
          throw e;
        }
      },
    );
  };
  const handleRefund = async (id: string, values: any) => {
    const order = items.find((o: any) => o.id === id);
    const orderNo = order?.platformNo || id.slice(0, 8);
    runWithConfirm(
      {
        action: 'order.refund',
        description: `即将为订单 ${orderNo} 退款 ${values.amount} ${order?.currency || ''}。此操作会扣减财务收入并退回库存。`,
        keyword: 'REFUND',
        payload: { orderId: id, amount: values.amount, reason: values.reason || '' },
        highlight: [
          { label: '订单号', value: orderNo },
          { label: '退款金额', value: `${values.amount} ${order?.currency || ''}`, danger: true },
          { label: '原因', value: values.reason },
        ],
        countdownSec: 3,
      },
      async (token) => {
        try {
          await orderApi.refund(id, { amount: values.amount, reason: values.reason, confirmToken: token });
          message.success('退款已处理');
          setRefundOrder(null);
          qc.invalidateQueries({ queryKey: ['orders'] });
          qc.invalidateQueries({ queryKey: ['order-stats'] });
        } catch (e: any) {
          message.error(e?.message || '退款失败');
          throw e;
        }
      },
    );
  };
  const handleComplete = async (id: string) => {
    try {
      await orderApi.complete(id);
      message.success('已标记完成');
      qc.invalidateQueries({ queryKey: ['orders'] });
    } catch (e: any) {
      message.error(e?.message || '操作失败');
    }
  };
  const handlePay = async (id: string) => {
    try {
      await orderApi.pay(id);
      message.success('已确认付款, 库存已锁定');
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order-stats'] });
    } catch (e: any) {
      message.error(e?.message || '付款确认失败');
    }
  };
  const handleToship = async (id: string) => {
    try {
      await orderApi.toship(id);
      message.success('已转入待发货');
      qc.invalidateQueries({ queryKey: ['orders'] });
    } catch (e: any) {
      message.error(e?.message || '操作失败');
    }
  };

  // 打印面单 (单个订单)
  const handlePrintLabel = async (order: any) => {
    try {
      const r: any = await printApi.label(order.id);
      message.success(`面单已生成 (${r.carrier} · ${r.trackingNo})`);
      openPrintWindow(r.html, `面单 ${order.platformNo}`);
    } catch (e: any) {
      message.error(e?.message || '生成面单失败');
    }
  };

  // 批量打印拣货单
  const handlePrintPicklist = async (ids: string[]) => {
    if (!ids.length) {
      message.warning('请先勾选要打印的订单');
      return;
    }
    setPrintingPick(true);
    try {
      const r: any = await printApi.picklist(ids);
      message.success(
        `拣货单已生成: ${r.summary.orderCount} 单 / ${r.summary.itemCount} SKU / ${r.summary.warehouseCount} 仓`,
      );
      openPrintWindow(r.html, `拣货单`);
    } catch (e: any) {
      message.error(e?.message || '生成拣货单失败');
    } finally {
      setPrintingPick(false);
    }
  };

  const columns: any[] = [
    {
      title: '平台订单号',
      dataIndex: 'platformNo',
      width: 180,
      fixed: 'left',
      render: (v: string, r: any) => (
        <a onClick={() => setDetail(r)}>
          <Space direction="vertical" size={0}>
            <span style={{ fontFamily: 'monospace' }}>{v}</span>
            <Tag color="blue" style={{ fontSize: 11 }}>{r.shop?.platform?.name || '-'}</Tag>
          </Space>
        </a>
      ),
    },
    {
      title: '店铺',
      dataIndex: 'shopId',
      width: 150,
      render: (v: string) => shopMap[v]?.name || v.slice(-6),
    },
    { title: '买家', dataIndex: 'buyerName', width: 130, render: (v: string) => v || '-' },
    {
      title: '国家',
      dataIndex: 'country',
      width: 80,
      render: (v: string) => <Tag>{v || '-'}</Tag>,
    },
    {
      title: '金额',
      dataIndex: 'totalAmount',
      width: 120,
      render: (v: number, r: any) => (
        <span style={{ color: '#cf1322', fontWeight: 600 }}>{v?.toFixed(2)} {r.currency}</span>
      ),
    },
    {
      title: '商品',
      key: 'items',
      render: (_: any, r: any) => (
        <span>
          {r.items?.length || 0} SKU, {r.items?.reduce((s: number, i: any) => s + i.quantity, 0)} 件
        </span>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (s: string) => {
        const m = STATUS_BADGE[s] || { color: 'default', label: s };
        return <Tag color={m.color}>{m.label}</Tag>;
      },
    },
    {
      title: '下单时间',
      dataIndex: 'createdAt',
      width: 140,
      render: (v: string) => dayjs(v).format('MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'op',
      width: 280,
      fixed: 'right',
      render: (_: any, r: any) => (
        <Space size={4} wrap>
          <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => setDetail(r)}>
            详情
          </Button>
          {r.status === 'pending' ? (
            <AuthButton size="small" type="link" perm="order:detail" icon={<PayCircleOutlined />} onClick={() => handlePay(r.id)}>
              确认收款
            </AuthButton>
          ) : null}
          {r.status === 'pay' ? (
            <AuthButton size="small" type="link" perm="order:detail" icon={<SendOutlined />} onClick={() => handleToship(r.id)}>
              进入待发货
            </AuthButton>
          ) : null}
          {r.status === 'pay' || r.status === 'toship' ? (
            <AuthButton size="small" type="link" perm="order:ship" icon={<SendOutlined />} onClick={() => setShipOrder(r)}>
              发货
            </AuthButton>
          ) : null}
          {(r.status === 'pending' || r.status === 'pay' || r.status === 'toship') ? (
            <AuthButton size="small" type="link" danger perm="order:cancel" icon={<CloseCircleOutlined />} onClick={() => setCancelOrder(r)}>
              取消
            </AuthButton>
          ) : null}
          {r.status === 'pay' || r.status === 'toship' || r.status === 'shipped' || r.status === 'done' ? (
            <AuthButton size="small" type="link" perm="order:refund" icon={<RollbackOutlined />} onClick={() => setRefundOrder(r)}>
              退款
            </AuthButton>
          ) : null}
          {r.status === 'shipped' ? (
            <AuthButton size="small" type="link" perm="order:detail" icon={<CheckOutlined />} onClick={() => handleComplete(r.id)}>
              完成
            </AuthButton>
          ) : null}
          <AuthButton size="small" type="link" perm="order:print" icon={<PrinterOutlined />} onClick={() => handlePrintLabel(r)}>
            面单
          </AuthButton>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>订单处理</Title>
      <Text type="secondary">按订单状态分桶处理, 支持批量发货/取消/退款</Text>

      <Row gutter={16} style={{ marginTop: 12, marginBottom: 16 }}>
        {TAB_DEFS.map((t) => (
          <Col span={4} key={t.key}>
            <Card
              hoverable
              size="small"
              onClick={() => {
                setSearchParams({ tab: t.key });
                setFilters({ page: 1, pageSize: 15 });
              }}
              style={activeTab === t.key ? { borderColor: t.color, boxShadow: `0 0 0 1px ${t.color}` } : {}}
            >
              <Statistic
                title={
                  <Space>
                    <span style={{ color: t.color }}>{t.icon}</span>
                    {t.label}
                  </Space>
                }
                value={(stats as any)?.[t.statusLabel] || 0}
                valueStyle={{ color: t.color, fontSize: 20 }}
              />
            </Card>
          </Col>
        ))}
      </Row>

      <Card bordered={false} title={
        <Space>
          <span style={{ color: currentTab.color }}>{currentTab.icon}</span>
          {currentTab.label}
          <Badge count={total} showZero color={currentTab.color} />
        </Space>
      }>
        <Form
          layout="inline"
          style={{ marginBottom: 16 }}
          onFinish={(v) => setFilters((f: any) => ({ ...f, ...v, page: 1 }))}
        >
          <Form.Item name="keyword">
            <Input placeholder="订单号 / 买家名 / 邮箱" allowClear prefix={<SearchOutlined />} style={{ width: 260 }} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">搜索</Button>
              <Button icon={<ReloadOutlined />} onClick={() => setFilters({ page: 1, pageSize: 15 })}>重置</Button>
            </Space>
          </Form.Item>
        </Form>

        <div style={{ marginBottom: 12, color: '#999', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>
            本页金额合计: <span style={{ color: '#cf1322', fontWeight: 600 }}>{totalAmount.toFixed(2)}</span> (含 {items.length} 单)
            {selectedIds.length > 0 && (
              <span style={{ marginLeft: 16, color: '#1677ff' }}>
                · 已选 <b>{selectedIds.length}</b> 单
              </span>
            )}
          </span>
          <Space>
            <AuthButton
              icon={<FileTextOutlined />}
              onClick={() => handlePrintPicklist(selectedIds)}
              loading={printingPick}
              perm="order:print"
            >
              打印拣货单 ({selectedIds.length || 0})
            </AuthButton>
            <Button
              size="small"
              onClick={() => setSelectedIds(items.map((i: any) => i.id))}
            >
              全选当前页
            </Button>
            <Button
              size="small"
              onClick={() => setSelectedIds([])}
              disabled={selectedIds.length === 0}
            >
              清空选择
            </Button>
          </Space>
        </div>

        {items.length ? (
          <Table
            size="middle"
            columns={columns}
            dataSource={items}
            loading={isLoading}
            rowKey="id"
            rowSelection={{
              selectedRowKeys: selectedIds,
              onChange: (keys) => setSelectedIds(keys as string[]),
            }}
            scroll={{ x: 1400 }}
            pagination={{
              current: filters.page,
              pageSize: filters.pageSize,
              total,
              showSizeChanger: true,
              showTotal: (t) => `共 ${t} 条`,
              onChange: (page, pageSize) => setFilters((f: any) => ({ ...f, page, pageSize })),
            }}
          />
        ) : (
          !isLoading && <Empty description="暂无订单" />
        )}
      </Card>

      <Drawer title="订单详情" open={!!detail} onClose={() => setDetail(null)} width={720} extra={
        detail && (
          <Space>
            <Button icon={<PrinterOutlined />} onClick={() => handlePrintLabel(detail)}>
              打印面单
            </Button>
            <Button icon={<FileTextOutlined />} onClick={() => handlePrintPicklist([detail.id])}>
              拣货单
            </Button>
          </Space>
        )
      }>
        {detail && (
          <>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="平台订单号" span={2}>
                <code>{detail.platformNo}</code>
              </Descriptions.Item>
              <Descriptions.Item label="店铺">{detail.shop?.name}</Descriptions.Item>
              <Descriptions.Item label="平台">{detail.shop?.platform?.name}</Descriptions.Item>
              <Descriptions.Item label="买家">{detail.buyerName || '-'}</Descriptions.Item>
              <Descriptions.Item label="邮箱">{detail.buyerEmail || '-'}</Descriptions.Item>
              <Descriptions.Item label="国家">{detail.country || '-'}</Descriptions.Item>
              <Descriptions.Item label="状态"><Tag color={STATUS_BADGE[detail.status]?.color}>{STATUS_BADGE[detail.status]?.label || detail.status}</Tag></Descriptions.Item>
              <Descriptions.Item label="订单金额" span={2}>
                <span style={{ color: '#cf1322', fontWeight: 600, fontSize: 16 }}>{detail.totalAmount} {detail.currency}</span>
              </Descriptions.Item>
              <Descriptions.Item label="运费">{detail.shipFee}</Descriptions.Item>
              <Descriptions.Item label="成本">{detail.costAmount}</Descriptions.Item>
              <Descriptions.Item label="付款时间">{detail.payTime ? dayjs(detail.payTime).format('YYYY-MM-DD HH:mm') : '-'}</Descriptions.Item>
              <Descriptions.Item label="发货时间">{detail.shipTime ? dayjs(detail.shipTime).format('YYYY-MM-DD HH:mm') : '-'}</Descriptions.Item>
              {detail.remark && <Descriptions.Item label="备注" span={2}>{detail.remark}</Descriptions.Item>}
            </Descriptions>
            <Divider>商品明细 ({detail.items?.length || 0})</Divider>
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={detail.items || []}
              columns={[
                { title: 'SKU', dataIndex: 'sku' },
                { title: '商品', dataIndex: 'productName' },
                { title: '数量', dataIndex: 'quantity', width: 80 },
                { title: '单价', dataIndex: 'price', width: 100, render: (v: number) => v?.toFixed(2) },
                { title: '小计', dataIndex: 'amount', width: 100, render: (v: number) => v?.toFixed(2) },
              ]}
            />
          </>
        )}
      </Drawer>

      <ShipModal order={shipOrder} onClose={() => setShipOrder(null)} onSubmit={handleShip} />
      <CancelModal order={cancelOrder} onClose={() => setCancelOrder(null)} onSubmit={handleCancel} />
      <RefundModal order={refundOrder} onClose={() => setRefundOrder(null)} onSubmit={handleRefund} />

      {confirmModal}
    </div>
  );
}

function ShipModal({ order, onClose, onSubmit }: { order: any; onClose: () => void; onSubmit: (id: string, v: any) => void }) {
  const [form] = Form.useForm();
  if (!order) return null;
  return (
    <Modal
      title={`发货 - ${order.platformNo}`}
      open={!!order}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="确认发货"
    >
      <Form form={form} layout="vertical" onFinish={(v) => onSubmit(order.id, v)} initialValues={{ carrier: 'UPS' }}>
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
        <Form.Item label="运单号" name="trackingNo" rules={[{ required: true, message: '请输入运单号' }]}>
          <Input placeholder="物流单号" />
        </Form.Item>
        <Form.Item label="备注" name="remark">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function CancelModal({ order, onClose, onSubmit }: { order: any; onClose: () => void; onSubmit: (id: string, reason: string) => void }) {
  const [reason, setReason] = useState('');
  if (!order) return null;
  return (
    <Modal
      title={`取消订单 - ${order.platformNo}`}
      open={!!order}
      onCancel={onClose}
      onOk={() => reason && onSubmit(order.id, reason)}
      okText="确认取消"
      okButtonProps={{ danger: true, disabled: !reason }}
    >
      <p>订单金额: <b>{order.totalAmount} {order.currency}</b></p>
      <Input.TextArea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="请输入取消原因"
        rows={3}
      />
    </Modal>
  );
}

function RefundModal({ order, onClose, onSubmit }: { order: any; onClose: () => void; onSubmit: (id: string, v: any) => void }) {
  const [form] = Form.useForm();
  if (!order) return null;
  return (
    <Modal
      title={`退款 - ${order.platformNo}`}
      open={!!order}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="确认退款"
    >
      <Form form={form} layout="vertical" onFinish={(v) => onSubmit(order.id, v)} initialValues={{ amount: order.totalAmount, reason: '买家申请' }}>
        <Form.Item label="退款金额" name="amount" rules={[{ required: true }]}>
          <InputNumber
            style={{ width: '100%' }}
            min={0.01}
            max={order.totalAmount}
            addonAfter={order.currency}
          />
        </Form.Item>
        <Form.Item label="退款原因" name="reason" rules={[{ required: true }]}>
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
