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
import { useTranslation } from '../i18n';

const { Title, Text } = Typography;

// ============ 子账号管理 ============
function UserTab() {
  const { t } = useTranslation();
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
      message.success(t('pages.systemSettings.createOk'));
      qc.invalidateQueries({ queryKey: ['users'] });
      setEditing(null);
    },
  });
  const updateMut = useMutation({
    mutationFn: (vars: any) => systemApi.userUpdate(vars.id, vars.data),
    onSuccess: () => {
      message.success(t('pages.systemSettings.user.updateOk'));
      qc.invalidateQueries({ queryKey: ['users'] });
      setEditing(null);
    },
  });
  const removeMut = useMutation({
    mutationFn: systemApi.userRemove,
    onSuccess: () => {
      message.success(t('pages.systemSettings.user.deleteOk'));
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const onSubmit = async () => {
    const v = await form.validateFields();
    if (editing?.id) updateMut.mutate({ id: editing.id, data: v });
    else createMut.mutate(v);
  };

  const columns = [
    { title: t('pages.systemSettings.user.username'), dataIndex: 'username', width: 140 },
    { title: t('pages.systemSettings.user.name'), dataIndex: 'name', width: 140 },
    { title: t('pages.systemSettings.user.email'), dataIndex: 'email', width: 200, ellipsis: true },
    { title: t('pages.systemSettings.user.phone'), dataIndex: 'phone', width: 140, render: (v: string) => v || '-' },
    {
      title: t('pages.systemSettings.user.role'),
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
      title: t('pages.systemSettings.user.status'),
      dataIndex: 'status',
      width: 100,
      render: (v: number) => v === 1 ? <Tag color="green">{t('pages.systemSettings.user.normal')}</Tag> : <Tag>{t('pages.systemSettings.user.disabled')}</Tag>,
    },
    {
      title: t('pages.systemSettings.user.lastLogin'),
      dataIndex: 'lastLogin',
      width: 160,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : t('pages.systemSettings.user.never'),
    },
    {
      title: t('pages.systemSettings.user.action'),
      width: 180,
      fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Space size="small">
          {has('system:sub:manage') && (
            <>
              <Button size="small" type="link" onClick={() => {
                setEditing(r);
                form.setFieldsValue(r);
              }}>{t('pages.systemSettings.user.edit')}</Button>
              <Popconfirm title={t('pages.systemSettings.user.confirmDelete')} onConfirm={() => removeMut.mutate(r.id)}>
                <Button size="small" type="link" danger>{t('pages.systemSettings.user.delete')}</Button>
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
            <Input placeholder={t('pages.systemSettings.user.searchPlaceholder')} allowClear prefix={<SearchOutlined />} style={{ width: 240 }} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">{t('pages.systemSettings.user.filter')}</Button>
              <Button onClick={() => setFilters({ page: 1, pageSize: 10 })} icon={<ReloadOutlined />}>{t('pages.systemSettings.user.reset')}</Button>
              {has('system:sub:manage') && (
                <Button type="primary" icon={<PlusOutlined />} onClick={() => {
                  setEditing({});
                  form.resetFields();
                }}>{t('pages.systemSettings.user.add')}</Button>
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
        title={editing?.id ? t('pages.systemSettings.user.editTitle') : t('pages.systemSettings.user.addTitle')}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={onSubmit}
        confirmLoading={createMut.isPending || updateMut.isPending}
        width={560}
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="username" label={t('pages.systemSettings.user.username')} rules={[{ required: true }]}><Input disabled={!!editing?.id} /></Form.Item></Col>
            <Col span={12}><Form.Item name="name" label={t('pages.systemSettings.user.name')} rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="email" label={t('pages.systemSettings.user.email')}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="phone" label={t('pages.systemSettings.user.phone')}><Input /></Form.Item></Col>
            {!editing?.id && (
              <Col span={12}><Form.Item name="password" label={t('pages.systemSettings.user.password')} rules={[{ required: true }]}><Input.Password /></Form.Item></Col>
            )}
            <Col span={12}><Form.Item name="status" label={t('pages.systemSettings.user.status')} initialValue={1}><Select options={[{ label: t('pages.systemSettings.user.normal'), value: 1 }, { label: t('pages.systemSettings.user.disabled'), value: 0 }]} /></Form.Item></Col>
            <Col span={24}><Form.Item name="roleIds" label={t('pages.systemSettings.user.role')}><Select mode="multiple" options={(roles || []).map((r: any) => ({ label: r.name, value: r.id }))} /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
}

// ============ 角色权限 ============
function RoleTab() {
  const { t } = useTranslation();
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
      message.success(t('pages.systemSettings.createOk'));
      qc.invalidateQueries({ queryKey: ['roles'] });
      setEditing(null);
    },
  });

  const columns = [
    { title: t('pages.systemSettings.role.code'), dataIndex: 'code', width: 140 },
    { title: t('pages.systemSettings.role.name'), dataIndex: 'name', width: 200 },
    { title: t('pages.systemSettings.role.description'), dataIndex: 'description', ellipsis: true },
    {
      title: t('pages.systemSettings.role.builtIn'),
      dataIndex: 'builtIn',
      width: 100,
      render: (v: boolean) => v ? <Tag color="blue">{t('pages.systemSettings.role.built')}</Tag> : <Tag>{t('pages.systemSettings.role.custom')}</Tag>,
    },
    {
      title: t('pages.systemSettings.role.permCount'),
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
        }}>{t('pages.systemSettings.role.add')}</Button>
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
        title={editing?.id ? t('pages.systemSettings.role.editTitle') : t('pages.systemSettings.role.addTitle')}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={async () => {
          const v = await form.validateFields();
          createMut.mutate(v);
        }}
        confirmLoading={createMut.isPending}
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="code" label={t('pages.systemSettings.role.code')} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="name" label={t('pages.systemSettings.role.name')} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label={t('pages.systemSettings.role.description')}><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="permissions" label={t('pages.systemSettings.role.permissionsLabel')}><Input.TextArea rows={4} placeholder={t('pages.systemSettings.role.permissionsPlaceholder')} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

// ============ 全局参数 ============
function GlobalTab() {
  const { t } = useTranslation();
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
    message.success(t('pages.systemSettings.global.savedOk'));
  };
  return (
    <Card bordered={false} title={t('pages.systemSettings.global.title')} extra={<Button type="primary" onClick={onSave}>{t('pages.systemSettings.global.save')}</Button>}>
      <Descriptions column={2} bordered>
        <Descriptions.Item label={t('pages.systemSettings.global.currency')}>
          <Select value={settings.currency} onChange={(v) => setSettings({ ...settings, currency: v })} style={{ width: 200 }} options={['USD', 'CNY', 'EUR', 'GBP', 'JPY'].map((c) => ({ label: c, value: c }))} />
        </Descriptions.Item>
        <Descriptions.Item label={t('pages.systemSettings.global.timezone')}>
          <Select value={settings.timezone} onChange={(v) => setSettings({ ...settings, timezone: v })} style={{ width: 200 }} options={[
            { label: t('pages.systemSettings.global.shanghai'), value: 'Asia/Shanghai' },
            { label: t('pages.systemSettings.global.losAngeles'), value: 'America/Los_Angeles' },
            { label: t('pages.systemSettings.global.london'), value: 'Europe/London' },
          ]} />
        </Descriptions.Item>
        <Descriptions.Item label={t('pages.systemSettings.global.language')}>
          <Select value={settings.language} onChange={(v) => setSettings({ ...settings, language: v })} style={{ width: 200 }} options={[
            { label: t('pages.systemSettings.global.chinese'), value: 'zh-CN' },
            { label: 'English', value: 'en-US' },
          ]} />
        </Descriptions.Item>
        <Descriptions.Item label={t('pages.systemSettings.global.lowStockThreshold')}>
          <Input type="number" value={settings.lowStockThreshold} onChange={(e) => setSettings({ ...settings, lowStockThreshold: +e.target.value })} style={{ width: 200 }} />
        </Descriptions.Item>
        <Descriptions.Item label={t('pages.systemSettings.global.orderAutoSync')}>
          <Switch checked={settings.orderAutoSync} onChange={(v) => setSettings({ ...settings, orderAutoSync: v })} />
        </Descriptions.Item>
        <Descriptions.Item label={t('pages.systemSettings.global.inventoryAlert')}>
          <Switch checked={settings.inventoryAlert} onChange={(v) => setSettings({ ...settings, inventoryAlert: v })} />
        </Descriptions.Item>
        <Descriptions.Item label={t('pages.systemSettings.global.alertEmail')} span={2}>
          <Input value={settings.alertEmail} onChange={(e) => setSettings({ ...settings, alertEmail: e.target.value })} />
        </Descriptions.Item>
      </Descriptions>
    </Card>
  );
}

// ============ 通知设置 ============
function NotifyTab() {
  const { t } = useTranslation();
  const [notify, setNotify] = useState({
    newOrder: { email: true, sms: false, inapp: true },
    lowStock: { email: true, sms: true, inapp: true },
    syncFailed: { email: true, sms: false, inapp: true },
    aftersale: { email: true, sms: true, inapp: true },
  });
  const onSave = () => message.success(t('pages.systemSettings.notify.savedOk'));
  const items: any[] = [
    { key: 'newOrder', label: t('pages.systemSettings.notify.newOrder') },
    { key: 'lowStock', label: t('pages.systemSettings.notify.lowStock') },
    { key: 'syncFailed', label: t('pages.systemSettings.notify.syncFailed') },
    { key: 'aftersale', label: t('pages.systemSettings.notify.aftersale') },
  ];
  return (
    <Card bordered={false} title={t('pages.systemSettings.notify.title')} extra={<Button type="primary" onClick={onSave}>{t('pages.systemSettings.global.save')}</Button>}>
      <Table
        size="middle"
        pagination={false}
        dataSource={items}
        rowKey="key"
        columns={[
          { title: t('pages.systemSettings.notify.event'), dataIndex: 'label', width: 200 },
          {
            title: t('pages.systemSettings.notify.email'),
            dataIndex: 'key',
            width: 120,
            render: (k: string) => <Switch checked={notify[k as keyof typeof notify].email} onChange={(v) => setNotify({ ...notify, [k]: { ...notify[k as keyof typeof notify], email: v } })} />,
          },
          {
            title: t('pages.systemSettings.notify.sms'),
            dataIndex: 'key',
            width: 120,
            render: (k: string) => <Switch checked={notify[k as keyof typeof notify].sms} onChange={(v) => setNotify({ ...notify, [k]: { ...notify[k as keyof typeof notify], sms: v } })} />,
          },
          {
            title: t('pages.systemSettings.notify.inapp'),
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
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['op-logs', { page: 1, pageSize: 20 }],
    queryFn: () => systemApi.opLogs({ page: 1, pageSize: 20 }),
  });
  const columns = [
    {
      title: t('pages.systemSettings.oplog.time'),
      dataIndex: 'createdAt',
      width: 160,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-',
    },
    { title: t('pages.systemSettings.oplog.user'), dataIndex: 'username', width: 120 },
    { title: t('pages.systemSettings.oplog.module'), dataIndex: 'module', width: 120, render: (v: string) => <Tag>{v}</Tag> },
    { title: t('pages.systemSettings.oplog.action'), dataIndex: 'action', width: 200 },
    { title: t('pages.systemSettings.oplog.detail'), dataIndex: 'detail', ellipsis: true },
    { title: 'IP', dataIndex: 'ip', width: 140 },
  ];
  return (
    <Card bordered={false} title={t('pages.systemSettings.oplog.title')}>
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
  const { t } = useTranslation();
  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>{t('pages.systemSettings.title')}</Title>
      <Text type="secondary">{t('pages.systemSettings.subtitle')}</Text>
      <Tabs
        style={{ marginTop: 12 }}
        defaultActiveKey="user"
        items={[
          { key: 'user', label: t('pages.systemSettings.tab.user'), icon: <UserOutlined />, children: <UserTab /> },
          { key: 'role', label: t('pages.systemSettings.tab.role'), icon: <TeamOutlined />, children: <RoleTab /> },
          { key: 'global', label: t('pages.systemSettings.tab.global'), icon: <SettingOutlined />, children: <GlobalTab /> },
          { key: 'notify', label: t('pages.systemSettings.tab.notify'), icon: <BellOutlined />, children: <NotifyTab /> },
          { key: 'oplog', label: t('pages.systemSettings.tab.oplog'), icon: <AuditOutlined />, children: <OpLogTab /> },
        ]}
      />
    </div>
  );
}