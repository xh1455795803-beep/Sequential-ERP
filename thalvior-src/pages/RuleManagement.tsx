// 规则引擎管理页 (P1-1.3)
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Table,
  Tag,
  Space,
  Button,
  Form,
  Row,
  Col,
  Typography,
  Modal,
  Input,
  Select,
  Switch,
  InputNumber,
  Drawer,
  Descriptions,
  message,
  Tabs,
  Empty,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  EditOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  PlayCircleOutlined,
  HistoryOutlined,
} from '@ant-design/icons';
import { ruleApi, type Rule } from '../api';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const SCENES: Record<string, { label: string; color: string }> = {
  order_review: { label: '审单规则', color: 'blue' },
  order_split: { label: '分仓规则', color: 'cyan' },
  inventory_alert: { label: '库存预警', color: 'orange' },
  notification: { label: '通知规则', color: 'purple' },
  aftersale: { label: '售后规则', color: 'red' },
};

const OPS = [
  { value: 'eq', label: '=' },
  { value: 'ne', label: '≠' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'in', label: 'in' },
  { value: 'nin', label: 'not in' },
  { value: 'contains', label: '包含' },
  { value: 'startsWith', label: '开头是' },
  { value: 'isEmpty', label: '为空' },
  { value: 'isNotEmpty', label: '非空' },
];

const ACTION_TYPES = [
  { value: 'tag', label: '打标签' },
  { value: 'setField', label: '设字段值' },
  { value: 'block', label: '拦截' },
  { value: 'notify', label: '发通知' },
  { value: 'splitWarehouse', label: '指定仓库' },
  { value: 'flag', label: '标记旗标' },
  { value: 'assign', label: '分配人' },
];

