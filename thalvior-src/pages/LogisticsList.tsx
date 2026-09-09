import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Tag, Space, Button, Input, Select, Form, Row, Col, Typography,
  Tabs, Modal, message, Timeline, Statistic,
} from 'antd';
import {
  ReloadOutlined, PlusOutlined,
  SendOutlined, CompassOutlined, CheckCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { logisticsApi, orderApi } from '../api';
import { usePermission } from '../hooks/usePermission';

const { Title, Text } = Typography;

const CARRIERS = [
  { value: 'yuantong', label: '圆通国际' },
  { value: 'shunfeng', label: '顺丰国际' },
  { value: 'ems', label: 'EMS' },
  { value: 'dhl', label: 'DHL' },
  { value: 'ups', label: 'UPS' },
  { value: 'fedex', label: 'FedEx' },
  { value: 'yanwen', label: '燕文物流' },
  { value: 'yunexpress', label: '云途物流' },
];

// ============ 渠道管理 Tab ============
function ChannelTab() {
  const [editing, setEditing] = useState<any | null>(null);
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { has } = usePermission();

  const { data, isLoading } = useQuery({
    queryKey: ['logistics-channels'],
    queryFn: () => logisticsApi.channels(),
  });

  const createMut = useMutation({
    mutationFn: logisticsApi.createChannel,
    onSuccess: () => {
      message.success('已创建');
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['logistics-channels'] });
    },
  });

  const columns = [
    { title: '渠道编码', dataIndex: 'code', width: 140 },
    { title: '渠道名称', dataIndex: 'name', width: 200 },
    {
      title: '承运商',
      dataIndex: 'carrier',
      width: 160,
      render: (v: string) => CARRIERS.find((c) => c.value === v)?.label || v,
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 100,
      render: (v: number) => v === 1 ? <Tag color="blue">自营</Tag> : <Tag>三方</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 100,
      render: (v: number) => v === 1 ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-',
    },
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 12 }}>
        <Col span={6}><Card bordered={false}><Statistic title="渠道总数" value={(data || []).length} prefix={<SendOutlined />} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title="启用" value={(data || []).filter((d: any) => d.enabled === 1).length} valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title="自营" value={(data || []).filter((d: any) => d.type === 1).length} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title="第三方" value={(data || []).filter((d: any) => d.type !== 1).length} /></Card></Col>
      </Row>
      <Card bordered={false} extra={has('logistics:channel') && (
        <Button type="primary" icon={<PlusOutlined />} onClick={() => {
          setEditing({});
          form.resetFields();
        }}>新增渠道</Button>
      )}>
        <Table
          size="middle"
          columns={columns as any}
          dataSource={data || []}
          loading={isLoading}
          rowKey="id"
          pagination={false}
        />
      </Card>
      <Modal
        title={editing?.id ? '编辑渠道' : '新增渠道'}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={async () => {
          const v = await form.validateFields();
          createMut.mutate(v);
        }}
        confirmLoading={createMut.isPending}
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="code" label="编码" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}>
              <Form.Item name="carrier" label="承运商" rules={[{ required: true }]}>
                <Select options={CARRIERS} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="type" label="类型" initialValue={1}>
                <Select options={[{ label: '自营', value: 1 }, { label: '三方', value: 2 }]} />
              </Form.Item>
            </Col>
            <Col span={24}><Form.Item name="apiKey" label="API Key"><Input.Password placeholder="渠道 API 凭证" /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
}

