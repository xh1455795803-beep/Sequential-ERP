// 审批中心 - 工作流引擎前端
// - 我的待办
// - 我发起的
// - 全部实例
// - 定义管理
import { useState } from 'react';
import {
  Card,
  Tabs,
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  Switch,
  message,
  Popconfirm,
  Row,
  Col,
  Statistic,
  Drawer,
  Timeline,
  Typography,
  Tooltip,
  Empty,
  Steps,
  Alert,
} from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  SwapOutlined,
  ReloadOutlined,
  PlusOutlined,
  AuditOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
  UserOutlined,
  TeamOutlined,
  EyeOutlined,
  StopOutlined,
  FireOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { workflowApi, type WorkflowInstance, type WorkflowDefinition } from '../api';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const BUSINESS_OPTIONS = [
  { value: 'order_refund', label: '订单退款', color: 'orange' },
  { value: 'purchase', label: '采购审批', color: 'blue' },
  { value: 'aftersale', label: '售后单', color: 'cyan' },
  { value: 'manual_order', label: '手工订单', color: 'green' },
  { value: 'leave', label: '请假', color: 'purple' },
];

const STATUS_MAP: Record<string, { color: string; label: string }> = {
  pending: { color: 'default', label: '待启动' },
  running: { color: 'processing', label: '审批中' },
  approved: { color: 'success', label: '已通过' },
  rejected: { color: 'error', label: '已驳回' },
  cancelled: { color: 'default', label: '已撤销' },
  terminated: { color: 'default', label: '已终止' },
};

const STEP_STATUS_MAP: Record<string, { color: string; label: string }> = {
  waiting: { color: 'default', label: '等待' },
  running: { color: 'processing', label: '审批中' },
  approved: { color: 'success', label: '通过' },
  rejected: { color: 'error', label: '驳回' },
  skipped: { color: 'default', label: '跳过' },
  transferred: { color: 'cyan', label: '转交' },
  cancelled: { color: 'default', label: '取消' },
};

