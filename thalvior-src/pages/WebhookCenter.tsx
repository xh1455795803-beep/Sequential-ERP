// Webhook 事件管理
import { useState } from 'react';
import {
  Table,
  Tag,
  Space,
  Button,
  Card,
  Row,
  Col,
  Statistic,
  Typography,
  Drawer,
  Descriptions,
  Empty,
  Input,
  Select,
  message,
  Form,
  Popconfirm,
} from 'antd';
import {
  ReloadOutlined,
  PlayCircleOutlined,
  ApiOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  EyeOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { webhookApi } from '../api';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const STATUS_TAG: Record<string, { color: string; label: string; icon: any }> = {
  pending: { color: 'default', label: '待处理', icon: <ExclamationCircleOutlined /> },
  processed: { color: 'success', label: '已处理', icon: <CheckCircleOutlined /> },
  failed: { color: 'error', label: '失败', icon: <CloseCircleOutlined /> },
  ignored: { color: 'default', label: '已忽略', icon: null },
};

const EVENT_TAG: Record<string, { color: string; label: string }> = {
  'order.created': { color: 'blue', label: '订单创建' },
  'order.paid': { color: 'green', label: '订单支付' },
  'order.shipped': { color: 'cyan', label: '订单发货' },
  'shipment.updated': { color: 'cyan', label: '物流更新' },
  'inventory.updated': { color: 'gold', label: '库存更新' },
};

export default function WebhookCenter() {
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 15 });
  const [detail, setDetail] = useState<any | null>(null);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['webhook-events', filters],
    queryFn: () => webhookApi.events(filters),
    refetchInterval: 5000,
  });
  const { data: ov } = useQuery({
    queryKey: ['webhook-overview'],
    queryFn: () => webhookApi.overview(),
    refetchInterval: 5000,
  });

  const items = data?.items || [];
  const total = data?.total || 0;
  const overview = (ov as any) || {};

  const handleReplay = async (id: string) => {
    const hide = message.loading('重放中...', 0);
    try {
      await webhookApi.replay(id);
      message.success('已重放');
      qc.invalidateQueries({ queryKey: ['webhook-events'] });
      qc.invalidateQueries({ queryKey: ['webhook-overview'] });
      if (detail?.id === id) {
        const fresh = await webhookApi.detail(id);
        setDetail(fresh);
      }
    } catch (e: any) {
      message.error(e?.message || '重放失败');
    } finally {
      hide();
    }
  };

  const handleRetryAll = async () => {
    const hide = message.loading('重试中...', 0);
    try {
      const r = await webhookApi.retryFailed();
      message.success(`已重试 ${r.retried} 条`);
      qc.invalidateQueries({ queryKey: ['webhook-events'] });
      qc.invalidateQueries({ queryKey: ['webhook-overview'] });
    } catch (e: any) {
      message.error(e?.message || '重试失败');
    } finally {
      hide();
    }
  };

  const columns: any[] = [
    {
      title: '平台 / 事件',
      key: 'pe',
      width: 200,
      render: (_: any, r: any) => (
        <Space direction="vertical" size={0}>
          <Space size={4}>
            <Tag color="purple">{r.platform}</Tag>
            <Tag color={EVENT_TAG[r.event]?.color || 'default'}>{EVENT_TAG[r.event]?.label || r.event}</Tag>
          </Space>
          {r.externalId && <code style={{ fontSize: 11, color: '#999' }}>{r.externalId}</code>}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (s: string, r: any) => (
        <Space direction="vertical" size={0}>
          <Tag color={STATUS_TAG[s]?.color} icon={STATUS_TAG[s]?.icon}>{STATUS_TAG[s]?.label}</Tag>
          {r.attempts > 0 && <span style={{ fontSize: 11, color: '#999' }}>重试 {r.attempts} 次</span>}
        </Space>
      ),
    },
    {
      title: '关联',
      key: 'ref',
      width: 180,
      render: (_: any, r: any) => (
        r.refType ? (
          <Space direction="vertical" size={0}>
            <span style={{ fontSize: 11 }}>{r.refType}</span>
            <code style={{ fontSize: 10, color: '#999' }}>{r.refId?.slice(0, 16)}…</code>
          </Space>
        ) : <Text type="secondary">-</Text>
      ),
    },
    {
      title: '错误',
      dataIndex: 'errorMsg',
      width: 200,
      ellipsis: true,
      render: (v: string) => v ? <span style={{ color: '#ff4d4f', fontSize: 12 }}>{v}</span> : '-',
    },
    {
      title: '时间',
      key: 'time',
      width: 140,
      render: (_: any, r: any) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontSize: 12 }}>{dayjs(r.createdAt).format('MM-DD HH:mm:ss')}</span>
          {r.processedAt && <span style={{ fontSize: 10, color: '#999' }}>处理: {dayjs(r.processedAt).format('HH:mm:ss')}</span>}
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'op',
      width: 150,
      fixed: 'right',
      render: (_: any, r: any) => (
        <Space size={4} wrap>
          <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => setDetail(r)}>详情</Button>
          {(r.status === 'failed' || r.status === 'processed') && (
            <Button size="small" type="link" icon={<PlayCircleOutlined />} onClick={() => handleReplay(r.id)}>重放</Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>Webhook 回调</Title>
      <Text type="secondary">接收各平台推送: 订单/库存/物流 · 支持验签 + 幂等去重</Text>

      <Row gutter={16} style={{ marginTop: 12, marginBottom: 16 }}>
        <Col span={4}><Card bordered={false}><Statistic title="总事件" value={overview.total || 0} prefix={<ApiOutlined />} /></Card></Col>
        <Col span={4}><Card bordered={false}><Statistic title="待处理" value={overview.pending || 0} valueStyle={{ color: '#fa8c16' }} prefix={<ExclamationCircleOutlined />} /></Card></Col>
        <Col span={4}><Card bordered={false}><Statistic title="已处理" value={overview.processed || 0} valueStyle={{ color: '#52c41a' }} prefix={<CheckCircleOutlined />} /></Card></Col>
        <Col span={4}><Card bordered={false}><Statistic title="失败" value={overview.failed || 0} valueStyle={{ color: '#ff4d4f' }} prefix={<CloseCircleOutlined />} /></Card></Col>
        <Col span={4}><Card bordered={false}><Statistic title="已忽略" value={overview.ignored || 0} prefix={null} /></Card></Col>
        <Col span={4}>
          <Popconfirm title="重试所有 failed 事件?" onConfirm={handleRetryAll}>
            <Button type="primary" size="large" icon={<ThunderboltOutlined />} block>批量重试</Button>
          </Popconfirm>
        </Col>
      </Row>

      <Card bordered={false} style={{ marginBottom: 12 }}>
        <Space wrap>
          <Input.Search
            placeholder="按 ID 搜索"
            allowClear
            style={{ width: 220 }}
            onSearch={(v) => setFilters((f: any) => ({ ...f, keyword: v, page: 1 }))}
          />
          <Select
            placeholder="平台"
            allowClear
            style={{ width: 130 }}
            value={filters.platform}
            onChange={(v) => setFilters((f: any) => ({ ...f, platform: v, page: 1 }))}
            options={[
              { value: 'shopee', label: 'Shopee' },
              { value: 'tiktok', label: 'TikTok' },
              { value: 'amazon', label: 'Amazon' },
              { value: 'lazada', label: 'Lazada' },
              { value: 'aliexpress', label: 'AliExpress' },
              { value: 'ebay', label: 'eBay' },
            ]}
          />
          <Select
            placeholder="状态"
            allowClear
            style={{ width: 130 }}
            value={filters.status}
            onChange={(v) => setFilters((f: any) => ({ ...f, status: v, page: 1 }))}
            options={Object.entries(STATUS_TAG).map(([k, v]) => ({ value: k, label: v.label }))}
          />
          <Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['webhook-events'] })}>刷新</Button>
        </Space>
      </Card>

      <Card bordered={false} title="事件列表">
        {items.length ? (
          <Table
            size="middle"
            columns={columns}
            dataSource={items}
            loading={isLoading}
            rowKey="id"
            scroll={{ x: 1200 }}
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
          !isLoading && <Empty description="暂无 Webhook 事件" />
        )}
      </Card>

      <Drawer
        title={`Webhook 详情 - ${detail?.id?.slice(0, 16) || ''}`}
        open={!!detail}
        onClose={() => setDetail(null)}
        width={760}
      >
        {detail && (
          <>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="平台"><Tag color="purple">{detail.platform}</Tag></Descriptions.Item>
              <Descriptions.Item label="事件"><Tag color={EVENT_TAG[detail.event]?.color}>{EVENT_TAG[detail.event]?.label || detail.event}</Tag></Descriptions.Item>
              <Descriptions.Item label="外部 ID" span={2}><code>{detail.externalId || '-'}</code></Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={STATUS_TAG[detail.status]?.color} icon={STATUS_TAG[detail.status]?.icon}>{STATUS_TAG[detail.status]?.label}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="重试次数">{detail.attempts}</Descriptions.Item>
              <Descriptions.Item label="关联类型">{detail.refType || '-'}</Descriptions.Item>
              <Descriptions.Item label="关联 ID" span={2}><code>{detail.refId || '-'}</code></Descriptions.Item>
              <Descriptions.Item label="接收时间">{dayjs(detail.createdAt).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>
              <Descriptions.Item label="处理时间">{detail.processedAt ? dayjs(detail.processedAt).format('YYYY-MM-DD HH:mm:ss') : '-'}</Descriptions.Item>
              {detail.errorMsg && <Descriptions.Item label="错误信息" span={2}><span style={{ color: '#ff4d4f' }}>{detail.errorMsg}</span></Descriptions.Item>}
            </Descriptions>

            <Title level={5} style={{ marginTop: 16 }}>原始 Payload</Title>
            <pre style={{
              background: '#fafafa',
              padding: 12,
              borderRadius: 4,
              fontSize: 12,
              maxHeight: 300,
              overflow: 'auto',
              border: '1px solid #f0f0f0',
            }}>
{(() => {
  try {
    return JSON.stringify(JSON.parse(detail.payload), null, 2);
  } catch {
    return detail.payload;
  }
})()}
            </pre>
          </>
        )}
      </Drawer>
    </div>
  );
}