// ============ 物流轨迹 Tab ============
function TrackTab() {
  const [trackingNo, setTrackingNo] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const onTrack = async () => {
    if (!trackingNo) {
      message.warning('请输入运单号');
      return;
    }
    setLoading(true);
    try {
      const r = await logisticsApi.track(trackingNo);
      setResult(r);
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Card bordered={false}>
        <Space.Compact style={{ width: '100%', maxWidth: 600 }}>
          <Input
            size="large"
            placeholder="请输入运单号"
            value={trackingNo}
            onChange={(e) => setTrackingNo(e.target.value)}
            onPressEnter={onTrack}
            prefix={<CompassOutlined />}
          />
          <Button size="large" type="primary" loading={loading} onClick={onTrack}>查询</Button>
        </Space.Compact>
        <div style={{ marginTop: 12, color: '#999', fontSize: 12 }}>
          支持国际快递 (DHL/UPS/FedEx/EMS) 及国内快递 (顺丰/圆通/燕文/云途)
        </div>
      </Card>

      {result && (
        <Card style={{ marginTop: 16 }} bordered={false}
          title={<Space><span>运单号 {result.trackingNo}</span><Tag color="blue">{result.carrier}</Tag></Space>}
        >
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={6}>
              <Statistic
                title="状态"
                value={result.status === 'delivered' ? '已签收' : result.status === 'in_transit' ? '运输中' : '已发出'}
                valueStyle={{ color: result.status === 'delivered' ? '#52c41a' : '#1890ff' }}
                prefix={result.status === 'delivered' ? <CheckCircleOutlined /> : <CompassOutlined />}
              />
            </Col>
            <Col span={18}>
              <Card size="small">
                <div style={{ fontWeight: 'bold', marginBottom: 4 }}>最新动态</div>
                <div style={{ color: '#666' }}>
                  {result.lastEvent?.time ? dayjs(result.lastEvent.time).format('YYYY-MM-DD HH:mm') : '-'}
                  {' '}{result.lastEvent?.location} - {result.lastEvent?.action}
                </div>
                <div style={{ color: '#999', marginTop: 4 }}>{result.lastEvent?.detail}</div>
              </Card>
            </Col>
          </Row>
          <Title level={5}>物流轨迹</Title>
          <Timeline
            items={(result.events || []).map((e: any) => ({
              color: 'blue',
              children: (
                <div>
                  <div style={{ fontWeight: 'bold' }}>{e.action} - {e.location}</div>
                  <div style={{ color: '#666', fontSize: 13 }}>{e.detail}</div>
                  <div style={{ color: '#999', fontSize: 12 }}>{dayjs(e.time).format('YYYY-MM-DD HH:mm:ss')}</div>
                </div>
              ),
            }))}
          />
        </Card>
      )}
    </div>
  );
}

// ============ 面单打印 Tab ============
function WaybillTab() {
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 20, status: 'toship' });
  const { data, isLoading } = useQuery({
    queryKey: ['orders', filters],
    queryFn: () => orderApi.list(filters),
  });
  const { data: channels } = useQuery({
    queryKey: ['logistics-channels'],
    queryFn: () => logisticsApi.channels(),
  });

  const onPrint = (record: any) => {
    Modal.info({
      title: '面单已生成',
      width: 500,
      content: (
        <div>
          <p>订单号: {record.platformNo}</p>
          <p>收件人: {record.buyerName}</p>
          <p>国家: {record.country}</p>
          <p>推荐渠道: {(channels || [])[0]?.name || '请先配置渠道'}</p>
          <p style={{ color: '#999' }}>实际打印请到对应物流服务商后台操作</p>
        </div>
      ),
    });
  };

  const columns = [
    { title: '订单号', dataIndex: 'platformNo', width: 200 },
    { title: '收件人', dataIndex: 'buyerName', width: 120 },
    { title: '国家', dataIndex: 'country', width: 80 },
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
        const map: Record<string, { color: string; text: string }> = {
          pending: { color: 'default', text: '待付款' },
          pay: { color: 'cyan', text: '已付款' },
          toship: { color: 'blue', text: '待发货' },
          shipped: { color: 'green', text: '已发货' },
          done: { color: 'green', text: '已完成' },
          cancel: { color: 'red', text: '已取消' },
        };
        return <Tag color={map[v]?.color}>{map[v]?.text || v}</Tag>;
      },
    },
    {
      title: '操作',
      width: 160,
      fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Button size="small" type="primary" onClick={() => onPrint(r)} disabled={r.status !== 'toship'}>
          打印面单
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Card bordered={false}>
        <Form
          layout="inline"
          onFinish={(v) => setFilters((f: any) => ({ ...f, ...v, page: 1 }))}
        >
          <Form.Item name="platformNo">
            <Input placeholder="订单号" allowClear style={{ width: 200 }} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">查询</Button>
              <Button onClick={() => setFilters({ page: 1, pageSize: 20, status: 'toship' })} icon={<ReloadOutlined />}>重置</Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
      <Card style={{ marginTop: 16 }} bordered={false} title="待打印面单 (待发货订单)">
        <Table
          size="middle"
          columns={columns as any}
          dataSource={data?.items || []}
          loading={isLoading}
          rowKey="id"
          scroll={{ x: 900 }}
          pagination={{
            current: filters.page,
            pageSize: filters.pageSize,
            total: data?.total || 0,
            showSizeChanger: true,
            onChange: (page, pageSize) => setFilters((f: any) => ({ ...f, page, pageSize })),
          }}
        />
      </Card>
    </div>
  );
}

// ============ 入口 ============
export default function LogisticsList() {
  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>物流分拨</Title>
      <Text type="secondary">物流渠道管理 · 轨迹查询 · 面单打印</Text>
      <Tabs
        style={{ marginTop: 12 }}
        defaultActiveKey="channel"
        items={[
          { key: 'channel', label: '物流渠道', children: <ChannelTab /> },
          { key: 'waybill', label: '面单打印', children: <WaybillTab /> },
          { key: 'track', label: '物流轨迹查询', children: <TrackTab /> },
        ]}
      />
    </div>
  );
}
