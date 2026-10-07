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
import { useTranslation } from '../i18n';
import { zhCN } from '../i18n/locales';

const { Title, Text } = Typography;

// 把后端返回的 HTML 写到新窗口, 让用户打印
function openPrintWindow(html: string, title: string) {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) {
    // 模块级函数无 hook 可用, 直接用 zhCN 主字典作为 fallback (保证永远有值, 不影响默认语言体验)
    const msg: string = (zhCN as any).pages?.orderHandle?.msg?.popupBlocked
      || '浏览器拦截了弹窗, 请允许弹窗后重试';
    message.error(msg);
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.document.title = title;
}

// TAB_DEFS 工厂: 因为 label 需要 t() 动态翻译
function makeTabDefs(t: (key: string, params?: Record<string, string | number>) => string) {
  return [
    { key: 'pending', label: t('pages.orderHandle.tab.pending'), icon: <PayCircleOutlined />, color: '#fa8c16', statusLabel: 'pending' },
    { key: 'pay', label: t('pages.orderHandle.tab.pay'), icon: <DollarOutlined />, color: '#2db7f5', statusLabel: 'pay' },
    { key: 'toship', label: t('pages.orderHandle.tab.toship'), icon: <SendOutlined />, color: '#1677ff', statusLabel: 'toship' },
    { key: 'shipped', label: t('pages.orderHandle.tab.shipped'), icon: <SendOutlined rotate={180} />, color: '#13c2c2', statusLabel: 'shipped' },
    { key: 'done', label: t('pages.orderHandle.tab.done'), icon: <CheckOutlined />, color: '#52c41a', statusLabel: 'done' },
    { key: 'cancel', label: t('pages.orderHandle.tab.cancel'), icon: <CloseCircleOutlined />, color: '#999', statusLabel: 'cancel' },
    { key: 'abnormal', label: t('pages.orderHandle.tab.abnormal'), icon: <ExclamationCircleOutlined />, color: '#ff4d4f', statusLabel: 'refund' },
  ];
}

function makeStatusBadge(t: (key: string, params?: Record<string, string | number>) => string) {
  return {
    pending: { color: 'orange', label: t('pages.orderHandle.status.pending') },
    pay: { color: 'gold', label: t('pages.orderHandle.status.pay') },
    toship: { color: 'blue', label: t('pages.orderHandle.status.toship') },
    shipped: { color: 'cyan', label: t('pages.orderHandle.status.shipped') },
    done: { color: 'green', label: t('pages.orderHandle.status.done') },
    cancel: { color: 'default', label: t('pages.orderHandle.status.cancel') },
    refund: { color: 'red', label: t('pages.orderHandle.status.refund') },
  } as Record<string, { color: string; label: string }>;
}

