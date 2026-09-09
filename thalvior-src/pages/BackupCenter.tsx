// 数据备份管理
// 列表/创建/下载/演练恢复/删除
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
  Modal,
  Form,
  Input,
  Popconfirm,
  message,
  Tooltip,
  Empty,
} from 'antd';
import {
  CloudUploadOutlined,
  DownloadOutlined,
  ExperimentOutlined,
  DeleteOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  HddOutlined,
  CloudServerOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { backupApi } from '../api';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const TYPE_TAG: Record<string, { color: string; label: string }> = {
  manual: { color: 'blue', label: '手动备份' },
  auto: { color: 'cyan', label: '自动备份' },
  'restore-drill': { color: 'purple', label: '恢复演练' },
};

const STATUS_TAG: Record<string, { color: string; label: string; icon: any }> = {
  pending: { color: 'default', label: '排队中', icon: <SyncOutlined spin /> },
  running: { color: 'processing', label: '执行中', icon: <SyncOutlined spin /> },
  success: { color: 'success', label: '成功', icon: <CheckCircleOutlined /> },
  failed: { color: 'error', label: '失败', icon: <CloseCircleOutlined /> },
};

const fmtSize = (n: number) => {
  if (!n) return '-';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
};

export default function BackupCenter() {
  const [form] = Form.useForm();
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 15 });
  const [createOpen, setCreateOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState<any | null>(null);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['backups', filters],
    queryFn: () => backupApi.list(filters),
    refetchInterval: 5000, // 5s 自动刷新, 看到 running -> success
  });
  const { data: overview } = useQuery({
    queryKey: ['backup-overview'],
    queryFn: () => backupApi.overview(),
    refetchInterval: 10000,
  });

  const items = data?.items || [];
  const total = data?.total || 0;
  const ov = (overview as any) || {};

  const handleCreate = async (vals: any) => {
    try {
      const r = await backupApi.create({ type: 'manual', note: vals.note });
      message.success('备份已启动, 请稍候');
      setCreateOpen(false);
      qc.invalidateQueries({ queryKey: ['backups'] });
      qc.invalidateQueries({ queryKey: ['backup-overview'] });
    } catch (e: any) {
      message.error(e?.message || '启动失败');
    }
  };

  const handleDrill = async (id: string) => {
    const hide = message.loading('演练中...', 0);
    try {
      const r = await backupApi.drill(id);
      if (r.ok) {
        message.success(`演练通过 (${r.duration}ms) - 文件可读, 校验和一致`);
      } else {
        message.error(`演练失败: ${r.message}`);
      }
      qc.invalidateQueries({ queryKey: ['backups'] });
      qc.invalidateQueries({ queryKey: ['backup-overview'] });
    } catch (e: any) {
      message.error(e?.message || '演练失败');
    } finally {
      hide();
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await backupApi.remove(id);
      message.success('已删除');
      qc.invalidateQueries({ queryKey: ['backups'] });
      qc.invalidateQueries({ queryKey: ['backup-overview'] });
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  };

  const columns: any[] = [
    {
      title: '备份名称',
      dataIndex: 'name',
      width: 240,
      render: (v: string, r: any) => (
        <Space direction="vertical" size={0}>
          <code style={{ fontSize: 12 }}>{v}</code>
          <Space size={4}>
            <Tag color={TYPE_TAG[r.type]?.color} style={{ fontSize: 10 }}>{TYPE_TAG[r.type]?.label}</Tag>
            {r.storage === 's3' && <Tag color="gold" style={{ fontSize: 10 }}>异地</Tag>}
          </Space>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (s: string, r: any) => (
        <Tooltip title={r.errorMsg}>
          <Tag color={STATUS_TAG[s]?.color} icon={STATUS_TAG[s]?.icon}>{STATUS_TAG[s]?.label}</Tag>
        </Tooltip>
      ),
    },
    {
      title: '大小',
      dataIndex: 'size',
      width: 100,
      render: (v: number) => fmtSize(v),
    },
    {
      title: '耗时',
      dataIndex: 'duration',
      width: 100,
      render: (v: number) => v ? `${v} ms` : '-',
    },
    {
      title: '校验和',
      dataIndex: 'checksum',
      width: 120,
      render: (v: string) => v ? <code style={{ fontSize: 10 }}>{v.slice(0, 12)}…</code> : '-',
    },
    {
      title: '触发',
      dataIndex: 'triggeredBy',
      width: 100,
      render: (v: string) => v === 'system' || v === 'cron' ? <Tag>{v}</Tag> : <Tag color="blue">手动</Tag>,
    },
    {
      title: '开始时间',
      dataIndex: 'startedAt',
      width: 150,
      render: (v: string) => v ? dayjs(v).format('MM-DD HH:mm:ss') : '-',
    },
    {
      title: '备注',
      dataIndex: 'note',
      ellipsis: true,
    },
    {
      title: '操作',
      key: 'op',
      width: 220,
      fixed: 'right',
      render: (_: any, r: any) => (
        <Space size={4} wrap>
          {r.status === 'success' && r.filePath && (
            <Button size="small" type="link" icon={<DownloadOutlined />}
              onClick={() => window.open(backupApi.downloadUrl(r.id), '_blank')}>
              下载
            </Button>
          )}
          {r.status === 'success' && (
            <Button size="small" type="link" icon={<ExperimentOutlined />} onClick={() => handleDrill(r.id)}>
              演练
            </Button>
          )}
          {r.status === 'success' && (
            <Button size="small" type="link" danger icon={<SafetyCertificateOutlined />}
              onClick={() => setRestoreOpen(r)}>
              恢复
            </Button>
          )}
          <Popconfirm title="确定删除?" onConfirm={() => handleRemove(r.id)}>
            <Button size="small" type="link" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>数据备份</Title>
      <Text type="secondary">每日自动备份 + 手动备份 + 异地容灾 + 恢复演练</Text>

      <Row gutter={16} style={{ marginTop: 12, marginBottom: 16 }}>
        <Col span={4}><Card bordered={false}><Statistic title="备份总数" value={ov.total || 0} prefix={<HddOutlined />} /></Card></Col>
        <Col span={4}><Card bordered={false}><Statistic title="成功" value={ov.success || 0} valueStyle={{ color: '#52c41a' }} prefix={<CheckCircleOutlined />} /></Card></Col>
        <Col span={4}><Card bordered={false}><Statistic title="失败" value={ov.success === undefined ? '-' : (ov.failed || 0)} valueStyle={{ color: '#ff4d4f' }} prefix={<CloseCircleOutlined />} /></Card></Col>
        <Col span={4}><Card bordered={false}><Statistic title="本地占用" value={fmtSize(ov.localSize || 0)} prefix={<HddOutlined />} /></Card></Col>
        <Col span={4}><Card bordered={false}><Statistic title="异地容灾" value={ov.remoteEnabled ? '已启用' : '未配置'} valueStyle={{ color: ov.remoteEnabled ? '#1677ff' : '#999' }} prefix={<CloudServerOutlined />} /></Card></Col>
        <Col span={4}><Button type="primary" size="large" icon={<CloudUploadOutlined />} block onClick={() => setCreateOpen(true)}>立即备份</Button></Col>
      </Row>

      <Card bordered={false} title="备份列表" extra={
        <Space>
          {ov.latestAt && <Text type="secondary">最近备份: {dayjs(ov.latestAt).format('YYYY-MM-DD HH:mm')}</Text>}
          <Button size="small" icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['backups'] })}>刷新</Button>
        </Space>
      }>
        {items.length ? (
          <Table
            size="middle"
            columns={columns}
            dataSource={items}
            loading={isLoading}
            rowKey="id"
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
          !isLoading && <Empty description="暂无备份" />
        )}
      </Card>

      <Modal title="创建备份" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => form.submit()} okText="开始备份">
        <Form layout="vertical" onFinish={handleCreate} form={form}>
          <p style={{ color: '#666' }}>将立即开始备份数据库. 完成后会保留在 <code>backups/</code> 目录 (异地容灾如已配置会自动同步).</p>
          <Form.Item label="备注" name="note" initialValue="">
            <Input placeholder="可选, 例如: 上线前备份" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`恢复数据库 - ${restoreOpen?.name || ''}`}
        open={!!restoreOpen}
        onCancel={() => setRestoreOpen(null)}
        onOk={async () => {
          try {
            const r = await backupApi.restore(restoreOpen.id);
            message.success(`已恢复到 ${restoreOpen.name}, 旧库已备份到 ${r.safetyPath}`);
            setRestoreOpen(null);
          } catch (e: any) {
            message.error(e?.message || '恢复失败');
          }
        }}
        okText="确认恢复"
        okButtonProps={{ danger: true }}
      >
        <div style={{ background: '#fffbe6', border: '1px solid #ffe58f', padding: 12, borderRadius: 4, marginBottom: 12 }}>
          <p style={{ margin: 0, color: '#d48806' }}>⚠️ 高危操作</p>
          <p style={{ margin: '4px 0 0', fontSize: 12 }}>
            恢复将直接覆盖当前数据库, 系统会自动备份当前数据到 <code>backups/pre_restore_*.db</code>.
            建议先做一次"演练"确认备份文件可用, 再执行真正恢复.
          </p>
        </div>
        <p>备份 ID: <code>{restoreOpen?.id}</code></p>
        <p>大小: {fmtSize(restoreOpen?.size || 0)}</p>
        <p>创建时间: {restoreOpen?.startedAt && dayjs(restoreOpen.startedAt).format('YYYY-MM-DD HH:mm:ss')}</p>
      </Modal>
    </div>
  );
}