export default function RuleManagement() {
  const [filters, setFilters] = useState<{ scene?: string; enabled?: string }>({});
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsRule, setLogsRule] = useState<Rule | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testForm] = Form.useForm();
  const [form] = Form.useForm();
  const [tab, setTab] = useState('list');
  const qc = useQueryClient();

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['rules', filters],
    queryFn: () => ruleApi.list(filters),
  });
  const { data: presets = [] } = useQuery({
    queryKey: ['rule-presets'],
    queryFn: () => ruleApi.presets(),
    enabled: tab === 'presets',
  });

  const createMut = useMutation({ mutationFn: ruleApi.create, onSuccess: () => { message.success('已创建'); setEditOpen(false); qc.invalidateQueries({ queryKey: ['rules'] }); } });
  const updateMut = useMutation({ mutationFn: ({ id, data }: any) => ruleApi.update(id, data), onSuccess: () => { message.success('已更新'); setEditOpen(false); qc.invalidateQueries({ queryKey: ['rules'] }); } });
  const removeMut = useMutation({ mutationFn: ruleApi.remove, onSuccess: () => { message.success('已删除'); qc.invalidateQueries({ queryKey: ['rules'] }); } });
  const fromPresetMut = useMutation({ mutationFn: ruleApi.fromPreset, onSuccess: () => { message.success('已从预设创建'); qc.invalidateQueries({ queryKey: ['rules'] }); setTab('list'); } });
  const toggleMut = useMutation({
    mutationFn: ({ id, data }: any) => ruleApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
  });
  const testMut = useMutation({ mutationFn: ({ scene, context }: any) => ruleApi.test(scene, context) });

  const onAdd = () => { setEditing(null); form.resetFields(); form.setFieldsValue({ scene: 'order_review', enabled: true, priority: 100, conditions: { all: [] }, actions: [] }); setEditOpen(true); };
  const onEdit = (r: Rule) => {
    setEditing(r);
    form.setFieldsValue({ ...r, conditions: JSON.stringify(r.conditions, null, 2), actions: JSON.stringify(r.actions, null, 2) });
    setEditOpen(true);
  };
  const onSubmit = async () => {
    const v = await form.validateFields();
    let conditions, actions;
    try { conditions = JSON.parse(v.conditions); } catch { return message.error('条件 JSON 格式错误'); }
    try { actions = JSON.parse(v.actions); } catch { return message.error('动作 JSON 格式错误'); }
    const data = { ...v, conditions, actions };
    if (editing) updateMut.mutate({ id: editing.id, data });
    else createMut.mutate(data);
  };
  const onToggle = (r: Rule, enabled: boolean) => toggleMut.mutate({ id: r.id, data: { enabled } });
  const onRemove = (r: Rule) => Modal.confirm({ title: '删除规则?', content: r.name, okType: 'danger', onOk: () => removeMut.mutate(r.id) });
  const onShowLogs = (r: Rule) => { setLogsRule(r); setLogsOpen(true); };
  const onTest = () => {
    const v = testForm.getFieldsValue();
    try { const ctx = v.context ? JSON.parse(v.context) : {}; testMut.mutate({ scene: v.scene, context: ctx }); } catch { message.error('Context 必须是 JSON'); }
  };

  const columns = [
    { title: '名称', dataIndex: 'name', width: 200, render: (v: string, r: Rule) => <a onClick={() => onEdit(r)}>{v}</a> },
    { title: '编码', dataIndex: 'code', width: 200, ellipsis: true },
    { title: '场景', dataIndex: 'scene', width: 110, render: (v: string) => <Tag color={SCENES[v]?.color}>{SCENES[v]?.label || v}</Tag> },
    { title: '启用', dataIndex: 'enabled', width: 80, render: (v: boolean, r: Rule) => <Switch size="small" checked={v} onChange={(c) => onToggle(r, c)} /> },
    { title: '优先级', dataIndex: 'priority', width: 80, align: 'right' as const },
    { title: '命中数', dataIndex: 'hitCount', width: 90, align: 'right' as const, render: (v: number) => <Tag>{v}</Tag> },
    { title: '最近触发', dataIndex: 'lastHitAt', width: 160, render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-' },
    { title: '描述', dataIndex: 'description', ellipsis: true },
    {
      title: '操作', key: 'op', width: 200, fixed: 'right' as const,
      render: (_: any, r: Rule) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => onEdit(r)}>编辑</Button>
          <Button type="link" size="small" icon={<HistoryOutlined />} onClick={() => onShowLogs(r)}>日志</Button>
          <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => onRemove(r)}>删除</Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}><ThunderboltOutlined /> 规则引擎</Title>
      <Text type="secondary">通过条件-动作模型实现订单/库存/通知等场景的自动化 · 支持预设模板一键启用</Text>

      <Row gutter={16} style={{ marginTop: 12 }}>
        <Col span={6}><Card><Text type="secondary">规则总数</Text><div style={{ fontSize: 22, fontWeight: 600 }}>{rules.length}</div></Card></Col>
        <Col span={6}><Card><Text type="secondary">已启用</Text><div style={{ fontSize: 22, fontWeight: 600, color: '#52c41a' }}>{rules.filter((r) => r.enabled).length}</div></Card></Col>
        <Col span={6}><Card><Text type="secondary">总命中次数</Text><div style={{ fontSize: 22, fontWeight: 600, color: '#1677ff' }}>{rules.reduce((s, r) => s + (r.hitCount || 0), 0)}</div></Card></Col>
        <Col span={6}><Card><Text type="secondary">预设模板</Text><div style={{ fontSize: 22, fontWeight: 600, color: '#722ed1' }}>{presets.length}</div></Card></Col>
      </Row>

      <Card style={{ marginTop: 16 }} bordered={false}>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          tabBarExtraContent={
            <Space>
              <Button icon={<PlayCircleOutlined />} onClick={() => setTestOpen(true)}>试运行</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>新增规则</Button>
            </Space>
          }
          items={[
            { key: 'list', label: `规则列表 (${rules.length})`, children: (
              <>
                <Form layout="inline" style={{ marginBottom: 12 }} onFinish={(v) => setFilters(v)}>
                  <Form.Item name="scene">
                    <Select placeholder="场景" allowClear style={{ width: 140 }} options={Object.entries(SCENES).map(([v, l]) => ({ value: v, label: l.label }))} />
                  </Form.Item>
                  <Form.Item name="enabled">
                    <Select placeholder="启用" allowClear style={{ width: 100 }} options={[{ value: 'true', label: '已启用' }, { value: 'false', label: '已停用' }]} />
                  </Form.Item>
                  <Form.Item><Button type="primary" htmlType="submit">筛选</Button></Form.Item>
                  <Form.Item><Button icon={<ReloadOutlined />} onClick={() => setFilters({})}>重置</Button></Form.Item>
                </Form>
                <Table size="middle" rowKey="id" loading={isLoading} dataSource={rules} columns={columns as any} pagination={{ pageSize: 20 }} scroll={{ x: 1300 }} />
              </>
            )},
            { key: 'presets', label: `预设模板 (${presets.length})`, children: (
              <Row gutter={[16, 16]}>
                {presets.map((p: any) => (
                  <Col span={8} key={p.code}>
                    <Card
                      title={<Space><Tag color={SCENES[p.scene]?.color}>{SCENES[p.scene]?.label}</Tag><span>{p.name}</span></Space>}
                      extra={<Button size="small" type="primary" onClick={() => fromPresetMut.mutate(p.code)}>启用</Button>}
                      size="small"
                    >
                      <Text type="secondary">{p.description}</Text>
                      <div style={{ marginTop: 8, fontSize: 12 }}>
                        <Text strong>条件: </Text><code style={{ background: '#f5f5f5', padding: '2px 4px' }}>{JSON.stringify(p.conditions)}</code>
                      </div>
                      <div style={{ marginTop: 4, fontSize: 12 }}>
                        <Text strong>动作: </Text><code style={{ background: '#f5f5f5', padding: '2px 4px' }}>{JSON.stringify(p.actions)}</code>
                      </div>
                    </Card>
                  </Col>
                ))}
                {presets.length === 0 ? (
                  <Col span={24}>
                    <Empty description="暂无预设" />
                  </Col>
                ) : null}
              </Row>
            )},
          ]}
        />
      </Card>

      <Modal title={editing ? '编辑规则' : '新增规则'} open={editOpen} onCancel={() => setEditOpen(false)} onOk={onSubmit} width={720} confirmLoading={createMut.isPending || updateMut.isPending}>
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={12}><Form.Item label="名称" name="name" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item label="编码" name="code" rules={[{ required: true }]}><Input disabled={!!editing} placeholder="英文/数字/下划线" /></Form.Item></Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}><Form.Item label="场景" name="scene" rules={[{ required: true }]}><Select disabled={!!editing} options={Object.entries(SCENES).map(([v, l]) => ({ value: v, label: l.label }))} /></Form.Item></Col>
            <Col span={8}><Form.Item label="优先级" name="priority"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={8}><Form.Item label="启用" name="enabled" valuePropName="checked"><Switch /></Form.Item></Col>
          </Row>
          <Form.Item label="条件 (JSON, 支持 all/any 嵌套) " name="conditions" rules={[{ required: true }]}>
            <Input.TextArea rows={5} placeholder='{ "all": [{ "field": "totalAmount", "op": "gte", "value": 500 }] }' />
          </Form.Item>
          <Form.Item label="动作 (JSON 数组)" name="actions" rules={[{ required: true }]}>
            <Input.TextArea rows={5} placeholder='[{ "type": "tag", "params": { "tag": "需审单" } }]' />
          </Form.Item>
          <Form.Item label="描述" name="description"><Input.TextArea rows={2} /></Form.Item>
          <div style={{ background: '#f5f5f5', padding: 8, borderRadius: 4, fontSize: 12 }}>
            <Text type="secondary">支持的字段: totalAmount / country / currency / available / status 等上下文字段</Text><br />
            <Text type="secondary">支持的操作: {OPS.map((o) => o.label).join(' / ')}</Text><br />
            <Text type="secondary">支持的动作: {ACTION_TYPES.map((a) => a.label).join(' / ')}</Text>
          </div>
        </Form>
      </Modal>

      <Drawer title={`规则日志 - ${logsRule?.name || ''}`} open={logsOpen} onClose={() => setLogsOpen(false)} width={720}>
        {logsRule && <RuleLogs ruleId={logsRule.id} />}
      </Drawer>

      <Modal title="试运行规则" open={testOpen} onCancel={() => setTestOpen(false)} footer={null}>
        <Form form={testForm} layout="vertical" initialValues={{ scene: 'order_review' }} onFinish={onTest}>
          <Form.Item label="场景" name="scene" rules={[{ required: true }]}>
            <Select options={Object.entries(SCENES).map(([v, l]) => ({ value: v, label: l.label }))} />
          </Form.Item>
          <Form.Item label="上下文 (JSON)" name="context" initialValue='{ "totalAmount": 800, "country": "US" }'>
            <Input.TextArea rows={6} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={testMut.isPending}>运行</Button>
              <Button onClick={() => { testForm.setFieldsValue({ context: '{"totalAmount":800,"country":"US"}' }); }}>样例 1: 高额美国单</Button>
              <Button onClick={() => { testForm.setFieldsValue({ context: '{"totalAmount":50,"country":"CN"}' }); }}>样例 2: 小额中国单</Button>
            </Space>
          </Form.Item>
          {testMut.data && (
            <Card size="small" title="执行结果">
              <pre style={{ background: '#f5f5f5', padding: 8, borderRadius: 4, margin: 0, fontSize: 12 }}>{JSON.stringify(testMut.data, null, 2)}</pre>
            </Card>
          )}
        </Form>
      </Modal>
    </div>
  );
}

function RuleLogs({ ruleId }: { ruleId: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['rule-logs', ruleId], queryFn: () => ruleApi.logs(ruleId, { pageSize: 50 }) });
  return (
    <Table
      size="small"
      loading={isLoading}
      rowKey="id"
      dataSource={data?.items || []}
      pagination={false}
      columns={[
        { title: '时间', dataIndex: 'createdAt', width: 160, render: (v) => dayjs(v).format('YYYY-MM-DD HH:mm:ss') },
        { title: '场景', dataIndex: 'scene', width: 120, render: (v) => <Tag color={SCENES[v]?.color}>{SCENES[v]?.label || v}</Tag> },
        { title: '结果', dataIndex: 'result', width: 90, render: (v) => <Tag color={v === 'success' ? 'green' : v === 'failed' ? 'red' : 'default'}>{v}</Tag> },
        { title: '消息', dataIndex: 'message', ellipsis: true },
        { title: '上下文', dataIndex: 'context', ellipsis: true, width: 180 },
      ]}
    />
  );
}