export default function WorkflowCenter() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState('pending');
  const [detail, setDetail] = useState<WorkflowInstance | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // 我的待办
  const pendingQ = useQuery({
    queryKey: ['workflow-pending'],
    queryFn: () => workflowApi.myPending(),
    refetchInterval: 30000,
  });

  // 全部实例
  const listQ = useQuery({
    queryKey: ['workflow-instances'],
    queryFn: () => workflowApi.listInstances({ take: 100 }),
  });

  // 定义列表
  const defQ = useQuery({
    queryKey: ['workflow-definitions'],
    queryFn: () => workflowApi.listDefinitions(),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['workflow-pending'] });
    qc.invalidateQueries({ queryKey: ['workflow-instances'] });
  };

  const openDetail = async (id: string) => {
    const d = await workflowApi.getInstance(id);
    setDetail(d);
    setDetailOpen(true);
  };

  // 审批通过
  const approveMut = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment?: string }) =>
      workflowApi.approve(id, { comment }),
    onSuccess: () => {
      message.success('已审批通过');
      refresh();
      setDetailOpen(false);
    },
    onError: (e: any) => message.error(e?.message || '操作失败'),
  });

  // 驳回
  const rejectMut = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment: string }) =>
      workflowApi.reject(id, { comment }),
    onSuccess: () => {
      message.success('已驳回');
      refresh();
      setDetailOpen(false);
    },
    onError: (e: any) => message.error(e?.message || '操作失败'),
  });

  // 撤销
  const cancelMut = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment?: string }) =>
      workflowApi.cancel(id, { comment }),
    onSuccess: () => {
      message.success('已撤销');
      refresh();
      setDetailOpen(false);
    },
    onError: (e: any) => message.error(e?.message || '操作失败'),
  });

  // 统计
  const stats = {
    pending: pendingQ.data?.length || 0,
    running: listQ.data?.filter((d) => d.status === 'running').length || 0,
    approved: listQ.data?.filter((d) => d.status === 'approved').length || 0,
    rejected: listQ.data?.filter((d) => d.status === 'rejected').length || 0,
  };

  return (
    <div>
      <Row align="middle" justify="space-between" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={4} style={{ margin: 0 }}>
            <AuditOutlined style={{ color: '#722ed1' }} /> 审批中心
          </Title>
          <Text type="secondary">工作流引擎 · 多级审批 · 转交 / 驳回 / 撤销</Text>
        </Col>
        <Col>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={refresh}>刷新</Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setActiveTab('definitions')}
            >
              管理审批流
            </Button>
          </Space>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card bordered={false} bodyStyle={{ padding: 16 }}>
            <Statistic
              title="待我审批"
              value={stats.pending}
              prefix={<ClockCircleOutlined style={{ color: '#fa8c16' }} />}
              suffix="条"
              valueStyle={{ color: stats.pending > 0 ? '#fa8c16' : undefined }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card bordered={false} bodyStyle={{ padding: 16 }}>
            <Statistic
              title="审批中"
              value={stats.running}
              prefix={<AuditOutlined style={{ color: '#1677ff' }} />}
              suffix="条"
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card bordered={false} bodyStyle={{ padding: 16 }}>
            <Statistic
              title="已通过"
              value={stats.approved}
              prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
              suffix="条"
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card bordered={false} bodyStyle={{ padding: 16 }}>
            <Statistic
              title="已驳回"
              value={stats.rejected}
              prefix={<CloseOutlined style={{ color: '#ff4d4f' }} />}
              suffix="条"
            />
          </Card>
        </Col>
      </Row>

      <Card bordered={false}>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'pending',
              label: (
                <span>
                  <ClockCircleOutlined /> 待我审批
                  {stats.pending > 0 && (
                    <Tag color="orange" style={{ marginLeft: 6 }}>{stats.pending}</Tag>
                  )}
                </span>
              ),
              children: <PendingTable data={pendingQ.data || []} loading={pendingQ.isLoading} onOpen={openDetail} />,
            },
            {
              key: 'all',
              label: <span><AuditOutlined /> 全部实例</span>,
              children: <AllInstancesTable data={listQ.data || []} loading={listQ.isLoading} onOpen={openDetail} />,
            },
            {
              key: 'definitions',
              label: <span><FireOutlined /> 审批流定义</span>,
              children: <DefinitionsPanel data={defQ.data || []} loading={defQ.isLoading} onChange={refresh} />,
            },
          ]}
        />
      </Card>

      {/* 详情抽屉 */}
      <Drawer
        title={
          <Space>
            <AuditOutlined />
            审批详情
          </Space>
        }
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width={720}
        extra={
          detail && (
            <Tag color={STATUS_MAP[detail.status]?.color || 'default'}>
              {STATUS_MAP[detail.status]?.label || detail.status}
            </Tag>
          )
        }
      >
        {detail && <DetailContent inst={detail} onApprove={(c) => approveMut.mutate({ id: detail.id, comment: c })} onReject={(c) => rejectMut.mutate({ id: detail.id, comment: c })} onCancel={(c) => cancelMut.mutate({ id: detail.id, comment: c })} approving={approveMut.isPending} rejecting={rejectMut.isPending} cancelling={cancelMut.isPending} />}
      </Drawer>
    </div>
  );
}

// ============ 待我审批表格 ============
function PendingTable({ data, loading, onOpen }: { data: any[]; loading: boolean; onOpen: (id: string) => void }) {
  const cols = [
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      render: (v: string, r: any) => (
        <Space direction="vertical" size={0}>
          <Text strong>{v}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>单号: {r.businessNo || r.businessId}</Text>
        </Space>
      ),
    },
    {
      title: '业务类型',
      dataIndex: 'business',
      key: 'business',
      width: 120,
      render: (v: string) => {
        const opt = BUSINESS_OPTIONS.find((b) => b.value === v);
        return <Tag color={opt?.color || 'default'}>{opt?.label || v}</Tag>;
      },
    },
    {
      title: '申请人',
      dataIndex: 'applicantName',
      key: 'applicantName',
      width: 120,
      render: (v: string) => v || '-',
    },
    {
      title: '当前步骤',
      key: 'currentStep',
      width: 120,
      render: (_: any, r: any) => {
        const cur = r.steps?.find((s: any) => s.status === 'running');
        return cur ? <Tag color="processing">{cur.name}</Tag> : '-';
      },
    },
    {
      title: '申请时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (v: string) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {new Date(v).toLocaleString('zh-CN')}
        </Text>
      ),
    },
    {
      title: '操作',
      key: 'op',
      width: 100,
      render: (_: any, r: any) => (
        <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => onOpen(r.id)}>
          审批
        </Button>
      ),
    },
  ];

  if (data.length === 0 && !loading) {
    return <Empty description="暂无待审批" />;
  }

  return (
    <Table
      rowKey="id"
      loading={loading}
      dataSource={data}
      columns={cols as any}
      pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
    />
  );
}

