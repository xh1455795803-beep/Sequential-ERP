// 售后管理 (退款 / 退货 / 换货)
import { useState } from 'react';
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
  Steps,
  Divider,
} from 'antd';
import {
  SearchOutlined,
  ReloadOutlined,
  RollbackOutlined,
  CheckOutlined,
  CloseOutlined,
  EyeOutlined,
  ImportOutlined,
  DollarOutlined,
  AuditOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { aftersaleApi, orderApi, warehouseApi } from '../api';
import AuthButton from '../components/AuthButton';
import dayjs from 'dayjs';
import { useTranslation } from '../i18n';

const { Title, Text } = Typography;

export default function AftersaleList() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 15 });
  const [detail, setDetail] = useState<any | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState<any | null>(null);
  const [receiveOpen, setReceiveOpen] = useState<any | null>(null);
  const [rejectOpen, setRejectOpen] = useState<any | null>(null);
  const qc = useQueryClient();

  // 状态/类型标签（移至组件内以支持 i18n）
  const STATUS_TAG: Record<string, { color: string; label: string; step: number }> = {
    pending: { color: 'orange', label: t('pages.aftersaleList.status.pending'), step: 0 },
    approved: { color: 'blue', label: t('pages.aftersaleList.status.approved'), step: 1 },
    processing: { color: 'cyan', label: t('pages.aftersaleList.status.processing'), step: 2 },
    done: { color: 'green', label: t('pages.aftersaleList.status.done'), step: 3 },
    rejected: { color: 'red', label: t('pages.aftersaleList.status.rejected'), step: -1 },
    cancelled: { color: 'default', label: t('pages.aftersaleList.status.cancelled'), step: -1 },
  };

  const TYPE_TAG: Record<string, { color: string; label: string }> = {
    refund: { color: 'gold', label: t('pages.aftersaleList.type.refund') },
    return: { color: 'purple', label: t('pages.aftersaleList.type.return') },
    exchange: { color: 'cyan', label: t('pages.aftersaleList.type.exchange') },
  };

  const { data, isLoading } = useQuery({
    queryKey: ['aftersales', filters],
    queryFn: () => aftersaleApi.list(filters),
  });
  const { data: stats } = useQuery({
    queryKey: ['aftersales-stats'],
    queryFn: () => aftersaleApi.stats(),
    refetchInterval: 10000,
  });

  const items = data?.items || [];
  const total = data?.total || 0;

  const handleCancel = async (id: string) => {
    try {
      await aftersaleApi.cancel(id, { reason: '管理员取消' });
      message.success(t('pages.aftersaleList.msg.cancelled'));
      qc.invalidateQueries({ queryKey: ['aftersales'] });
      qc.invalidateQueries({ queryKey: ['aftersales-stats'] });
    } catch (e: any) {
      message.error(e?.message || t('pages.aftersaleList.msg.cancelFailed'));
    }
  };

  const columns: any[] = [
    {
      title: t('pages.aftersaleList.colNo'),
      dataIndex: 'aftersaleNo',
      width: 170,
      fixed: 'left',
      render: (v: string, r: any) => (
        <a onClick={() => setDetail(r)}>
          <Space direction="vertical" size={0}>
            <code style={{ fontSize: 12 }}>{v}</code>
            <Tag color={TYPE_TAG[r.type]?.color} style={{ fontSize: 11 }}>{TYPE_TAG[r.type]?.label}</Tag>
          </Space>
        </a>
      ),
    },
    {
      title: t('pages.aftersaleList.colRelatedOrder'),
      dataIndex: ['order', 'platformNo'],
      width: 170,
      render: (v: string, r: any) => (
        <Space direction="vertical" size={0}>
          <code style={{ fontSize: 11 }}>{v}</code>
          <span style={{ fontSize: 11, color: '#999' }}>{r.order?.shop?.name || '-'}</span>
        </Space>
      ),
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 110,
      render: (s: string) => {
        const m = STATUS_TAG[s];
        return <Tag color={m?.color}>{m?.label || s}</Tag>;
      },
    },
    {
      title: t('pages.aftersaleList.colRefundAmount'),
      dataIndex: 'refundAmount',
      width: 130,
      render: (v: number, r: any) => (
        <span style={{ color: '#cf1322', fontWeight: 600 }}>{v?.toFixed(2)} {r.currency}</span>
      ),
    },
    {
      title: t('pages.aftersaleList.colReason'),
      dataIndex: 'reason',
      width: 160,
      ellipsis: true,
    },
    {
      title: t('pages.aftersaleList.colReturnLogistics'),
      key: 'returnLogistics',
      width: 160,
      render: (_: any, r: any) => {
        if (!r.returnTrackingNo) return '-';
        return (
          <Space direction="vertical" size={0}>
            <span style={{ fontSize: 11 }}>{r.returnCarrier}</span>
            <code style={{ fontSize: 11 }}>{r.returnTrackingNo}</code>
          </Space>
        );
      },
    },
    {
      title: t('pages.aftersaleList.colApplyTime'),
      dataIndex: 'createdAt',
      width: 140,
      render: (v: string) => dayjs(v).format('MM-DD HH:mm'),
    },
    {
      title: t('pages.aftersaleList.colCompleteTime'),
      dataIndex: 'completedAt',
      width: 140,
      render: (v: string) => v ? dayjs(v).format('MM-DD HH:mm') : '-',
    },
    {
      title: t('common.operation'),
      key: 'op',
      width: 240,
      fixed: 'right',
      render: (_: any, r: any) => (
        <Space size={4} wrap>
          <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => setDetail(r)}>{t('common.detail')}</Button>
          {r.status === 'pending' && (
            <>
              <AuthButton size="small" type="link" perm="order:aftersale" icon={<CheckOutlined />} onClick={() => setReviewOpen(r)}>
                {t('pages.aftersaleList.actionReview')}
              </AuthButton>
              <AuthButton size="small" type="link" danger perm="order:aftersale" onClick={() => setRejectOpen(r)}>
                {t('pages.aftersaleList.actionReject')}
              </AuthButton>
            </>
          )}
          {r.status === 'approved' && r.type === 'return' && (
            <AuthButton size="small" type="link" perm="order:aftersale" icon={<ImportOutlined />} onClick={() => setReceiveOpen(r)}>
              {t('pages.aftersaleList.actionReceiveReturn')}
            </AuthButton>
          )}
          {(r.status === 'approved' || r.status === 'processing') && (
            <AuthButton size="small" type="primary" perm="order:aftersale" icon={<DollarOutlined />} onClick={async () => {
              try {
                await aftersaleApi.complete(r.id);
                message.success(t('pages.aftersaleList.msg.completed'));
                qc.invalidateQueries({ queryKey: ['aftersales'] });
                qc.invalidateQueries({ queryKey: ['aftersales-stats'] });
              } catch (e: any) { message.error(e?.message || t('pages.aftersaleList.msg.opFailed')); }
            }}>
              {r.type === 'refund' ? t('pages.aftersaleList.actionConfirmRefund') : t('pages.aftersaleList.actionFinishRefund')}
            </AuthButton>
          )}
          {(r.status === 'pending' || r.status === 'approved') && (
            <AuthButton size="small" type="link" danger perm="order:aftersale" onClick={() => handleCancel(r.id)}>
              {t('common.cancel')}
            </AuthButton>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>{t('pages.aftersaleList.title')}</Title>
      <Text type="secondary">{t('pages.aftersaleList.subtitle', { total })}</Text>

      <Row gutter={16} style={{ marginTop: 12, marginBottom: 16 }}>
        <Col span={4}><Card bordered={false}><Statistic title={STATUS_TAG.pending.label} value={(stats as any)?.pending || 0} valueStyle={{ color: '#fa8c16' }} prefix={<AuditOutlined />} /></Card></Col>
        <Col span={4}><Card bordered={false}><Statistic title={STATUS_TAG.approved.label} value={(stats as any)?.approved || 0} valueStyle={{ color: '#1677ff' }} prefix={<CheckOutlined />} /></Card></Col>
        <Col span={4}><Card bordered={false}><Statistic title={STATUS_TAG.processing.label} value={(stats as any)?.processing || 0} valueStyle={{ color: '#13c2c2' }} prefix={<ImportOutlined />} /></Card></Col>
        <Col span={4}><Card bordered={false}><Statistic title={STATUS_TAG.done.label} value={(stats as any)?.done || 0} valueStyle={{ color: '#52c41a' }} prefix={<CheckOutlined />} /></Card></Col>
        <Col span={4}><Card bordered={false}><Statistic title={STATUS_TAG.rejected.label} value={(stats as any)?.rejected || 0} valueStyle={{ color: '#ff4d4f' }} prefix={<CloseOutlined />} /></Card></Col>
        <Col span={4}><Button type="primary" size="large" icon={<RollbackOutlined />} block onClick={() => setCreateOpen(true)}>{t('pages.aftersaleList.actionApply')}</Button></Col>
      </Row>

      <Card bordered={false} style={{ marginBottom: 16 }}>
        <Form
          layout="inline"
          onFinish={(v) => setFilters((f: any) => ({ ...f, ...v, page: 1 }))}
        >
          <Form.Item name="keyword">
            <Input placeholder={t('pages.aftersaleList.filterKeywordPlaceholder')} allowClear prefix={<SearchOutlined />} style={{ width: 240 }} />
          </Form.Item>
          <Form.Item name="status">
            <Select placeholder={t('common.status')} allowClear style={{ width: 140 }} options={Object.entries(STATUS_TAG).map(([k, v]) => ({ value: k, label: v.label }))} />
          </Form.Item>
          <Form.Item name="type">
            <Select placeholder={t('pages.aftersaleList.filterTypePlaceholder')} allowClear style={{ width: 140 }} options={Object.entries(TYPE_TAG).map(([k, v]) => ({ value: k, label: v.label }))} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">{t('common.search')}</Button>
              <Button icon={<ReloadOutlined />} onClick={() => setFilters({ page: 1, pageSize: 15 })}>{t('common.reset')}</Button>
              <Button
                icon={<DownloadOutlined />}
                onClick={async () => {
                  try {
                    const r = await aftersaleApi.exportCsv({
                      status: filters.status,
                      type: filters.type,
                      keyword: filters.keyword,
                    });
                    const blob = new Blob([r.content], { type: 'text/csv;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = r.filename;
                    a.click();
                    URL.revokeObjectURL(url);
                    message.success(t('pages.aftersaleList.msg.exported', { count: r.count }));
                  } catch (e: any) {
                    message.error(e?.message || t('pages.aftersaleList.msg.exportFailed'));
                  }
                }}
              >
                {t('pages.aftersaleList.actionExportCsv')}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      <Card bordered={false} title={t('pages.aftersaleList.listTitle')}>
        {items.length ? (
          <Table
            size="middle"
            columns={columns}
            dataSource={items}
            loading={isLoading}
            rowKey="id"
            scroll={{ x: 1500 }}
            pagination={{
              current: filters.page,
              pageSize: filters.pageSize,
              total,
              showSizeChanger: true,
              showTotal: (t2) => t('pages.aftersaleList.totalCount', { total: t2 }),
              onChange: (page, pageSize) => setFilters((f: any) => ({ ...f, page, pageSize })),
            }}
          />
        ) : (
          !isLoading && <Empty description={t('pages.aftersaleList.noAftersale')} />
        )}
      </Card>

      {/* 详情 */}
      <Drawer
        title={detail ? t('pages.aftersaleList.detailTitle', { no: detail.aftersaleNo }) : ''}
        open={!!detail}
        onClose={() => setDetail(null)}
        width={760}
      >
        {detail && (
          <>
            <Steps
              size="small"
              current={STATUS_TAG[detail.status]?.step ?? 0}
              status={detail.status === 'rejected' || detail.status === 'cancelled' ? 'error' : undefined}
              items={[
                { title: t('pages.aftersaleList.step.apply') },
                { title: t('pages.aftersaleList.step.review') },
                { title: t('pages.aftersaleList.step.process') },
                { title: t('pages.aftersaleList.step.done') },
              ]}
              style={{ marginBottom: 20 }}
            />

            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label={t('pages.aftersaleList.colNo')} span={2}><code>{detail.aftersaleNo}</code></Descriptions.Item>
              <Descriptions.Item label={t('pages.aftersaleList.labelType')}><Tag color={TYPE_TAG[detail.type]?.color}>{TYPE_TAG[detail.type]?.label}</Tag></Descriptions.Item>
              <Descriptions.Item label={t('common.status')}><Tag color={STATUS_TAG[detail.status]?.color}>{STATUS_TAG[detail.status]?.label}</Tag></Descriptions.Item>
              <Descriptions.Item label={t('pages.aftersaleList.colRelatedOrder')} span={2}>
                <code>{detail.order?.platformNo}</code> · {detail.order?.shop?.name}
              </Descriptions.Item>
              <Descriptions.Item label={t('pages.aftersaleList.colRefundAmount')} span={2}>
                <span style={{ color: '#cf1322', fontWeight: 600, fontSize: 16 }}>{detail.refundAmount} {detail.currency}</span>
              </Descriptions.Item>
              <Descriptions.Item label={t('pages.aftersaleList.colReason')} span={2}>{detail.reason}</Descriptions.Item>
              {detail.returnCarrier && (
                <Descriptions.Item label={t('pages.aftersaleList.colReturnLogistics')} span={2}>
                  {detail.returnCarrier} <code>{detail.returnTrackingNo}</code>
                </Descriptions.Item>
              )}
              {detail.receivedAt && <Descriptions.Item label={t('pages.aftersaleList.labelReceivedAt')}>{dayjs(detail.receivedAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>}
              {detail.approvedAt && <Descriptions.Item label={t('pages.aftersaleList.labelApprovedAt')}>{dayjs(detail.approvedAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>}
              {detail.completedAt && <Descriptions.Item label={t('pages.aftersaleList.labelCompletedAt')} span={2}>{dayjs(detail.completedAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>}
              {detail.rejectReason && <Descriptions.Item label={t('pages.aftersaleList.labelRejectReason')} span={2}><span style={{ color: '#ff4d4f' }}>{detail.rejectReason}</span></Descriptions.Item>}
              {detail.remark && <Descriptions.Item label={t('pages.aftersaleList.labelRemark')} span={2}>{detail.remark}</Descriptions.Item>}
            </Descriptions>

            <Divider>{t('pages.aftersaleList.dividerItems', { count: detail.items?.length || 0 })}</Divider>
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={detail.items || []}
              columns={[
                { title: t('pages.aftersaleList.colSku'), dataIndex: 'sku', width: 120 },
                { title: t('pages.aftersaleList.colProduct'), dataIndex: 'productName' },
                { title: t('pages.aftersaleList.colQty'), dataIndex: 'quantity', width: 80 },
                { title: t('pages.aftersaleList.colUnitPrice'), dataIndex: 'unitPrice', width: 100, render: (v: number) => v?.toFixed(2) },
                { title: t('pages.aftersaleList.colAmount'), dataIndex: 'amount', width: 100, render: (v: number) => v?.toFixed(2) },
                { title: t('pages.aftersaleList.colRestockQty'), dataIndex: 'restockQty', width: 80, render: (v: number) => v || 0 },
              ]}
            />
          </>
        )}
      </Drawer>

      {/* 申请售后 */}
      <CreateAftersaleModal open={createOpen} onClose={() => setCreateOpen(false)} onDone={() => { setCreateOpen(false); qc.invalidateQueries({ queryKey: ['aftersales'] }); qc.invalidateQueries({ queryKey: ['aftersales-stats'] }); }} />

      {/* 审核通过 */}
      <ReviewModal aftersale={reviewOpen} onClose={() => setReviewOpen(null)} onDone={() => { setReviewOpen(null); qc.invalidateQueries({ queryKey: ['aftersales'] }); qc.invalidateQueries({ queryKey: ['aftersales-stats'] }); setDetail(null); }} />

      {/* 拒绝 */}
      <RejectModal aftersale={rejectOpen} onClose={() => setRejectOpen(null)} onDone={() => { setRejectOpen(null); qc.invalidateQueries({ queryKey: ['aftersales'] }); qc.invalidateQueries({ queryKey: ['aftersales-stats'] }); setDetail(null); }} />

      {/* 收到退货 */}
      <ReceiveReturnModal aftersale={receiveOpen} onClose={() => setReceiveOpen(null)} onDone={() => { setReceiveOpen(null); qc.invalidateQueries({ queryKey: ['aftersales'] }); qc.invalidateQueries({ queryKey: ['aftersales-stats'] }); setDetail(null); }} />
    </div>
  );
}

// ============ 申请售后 Modal ============
function CreateAftersaleModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [orderId, setOrderId] = useState<string>();
  const [type, setType] = useState<string>('refund');
  const [itemQtys, setItemQtys] = useState<Record<string, number>>({});

  const { data: order } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => orderId ? orderApi.detail(orderId) : null,
    enabled: !!orderId,
  });

  const submit = async () => {
    try {
      const v = await form.validateFields();
      const items = Object.entries(itemQtys)
        .filter(([_, q]) => q > 0)
        .map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
      if (!items.length) {
        message.error(t('pages.aftersaleList.msg.selectAtLeastOne'));
        return;
      }
      await aftersaleApi.create({ ...v, items });
      message.success(t('pages.aftersaleList.msg.created'));
      form.resetFields();
      setItemQtys({});
      setOrderId(undefined);
      onDone();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || t('pages.aftersaleList.msg.createFailed'));
    }
  };

  return (
    <Modal title={t('pages.aftersaleList.actionApply')} open={open} onCancel={onClose} onOk={submit} okText={t('pages.aftersaleList.okSubmit')} width={680}>
      <Form form={form} layout="vertical">
        <Form.Item label={t('pages.aftersaleList.colRelatedOrder')} name="orderId" rules={[{ required: true, message: t('pages.aftersaleList.msg.orderIdRequired') }]}>
          <Input.Search placeholder={t('pages.aftersaleList.orderIdPlaceholder')} onSearch={(v) => setOrderId(v)} allowClear />
        </Form.Item>
        {order && (
          <Card size="small" style={{ marginBottom: 12, background: '#fafafa' }}>
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Space>
                <Tag color="blue">{order.shop?.platform?.name}</Tag>
                <code>{order.platformNo}</code>
                <span>· {order.shop?.name}</span>
              </Space>
              <Space>
                <Tag color={order.status === 'paid' ? 'green' : 'default'}>{order.status}</Tag>
                <span style={{ color: '#cf1322', fontWeight: 600 }}>{order.totalAmount} {order.currency}</span>
                <span style={{ color: '#999' }}>· {order.buyerName} · {order.country}</span>
              </Space>
            </Space>
          </Card>
        )}
        <Form.Item label={t('pages.aftersaleList.labelType')} name="type" rules={[{ required: true }]} initialValue="refund">
          <Select onChange={setType} options={[
            { value: 'refund', label: t('pages.aftersaleList.type.refundOption') },
            { value: 'return', label: t('pages.aftersaleList.type.returnOption') },
            { value: 'exchange', label: t('pages.aftersaleList.type.exchange') },
          ]} />
        </Form.Item>
        {order && order.items?.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 6, fontSize: 13, color: '#666' }}>{t('pages.aftersaleList.selectItemsHint')}</div>
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={order.items}
              columns={[
                { title: t('pages.aftersaleList.colSku'), dataIndex: 'sku', width: 130 },
                { title: t('pages.aftersaleList.colProduct'), dataIndex: 'productName' },
                { title: t('pages.aftersaleList.colPurchased'), dataIndex: 'quantity', width: 70 },
                { title: t('pages.aftersaleList.colUnitPrice'), dataIndex: 'price', width: 90, render: (v: number) => v?.toFixed(2) },
                {
                  title: t('pages.aftersaleList.colAftersaleQty'),
                  width: 110,
                  render: (_: any, r: any) => (
                    <InputNumber
                      min={0}
                      max={r.quantity}
                      size="small"
                      value={itemQtys[r.id] || 0}
                      onChange={(v) => setItemQtys((m) => ({ ...m, [r.id]: v || 0 }))}
                      style={{ width: '100%' }}
                    />
                  ),
                },
              ]}
            />
          </div>
        )}
        <Form.Item label={t('pages.aftersaleList.colReason')} name="reason" rules={[{ required: true }]} initialValue="买家申请">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item label={t('pages.aftersaleList.labelRemark')} name="remark">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ============ 审核 Modal ============
function ReviewModal({ aftersale, onClose, onDone }: { aftersale: any; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  if (!aftersale) return null;
  const submit = async () => {
    try {
      const v = await form.validateFields();
      await aftersaleApi.review(aftersale.id, { action: 'approve', ...v });
      message.success(t('pages.aftersaleList.msg.reviewed'));
      onDone();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || t('pages.aftersaleList.msg.reviewFailed'));
    }
  };
  return (
    <Modal title={t('pages.aftersaleList.reviewTitle', { no: aftersale.aftersaleNo })} open={!!aftersale} onCancel={onClose} onOk={submit} okText={t('pages.aftersaleList.reviewOk')} okButtonProps={{ type: 'primary' }}>
      <Form form={form} layout="vertical" initialValues={{ refundAmount: aftersale.refundAmount }}>
        <p>{t('pages.aftersaleList.originalRefundAmount')}: <b style={{ color: '#cf1322' }}>{aftersale.refundAmount} {aftersale.currency}</b></p>
        <Form.Item label={t('pages.aftersaleList.actualRefundAmount')} name="refundAmount" rules={[{ required: true }]}>
          <InputNumber
            style={{ width: '100%' }}
            min={0}
            max={aftersale.refundAmount}
            addonAfter={aftersale.currency}
          />
        </Form.Item>
        <Form.Item label={t('pages.aftersaleList.labelRemark')} name="remark">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ============ 拒绝 Modal ============
function RejectModal({ aftersale, onClose, onDone }: { aftersale: any; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  if (!aftersale) return null;
  return (
    <Modal title={t('pages.aftersaleList.rejectTitle', { no: aftersale.aftersaleNo })} open={!!aftersale} onCancel={onClose} onOk={async () => {
      if (!reason) { message.error(t('pages.aftersaleList.msg.rejectReasonRequired')); return; }
      try {
        await aftersaleApi.review(aftersale.id, { action: 'reject', rejectReason: reason });
        message.success(t('pages.aftersaleList.msg.rejected'));
        onDone();
      } catch (e: any) { message.error(e?.message || t('pages.aftersaleList.msg.opFailed')); }
    }} okText={t('pages.aftersaleList.okReject')} okButtonProps={{ danger: true, disabled: !reason }}>
      <p>{t('pages.aftersaleList.labelAftersaleNo')}: <b>{aftersale.aftersaleNo}</b></p>
      <p>{t('pages.aftersaleList.colReason')}: {aftersale.reason}</p>
      <Input.TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('pages.aftersaleList.rejectReasonPlaceholder')} rows={3} />
    </Modal>
  );
}

// ============ 收到退货 Modal ============
function ReceiveReturnModal({ aftersale, onClose, onDone }: { aftersale: any; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  if (!aftersale) return null;
  const submit = async () => {
    try {
      const v = await form.validateFields();
      await aftersaleApi.receive(aftersale.id, v);
      message.success(t('pages.aftersaleList.msg.received'));
      onDone();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || t('pages.aftersaleList.msg.opFailed'));
    }
  };
  return (
    <Modal title={t('pages.aftersaleList.receiveTitle', { no: aftersale.aftersaleNo })} open={!!aftersale} onCancel={onClose} onOk={submit} okText={t('pages.aftersaleList.okReceive')}>
      <Form form={form} layout="vertical" initialValues={{ returnCarrier: 'JNE' }}>
        <Form.Item label={t('pages.aftersaleList.colReturnLogistics')} name="returnCarrier" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label={t('pages.aftersaleList.labelTrackingNo')} name="returnTrackingNo" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <p style={{ color: '#999', fontSize: 12 }}>{t('pages.aftersaleList.receiveHint')}</p>
      </Form>
    </Modal>
  );
}
