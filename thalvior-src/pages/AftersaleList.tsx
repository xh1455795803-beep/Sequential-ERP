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

const { Title, Text } = Typography;

const STATUS_TAG: Record<string, { color: string; label: string; step: number }> = {
  pending: { color: 'orange', label: '待审核', step: 0 },
  approved: { color: 'blue', label: '已通过', step: 1 },
  processing: { color: 'cyan', label: '退货处理中', step: 2 },
  done: { color: 'green', label: '已完成', step: 3 },
  rejected: { color: 'red', label: '已拒绝', step: -1 },
  cancelled: { color: 'default', label: '已取消', step: -1 },
};

const TYPE_TAG: Record<string, { color: string; label: string }> = {
  refund: { color: 'gold', label: '仅退款' },
  return: { color: 'purple', label: '退货退款' },
  exchange: { color: 'cyan', label: '换货' },
};

export default function AftersaleList() {
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 15 });
  const [detail, setDetail] = useState<any | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState<any | null>(null);
  const [receiveOpen, setReceiveOpen] = useState<any | null>(null);
  const [rejectOpen, setRejectOpen] = useState<any | null>(null);
  const qc = useQueryClient();

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
      message.success('已取消');
      qc.invalidateQueries({ queryKey: ['aftersales'] });
      qc.invalidateQueries({ queryKey: ['aftersales-stats'] });
    } catch (e: any) {
      message.error(e?.message || '取消失败');
    }
  };

  const columns: any[] = [
    {
      title: '售后单号',
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
      title: '关联订单',
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
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (s: string) => {
        const m = STATUS_TAG[s];
        return <Tag color={m?.color}>{m?.label || s}</Tag>;
      },
    },
    {
      title: '退款金额',
      dataIndex: 'refundAmount',
      width: 130,
      render: (v: number, r: any) => (
        <span style={{ color: '#cf1322', fontWeight: 600 }}>{v?.toFixed(2)} {r.currency}</span>
      ),
    },
    {
      title: '原因',
      dataIndex: 'reason',
      width: 160,
      ellipsis: true,
    },
    {
      title: '退货物流',
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
      title: '申请时间',
      dataIndex: 'createdAt',
      width: 140,
      render: (v: string) => dayjs(v).format('MM-DD HH:mm'),
    },
    {
      title: '完成时间',
      dataIndex: 'completedAt',
      width: 140,
      render: (v: string) => v ? dayjs(v).format('MM-DD HH:mm') : '-',
    },
    {
      title: '操作',
      key: 'op',
      width: 240,
      fixed: 'right',
      render: (_: any, r: any) => (
        <Space size={4} wrap>
          <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => setDetail(r)}>详情</Button>
          {r.status === 'pending' && (
            <>
              <AuthButton size="small" type="link" perm="order:aftersale" icon={<CheckOutlined />} onClick={() => setReviewOpen(r)}>
                审核
              </AuthButton>
              <AuthButton size="small" type="link" danger perm="order:aftersale" onClick={() => setRejectOpen(r)}>
                拒绝
              </AuthButton>
            </>
          )}
          {r.status === 'approved' && r.type === 'return' && (
            <AuthButton size="small" type="link" perm="order:aftersale" icon={<ImportOutlined />} onClick={() => setReceiveOpen(r)}>
              收到退货
            </AuthButton>
          )}
          {(r.status === 'approved' || r.status === 'processing') && (
            <AuthButton size="small" type="primary" perm="order:aftersale" icon={<DollarOutlined />} onClick={async () => {
              try {
                await aftersaleApi.complete(r.id);
                message.success('已完成, 已退款');
                qc.invalidateQueries({ queryKey: ['aftersales'] });
                qc.invalidateQueries({ queryKey: ['aftersales-stats'] });
              } catch (e: any) { message.error(e?.message || '操作失败'); }
            }}>
              {r.type === 'refund' ? '确认退款' : '完成退款'}
            </AuthButton>
          )}
          {(r.status === 'pending' || r.status === 'approved') && (
            <AuthButton size="small" type="link" danger perm="order:aftersale" onClick={() => handleCancel(r.id)}>
              取消
            </AuthButton>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>售后管理</Title>
      <Text type="secondary">退款 / 退货 / 换货统一管理 · 共 {total} 单</Text>

      <Row gutter={16} style={{ marginTop: 12, marginBottom: 16 }}>
        <Col span={4}><Card bordered={false}><Statistic title="待审核" value={(stats as any)?.pending || 0} valueStyle={{ color: '#fa8c16' }} prefix={<AuditOutlined />} /></Card></Col>
        <Col span={4}><Card bordered={false}><Statistic title="已通过" value={(stats as any)?.approved || 0} valueStyle={{ color: '#1677ff' }} prefix={<CheckOutlined />} /></Card></Col>
        <Col span={4}><Card bordered={false}><Statistic title="退货处理中" value={(stats as any)?.processing || 0} valueStyle={{ color: '#13c2c2' }} prefix={<ImportOutlined />} /></Card></Col>
        <Col span={4}><Card bordered={false}><Statistic title="已完成" value={(stats as any)?.done || 0} valueStyle={{ color: '#52c41a' }} prefix={<CheckOutlined />} /></Card></Col>
        <Col span={4}><Card bordered={false}><Statistic title="已拒绝" value={(stats as any)?.rejected || 0} valueStyle={{ color: '#ff4d4f' }} prefix={<CloseOutlined />} /></Card></Col>
        <Col span={4}><Button type="primary" size="large" icon={<RollbackOutlined />} block onClick={() => setCreateOpen(true)}>申请售后</Button></Col>
      </Row>

      <Card bordered={false} style={{ marginBottom: 16 }}>
        <Form
          layout="inline"
          onFinish={(v) => setFilters((f: any) => ({ ...f, ...v, page: 1 }))}
        >
          <Form.Item name="keyword">
            <Input placeholder="售后单号 / 原因" allowClear prefix={<SearchOutlined />} style={{ width: 240 }} />
          </Form.Item>
          <Form.Item name="status">
            <Select placeholder="状态" allowClear style={{ width: 140 }} options={Object.entries(STATUS_TAG).map(([k, v]) => ({ value: k, label: v.label }))} />
          </Form.Item>
          <Form.Item name="type">
            <Select placeholder="类型" allowClear style={{ width: 140 }} options={Object.entries(TYPE_TAG).map(([k, v]) => ({ value: k, label: v.label }))} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">搜索</Button>
              <Button icon={<ReloadOutlined />} onClick={() => setFilters({ page: 1, pageSize: 15 })}>重置</Button>
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
                    message.success(`已导出 ${r.count} 条`);
                  } catch (e: any) {
                    message.error(e?.message || '导出失败');
                  }
                }}
              >
                导出CSV
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      <Card bordered={false} title="售后列表">
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
              showTotal: (t) => `共 ${t} 条`,
              onChange: (page, pageSize) => setFilters((f: any) => ({ ...f, page, pageSize })),
            }}
          />
        ) : (
          !isLoading && <Empty description="暂无售后单" />
        )}
      </Card>

      {/* 详情 */}
      <Drawer
        title={detail ? `售后单 ${detail.aftersaleNo}` : ''}
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
                { title: '申请' },
                { title: '审核' },
                { title: '处理' },
                { title: '完成' },
              ]}
              style={{ marginBottom: 20 }}
            />

            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="售后单号" span={2}><code>{detail.aftersaleNo}</code></Descriptions.Item>
              <Descriptions.Item label="类型"><Tag color={TYPE_TAG[detail.type]?.color}>{TYPE_TAG[detail.type]?.label}</Tag></Descriptions.Item>
              <Descriptions.Item label="状态"><Tag color={STATUS_TAG[detail.status]?.color}>{STATUS_TAG[detail.status]?.label}</Tag></Descriptions.Item>
              <Descriptions.Item label="关联订单" span={2}>
                <code>{detail.order?.platformNo}</code> · {detail.order?.shop?.name}
              </Descriptions.Item>
              <Descriptions.Item label="退款金额" span={2}>
                <span style={{ color: '#cf1322', fontWeight: 600, fontSize: 16 }}>{detail.refundAmount} {detail.currency}</span>
              </Descriptions.Item>
              <Descriptions.Item label="原因" span={2}>{detail.reason}</Descriptions.Item>
              {detail.returnCarrier && (
                <Descriptions.Item label="退货物流" span={2}>
                  {detail.returnCarrier} <code>{detail.returnTrackingNo}</code>
                </Descriptions.Item>
              )}
              {detail.receivedAt && <Descriptions.Item label="收到退货时间">{dayjs(detail.receivedAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>}
              {detail.approvedAt && <Descriptions.Item label="审核时间">{dayjs(detail.approvedAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>}
              {detail.completedAt && <Descriptions.Item label="完成时间" span={2}>{dayjs(detail.completedAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>}
              {detail.rejectReason && <Descriptions.Item label="拒绝原因" span={2}><span style={{ color: '#ff4d4f' }}>{detail.rejectReason}</span></Descriptions.Item>}
              {detail.remark && <Descriptions.Item label="备注" span={2}>{detail.remark}</Descriptions.Item>}
            </Descriptions>

            <Divider>售后商品 ({detail.items?.length || 0})</Divider>
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={detail.items || []}
              columns={[
                { title: 'SKU', dataIndex: 'sku', width: 120 },
                { title: '商品', dataIndex: 'productName' },
                { title: '数量', dataIndex: 'quantity', width: 80 },
                { title: '单价', dataIndex: 'unitPrice', width: 100, render: (v: number) => v?.toFixed(2) },
                { title: '金额', dataIndex: 'amount', width: 100, render: (v: number) => v?.toFixed(2) },
                { title: '已入库', dataIndex: 'restockQty', width: 80, render: (v: number) => v || 0 },
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
        message.error('请至少选择 1 个售后商品');
        return;
      }
      await aftersaleApi.create({ ...v, items });
      message.success('售后单已创建, 等待审核');
      form.resetFields();
      setItemQtys({});
      setOrderId(undefined);
      onDone();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '创建失败');
    }
  };

  return (
    <Modal title="申请售后" open={open} onCancel={onClose} onOk={submit} okText="提交申请" width={680}>
      <Form form={form} layout="vertical">
        <Form.Item label="关联订单" name="orderId" rules={[{ required: true, message: '请输入订单 ID' }]}>
          <Input.Search placeholder="输入订单 ID (粘贴从订单列表复制的 ID)" onSearch={(v) => setOrderId(v)} allowClear />
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
                <Tag color={STATUS_TAG[order.status]?.color || 'default'}>{order.status}</Tag>
                <span style={{ color: '#cf1322', fontWeight: 600 }}>{order.totalAmount} {order.currency}</span>
                <span style={{ color: '#999' }}>· {order.buyerName} · {order.country}</span>
              </Space>
            </Space>
          </Card>
        )}
        <Form.Item label="售后类型" name="type" rules={[{ required: true }]} initialValue="refund">
          <Select onChange={setType} options={[
            { value: 'refund', label: '仅退款 (不退商品)' },
            { value: 'return', label: '退货退款 (退换货)' },
            { value: 'exchange', label: '换货' },
          ]} />
        </Form.Item>
        {order && order.items?.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 6, fontSize: 13, color: '#666' }}>选择售后商品:</div>
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={order.items}
              columns={[
                { title: 'SKU', dataIndex: 'sku', width: 130 },
                { title: '商品', dataIndex: 'productName' },
                { title: '已购', dataIndex: 'quantity', width: 70 },
                { title: '单价', dataIndex: 'price', width: 90, render: (v: number) => v?.toFixed(2) },
                {
                  title: '售后数量',
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
        <Form.Item label="原因" name="reason" rules={[{ required: true }]} initialValue="买家申请">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item label="备注" name="remark">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ============ 审核 Modal ============
function ReviewModal({ aftersale, onClose, onDone }: { aftersale: any; onClose: () => void; onDone: () => void }) {
  const [form] = Form.useForm();
  if (!aftersale) return null;
  const submit = async () => {
    try {
      const v = await form.validateFields();
      await aftersaleApi.review(aftersale.id, { action: 'approve', ...v });
      message.success('已审核通过');
      onDone();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '审核失败');
    }
  };
  return (
    <Modal title={`审核 - ${aftersale.aftersaleNo}`} open={!!aftersale} onCancel={onClose} onOk={submit} okText="通过" okButtonProps={{ type: 'primary' }}>
      <Form form={form} layout="vertical" initialValues={{ refundAmount: aftersale.refundAmount }}>
        <p>原申请金额: <b style={{ color: '#cf1322' }}>{aftersale.refundAmount} {aftersale.currency}</b></p>
        <Form.Item label="实际退款金额" name="refundAmount" rules={[{ required: true }]}>
          <InputNumber
            style={{ width: '100%' }}
            min={0}
            max={aftersale.refundAmount}
            addonAfter={aftersale.currency}
          />
        </Form.Item>
        <Form.Item label="备注" name="remark">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ============ 拒绝 Modal ============
function RejectModal({ aftersale, onClose, onDone }: { aftersale: any; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  if (!aftersale) return null;
  return (
    <Modal title={`拒绝 - ${aftersale.aftersaleNo}`} open={!!aftersale} onCancel={onClose} onOk={async () => {
      if (!reason) { message.error('请填写拒绝原因'); return; }
      try {
        await aftersaleApi.review(aftersale.id, { action: 'reject', rejectReason: reason });
        message.success('已拒绝');
        onDone();
      } catch (e: any) { message.error(e?.message || '操作失败'); }
    }} okText="确认拒绝" okButtonProps={{ danger: true, disabled: !reason }}>
      <p>售后单: <b>{aftersale.aftersaleNo}</b></p>
      <p>原因: {aftersale.reason}</p>
      <Input.TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="拒绝原因" rows={3} />
    </Modal>
  );
}

// ============ 收到退货 Modal ============
function ReceiveReturnModal({ aftersale, onClose, onDone }: { aftersale: any; onClose: () => void; onDone: () => void }) {
  const [form] = Form.useForm();
  if (!aftersale) return null;
  const submit = async () => {
    try {
      const v = await form.validateFields();
      await aftersaleApi.receive(aftersale.id, v);
      message.success('已记录退货入库, 请继续完成退款');
      onDone();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '操作失败');
    }
  };
  return (
    <Modal title={`收到退货 - ${aftersale.aftersaleNo}`} open={!!aftersale} onCancel={onClose} onOk={submit} okText="确认收到并入库">
      <Form form={form} layout="vertical" initialValues={{ returnCarrier: 'JNE' }}>
        <Form.Item label="退货物流" name="returnCarrier" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label="退货运单号" name="returnTrackingNo" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <p style={{ color: '#999', fontSize: 12 }}>提交后, 退货商品将自动入库到默认仓库, 售后单进入"退货处理中"状态</p>
      </Form>
    </Modal>
  );
}
