import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Tag, Space, Button, Input, Select, Form, Row, Col, Typography,
  Tabs, Modal, Switch, message, Popconfirm, Descriptions,
} from 'antd';
import {
  SearchOutlined, ReloadOutlined, PlusOutlined, UserOutlined, TeamOutlined,
  AuditOutlined, BellOutlined, SettingOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { systemApi, roleApi } from '../api';
import { usePermission } from '../hooks/usePermission';

const { Title, Text } = Typography;

// ============ 子账号管理 ============
function UserTab() {
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 10 });
  const [editing, setEditing] = useState<any | null>(null);
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { has } = usePermission();

  const { data, isLoading } = useQuery({
    queryKey: ['users', filters],
    queryFn: () => systemApi.users(filters),
  });
  const { data: roles } = useQuery({
    queryKey: ['roles'],
    queryFn: () => roleApi.list(),
  });

  const createMut = useMutation({
    mutationFn: systemApi.userCreate,
    onSuccess: () => {
      message.success('创建成功');
      qc.invalidateQueries({ queryKey: ['users'] });
      setEditing(null);
    },
  });
  const updateMut = useMutation({
    mutationFn: (vars: any) => systemApi.userUpdate(vars.id, vars.data),
    onSuccess: () => {
      message.success('更新成功');
      qc.invalidateQueries({ queryKey: ['users'] });
      setEditing(null);
    },
  });
  const removeMut = useMutation({
    mutationFn: systemApi.userRemove,
    onSuccess: () => {
      message.success('已删除');
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const onSubmit = async () => {
    const v = await form.validateFields();
    if (editing?.id) updateMut.mutate({ id: editing.id, data: v });
    else createMut.mutate(v);
  };

  const columns = [
    { title: '用户名', dataIndex: 'username', width: 140 },
    { title: '姓名', dataIndex: 'name', width: 140 },
    { title: '邮箱', dataIndex: 'email', width: 200, ellipsis: true },
    { title: '手机', dataIndex: 'phone', width: 140, render: (v: string) => v || '-' },
    {
      title: '角色',
      dataIndex: 'roles',
      width: 200,
      render: (rs: any[]) => (
        <Space>
          {(rs || []).map((r: any, i: number) => {
            const name = typeof r === 'string' ? r : (r?.role?.name || r?.name || '-');
            return <Tag key={`${name}-${i}`} color="blue">{name}</Tag>;
          })}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: number) => v === 1 ? <Tag color="green">正常</Tag> : <Tag>停用</Tag>,
    },
    {
      title: '最后登录',
      dataIndex: 'lastLogin',
      width: 160,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '从未',
    },
    {
      title: '操作',
      width: 180,
      fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Space size="small">
          {has('system:sub:manage') && (
            <>
              <Button size="small" type="link" onClick={() => {
                setEditing(r);
                form.setFieldsValue(r);
              }}>编辑</Button>
              <Popconfirm title="确认删除?" onConfirm={() => removeMut.mutate(r.id)}>
                <Button size="small" type="link" danger>删除</Button>
              </Popconfirm>
            </>
          )}
        </Space>
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
          <Form.Item name="keyword">
            <Input placeholder="用户名/姓名/邮箱" allowClear prefix={<SearchOutlined />} style={{ width: 240 }} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">筛选</Button>
              <Button onClick={() => setFilters({ page: 1, pageSize: 10 })} icon={<ReloadOutlined />}>重置</Button>
              {has('system:sub:manage') && (
                <Button type="primary" icon={<PlusOutlined />} onClick={() => {
                  setEditing({});
                  form.resetFields();
                }}>新增账号</Button>
              )}
            </Space>
          </Form.Item>
        </Form>
      </Card>
      <Card style={{ marginTop: 16 }} bordered={false}>
        <Table
          size="middle"
          columns={columns as any}
          dataSource={data?.items || []}
          loading={isLoading}
          rowKey="id"
          scroll={{ x: 1200 }}
          pagination={{
            current: filters.page,
            pageSize: filters.pageSize,
            total: data?.total || 0,
            showSizeChanger: true,
            onChange: (page, pageSize) => setFilters((f: any) => ({ ...f, page, pageSize })),
          }}
        />
      </Card>
      <Modal
        title={editing?.id ? '编辑账号' : '新增账号'}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={onSubmit}
        confirmLoading={createMut.isPending || updateMut.isPending}
        width={560}
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="username" label="用户名" rules={[{ required: true }]}><Input disabled={!!editing?.id} /></Form.Item></Col>
            <Col span={12}><Form.Item name="name" label="姓名" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="email" label="邮箱"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="phone" label="手机"><Input /></Form.Item></Col>
            {!editing?.id && (
              <Col span={12}><Form.Item name="password" label="初始密码" rules={[{ required: true }]}><Input.Password /></Form.Item></Col>
            )}
            <Col span={12}><Form.Item name="status" label="状态" initialValue={1}><Select options={[{ label: '正常', value: 1 }, { label: '停用', value: 0 }]} /></Form.Item></Col>
            <Col span={24}><Form.Item name="roleIds" label="角色"><Select mode="multiple" options={(roles || []).map((r: any) => ({ label: r.name, value: r.id }))} /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
}

// ============ 角色权限 ============
function RoleTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: () => roleApi.list(),
  });
  const [editing, setEditing] = useState<any | null>(null);
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { has } = usePermission();

  const createMut = useMutation({
    mutationFn: systemApi.roleCreate,
    onSuccess: () => {
      message.success('创建成功');
      qc.invalidateQueries({ queryKey: ['roles'] });
      setEditing(null);
    },
  });

  const columns = [
    { title: '角色编码', dataIndex: 'code', width: 140 },
    { title: '角色名称', dataIndex: 'name', width: 200 },
    { title: '描述', dataIndex: 'description', ellipsis: true },
    {
      title: '内置',
      dataIndex: 'builtIn',
      width: 100,
      render: (v: boolean) => v ? <Tag color="blue">内置</Tag> : <Tag>自定义</Tag>,
    },
    {
      title: '权限数',
      width: 100,
      render: (_: any, r: any) => (r.permissions || '').split(',').filter(Boolean).length,
    },
  ];

  return (
    <div>
      <Card bordered={false} extra={has('system:role:manage') && (
        <Button type="primary" icon={<PlusOutlined />} onClick={() => {
          setEditing({});
          form.resetFields();
        }}>新增角色</Button>
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
        title={editing?.id ? '编辑角色' : '新增角色'}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={async () => {
          const v = await form.validateFields();
          createMut.mutate(v);
        }}
        confirmLoading={createMut.isPending}
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="code" label="角色编码" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="name" label="角色名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label="描述"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="permissions" label="权限码 (逗号分隔)"><Input.TextArea rows={4} placeholder="例如: order:list,order:ship" /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

// ============ 全局参数 ============
function GlobalTab() {
  const [settings, setSettings] = useState({
    currency: 'USD',
    timezone: 'Asia/Shanghai',
    language: 'zh-CN',
    orderAutoSync: true,
    inventoryAlert: true,
    alertEmail: 'admin@thalvior.com',
    lowStockThreshold: 10,
  });
  const onSave = () => {
    message.success('已保存全局参数');
  };
  return (
    <Card bordered={false} title="全局参数" extra={<Button type="primary" onClick={onSave}>保存</Button>}>
      <Descriptions column={2} bordered>
        <Descriptions.Item label="默认币种">
          <Select value={settings.currency} onChange={(v) => setSettings({ ...settings, currency: v })} style={{ width: 200 }} options={['USD', 'CNY', 'EUR', 'GBP', 'JPY'].map((c) => ({ label: c, value: c }))} />
        </Descriptions.Item>
        <Descriptions.Item label="时区">
          <Select value={settings.timezone} onChange={(v) => setSettings({ ...settings, timezone: v })} style={{ width: 200 }} options={[
            { label: '上海 (UTC+8)', value: 'Asia/Shanghai' },
            { label: '洛杉矶 (UTC-8)', value: 'America/Los_Angeles' },
            { label: '伦敦 (UTC+0)', value: 'Europe/London' },
          ]} />
        </Descriptions.Item>
        <Descriptions.Item label="语言">
          <Select value={settings.language} onChange={(v) => setSettings({ ...settings, language: v })} style={{ width: 200 }} options={[
            { label: '简体中文', value: 'zh-CN' },
            { label: 'English', value: 'en-US' },
          ]} />
        </Descriptions.Item>
        <Descriptions.Item label="低库存阈值">
          <Input type="number" value={settings.lowStockThreshold} onChange={(e) => setSettings({ ...settings, lowStockThreshold: +e.target.value })} style={{ width: 200 }} />
        </Descriptions.Item>
        <Descriptions.Item label="订单自动同步">
          <Switch checked={settings.orderAutoSync} onChange={(v) => setSettings({ ...settings, orderAutoSync: v })} />
        </Descriptions.Item>
        <Descriptions.Item label="库存预警">
          <Switch checked={settings.inventoryAlert} onChange={(v) => setSettings({ ...settings, inventoryAlert: v })} />
        </Descriptions.Item>
        <Descriptions.Item label="预警邮箱" span={2}>
          <Input value={settings.alertEmail} onChange={(e) => setSettings({ ...settings, alertEmail: e.target.value })} />
        </Descriptions.Item>
      </Descriptions>
    </Card>
  );
}

// ============ 通知设置 ============
function NotifyTab() {
  const [notify, setNotify] = useState({
    newOrder: { email: true, sms: false, inapp: true },
    lowStock: { email: true, sms: true, inapp: true },
    syncFailed: { email: true, sms: false, inapp: true },
    aftersale: { email: true, sms: true, inapp: true },
  });
  const onSave = () => message.success('已保存通知设置');
  const items: any[] = [
    { key: 'newOrder', label: '新订单' },
    { key: 'lowStock', label: '库存预警' },
    { key: 'syncFailed', label: '同步失败' },
    { key: 'aftersale', label: '售后提醒' },
  ];
  return (
    <Card bordered={false} title="通知渠道" extra={<Button type="primary" onClick={onSave}>保存</Button>}>
      <Table
        size="middle"
        pagination={false}
        dataSource={items}
        rowKey="key"
        columns={[
          { title: '事件', dataIndex: 'label', width: 200 },
          {
            title: '邮件',
            dataIndex: 'key',
            width: 120,
            render: (k: string) => <Switch checked={notify[k as keyof typeof notify].email} onChange={(v) => setNotify({ ...notify, [k]: { ...notify[k as keyof typeof notify], email: v } })} />,
          },
          {
            title: '短信',
            dataIndex: 'key',
            width: 120,
            render: (k: string) => <Switch checked={notify[k as keyof typeof notify].sms} onChange={(v) => setNotify({ ...notify, [k]: { ...notify[k as keyof typeof notify], sms: v } })} />,
          },
          {
            title: '站内',
            dataIndex: 'key',
            width: 120,
            render: (k: string) => <Switch checked={notify[k as keyof typeof notify].inapp} onChange={(v) => setNotify({ ...notify, [k]: { ...notify[k as keyof typeof notify], inapp: v } })} />,
          },
        ]}
      />
    </Card>
  );
}

// ============ 操作日志 ============
function OpLogTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['op-logs', { page: 1, pageSize: 20 }],
    queryFn: () => systemApi.opLogs({ page: 1, pageSize: 20 }),
  });
  const columns = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-',
    },
    { title: '用户', dataIndex: 'username', width: 120 },
    { title: '模块', dataIndex: 'module', width: 120, render: (v: string) => <Tag>{v}</Tag> },
    { title: '操作', dataIndex: 'action', width: 200 },
    { title: '详情', dataIndex: 'detail', ellipsis: true },
    { title: 'IP', dataIndex: 'ip', width: 140 },
  ];
  return (
    <Card bordered={false} title="操作日志">
      <Table
        size="middle"
        columns={columns as any}
        dataSource={data?.items || []}
        loading={isLoading}
        rowKey="id"
        pagination={{
          current: 1,
          pageSize: 20,
          total: data?.total || 0,
        }}
      />
    </Card>
  );
}

// ============ 入口 ============
export default function SystemSettings() {
  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>系统设置</Title>
      <Text type="secondary">子账号 · 角色权限 · 全局参数 · 通知 · 日志</Text>
      <Tabs
        style={{ marginTop: 12 }}
        defaultActiveKey="user"
        items={[
          { key: 'user', label: '子账号', icon: <UserOutlined />, children: <UserTab /> },
          { key: 'role', label: '角色权限', icon: <TeamOutlined />, children: <RoleTab /> },
          { key: 'global', label: '全局参数', icon: <SettingOutlined />, children: <GlobalTab /> },
          { key: 'notify', label: '通知设置', icon: <BellOutlined />, children: <NotifyTab /> },
          { key: 'oplog', label: '操作日志', icon: <AuditOutlined />, children: <OpLogTab /> },
        ]}
      />
    </div>
  );
}