// ============ 全部实例表格 ============
function AllInstancesTable({ data, loading, onOpen }: { data: any[]; loading: boolean; onOpen: (id: string) => void }) {
  const cols = [
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      render: (v: string, r: any) => (
        <Space direction="vertical" size={0}>
          <Text strong>{v}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>单号: {r.businessNo || r.businessId}</Text>
        </Space>
      ),
    },
    {
      title: '业务',
      dataIndex: 'business',
      key: 'business',
      width: 110,
      render: (v: string) => {
        const opt = BUSINESS_OPTIONS.find((b) => b.value === v);
        return <Tag color={opt?.color || 'default'}>{opt?.label || v}</Tag>;
      },
    },
    {
      title: '申请人',
      dataIndex: 'applicantName',
      key: 'applicantName',
      width: 100,
    },
    {
      title: '进度',
      key: 'progress',
      width: 160,
      render: (_: any, r: any) => {
        const cur = r.currentStep + 1;
        const total = r.totalSteps;
        return (
          <Space size={4}>
            <Text>{cur}/{total}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {Math.round((cur / total) * 100)}%
            </Text>
          </Space>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v: string) => (
        <Tag color={STATUS_MAP[v]?.color || 'default'}>{STATUS_MAP[v]?.label || v}</Tag>
      ),
    },
    {
      title: '发起时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (v: string) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {new Date(v).toLocaleString('zh-CN')}
        </Text>
      ),
    },
    {
      title: '操作',
      key: 'op',
      width: 80,
      render: (_: any, r: any) => (
        <Button type="link" size="small" onClick={() => onOpen(r.id)}>
          查看
        </Button>
      ),
    },
  ];

  return (
    <Table
      rowKey="id"
      loading={loading}
      dataSource={data}
      columns={cols as any}
      pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
    />
  );
}