export default function OrderHandle() {
  const { t } = useTranslation();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const TAB_DEFS = useMemo(() => makeTabDefs(t), [t]);
  const STATUS_BADGE = useMemo(() => makeStatusBadge(t), [t]);

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

  const currentTab = TAB_DEFS.find((td) => td.key === activeTab) || TAB_DEFS[1];

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
      message.success(t('pages.orderHandle.msg.shipSuccess'));
      setShipOrder(null);
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order-stats'] });
    } catch (e: any) {
      message.error(e?.message || t('pages.orderHandle.msg.shipFailed'));
    }
  };
  const handleCancel = async (id: string, reason: string) => {
    runWithConfirm(
      {
        action: 'order.cancel',
        description: t('pages.orderHandle.confirm.cancelDescription', { orderId: id.slice(0, 8) }),
        keyword: 'CANCEL',
        payload: { orderId: id, reason },
        highlight: [
          { label: t('pages.orderHandle.confirm.orderId'), value: id.slice(0, 8) + '...' },
          { label: t('pages.orderHandle.confirm.reason'), value: reason },
        ],
        countdownSec: 3,
      },
      async (token) => {
        try {
          await orderApi.cancel(id, { reason, confirmToken: token });
          message.success(t('pages.orderHandle.msg.cancelSuccess'));
          setCancelOrder(null);
          qc.invalidateQueries({ queryKey: ['orders'] });
          qc.invalidateQueries({ queryKey: ['order-stats'] });
        } catch (e: any) {
          message.error(e?.message || t('pages.orderHandle.msg.cancelFailed'));
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
        description: t('pages.orderHandle.confirm.refundDescription', {
          orderNo,
          amount: values.amount,
          currency: order?.currency || '',
        }),
        keyword: 'REFUND',
        payload: { orderId: id, amount: values.amount, reason: values.reason || '' },
        highlight: [
          { label: t('pages.orderHandle.confirm.orderNo'), value: orderNo },
          { label: t('pages.orderHandle.confirm.refundAmount'), value: `${values.amount} ${order?.currency || ''}`, danger: true },
          { label: t('pages.orderHandle.confirm.reason'), value: values.reason },
        ],
        countdownSec: 3,
      },
      async (token) => {
        try {
          await orderApi.refund(id, { amount: values.amount, reason: values.reason, confirmToken: token });
          message.success(t('pages.orderHandle.msg.refundSuccess'));
          setRefundOrder(null);
          qc.invalidateQueries({ queryKey: ['orders'] });
          qc.invalidateQueries({ queryKey: ['order-stats'] });
        } catch (e: any) {
          message.error(e?.message || t('pages.orderHandle.msg.refundFailed'));
          throw e;
        }
      },
    );
  };
  const handleComplete = async (id: string) => {
    try {
      await orderApi.complete(id);
      message.success(t('pages.orderHandle.msg.completeSuccess'));
      qc.invalidateQueries({ queryKey: ['orders'] });
    } catch (e: any) {
      message.error(e?.message || t('pages.orderHandle.msg.opFailed'));
    }
  };
  const handlePay = async (id: string) => {
    try {
      await orderApi.pay(id);
      message.success(t('pages.orderHandle.msg.paySuccess'));
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order-stats'] });
    } catch (e: any) {
      message.error(e?.message || t('pages.orderHandle.msg.payFailed'));
    }
  };
  const handleToship = async (id: string) => {
    try {
      await orderApi.toship(id);
      message.success(t('pages.orderHandle.msg.toshipSuccess'));
      qc.invalidateQueries({ queryKey: ['orders'] });
    } catch (e: any) {
      message.error(e?.message || t('pages.orderHandle.msg.opFailed'));
    }
  };

  // 打印面单 (单个订单)
  const handlePrintLabel = async (order: any) => {
    try {
      const r: any = await printApi.label(order.id);
      message.success(t('pages.orderHandle.msg.labelGenerated', { carrier: r.carrier, trackingNo: r.trackingNo }));
      openPrintWindow(r.html, t('pages.orderHandle.print.labelTitle', { platformNo: order.platformNo }));
    } catch (e: any) {
      message.error(e?.message || t('pages.orderHandle.msg.labelFailed'));
    }
  };

  // 批量打印拣货单
  const handlePrintPicklist = async (ids: string[]) => {
    if (!ids.length) {
      message.warning(t('pages.orderHandle.msg.selectOrderFirst'));
      return;
    }
    setPrintingPick(true);
    try {
      const r: any = await printApi.picklist(ids);
      message.success(
        t('pages.orderHandle.msg.picklistGenerated', {
          orderCount: r.summary.orderCount,
          itemCount: r.summary.itemCount,
          warehouseCount: r.summary.warehouseCount,
        }),
      );
      openPrintWindow(r.html, t('pages.orderHandle.print.picklistTitle'));
    } catch (e: any) {
      message.error(e?.message || t('pages.orderHandle.msg.picklistFailed'));
    } finally {
      setPrintingPick(false);
    }
  };

  const columns: any[] = [
    {
      title: t('pages.orderHandle.col.platformNo'),
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
      title: t('pages.orderHandle.col.shop'),
      dataIndex: 'shopId',
      width: 150,
      render: (v: string) => shopMap[v]?.name || v.slice(-6),
    },
    {
      title: t('pages.orderHandle.col.buyer'),
      dataIndex: 'buyerName',
      width: 130,
      render: (v: string) => v || '-',
    },
    {
      title: t('pages.orderHandle.col.country'),
      dataIndex: 'country',
      width: 80,
      render: (v: string) => <Tag>{v || '-'}</Tag>,
    },
    {
      title: t('pages.orderHandle.col.amount'),
      dataIndex: 'totalAmount',
      width: 120,
      render: (v: number, r: any) => (
        <span style={{ color: '#cf1322', fontWeight: 600 }}>{v?.toFixed(2)} {r.currency}</span>
      ),
    },
    {
      title: t('pages.orderHandle.col.product'),
      key: 'items',
      render: (_: any, r: any) => (
        <span>
          {t('pages.orderHandle.col.productRender', {
            skuCount: r.items?.length || 0,
            totalQty: r.items?.reduce((s: number, i: any) => s + i.quantity, 0),
          })}
        </span>
      ),
    },
    {
      title: t('pages.orderHandle.col.status'),
      dataIndex: 'status',
      width: 100,
      render: (s: string) => {
        const m = STATUS_BADGE[s] || { color: 'default', label: s };
        return <Tag color={m.color}>{m.label}</Tag>;
      },
    },
    {
      title: t('pages.orderHandle.col.createdAt'),
      dataIndex: 'createdAt',
      width: 140,
      render: (v: string) => dayjs(v).format('MM-DD HH:mm'),
    },
    {
      title: t('pages.orderHandle.col.actions'),
      key: 'op',
      width: 280,
      fixed: 'right',
      render: (_: any, r: any) => (
        <Space size={4} wrap>
          <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => setDetail(r)}>
            {t('common.detail')}
          </Button>
          {r.status === 'pending' ? (
            <AuthButton size="small" type="link" perm="order:detail" icon={<PayCircleOutlined />} onClick={() => handlePay(r.id)}>
              {t('pages.orderHandle.action.confirmPay')}
            </AuthButton>
          ) : null}
          {r.status === 'pay' ? (
            <AuthButton size="small" type="link" perm="order:detail" icon={<SendOutlined />} onClick={() => handleToship(r.id)}>
              {t('pages.orderHandle.action.toToship')}
            </AuthButton>
          ) : null}
          {r.status === 'pay' || r.status === 'toship' ? (
            <AuthButton size="small" type="link" perm="order:ship" icon={<SendOutlined />} onClick={() => setShipOrder(r)}>
              {t('pages.orderHandle.action.ship')}
            </AuthButton>
          ) : null}
          {(r.status === 'pending' || r.status === 'pay' || r.status === 'toship') ? (
            <AuthButton size="small" type="link" danger perm="order:cancel" icon={<CloseCircleOutlined />} onClick={() => setCancelOrder(r)}>
              {t('common.cancel')}
            </AuthButton>
          ) : null}
          {r.status === 'pay' || r.status === 'toship' || r.status === 'shipped' || r.status === 'done' ? (
            <AuthButton size="small" type="link" perm="order:refund" icon={<RollbackOutlined />} onClick={() => setRefundOrder(r)}>
              {t('pages.orderHandle.action.refund')}
            </AuthButton>
          ) : null}
          {r.status === 'shipped' ? (
            <AuthButton size="small" type="link" perm="order:detail" icon={<CheckOutlined />} onClick={() => handleComplete(r.id)}>
              {t('pages.orderHandle.action.complete')}
            </AuthButton>
          ) : null}
          <AuthButton size="small" type="link" perm="order:print" icon={<PrinterOutlined />} onClick={() => handlePrintLabel(r)}>
            {t('pages.orderHandle.action.label')}
          </AuthButton>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>{t('pages.orderHandle.title')}</Title>
      <Text type="secondary">{t('pages.orderHandle.subtitle')}</Text>

      <Row gutter={16} style={{ marginTop: 12, marginBottom: 16 }}>
        {TAB_DEFS.map((td) => (
          <Col span={4} key={td.key}>
            <Card
              hoverable
              size="small"
              onClick={() => {
                setSearchParams({ tab: td.key });
                setFilters({ page: 1, pageSize: 15 });
              }}
              style={activeTab === td.key ? { borderColor: td.color, boxShadow: `0 0 0 1px ${td.color}` } : {}}
            >
              <Statistic
                title={
                  <Space>
                    <span style={{ color: td.color }}>{td.icon}</span>
                    {td.label}
                  </Space>
                }
                value={(stats as any)?.[td.statusLabel] || 0}
                valueStyle={{ color: td.color, fontSize: 20 }}
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
            <Input placeholder={t('pages.orderHandle.filter.keywordPlaceholder')} allowClear prefix={<SearchOutlined />} style={{ width: 260 }} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">{t('common.search')}</Button>
              <Button icon={<ReloadOutlined />} onClick={() => setFilters({ page: 1, pageSize: 15 })}>{t('common.reset')}</Button>
            </Space>
          </Form.Item>
        </Form>

        <div style={{ marginBottom: 12, color: '#999', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>
            {t('pages.orderHandle.stat.pageTotal', { amount: totalAmount.toFixed(2), count: items.length })}
            {selectedIds.length > 0 && (
              <span style={{ marginLeft: 16, color: '#1677ff' }}>
                {t('pages.orderHandle.stat.selected', { count: selectedIds.length })}
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
              {t('pages.orderHandle.action.printPicklist', { count: selectedIds.length || 0 })}
            </AuthButton>
            <Button
              size="small"
              onClick={() => setSelectedIds(items.map((i: any) => i.id))}
            >
              {t('pages.orderHandle.action.selectAllCurrent')}
            </Button>
            <Button
              size="small"
              onClick={() => setSelectedIds([])}
              disabled={selectedIds.length === 0}
            >
              {t('pages.orderHandle.action.clearSelection')}
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
              showTotal: (totalCount) => t('pages.orderHandle.pagination.total', { total: totalCount }),
              onChange: (page, pageSize) => setFilters((f: any) => ({ ...f, page, pageSize })),
            }}
          />
        ) : (
          !isLoading && <Empty description={t('pages.orderHandle.empty.noOrders')} />
        )}
      </Card>

      <Drawer title={t('pages.orderHandle.drawer.title')} open={!!detail} onClose={() => setDetail(null)} width={720} extra={
        detail && (
          <Space>
            <Button icon={<PrinterOutlined />} onClick={() => handlePrintLabel(detail)}>
              {t('pages.orderHandle.drawer.printLabel')}
            </Button>
            <Button icon={<FileTextOutlined />} onClick={() => handlePrintPicklist([detail.id])}>
              {t('pages.orderHandle.drawer.picklist')}
            </Button>
          </Space>
        )
      }>
        {detail && (
          <>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label={t('pages.orderHandle.detail.platformNo')} span={2}>
                <code>{detail.platformNo}</code>
              </Descriptions.Item>
              <Descriptions.Item label={t('pages.orderHandle.detail.shop')}>{detail.shop?.name}</Descriptions.Item>
              <Descriptions.Item label={t('pages.orderHandle.detail.platform')}>{detail.shop?.platform?.name}</Descriptions.Item>
              <Descriptions.Item label={t('pages.orderHandle.detail.buyer')}>{detail.buyerName || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('pages.orderHandle.detail.email')}>{detail.buyerEmail || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('pages.orderHandle.detail.country')}>{detail.country || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('pages.orderHandle.detail.status')}>
                <Tag color={STATUS_BADGE[detail.status]?.color}>{STATUS_BADGE[detail.status]?.label || detail.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t('pages.orderHandle.detail.orderAmount')} span={2}>
                <span style={{ color: '#cf1322', fontWeight: 600, fontSize: 16 }}>{detail.totalAmount} {detail.currency}</span>
              </Descriptions.Item>
              <Descriptions.Item label={t('pages.orderHandle.detail.shipFee')}>{detail.shipFee}</Descriptions.Item>
              <Descriptions.Item label={t('pages.orderHandle.detail.cost')}>{detail.costAmount}</Descriptions.Item>
              <Descriptions.Item label={t('pages.orderHandle.detail.payTime')}>{detail.payTime ? dayjs(detail.payTime).format('YYYY-MM-DD HH:mm') : '-'}</Descriptions.Item>
              <Descriptions.Item label={t('pages.orderHandle.detail.shipTime')}>{detail.shipTime ? dayjs(detail.shipTime).format('YYYY-MM-DD HH:mm') : '-'}</Descriptions.Item>
              {detail.remark && <Descriptions.Item label={t('pages.orderHandle.detail.remark')} span={2}>{detail.remark}</Descriptions.Item>}
            </Descriptions>
            <Divider>{t('pages.orderHandle.detail.productDivider', { count: detail.items?.length || 0 })}</Divider>
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={detail.items || []}
              columns={[
                { title: t('pages.orderHandle.detailCol.sku'), dataIndex: 'sku' },
                { title: t('pages.orderHandle.detailCol.product'), dataIndex: 'productName' },
                { title: t('pages.orderHandle.detailCol.quantity'), dataIndex: 'quantity', width: 80 },
                { title: t('pages.orderHandle.detailCol.unitPrice'), dataIndex: 'price', width: 100, render: (v: number) => v?.toFixed(2) },
                { title: t('pages.orderHandle.detailCol.subtotal'), dataIndex: 'amount', width: 100, render: (v: number) => v?.toFixed(2) },
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
  const { t } = useTranslation();
  const [form] = Form.useForm();
  if (!order) return null;
  return (
    <Modal
      title={t('pages.orderHandle.shipModal.title', { platformNo: order.platformNo })}
      open={!!order}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText={t('pages.orderHandle.shipModal.okText')}
    >
      <Form form={form} layout="vertical" onFinish={(v) => onSubmit(order.id, v)} initialValues={{ carrier: 'UPS' }}>
        <Form.Item label={t('pages.orderHandle.shipModal.carrier')} name="carrier" rules={[{ required: true }]}>
          <Select options={[
            { value: 'UPS', label: 'UPS' },
            { value: 'FedEx', label: 'FedEx' },
            { value: 'USPS', label: 'USPS' },
            { value: 'DHL', label: 'DHL' },
            { value: '顺丰国际', label: t('pages.orderHandle.shipModal.carrierSf') },
            { value: 'JNE', label: t('pages.orderHandle.shipModal.carrierJne') },
            { value: 'Shopee Express', label: 'Shopee Express' },
          ]} />
        </Form.Item>
        <Form.Item label={t('pages.orderHandle.shipModal.trackingNo')} name="trackingNo" rules={[{ required: true, message: t('pages.orderHandle.shipModal.trackingNoRequired') }]}>
          <Input placeholder={t('pages.orderHandle.shipModal.trackingNoPlaceholder')} />
        </Form.Item>
        <Form.Item label={t('pages.orderHandle.shipModal.remark')} name="remark">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function CancelModal({ order, onClose, onSubmit }: { order: any; onClose: () => void; onSubmit: (id: string, reason: string) => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  if (!order) return null;
  return (
    <Modal
      title={t('pages.orderHandle.cancelModal.title', { platformNo: order.platformNo })}
      open={!!order}
      onCancel={onClose}
      onOk={() => reason && onSubmit(order.id, reason)}
      okText={t('pages.orderHandle.cancelModal.okText')}
      okButtonProps={{ danger: true, disabled: !reason }}
    >
      <p>{t('pages.orderHandle.cancelModal.orderAmount')}: <b>{order.totalAmount} {order.currency}</b></p>
      <Input.TextArea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t('pages.orderHandle.cancelModal.reasonPlaceholder')}
        rows={3}
      />
    </Modal>
  );
}

function RefundModal({ order, onClose, onSubmit }: { order: any; onClose: () => void; onSubmit: (id: string, v: any) => void }) {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  if (!order) return null;
  return (
    <Modal
      title={t('pages.orderHandle.refundModal.title', { platformNo: order.platformNo })}
      open={!!order}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText={t('pages.orderHandle.refundModal.okText')}
    >
      <Form form={form} layout="vertical" onFinish={(v) => onSubmit(order.id, v)} initialValues={{ amount: order.totalAmount, reason: t('pages.orderHandle.refundModal.defaultReason') }}>
        <Form.Item label={t('pages.orderHandle.refundModal.amount')} name="amount" rules={[{ required: true }]}>
          <InputNumber
            style={{ width: '100%' }}
            min={0.01}
            max={order.totalAmount}
            addonAfter={order.currency}
          />
        </Form.Item>
        <Form.Item label={t('pages.orderHandle.refundModal.reason')} name="reason" rules={[{ required: true }]}>
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
