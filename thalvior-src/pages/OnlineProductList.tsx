import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Tag, Space, Button, Input, Select, Form, Row, Col, Typography,
  Image, Tabs, message, Popconfirm, Modal, Statistic, Empty,
} from 'antd';
import {
  SearchOutlined, ReloadOutlined, CloudDownloadOutlined, CloudUploadOutlined,
  ShopOutlined, WarningOutlined, CheckCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { productApi, shopApi, syncApi } from '../api';
import { usePermission } from '../hooks/usePermission';
import { useTranslation } from '../i18n';

const { Title, Text } = Typography;

// 商品状态颜色映射（label 已迁移到字典，组件内通过 t() 取用）
const STATUS_COLOR: Record<number, string> = {
  1: 'green',
  0: 'default',
  2: 'red',
};

// ============ 在线商品列表 Tab ============
function OnlineProductsTab({ initialStatus = 1 }: { initialStatus?: number }) {
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 10, status: initialStatus });
  const [selected, setSelected] = useState<any[]>([]);
  const qc = useQueryClient();
  const { has } = usePermission();
  const { t } = useTranslation();

  // 状态 label 在组件内构造
  const statusLabel: Record<number, string> = {
    1: t('pages.onlineProductList.status.onSale'),
    0: t('pages.onlineProductList.status.offShelf'),
    2: t('pages.onlineProductList.status.violation'),
  };

  const { data, isLoading } = useQuery({
    queryKey: ['online-products', filters],
    queryFn: () => productApi.list(filters),
  });

  const { data: shops } = useQuery({
    queryKey: ['shops-all'],
    queryFn: () => shopApi.list({ page: 1, pageSize: 100 }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => productApi.update(id, data),
    onSuccess: () => {
      message.success(t('common.operationSuccess'));
      qc.invalidateQueries({ queryKey: ['online-products'] });
    },
  });

  const onChangeStatus = (ids: string[], status: number) => {
    if (!ids.length) {
      message.warning(t('pages.onlineProductList.pleaseSelectProduct'));
      return;
    }
    const label = statusLabel[status];
    Modal.confirm({
      title: t('pages.onlineProductList.batchStatusTitle', { label }),
      content: t('pages.onlineProductList.batchStatusContent', { count: ids.length, label }),
      onOk: async () => {
        for (const id of ids) {
          await productApi.update(id, { status });
        }
        message.success(t('pages.onlineProductList.batchActionDone'));
        qc.invalidateQueries({ queryKey: ['online-products'] });
        setSelected([]);
      },
    });
  };

  const columns = [
    {
      title: () => (
        <input
          type="checkbox"
          checked={selected.length > 0 && selected.length === (data?.items || []).length}
          onChange={(e) => {
            if (e.target.checked) {
              setSelected(data?.items || []);
            } else {
              setSelected([]);
            }
          }}
        />
      ),
      width: 50,
      render: (_: any, r: any) => (
        <input
          type="checkbox"
          checked={selected.some((s) => s.id === r.id)}
          onChange={(e) => {
            if (e.target.checked) {
              setSelected([...selected, r]);
            } else {
              setSelected(selected.filter((s) => s.id !== r.id));
            }
          }}
        />
      ),
    },
    {
      title: t('pages.onlineProductList.col.product'),
      width: 260,
      fixed: 'left' as const,
      render: (_: any, r: any) => (
        <Space>
          {r.image && <Image src={r.image} width={40} height={40} style={{ borderRadius: 4 }} />}
          <div>
            <div>{r.name}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>{r.sku}</Text>
          </div>
        </Space>
      ),
    },
    { title: t('pages.onlineProductList.col.category'), dataIndex: 'category', width: 120, render: (v: string) => v || '-' },
    {
      title: t('pages.onlineProductList.col.salePrice'),
      dataIndex: 'salePrice',
      width: 100,
      align: 'right' as const,
      render: (v: number, r: any) => `${r.currency} ${(+v).toFixed(2)}`,
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 90,
      render: (v: number) => {
        const color = STATUS_COLOR[v] || 'default';
        const label = statusLabel[v] || t('pages.onlineProductList.status.unknown');
        return <Tag color={color}>{label}</Tag>;
      },
    },
    {
      title: t('pages.onlineProductList.col.updatedAt'),
      dataIndex: 'updatedAt',
      width: 160,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      title: t('common.operation'),
      width: 200,
      fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Space size="small">
          {has('product:update') && r.status !== 1 && (
            <Button size="small" type="link" onClick={() => updateMut.mutate({ id: r.id, data: { status: 1 } })}>
              {t('pages.onlineProductList.action.putOnSale')}
            </Button>
          )}
          {has('product:update') && r.status === 1 && (
            <Button size="small" type="link" onClick={() => updateMut.mutate({ id: r.id, data: { status: 0 } })}>
              {t('pages.onlineProductList.action.takeOffShelf')}
            </Button>
          )}
          {has('product:update') && r.status !== 2 && (
            <Popconfirm
              title={t('pages.onlineProductList.action.confirmMarkViolation')}
              onConfirm={() => updateMut.mutate({ id: r.id, data: { status: 2 } })}
            >
              <Button size="small" type="link" danger>{t('pages.onlineProductList.action.markViolation')}</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 12 }}>
        <Col span={6}><Card bordered={false}><Statistic title={t('pages.onlineProductList.stat.onSale')} value={(data?.total || 0)} valueStyle={{ color: '#52c41a' }} prefix={<CheckCircleOutlined />} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title={t('pages.onlineProductList.stat.selected')} value={selected.length} suffix={t('pages.onlineProductList.stat.suffix')} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title={t('pages.onlineProductList.stat.shop')} value={(shops?.total || 0)} prefix={<ShopOutlined />} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title={t('pages.onlineProductList.stat.violation')} value={0} valueStyle={{ color: '#f5222d' }} prefix={<WarningOutlined />} /></Card></Col>
      </Row>

      <Card bordered={false}>
        <Form
          layout="inline"
          onFinish={(v) => setFilters((f: any) => ({ ...f, ...v, page: 1 }))}
        >
          <Form.Item name="keyword">
            <Input placeholder={t('pages.onlineProductList.filter.keywordPlaceholder')} allowClear prefix={<SearchOutlined />} style={{ width: 240 }} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">{t('common.filter')}</Button>
              <Button onClick={() => setFilters({ page: 1, pageSize: 10, status: initialStatus })} icon={<ReloadOutlined />}>{t('common.reset')}</Button>
              {has('product:update') && (
                <>
                  <Button type="primary" icon={<CloudUploadOutlined />} onClick={() => onChangeStatus(selected.map((s) => s.id), 1)}>
                    {t('pages.onlineProductList.batch.putOnSale')}
                  </Button>
                  <Button onClick={() => onChangeStatus(selected.map((s) => s.id), 0)}>
                    {t('pages.onlineProductList.batch.takeOffShelf')}
                  </Button>
                </>
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
          scroll={{ x: 1100 }}
          pagination={{
            current: filters.page,
            pageSize: filters.pageSize,
            total: data?.total || 0,
            showSizeChanger: true,
            showTotal: (count) => t('pages.onlineProductList.paginationTotal', { count }),
            onChange: (page, pageSize) => setFilters((f: any) => ({ ...f, page, pageSize })),
          }}
        />
      </Card>
    </div>
  );
}

// ============ 商品同步 Tab ============
function ProductSyncTab() {
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 20, type: 'product' });
  const [pullOpen, setPullOpen] = useState(false);
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { t } = useTranslation();

  const { data, isLoading } = useQuery({
    queryKey: ['sync-tasks', filters],
    queryFn: () => syncApi.tasks(filters),
  });
  const { data: shops } = useQuery({
    queryKey: ['shops-all'],
    queryFn: () => shopApi.list({ page: 1, pageSize: 100 }),
  });

  const runMut = useMutation({
    mutationFn: syncApi.run,
    onSuccess: () => {
      message.success(t('pages.onlineProductList.sync.taskCreated'));
      setPullOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['sync-tasks'] });
    },
  });

  const statusMap: Record<string, { color: string; text: string }> = {
    pending: { color: 'default', text: t('pages.onlineProductList.syncStatus.pending') },
    running: { color: 'blue', text: t('pages.onlineProductList.syncStatus.running') },
    success: { color: 'green', text: t('pages.onlineProductList.syncStatus.success') },
    failed: { color: 'red', text: t('pages.onlineProductList.syncStatus.failed') },
    partial: { color: 'orange', text: t('pages.onlineProductList.syncStatus.partial') },
  };

  const columns = [
    { title: t('pages.onlineProductList.col.shop'), dataIndex: ['shop', 'name'], width: 160, render: (_: any, r: any) => (
        <div>
          <div>{r.shop?.name || '-'}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>{r.platform}</Text>
        </div>
      )
    },
    { title: t('pages.onlineProductList.col.type'), dataIndex: 'type', width: 100, render: (v: string) => <Tag>{v}</Tag> },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 100,
      render: (v: string) => <Tag color={statusMap[v]?.color}>{statusMap[v]?.text || v}</Tag>,
    },
    {
      title: t('pages.onlineProductList.col.progress'),
      width: 200,
      render: (_: any, r: any) => {
        const total = r.total || 0;
        const done = (r.success || 0) + (r.failed || 0);
        const pct = total > 0 ? Math.round((done / total) * 100) : (r.status === 'success' ? 100 : 0);
        return (
          <div>
            <div style={{ fontSize: 12 }}>{done}/{total} ({pct}%)</div>
            <div style={{ height: 4, background: '#f0f0f0', borderRadius: 2, marginTop: 2 }}>
              <div style={{ width: `${pct}%`, height: 4, background: statusMap[r.status]?.color === 'red' ? '#f5222d' : '#52c41a' }} />
            </div>
          </div>
        );
      },
    },
    { title: t('pages.onlineProductList.col.success'), dataIndex: 'success', width: 80, align: 'right' as const, render: (v: number) => <span style={{ color: '#52c41a' }}>{v || 0}</span> },
    { title: t('pages.onlineProductList.col.failed'), dataIndex: 'failed', width: 80, align: 'right' as const, render: (v: number) => <span style={{ color: '#f5222d' }}>{v || 0}</span> },
    {
      title: t('pages.onlineProductList.col.trigger'),
      dataIndex: 'trigger',
      width: 80,
      render: (v: string) => v === 'schedule' ? <Tag color="blue">{t('pages.onlineProductList.sync.trigger.schedule')}</Tag> : <Tag>{t('pages.onlineProductList.sync.trigger.manual')}</Tag>,
    },
    {
      title: t('pages.onlineProductList.col.startedAt'),
      dataIndex: 'startedAt',
      width: 160,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-',
    },
    {
      title: t('common.operation'),
      width: 120,
      render: (_: any, r: any) => (
        <Button size="small" type="link" onClick={async () => {
          const d = await syncApi.taskDetail(r.id);
          Modal.info({
            title: t('pages.onlineProductList.sync.detailTitle', { id: r.id.slice(0, 8) }),
            width: 700,
            content: (
              <div>
                <p>{t('common.status')}: {statusMap[r.status]?.text}</p>
                <p>{t('pages.onlineProductList.sync.total')}: {r.total} {t('pages.onlineProductList.col.success')}: {r.success} {t('pages.onlineProductList.col.failed')}: {r.failed}</p>
                {r.message && <p>{t('pages.onlineProductList.sync.message')}: {r.message}</p>}
                {d?.logs && (
                  <Table
                    size="small"
                    pagination={{ pageSize: 5 }}
                    rowKey="id"
                    dataSource={d.logs}
                    columns={[
                      { title: t('pages.onlineProductList.log.action'), dataIndex: 'action', width: 140 },
                      { title: t('pages.onlineProductList.log.type'), dataIndex: 'refType', width: 80 },
                      { title: t('pages.onlineProductList.log.refId'), dataIndex: 'refId', width: 140 },
                      { title: t('common.status'), dataIndex: 'status', width: 80, render: (v: string) => <Tag color={v === 'success' ? 'green' : 'red'}>{v}</Tag> },
                      { title: t('pages.onlineProductList.log.detail'), dataIndex: 'detail' },
                    ]}
                  />
                )}
              </div>
            ),
          });
        }}>{t('pages.onlineProductList.viewDetail')}</Button>
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
          <Form.Item name="platform">
            <Select
              placeholder={t('pages.onlineProductList.filter.platformPlaceholder')}
              allowClear
              style={{ width: 160 }}
              options={[
                { label: 'Amazon', value: 'amazon' },
                { label: 'Shopee', value: 'shopee' },
                { label: 'TikTok', value: 'tiktok' },
              ]}
            />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">{t('common.filter')}</Button>
              <Button onClick={() => setFilters({ page: 1, pageSize: 20, type: 'product' })} icon={<ReloadOutlined />}>{t('common.reset')}</Button>
              <Button type="primary" icon={<CloudDownloadOutlined />} onClick={() => setPullOpen(true)}>
                {t('pages.onlineProductList.sync.pullNow')}
              </Button>
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
          scroll={{ x: 1300 }}
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
        title={t('pages.onlineProductList.sync.pullModalTitle')}
        open={pullOpen}
        onCancel={() => setPullOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={runMut.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(v) => runMut.mutate({ ...v, type: 'product' })}>
          <Form.Item name="shopId" label={t('pages.onlineProductList.sync.selectShop')} rules={[{ required: true, message: t('common.pleaseSelect') + t('pages.onlineProductList.sync.shop') }]}>
            <Select
              placeholder={t('pages.onlineProductList.sync.selectShop')}
              options={(shops?.items || []).map((s: any) => ({
                label: `${s.name} (${s.platform?.name || s.platformId})`,
                value: s.id,
              }))}
            />
          </Form.Item>
          <div style={{ color: '#999', fontSize: 12 }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('pages.onlineProductList.sync.emptyDescription')}
              style={{ padding: 0 }}
            />
          </div>
        </Form>
      </Modal>
    </div>
  );
}

// ============ 入口 ============
export default function OnlineProductList() {
  const { t } = useTranslation();
  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>{t('pages.onlineProductList.title')}</Title>
      <Text type="secondary">{t('pages.onlineProductList.subtitle')}</Text>
      <Tabs
        style={{ marginTop: 12 }}
        defaultActiveKey="selling"
        items={[
          { key: 'selling', label: t('pages.onlineProductList.tab.selling'), children: <OnlineProductsTab initialStatus={1} /> },
          { key: 'off', label: t('pages.onlineProductList.tab.off'), children: <OnlineProductsTab initialStatus={0} /> },
          { key: 'illegal', label: t('pages.onlineProductList.tab.illegal'), children: <OnlineProductsTab initialStatus={2} /> },
          { key: 'sync', label: t('pages.onlineProductList.tab.sync'), children: <ProductSyncTab /> },
        ]}
      />
    </div>
  );
}