// ============ 详情内容 ============
function DetailContent({
  inst,
  onApprove,
  onReject,
  onCancel,
  approving,
  rejecting,
  cancelling,
}: {
  inst: WorkflowInstance;
  onApprove: (c?: string) => void;
  onReject: (c: string) => void;
  onCancel: (c?: string) => void;
  approving: boolean;
  rejecting: boolean;
  cancelling: boolean;
}) {
  const [comment, setComment] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const cur = inst.steps?.find((s: any) => s.status === 'running');
  const isFinished = ['approved', 'rejected', 'cancelled', 'terminated'].includes(inst.status);

  return (
    <div>
      <Card bordered={false} style={{ marginBottom: 16 }} bodyStyle={{ padding: 16 }}>
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Space>
            <Tag color="blue">{inst.business}</Tag>
            <Text type="secondary">单号: {inst.businessNo || inst.businessId}</Text>
          </Space>
          <Title level={5} style={{ margin: 0 }}>{inst.title}</Title>
          <Text type="secondary">申请人: {inst.applicantName || inst.applicantId} · 发起时间: {new Date(inst.createdAt).toLocaleString('zh-CN')}</Text>
          {inst.result && (
            <Alert
              type={inst.status === 'approved' ? 'success' : inst.status === 'rejected' ? 'error' : 'info'}
              message={`最终结果: ${inst.result}`}
              showIcon
            />
          )}
        </Space>
      </Card>

      <Card title="审批步骤" bordered={false} style={{ marginBottom: 16 }} bodyStyle={{ padding: 16 }}>
        <Steps
          direction="vertical"
          size="small"
          current={inst.currentStep}
          items={(inst.steps || []).map((s: any) => {
            const st = STEP_STATUS_MAP[s.status] || { color: 'default', label: s.status };
            const approvers: string[] = typeof s.approvers === 'string' ? JSON.parse(s.approvers) : s.approvers;
            return {
              title: (
                <Space>
                  <Text strong>{s.name}</Text>
                  <Tag color={st.color}>{st.label}</Tag>
                  {s.type === 'role' && <Tag><TeamOutlined /> 按角色</Tag>}
                  {s.type === 'user' && <Tag><UserOutlined /> 指定人</Tag>}
                  {s.type === 'auto' && <Tag color="cyan">自动</Tag>}
                </Space>
              ),
              description: (
                <Space size={4} wrap>
                  {approvers.map((a: string) => (
                    <Tag key={a} style={{ fontSize: 12 }}>{a}</Tag>
                  ))}
                  {s.anyApprove && <Tag color="cyan" style={{ fontSize: 12 }}>任一通过</Tag>}
                  {s.finishedAt && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      完成: {new Date(s.finishedAt).toLocaleString('zh-CN')}
                    </Text>
                  )}
                </Space>
              ),
              status:
                s.status === 'approved' ? 'finish' :
                s.status === 'rejected' ? 'error' :
                s.status === 'running' ? 'process' : 'wait',
            };
          })}
        />
      </Card>

      <Card title="审批日志" bordered={false} style={{ marginBottom: 16 }} bodyStyle={{ padding: 16 }}>
        {(inst.logs || []).length === 0 ? (
          <Empty description="暂无日志" />
        ) : (
          <Timeline
            items={(inst.logs || []).map((l: any) => ({
              color:
                l.action === 'approve' ? 'green' :
                l.action === 'reject' ? 'red' :
                l.action === 'transfer' ? 'blue' :
                l.action === 'cancel' ? 'gray' :
                l.action === 'start' ? 'blue' : 'gray',
              children: (
                <Space direction="vertical" size={0}>
                  <Space>
                    <Text strong>{l.operatorName || l.operatorId || '系统'}</Text>
                    <Tag>{l.action}</Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {new Date(l.createdAt).toLocaleString('zh-CN')}
                    </Text>
                  </Space>
                  {l.comment && <Text type="secondary">{l.comment}</Text>}
                </Space>
              ),
            }))}
          />
        )}
      </Card>

      {/* 操作区 */}
      {!isFinished && cur && (
        <Card title="审批操作" bordered={false} bodyStyle={{ padding: 16 }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <TextArea
              placeholder="审批意见 (驳回时必填)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
            />
            <Space>
              <Button
                type="primary"
                icon={<CheckOutlined />}
                loading={approving}
                onClick={() => onApprove(comment)}
              >
                通过
              </Button>
              <Button
                danger
                icon={<CloseOutlined />}
                loading={rejecting}
                onClick={() => {
                  if (!comment) {
                    message.warning('驳回必须填写原因');
                    return;
                  }
                  setRejectOpen(true);
                }}
              >
                驳回
              </Button>
              <Button
                icon={<SwapOutlined />}
                onClick={() => message.info('请使用下方转交按钮')}
              >
                转交
              </Button>
              <Button
                icon={<StopOutlined />}
                onClick={() => setCancelOpen(true)}
                loading={cancelling}
              >
                撤销
              </Button>
            </Space>
          </Space>
        </Card>
      )}

      {/* 驳回确认 */}
      <Modal
        title="确认驳回"
        open={rejectOpen}
        onCancel={() => setRejectOpen(false)}
        onOk={() => {
          onReject(comment);
          setRejectOpen(false);
        }}
        okText="确认驳回"
        okButtonProps={{ danger: true }}
      >
        <Paragraph>驳回后流程将终止, 所有后续步骤取消。</Paragraph>
        <TextArea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} />
      </Modal>

      {/* 撤销确认 */}
      <Modal
        title="确认撤销"
        open={cancelOpen}
        onCancel={() => setCancelOpen(false)}
        onOk={() => {
          onCancel(comment);
          setCancelOpen(false);
        }}
        okText="确认撤销"
      >
        <Paragraph>撤销后流程将终止。是否继续?</Paragraph>
        <TextArea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} placeholder="撤销原因 (可选)" />
      </Modal>
    </div>
  );
}

