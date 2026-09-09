// 定时任务管理
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
  Switch,
  message,
  Tooltip,
} from 'antd';
import {
  ClockCircleOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  FieldTimeOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { schedulerApi } from '../api';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const STATUS_TAG: Record<string, { color: string; label: string; icon: any }> = {
  success: { color: 'success', label: '成功', icon: <CheckCircleOutlined /> },
  failed: { color: 'error', label: '失败', icon: <CloseCircleOutlined /> },
  running: { color: 'processing', label: '执行中', icon: <ClockCircleOutlined /> },
};

export default function SchedulerCenter() {
  const [detail, setDetail] = useState<any | null>(null);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['scheduler-jobs'],
    queryFn: () => schedulerApi.jobs(),
    refetchInterval: 5000,
  });
  const jobs = (data as any) || [];
  const stats = {
    total: jobs.length,
    enabled: jobs.filter((j: any) => j.enabled).length,
    failed: jobs.filter((j: any) => j.lastStatus === 'failed').length,
    success: jobs.filter((j: any) => j.lastStatus === 'success').length,
  };

  const handleToggle = async (j: any) => {
    try {
      await schedulerApi.toggle(j.id, !j.enabled);
      message.success(j.enabled ? '已暂停' : '已启用');
      qc.invalidateQueries({ queryKey: ['scheduler-jobs'] });
    } catch (e: any) {
      message.error(e?.message || '操作失败');
    }
  };

  const handleRun = async (j: any) => {
    const hide = message.loading(`执行 ${j.name}...`, 0);
    try {
      const r = await schedulerApi.run(j.code);
      if (r.ok) {
        message.success(`执行成功: ${r.message || ''}`);
      } else {
        message.error(`执行失败: ${r.message || '未知错误'}`);
      }
      qc.invalidateQueries({ queryKey: ['scheduler-jobs'] });
      if (detail?.id === j.id) {
        const fresh = await schedulerApi.detail(j.id);
        setDetail(fresh);
      }
    } catch (e: any) {
      message.error(e?.message || '执行失败');
    } finally {
      hide();
    }
  };

  const columns: any[] = [
    {
      title: '任务',
      dataIndex: 'name',
      width: 220,
      render: (v: string, r: any) => (
        <Space direction="vertical" size={0}>
          <b>{v}</b>
          <code style={{ fontSize: 11, color: '#999' }}>{r.code}</code>
        </Space>
      ),
    },
    {
      title: 'Cron',
      dataIndex: 'cron',
      width: 140,
      render: (v: string) => <Tag color="blue" style={{ fontFamily: 'monospace' }}>{v}</Tag>,
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 80,
      render: (v: boolean, r: any) => <Switch size="small" checked={v} onChange={() => handleToggle(r)} />,
    },
    {
      title: '上次执行',
      dataIndex: 'lastStatus',
      width: 120,
      render: (s: string, r: any) => {
        if (!s) return <Text type="secondary">未执行</Text>;
        return (
          <Space direction="vertical" size={0}>
            <Tag color={STATUS_TAG[s]?.color} icon={STATUS_TAG[s]?.icon}>{STATUS_TAG[s]?.label}</Tag>
            {r.lastRunAt && <span style={{ fontSize: 11, color: '#999' }}>{dayjs(r.lastRunAt).format('MM-DD HH:mm')}</span>}
          </Space>
        );
      },
    },
    {
      title: '上次消息',
      dataIndex: 'lastMessage',
      ellipsis: true,
      render: (v: string) => <span style={{ fontSize: 12, color: '#666' }}>{v || '-'}</span>,
    },
    {
      title: '下次执行',
      dataIndex: 'nextRunAt',
      width: 150,
      render: (v: string) => v ? dayjs(v).format('MM-DD HH:mm') : '-',
    },
    {
      title: '操作',
      key: 'op',
      width: 180,
      fixed: 'right',
      render: (_: any, r: any) => (
        <Space size={4} wrap>
          <Button size="small" type="link" icon={<PlayCircleOutlined />} onClick={() => handleRun(r)}>
            立即执行
          </Button>
          <Button size="small" type="link" onClick={() => setDetail(r)}>
            详情
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>定时任务</Title>
      <Text type="secondary">内置调度器: 自动拉单 / 库存预警 / 凭证续期 / 每日备份</Text>

      <Row gutter={16} style={{ marginTop: 12, marginBottom: 16 }}>
        <Col span={6}><Card bordered={false}><Statistic title="任务总数" value={stats.total} prefix={<FieldTimeOutlined />} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title="已启用" value={stats.enabled} valueStyle={{ color: '#52c41a' }} prefix={<CheckCircleOutlined />} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title="执行成功" value={stats.success} valueStyle={{ color: '#1677ff' }} prefix={<CheckCircleOutlined />} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title="执行失败" value={stats.failed} valueStyle={{ color: '#ff4d4f' }} prefix={<CloseCircleOutlined />} /></Card></Col>
      </Row>

      <Card bordered={false} title="任务列表" extra={
        <Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['scheduler-jobs'] })}>刷新</Button>
      }>
        {jobs.length ? (
          <Table
            size="middle"
            columns={columns}
            dataSource={jobs}
            loading={isLoading}
            rowKey="id"
            scroll={{ x: 1200 }}
            pagination={false}
          />
        ) : (
          !isLoading && <Empty description="暂无任务" />
        )}
      </Card>

      <Drawer
        title={detail ? detail.name : ''}
        open={!!detail}
        onClose={() => setDetail(null)}
        width={760}
      >
        {detail && (
          <>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="任务编码" span={2}><code>{detail.code}</code></Descriptions.Item>
              <Descriptions.Item label="任务名称" span={2}>{detail.name}</Descriptions.Item>
              <Descriptions.Item label="Cron 表达式" span={2}><Tag color="blue">{detail.cron}</Tag></Descriptions.Item>
              <Descriptions.Item label="启用状态">{detail.enabled ? '是' : '否'}</Descriptions.Item>
              <Descriptions.Item label="上次状态">
                <Tag color={STATUS_TAG[detail.lastStatus || '']?.color}>{STATUS_TAG[detail.lastStatus || '']?.label || '未执行'}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="上次执行" span={2}>{detail.lastRunAt ? dayjs(detail.lastRunAt).format('YYYY-MM-DD HH:mm:ss') : '-'}</Descriptions.Item>
              <Descriptions.Item label="下次执行" span={2}>{detail.nextRunAt ? dayjs(detail.nextRunAt).format('YYYY-MM-DD HH:mm:ss') : '-'}</Descriptions.Item>
              <Descriptions.Item label="上次消息" span={2}>{detail.lastMessage || '-'}</Descriptions.Item>
              <Descriptions.Item label="说明" span={2}>{detail.description || '-'}</Descriptions.Item>
            </Descriptions>

            <Title level={5} style={{ marginTop: 20 }}>执行历史 (最近 50 条)</Title>
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={detail.logs || []}
              columns={[
                {
                  title: '状态', dataIndex: 'status', width: 80,
                  render: (s: string) => <Tag color={STATUS_TAG[s]?.color}>{STATUS_TAG[s]?.label || s}</Tag>,
                },
                {
                  title: '开始', dataIndex: 'startedAt', width: 150,
                  render: (v: string) => dayjs(v).format('MM-DD HH:mm:ss'),
                },
                { title: '耗时', dataIndex: 'duration', width: 80, render: (v: number) => v ? `${v}ms` : '-' },
                { title: '消息', dataIndex: 'message', ellipsis: true },
              ]}
            />
          </>
        )}
      </Drawer>
    </div>
  );
}
