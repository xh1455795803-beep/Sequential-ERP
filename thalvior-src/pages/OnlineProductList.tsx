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

const { Title, Text } = Typography;

const STATUS_MAP: Record<number, { label: string; color: string }> = {
  1: { label: '在售', color: 'green' },
  0: { label: '下架', color: 'default' },
  2: { label: '违规', color: 'red' },
};

// ============ 在线商品列表 Tab ============
function OnlineProductsTab({ initialStatus = 1 }: { initialStatus?: number }) {
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 10, status: initialStatus });
  const [selected, setSelected] = useState<any[]>([]);
  const qc = useQueryClient();
  const { has } = usePermission();

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
      message.success('操作成功');
      qc.invalidateQueries({ queryKey: ['online-products'] });
    },
  });

  const onChangeStatus = (ids: string[], status: number) => {
    if (!ids.length) {
      message.warning('请先选择商品');
      return;
    }
    const label = STATUS_MAP[status].label;
    Modal.confirm({
      title: `批量${label}`,
      content: `确认将 ${ids.length} 个商品设为「${label}」?`,
      onOk: async () => {
        for (const id of ids) {
          await productApi.update(id, { status });
        }
        message.success('批量操作完成');
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
      title: '商品',
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
    { title: '类目', dataIndex: 'category', width: 120, render: (v: string) => v || '-' },
    {
      title: '售价',
      dataIndex: 'salePrice',
      width: 100,
      align: 'right' as const,
      render: (v: number, r: any) => `${r.currency} ${(+v).toFixed(2)}`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: number) => {
        const s = STATUS_MAP[v] || { label: '未知', color: 'default' };
        return <Tag color={s.color}>{s.label}</Tag>;
      },
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 160,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      title: '操作',
      width: 200,
      fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Space size="small">
          {has('product:update') && r.status !== 1 && (
            <Button size="small" type="link" onClick={() => updateMut.mutate({ id: r.id, data: { status: 1 } })}>
              上架
            </Button>
          )}
          {has('product:update') && r.status === 1 && (
            <Button size="small" type="link" onClick={() => updateMut.mutate({ id: r.id, data: { status: 0 } })}>
              下架
            </Button>
          )}
          {has('product:update') && r.status !== 2 && (
            <Popconfirm
              title="标记为违规商品?"
              onConfirm={() => updateMut.mutate({ id: r.id, data: { status: 2 } })}
            >
              <Button size="small" type="link" danger>违规</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 12 }}>
        <Col span={6}><Card bordered={false}><Statistic title="在售" value={(data?.total || 0)} valueStyle={{ color: '#52c41a' }} prefix={<CheckCircleOutlined />} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title="已选择" value={selected.length} suffix="项" /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title="店铺" value={(shops?.total || 0)} prefix={<ShopOutlined />} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title="违规" value={0} valueStyle={{ color: '#f5222d' }} prefix={<WarningOutlined />} /></Card></Col>
      </Row>

      <Card bordered={false}>
        <Form
          layout="inline"
          onFinish={(v) => setFilters((f: any) => ({ ...f, ...v, page: 1 }))}
        >
          <Form.Item name="keyword">
            <Input placeholder="SKU / 商品名" allowClear prefix={<SearchOutlined />} style={{ width: 240 }} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">筛选</Button>
              <Button onClick={() => setFilters({ page: 1, pageSize: 10, status: initialStatus })} icon={<ReloadOutlined />}>重置</Button>
              {has('product:update') && (
                <>
                  <Button type="primary" icon={<CloudUploadOutlined />} onClick={() => onChangeStatus(selected.map((s) => s.id), 1)}>
                    批量上架
                  </Button>
                  <Button onClick={() => onChangeStatus(selected.map((s) => s.id), 0)}>
                    批量下架
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
            showTotal: (t) => `共 ${t} 条`,
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
      message.success('同步任务已创建, 稍后查看结果');
      setPullOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['sync-tasks'] });
    },
  });

  const statusMap: Record<string, { color: string; text: string }> = {
    pending: { color: 'default', text: '等待' },
    running: { color: 'blue', text: '进行中' },
    success: { color: 'green', text: '成功' },
    failed: { color: 'red', text: '失败' },
    partial: { color: 'orange', text: '部分成功' },
  };

  const columns = [
    { title: '店铺', dataIndex: ['shop', 'name'], width: 160, render: (_: any, r: any) => (
        <div>
          <div>{r.shop?.name || '-'}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>{r.platform}</Text>
        </div>
      )
    },
    { title: '类型', dataIndex: 'type', width: 100, render: (v: string) => <Tag>{v}</Tag> },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => <Tag color={statusMap[v]?.color}>{statusMap[v]?.text || v}</Tag>,
    },
    {
      title: '进度',
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
    { title: '成功', dataIndex: 'success', width: 80, align: 'right' as const, render: (v: number) => <span style={{ color: '#52c41a' }}>{v || 0}</span> },
    { title: '失败', dataIndex: 'failed', width: 80, align: 'right' as const, render: (v: number) => <span style={{ color: '#f5222d' }}>{v || 0}</span> },
    {
      title: '触发',
      dataIndex: 'trigger',
      width: 80,
      render: (v: string) => v === 'schedule' ? <Tag color="blue">定时</Tag> : <Tag>手动</Tag>,
    },
    {
      title: '开始时间',
      dataIndex: 'startedAt',
      width: 160,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-',
    },
    {
      title: '操作',
      width: 120,
      render: (_: any, r: any) => (
        <Button size="small" type="link" onClick={async () => {
          const d = await syncApi.taskDetail(r.id);
          Modal.info({
            title: `同步任务 ${r.id.slice(0, 8)}`,
            width: 700,
            content: (
              <div>
                <p>状态: {statusMap[r.status]?.text}</p>
                <p>总数: {r.total} 成功: {r.success} 失败: {r.failed}</p>
                {r.message && <p>消息: {r.message}</p>}
                {d?.logs && (
                  <Table
                    size="small"
                    pagination={{ pageSize: 5 }}
                    rowKey="id"
                    dataSource={d.logs}
                    columns={[
                      { title: '动作', dataIndex: 'action', width: 140 },
                      { title: '类型', dataIndex: 'refType', width: 80 },
                      { title: '关联', dataIndex: 'refId', width: 140 },
                      { title: '状态', dataIndex: 'status', width: 80, render: (v: string) => <Tag color={v === 'success' ? 'green' : 'red'}>{v}</Tag> },
                      { title: '详情', dataIndex: 'detail' },
                    ]}
                  />
                )}
              </div>
            ),
          });
        }}>查看</Button>
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
              placeholder="平台"
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
              <Button type="primary" htmlType="submit">筛选</Button>
              <Button onClick={() => setFilters({ page: 1, pageSize: 20, type: 'product' })} icon={<ReloadOutlined />}>重置</Button>
              <Button type="primary" icon={<CloudDownloadOutlined />} onClick={() => setPullOpen(true)}>
                立即拉取
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
        title="立即拉取商品"
        open={pullOpen}
        onCancel={() => setPullOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={runMut.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(v) => runMut.mutate({ ...v, type: 'product' })}>
          <Form.Item name="shopId" label="选择店铺" rules={[{ required: true }]}>
            <Select
              placeholder="选择店铺"
              options={(shops?.items || []).map((s: any) => ({
                label: `${s.name} (${s.platform?.name || s.platformId})`,
                value: s.id,
              }))}
            />
          </Form.Item>
          <div style={{ color: '#999', fontSize: 12 }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="将从所选店铺拉取商品到 ERP"
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
  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>在线商品管理</Title>
      <Text type="secondary">管理各店铺在售/下架/违规商品 · 同步拉取平台商品</Text>
      <Tabs
        style={{ marginTop: 12 }}
        defaultActiveKey="selling"
        items={[
          { key: 'selling', label: '在售商品', children: <OnlineProductsTab initialStatus={1} /> },
          { key: 'off', label: '下架商品', children: <OnlineProductsTab initialStatus={0} /> },
          { key: 'illegal', label: '违规商品', children: <OnlineProductsTab initialStatus={2} /> },
          { key: 'sync', label: '商品同步记录', children: <ProductSyncTab /> },
        ]}
      />
    </div>
  );
}
