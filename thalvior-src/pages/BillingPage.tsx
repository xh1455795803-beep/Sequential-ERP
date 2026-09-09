// 计费/订阅管理 (P2-1.2)
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Table,
  Tag,
  Space,
  Button,
  Row,
  Col,
  Typography,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  message,
  Tabs,
  Statistic,
  Progress,
} from 'antd';
import {
  CrownOutlined,
  GiftOutlined,
  PayCircleOutlined,
  FileTextOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { billingApi } from '../api';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const PLAN_COLORS: Record<string, string> = {
  free: '#bfbfbf',
  basic: '#52c41a',
  pro: '#1677ff',
  enterprise: '#722ed1',
};

const PLAN_BADGE: Record<string, string> = {
  free: '免费',
  basic: '基础',
  pro: '专业',
  enterprise: '企业',
};

export default function BillingPage() {
  const [tab, setTab] = useState('plan');
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const [subPlan, setSubPlan] = useState<any>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceOrder, setInvoiceOrder] = useState<any>(null);
  const [form] = Form.useForm();
  const [invoiceForm] = Form.useForm();
  const qc = useQueryClient();

  const { data: plans = [] } = useQuery({ queryKey: ['billing-plans'], queryFn: () => billingApi.plans() });
  const { data: current } = useQuery({ queryKey: ['billing-current'], queryFn: () => billingApi.current() });
  const { data: orders } = useQuery({ queryKey: ['billing-orders'], queryFn: () => billingApi.orders() });
  const { data: invoices = [] } = useQuery({ queryKey: ['billing-invoices'], queryFn: () => billingApi.invoices() });
  const { data: limitProducts } = useQuery({ queryKey: ['billing-limit-products'], queryFn: () => billingApi.limit('products') });
  const { data: limitShops } = useQuery({ queryKey: ['billing-limit-shops'], queryFn: () => billingApi.limit('shops') });
  const { data: limitOrders } = useQuery({ queryKey: ['billing-limit-orders'], queryFn: () => billingApi.limit('orders') });
  const { data: limitUsers } = useQuery({ queryKey: ['billing-limit-users'], queryFn: () => billingApi.limit('users') });

  const subscribeMut = useMutation({ mutationFn: billingApi.subscribe, onSuccess: (res: any) => { message.success('订单已创建, 请支付'); setSubscribeOpen(false); qc.invalidateQueries({ queryKey: ['billing-orders'] }); qc.invalidateQueries({ queryKey: ['billing-current'] }); } });
  const payMut = useMutation({ mutationFn: billingApi.pay, onSuccess: () => { message.success('支付成功'); qc.invalidateQueries({ queryKey: ['billing-current'] }); qc.invalidateQueries({ queryKey: ['billing-orders'] }); } });
  const invoiceMut = useMutation({ mutationFn: billingApi.invoice, onSuccess: () => { message.success('发票申请已提交'); setInvoiceOpen(false); qc.invalidateQueries({ queryKey: ['billing-invoices'] }); } });

  const onSubscribe = (plan: any) => { setSubPlan(plan); form.resetFields(); form.setFieldsValue({ planCode: plan.code, months: 1, payMethod: 'alipay' }); setSubscribeOpen(true); };
  const onPay = (order: any) => Modal.confirm({ title: `确认支付订单 ${order.orderNo}?`, content: `${order.currency} ${order.amount} (演示环境直接标记为已支付)`, onOk: () => payMut.mutate(order.id) });
  const onInvoice = (order: any) => { setInvoiceOrder(order); invoiceForm.resetFields(); invoiceForm.setFieldsValue({ billingOrderId: order.id, type: 'normal' }); setInvoiceOpen(true); };

  const limits = (current?.plan?.limits || {}) as any;
  const items = orders?.items || [];

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}><CrownOutlined /> 订阅与账单</Title>
      <Text type="secondary">查看当前套餐 / 升级 / 续费 / 申请发票</Text>

      {current && (
        <Card style={{ marginTop: 16, background: `linear-gradient(135deg, ${PLAN_COLORS[current.plan?.code] || '#1677ff'}22, #fff)` }} bordered={false}>
          <Row gutter={16} align="middle">
            <Col span={4}>
              <div style={{ fontSize: 48, fontWeight: 600, color: PLAN_COLORS[current.plan?.code] || '#1677ff' }}>
                <GiftOutlined />
              </div>
            </Col>
            <Col span={10}>
              <Tag color="blue">{current.status === 'trial' ? '试用中' : current.status === 'active' ? '生效中' : current.status}</Tag>
              <Title level={3} style={{ marginTop: 8, marginBottom: 4 }}>{current.plan?.name}</Title>
              <Text type="secondary">到期: {current.endAt ? dayjs(current.endAt).format('YYYY-MM-DD') : '永久'} {current.autoRenew && '· 自动续费'}</Text>
            </Col>
            <Col span={5}>
              <Statistic title="月费" value={current.plan?.price || 0} suffix={current.plan?.currency} />
            </Col>
            <Col span={5}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text type="secondary">包含功能</Text>
                {(current.plan?.features || []).slice(0, 3).map((f: string) => <Tag key={f} color="blue">{f}</Tag>)}
              </Space>
            </Col>
          </Row>
        </Card>
      )}

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col span={6}><Card><Statistic title="商品用量" value={limitProducts?.current || 0} suffix={`/ ${limitProducts?.max}`} /></Card></Col>
        <Col span={6}><Card><Statistic title="店铺用量" value={limitShops?.current || 0} suffix={`/ ${limitShops?.max}`} /></Card></Col>
        <Col span={6}><Card><Statistic title="订单用量" value={limitOrders?.current || 0} suffix={`/ ${limitOrders?.max}`} /></Card></Col>
        <Col span={6}><Card><Statistic title="用户用量" value={limitUsers?.current || 0} suffix={`/ ${limitUsers?.max}`} /></Card></Col>
      </Row>

      <Card style={{ marginTop: 16 }} bordered={false}>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            { key: 'plan', label: '套餐升级', children: (
              <Row gutter={[16, 16]}>
                {plans.map((p: any) => {
                  const isCurrent = current?.plan?.code === p.code;
                  return (
                    <Col key={p.code} span={6}>
                      <Card
                        title={
                          <Space>
                            <Tag color={PLAN_COLORS[p.code]} style={{ color: '#fff', border: 'none' }}>
                              {PLAN_BADGE[p.code]}
                            </Tag>
                            <span>{p.name}</span>
                          </Space>
                        }
                        style={{ borderColor: isCurrent ? PLAN_COLORS[p.code] : undefined, borderWidth: isCurrent ? 2 : 1 }}
                        extra={isCurrent ? <Tag color="success">当前</Tag> : null}
                      >
                        <div style={{ textAlign: 'center', padding: '12px 0' }}>
                          <div style={{ fontSize: 32, fontWeight: 600, color: PLAN_COLORS[p.code] }}>
                            {p.currency} {p.price}<Text type="secondary" style={{ fontSize: 14 }}> /月</Text>
                          </div>
                          <Text type="secondary">年付 {p.currency} {p.yearlyPrice}</Text>
                        </div>
                        <Space direction="vertical" style={{ width: '100%' }}>
                          {(p.features || []).map((f: string) => <div key={f}><PayCircleOutlined style={{ color: PLAN_COLORS[p.code] }} /> {f}</div>)}
                        </Space>
                        <div style={{ marginTop: 16 }}>
                          <Text type="secondary">配额: 店铺 {p.limits?.maxShops} · 商品 {p.limits?.maxProducts} · 订单 {p.limits?.maxOrders}</Text>
                        </div>
                        <Button block type={isCurrent ? 'default' : 'primary'} style={{ marginTop: 12 }} disabled={isCurrent} onClick={() => onSubscribe(p)}>
                          {isCurrent ? '当前套餐' : p.price > 0 ? '立即升级' : '切换到此套餐'}
                        </Button>
                      </Card>
                    </Col>
                  );
                })}
              </Row>
            )},
            { key: 'orders', label: `账单 (${orders?.total || 0})`, children: (
              <Table
                size="middle"
                rowKey="id"
                dataSource={items}
                pagination={{ pageSize: 10 }}
                columns={[
                  { title: '订单号', dataIndex: 'orderNo', width: 200 },
                  { title: '套餐', dataIndex: 'planName', width: 120 },
                  { title: '类型', dataIndex: 'type', width: 100, render: (v) => <Tag>{v === 'new' ? '新购' : v === 'renew' ? '续费' : '升级'}</Tag> },
                  { title: '金额', dataIndex: 'amount', width: 130, render: (v, r) => `${r.currency} ${v.toFixed(2)}` },
                  { title: '支付方式', dataIndex: 'payMethod', width: 120, render: (v) => v || '-' },
                  { title: '状态', dataIndex: 'status', width: 110, render: (v) => <Tag color={v === 'paid' ? 'green' : v === 'pending' ? 'orange' : 'default'}>{v === 'paid' ? '已支付' : v === 'pending' ? '待支付' : v}</Tag> },
                  { title: '时间', dataIndex: 'createdAt', width: 160, render: (v) => dayjs(v).format('YYYY-MM-DD HH:mm') },
                  {
                    title: '操作', key: 'op', width: 200, fixed: 'right' as const,
                    render: (_: any, r: any) => (
                      <Space>
                        {r.status === 'pending' && <Button type="link" size="small" onClick={() => onPay(r)}>支付</Button>}
                        {r.status === 'paid' && <Button type="link" size="small" onClick={() => onInvoice(r)}>申请发票</Button>}
                      </Space>
                    ),
                  },
                ]}
              />
            )},
            { key: 'invoices', label: `发票 (${invoices.length})`, children: (
              <Table
                size="middle"
                rowKey="id"
                dataSource={invoices}
                pagination={{ pageSize: 10 }}
                columns={[
                  { title: '发票号', dataIndex: 'invoiceNo', width: 200 },
                  { title: '抬头', dataIndex: 'title', width: 200 },
                  { title: '税号', dataIndex: 'taxNo', width: 180 },
                  { title: '类型', dataIndex: 'type', width: 100, render: (v) => <Tag>{v === 'vat' ? '增值税专票' : '普通发票'}</Tag> },
                  { title: '金额', dataIndex: 'amount', width: 110, render: (v) => v.toFixed(2) },
                  { title: '税额', dataIndex: 'tax', width: 110, render: (v) => v.toFixed(2) },
                  { title: '含税合计', dataIndex: 'total', width: 120, render: (v) => <b>{v.toFixed(2)}</b> },
                  { title: '状态', dataIndex: 'status', width: 110, render: (v) => <Tag color={v === 'issued' ? 'green' : 'orange'}>{v === 'issued' ? '已开' : '待开'}</Tag> },
                  { title: '申请时间', dataIndex: 'createdAt', width: 160, render: (v) => dayjs(v).format('YYYY-MM-DD HH:mm') },
                ]}
              />
            )},
          ]}
        />
      </Card>

      <Modal title={`订阅 ${subPlan?.name}`} open={subscribeOpen} onCancel={() => setSubscribeOpen(false)} onOk={() => form.submit()} confirmLoading={subscribeMut.isPending}>
        <Form form={form} layout="vertical" onFinish={(v) => subscribeMut.mutate(v)}>
          <Form.Item label="套餐编码" name="planCode"><Input disabled /></Form.Item>
          <Form.Item label="购买月数" name="months" rules={[{ required: true }]}><InputNumber min={1} max={36} style={{ width: '100%' }} /></Form.Item>
          <Form.Item label="支付方式" name="payMethod">
            <Select options={[{ value: 'alipay', label: '支付宝' }, { value: 'wechat', label: '微信支付' }, { value: 'bank', label: '对公转账' }]} />
          </Form.Item>
          {subPlan && <div>合计: <b style={{ color: '#1677ff', fontSize: 18 }}>{subPlan.currency} {(subPlan.price * (form.getFieldValue('months') || 1)).toFixed(2)}</b></div>}
        </Form>
      </Modal>

      <Modal title="申请发票" open={invoiceOpen} onCancel={() => setInvoiceOpen(false)} onOk={() => invoiceForm.submit()} confirmLoading={invoiceMut.isPending}>
        <Form form={invoiceForm} layout="vertical" onFinish={(v) => invoiceMut.mutate(v)}>
          <Form.Item label="账单订单" name="billingOrderId"><Input disabled /></Form.Item>
          <Form.Item label="发票抬头" name="title" rules={[{ required: true }]}><Input placeholder="公司全称或个人姓名" /></Form.Item>
          <Form.Item label="税号" name="taxNo"><Input placeholder="增值税专票必填" /></Form.Item>
          <Form.Item label="发票类型" name="type">
            <Select options={[{ value: 'normal', label: '普通发票' }, { value: 'vat', label: '增值税专票' }]} />
          </Form.Item>
          <Form.Item label="接收邮箱" name="email"><Input placeholder="电子发票将发送至此邮箱" /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
