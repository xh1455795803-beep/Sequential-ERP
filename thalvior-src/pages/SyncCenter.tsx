// 平台同步中心
// - 列出所有已绑定店铺, 一键触发商品/订单/库存同步
// - 同步任务列表, 含每条 log
// - 自动轮询正在运行的任务, 完成后刷新
import { useState, useCallback } from 'react';
import {
  Card,
  Table,
  Tag,
  Space,
  Button,
  Select,
  Modal,
  Descriptions,
  Timeline,
  Statistic,
  Row,
  Col,
  Tooltip,
  Progress,
  message,
  Empty,
  Spin,
} from 'antd';
import {
  SyncOutlined,
  CloudDownloadOutlined,
  CloudUploadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ShopOutlined,
  ApiOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { shopApi, syncApi, platformApi } from '../api';
import dayjs from 'dayjs';

const STATUS_TAG: Record<string, { color: string; label: string }> = {
  success: { color: 'green', label: '成功' },
  failed: { color: 'red', label: '失败' },
  partial: { color: 'orange', label: '部分成功' },
  running: { color: 'blue', label: '同步中' },
  pending: { color: 'default', label: '等待中' },
};

export default function SyncCenter() {
  const [shopId, setShopId] = useState<string>();
  const [platform, setPlatform] = useState<string>();
  const [detailTaskId, setDetailTaskId] = useState<string>();
  const qc = useQueryClient();

  const { data: shopsResp } = useQuery({
    queryKey: ['shops-all'],
    queryFn: () => shopApi.list({ page: 1, pageSize: 200 }),
  });
  const shops = shopsResp?.items || [];

  const { data: platformsResp } = useQuery({
    queryKey: ['platforms'],
    queryFn: () => platformApi.list(),
  });
  const platforms: any[] = (platformsResp as any)?.data || platformsResp || [];
  const platformMap: Record<string, string> = Object.fromEntries(platforms.map((p: any) => [p.id, p.name]));

  const { data: tasksResp, refetch: refetchTasks } = useQuery({
    queryKey: ['sync-tasks', shopId, platform],
    queryFn: () => syncApi.tasks({ shopId, platform, page: 1, pageSize: 30 }),
    refetchInterval: (q) => {
      const data = q.state.data as any;
      const running = (data?.items || []).some((t: any) => t.status === 'running' || t.status === 'pending');
      return running ? 2000 : false;
    },
  });
  const tasks = tasksResp?.items || [];

  const { data: taskDetail, isFetching: detailLoading } = useQuery({
    queryKey: ['sync-task', detailTaskId],
    queryFn: () => syncApi.taskDetail(detailTaskId!),
    enabled: !!detailTaskId,
  });

  // 统计
  const stats = {
    total: tasks.length,
    running: tasks.filter((t: any) => t.status === 'running' || t.status === 'pending').length,
    success: tasks.filter((t: any) => t.status === 'success').length,
    failed: tasks.filter((t: any) => t.status === 'failed' || t.status === 'partial').length,
  };

  const handleSync = useCallback(
    async (sid: string, type: 'product' | 'order' | 'inventory' | 'shop') => {
      try {
        const r: any = await syncApi.run({ shopId: sid, type });
        message.success(`已触发 ${type} 同步, 任务ID: ${r.id}`);
        refetchTasks();
      } catch (e: any) {
        message.error(e?.message || '同步触发失败');
      }
    },
    [refetchTasks],
  );

  const shopColumns = [
    { title: '店铺名', dataIndex: 'name', key: 'name', render: (v: string) => <strong>{v}</strong> },
    {
      title: '平台',
      dataIndex: 'platformId',
      key: 'platformId',
      render: (v: string) => <Tag color="blue">{platformMap[v] || v}</Tag>,
    },
    { title: '店铺 ID', dataIndex: 'shopId', key: 'shopId' },
    { title: '地区', dataIndex: 'region', key: 'region', render: (v: string) => v || '-' },
    { title: '币种', dataIndex: 'currency', key: 'currency' },
    {
      title: '授权状态',
      dataIndex: 'status',
      key: 'status',
      render: (s: number) => {
        const map: Record<number, { color: string; label: string }> = {
          1: { color: 'green', label: '正常' },
          0: { color: 'red', label: '停用' },
          2: { color: 'orange', label: '授权过期' },
        };
        const m = map[s] || { color: 'default', label: '未知' };
        return <Tag color={m.color}>{m.label}</Tag>;
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 360,
      render: (_: any, r: any) => (
        <Space size={4} wrap>
          <Tooltip title="健康检查">
            <Button size="small" icon={<ApiOutlined />} onClick={() => handleSync(r.id, 'shop')}>
              验权
            </Button>
          </Tooltip>
          <Tooltip title="拉取店铺下的商品">
            <Button
              size="small"
              type="primary"
              icon={<CloudDownloadOutlined />}
              onClick={() => handleSync(r.id, 'product')}
            >
              拉商品
            </Button>
          </Tooltip>
          <Tooltip title="拉取订单">
            <Button size="small" icon={<CloudDownloadOutlined />} onClick={() => handleSync(r.id, 'order')}>
              拉订单
            </Button>
          </Tooltip>
          <Tooltip title="把内部库存推回平台">
            <Button size="small" icon={<CloudUploadOutlined />} onClick={() => handleSync(r.id, 'inventory')}>
              推库存
            </Button>
          </Tooltip>
        </Space>
      ),
    },
  ];

  const taskColumns = [
    {
      title: '任务',
      key: 'task',
      render: (_: any, r: any) => (
        <Space direction="vertical" size={2}>
          <span>
            <Tag color="blue">{r.platform}</Tag>
            <Tag>{r.type}</Tag>
            <Tag color="purple">{r.trigger}</Tag>
          </span>
          <span style={{ fontSize: 12, color: '#999' }}>任务 ID: {r.id}</span>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (s: string) => {
        const t = STATUS_TAG[s] || { color: 'default', label: s };
        if (s === 'running') {
          return (
            <Tag color="blue" icon={<SyncOutlined spin />}>
              {t.label}
            </Tag>
          );
        }
        return <Tag color={t.color}>{t.label}</Tag>;
      },
    },
    {
      title: '进度',
      key: 'progress',
      width: 220,
      render: (_: any, r: any) => {
        if (r.total === 0 && r.status === 'running') {
          return <Progress size="small" status="active" percent={50} />;
        }
        const pct = r.total > 0 ? Math.round((r.success / r.total) * 100) : 0;
        return (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Progress
              size="small"
              percent={pct}
              status={r.status === 'failed' ? 'exception' : r.status === 'partial' ? 'active' : 'normal'}
            />
            <span style={{ fontSize: 12, color: '#999' }}>
              成功 {r.success} / 总 {r.total} / 失败 {r.failed}
            </span>
          </Space>
        );
      },
    },
    {
      title: '耗时',
      key: 'duration',
      width: 110,
      render: (_: any, r: any) => {
        if (!r.startedAt) return '-';
        const end = r.finishedAt ? new Date(r.finishedAt).getTime() : Date.now();
        const dur = Math.round((end - new Date(r.startedAt).getTime()) / 100) / 10;
        return <span style={{ fontSize: 12 }}>{dur}s</span>;
      },
    },
    {
      title: '店铺',
      dataIndex: 'shopId',
      key: 'shopId',
      render: (sid: string) => shops.find((s: any) => s.id === sid)?.name || sid,
    },
    {
      title: '开始时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 150,
      render: (v: string) => (v ? dayjs(v).format('MM-DD HH:mm:ss') : '-'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (_: any, r: any) => (
        <Button size="small" onClick={() => setDetailTaskId(r.id)}>
          详情
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic title="总任务" value={stats.total} prefix={<SyncOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="同步中"
              value={stats.running}
              valueStyle={{ color: '#1677ff' }}
              prefix={<SyncOutlined spin={stats.running > 0} />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="成功"
              value={stats.success}
              valueStyle={{ color: '#52c41a' }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="失败/部分"
              value={stats.failed}
              valueStyle={{ color: '#ff4d4f' }}
              prefix={<CloseCircleOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Card
        title={
          <Space>
            <ShopOutlined />
            已授权店铺 ({shops.length})
          </Space>
        }
        extra={
          <Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['shops-all'] })}>
            刷新
          </Button>
        }
        style={{ marginBottom: 16 }}
      >
        <Table
          rowKey="id"
          columns={shopColumns as any}
          dataSource={shops}
          size="middle"
          pagination={{ pageSize: 8 }}
        />
      </Card>

      <Card
        title={
          <Space>
            <SyncOutlined />
            同步任务
          </Space>
        }
        extra={
          <Space>
            <Select
              placeholder="筛选平台"
              allowClear
              style={{ width: 160 }}
              value={platform}
              onChange={setPlatform}
              options={platforms.map((p: any) => ({ value: p.code, label: p.name }))}
            />
            <Select
              placeholder="筛选店铺"
              allowClear
              style={{ width: 200 }}
              value={shopId}
              onChange={setShopId}
              options={shops.map((s: any) => ({ value: s.id, label: s.name }))}
            />
          </Space>
        }
      >
        <Table
          rowKey="id"
          columns={taskColumns as any}
          dataSource={tasks}
          size="middle"
          pagination={false}
        />
      </Card>

      <Modal
        title="任务详情"
        open={!!detailTaskId}
        onCancel={() => setDetailTaskId(undefined)}
        footer={null}
        width={760}
      >
        {detailLoading ? (
          <Spin />
        ) : taskDetail ? (
          <div>
            <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="任务 ID">{taskDetail.id}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={STATUS_TAG[taskDetail.status]?.color}>{STATUS_TAG[taskDetail.status]?.label || taskDetail.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="平台">{taskDetail.platform}</Descriptions.Item>
              <Descriptions.Item label="类型">{taskDetail.type}</Descriptions.Item>
              <Descriptions.Item label="触发方式">{taskDetail.trigger}</Descriptions.Item>
              <Descriptions.Item label="店铺">
                {shops.find((s: any) => s.id === taskDetail.shopId)?.name || taskDetail.shopId}
              </Descriptions.Item>
              <Descriptions.Item label="成功 / 失败 / 总数">
                {taskDetail.success} / {taskDetail.failed} / {taskDetail.total}
              </Descriptions.Item>
              <Descriptions.Item label="耗时">
                {taskDetail.startedAt && taskDetail.finishedAt
                  ? `${Math.round((new Date(taskDetail.finishedAt).getTime() - new Date(taskDetail.startedAt).getTime()) / 100) / 10}s`
                  : '-'}
              </Descriptions.Item>
              {taskDetail.message && (
                <Descriptions.Item label="消息" span={2}>
                  {taskDetail.message}
                </Descriptions.Item>
              )}
            </Descriptions>

            <h4>同步明细 ({taskDetail.logs?.length || 0})</h4>
            {taskDetail.logs?.length ? (
              <Timeline
                items={taskDetail.logs.map((log: any) => ({
                  color: log.status === 'success' ? 'green' : 'red',
                  children: (
                    <Space direction="vertical" size={2}>
                      <span>
                        <Tag color="blue">{log.action}</Tag>
                        <Tag color={log.status === 'success' ? 'green' : 'red'}>
                          {log.status === 'success' ? '成功' : '失败'}
                        </Tag>
                        {log.refId && <Tag>{log.refId}</Tag>}
                      </span>
                      {log.detail && <span style={{ fontSize: 12, color: '#999' }}>{log.detail}</span>}
                      <span style={{ fontSize: 12, color: '#ccc' }}>{dayjs(log.createdAt).format('YYYY-MM-DD HH:mm:ss')}</span>
                    </Space>
                  ),
                }))}
              />
            ) : (
              <Empty description="暂无明细" />
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