// ============ 定义管理 ============
function DefinitionsPanel({
  data,
  loading,
  onChange,
}: {
  data: WorkflowDefinition[];
  loading: boolean;
  onChange: () => void;
}) {
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<WorkflowDefinition | null>(null);
  const [form] = Form.useForm();
  const [stepsJson, setStepsJson] = useState('[]');

  const removeMut = useMutation({
    mutationFn: (id: string) => workflowApi.removeDefinition(id),
    onSuccess: () => {
      message.success('已删除');
      onChange();
    },
    onError: (e: any) => message.error(e?.message || '删除失败'),
  });

  const presetMut = useMutation({
    mutationFn: (preset: 'order_refund' | 'purchase' | 'aftersale' | 'manual_order') =>
      workflowApi.createPreset(preset),
    onSuccess: () => {
      message.success('预设已创建');
      onChange();
    },
    onError: (e: any) => message.error(e?.message || '创建失败'),
  });

  const openEdit = (d?: WorkflowDefinition) => {
    setEditing(d || null);
    if (d) {
      try {
        const steps = typeof d.steps === 'string' ? JSON.parse(d.steps) : d.steps;
        form.setFieldsValue({
          name: d.name,
          code: d.code,
          business: d.business,
          description: d.description,
          enabled: d.enabled,
        });
        setStepsJson(JSON.stringify(steps, null, 2));
      } catch {
        setStepsJson('[]');
      }
    } else {
      form.resetFields();
      setStepsJson(JSON.stringify([
        { order: 0, name: '初审', type: 'role', approvers: ['admin'], anyApprove: true },
      ], null, 2));
    }
    setEditOpen(true);
  };

  const submit = async () => {
    const v = await form.validateFields();
    let steps: any;
    try {
      steps = JSON.parse(stepsJson);
    } catch {
      message.error('步骤 JSON 格式错误');
      return;
    }
    if (!Array.isArray(steps) || steps.length === 0) {
      message.error('至少一个步骤');
      return;
    }
    try {
      if (editing) {
        await workflowApi.updateDefinition(editing.id, { ...v, steps });
        message.success('已更新');
      } else {
        await workflowApi.createDefinition({ ...v, steps });
        message.success('已创建');
      }
      setEditOpen(false);
      onChange();
    } catch (e: any) {
      message.error(e?.message || '保存失败');
    }
  };

  const cols = [
    { title: '名称', dataIndex: 'name', key: 'name', render: (v: string, r: any) => <Text strong>{v}</Text> },
    { title: '代号', dataIndex: 'code', key: 'code', width: 180, render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text> },
    {
      title: '业务类型',
      dataIndex: 'business',
      key: 'business',
      width: 130,
      render: (v: string) => {
        const opt = BUSINESS_OPTIONS.find((b) => b.value === v);
        return <Tag color={opt?.color || 'default'}>{opt?.label || v}</Tag>;
      },
    },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true },
    { title: '版本', dataIndex: 'version', key: 'version', width: 80, render: (v: number) => <Tag>v{v}</Tag> },
    { title: '调用', dataIndex: 'hitCount', key: 'hitCount', width: 80, align: 'right' as const },
    {
      title: '状态',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 80,
      render: (v: boolean) => v ? <Tag color="green">启用</Tag> : <Tag color="default">停用</Tag>,
    },
    {
      title: '操作',
      key: 'op',
      width: 140,
      render: (_: any, r: any) => (
        <Space>
          <Button type="link" size="small" onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm
            title="确认删除?"
            onConfirm={() => removeMut.mutate(r.id)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button type="link" size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Text type="secondary">快速创建:</Text>
        <Button
          size="small"
          icon={<ThunderboltOutlined />}
          onClick={() => presetMut.mutate('order_refund')}
          loading={presetMut.isPending}
        >
          订单退款审批
        </Button>
        <Button
          size="small"
          icon={<ThunderboltOutlined />}
          onClick={() => presetMut.mutate('purchase')}
          loading={presetMut.isPending}
        >
          采购审批
        </Button>
        <Button
          size="small"
          icon={<ThunderboltOutlined />}
          onClick={() => presetMut.mutate('aftersale')}
          loading={presetMut.isPending}
        >
          售后审批
        </Button>
        <Button
          size="small"
          icon={<ThunderboltOutlined />}
          onClick={() => presetMut.mutate('manual_order')}
          loading={presetMut.isPending}
        >
          手工订单审批
        </Button>
        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => openEdit()}>
          自定义
        </Button>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={data}
        columns={cols as any}
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
      />

      <Modal
        title={editing ? '编辑审批流' : '新建审批流'}
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={submit}
        width={760}
        okText="保存"
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="名称" name="name" rules={[{ required: true }]}>
                <Input placeholder="如: 退款审批" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="业务类型" name="business" rules={[{ required: true }]}>
                <Select options={BUSINESS_OPTIONS.map((b) => ({ value: b.value, label: b.label }))} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="内部代号" name="code" rules={[{ required: true }]}>
                <Input placeholder="如: wf_refund_v1" disabled={!!editing} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="启用" name="enabled" valuePropName="checked" initialValue={true}>
                <Switch />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item
            label={
              <Space>
                <span>步骤定义 (JSON)</span>
                <Tooltip title="每个步骤: { order, name, type: 'role'|'user'|'auto', approvers: string[], anyApprove?: boolean, condition?: {...} }">
                  <Text type="secondary" style={{ fontSize: 12 }}>格式说明</Text>
                </Tooltip>
              </Space>
            }
          >
            <Input.TextArea
              value={stepsJson}
              onChange={(e) => setStepsJson(e.target.value)}
              rows={10}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
