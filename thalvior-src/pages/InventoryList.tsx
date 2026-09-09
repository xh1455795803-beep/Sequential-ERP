import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  Card, Table, Tag, Space, Button, Input, Select, Form, Row, Col, Typography,
  Image, Statistic, Progress, Tabs, Modal, InputNumber, message, Descriptions,
} from 'antd';
import {
  SearchOutlined, ReloadOutlined, WarningOutlined, PlusOutlined, SwapOutlined,
  ScanOutlined, ImportOutlined, ExportOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { inventoryApi, warehouseApi, productApi } from '../api';
import { usePermission } from '../hooks/usePermission';

const { Title, Text } = Typography;

// ============ 库存清单 Tab ============
function InventoryTab() {
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 10 });
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [safetyOpen, setSafetyOpen] = useState<any>(null);
  const [form] = Form.useForm();
  const [safetyForm] = Form.useForm();
  const qc = useQueryClient();
  const { has } = usePermission();

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', filters],
    queryFn: () => inventoryApi.list(filters),
  });
  const { data: summary } = useQuery({
    queryKey: ['inventory-summary'],
    queryFn: () => inventoryApi.summary(),
  });
  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => warehouseApi.list(),
  });
  const { data: products } = useQuery({
    queryKey: ['products-all'],
    queryFn: () => productApi.list({ page: 1, pageSize: 500 }),
  });

  const adjustMut = useMutation({
    mutationFn: inventoryApi.adjust,
    onSuccess: () => {
      message.success('库存调整成功');
      setAdjustOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory-summary'] });
      qc.invalidateQueries({ queryKey: ['inventory-logs'] });
    },
  });

  const safetyMut = useMutation({
    mutationFn: ({ id, safetyStock }: any) => inventoryApi.setSafetyStock(id, safetyStock),
    onSuccess: () => {
      message.success('安全库存已更新');
      setSafetyOpen(null);
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });

  const columns = [
    {
      title: '商品',
      dataIndex: ['product', 'name'],
      width: 240,
      fixed: 'left' as const,
      render: (_: any, r: any) => (
        <Space>
          {r.product?.image && <Image src={r.product.image} width={36} height={36} style={{ borderRadius: 4 }} />}
          <div>
            <div>{r.product?.name}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>{r.product?.sku}</Text>
          </div>
        </Space>
      ),
    },
    { title: '仓库', dataIndex: ['warehouse', 'name'], width: 140 },
    { title: '总库存', dataIndex: 'quantity', width: 90, align: 'right' as const },
    { title: '可用', dataIndex: 'available', width: 90, align: 'right' as const, render: (v: number) => <b>{v}</b> },
    { title: '已占用', dataIndex: 'locked', width: 90, align: 'right' as const },
    { title: '安全库存', dataIndex: 'safetyStock', width: 100, align: 'right' as const },
    {
      title: '健康度',
      width: 160,
      render: (_: any, r: any) => {
        const pct = r.safetyStock > 0 ? Math.min(100, (r.available / r.safetyStock) * 100) : 100;
        const low = r.available <= r.safetyStock;
        return (
          <Progress
            percent={Math.round(pct)}
            size="small"
            status={low ? 'exception' : 'normal'}
            strokeColor={low ? undefined : '#52c41a'}
          />
        );
      },
    },
    {
      title: '预警',
      width: 100,
      render: (_: any, r: any) =>
        r.available <= r.safetyStock ? (
          <Tag icon={<WarningOutlined />} color="red">需补货</Tag>
        ) : (
          <Tag color="green">正常</Tag>
        ),
    },
    {
      title: '操作',
      width: 180,
      fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Space size="small">
          {has('inventory:adjust') && (
            <Button size="small" type="link" onClick={() => {
              setSafetyOpen(r);
              safetyForm.setFieldsValue({ safetyStock: r.safetyStock });
            }}>设安全库存</Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 12 }}>
        <Col span={6}><Card bordered={false}><Statistic title="SKU × 仓数" value={summary?.total || 0} suffix="条" /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title="总库存量" value={summary?.totalQty || 0} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title="可用库存" value={summary?.totalAvailable || 0} valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title="需补货 SKU" value={summary?.lowCount || 0} valueStyle={{ color: '#f5222d' }} prefix={<WarningOutlined />} /></Card></Col>
      </Row>

      <Card bordered={false}>
        <Form
          layout="inline"
          onFinish={(v) => setFilters((f: any) => ({ ...f, ...v, page: 1 }))}
        >
          <Form.Item name="keyword">
            <Input placeholder="SKU / 商品名" allowClear prefix={<SearchOutlined />} style={{ width: 240 }} />
          </Form.Item>
          <Form.Item name="warehouseId">
            <Select
              placeholder="选择仓库"
              allowClear
              style={{ width: 180 }}
              options={(warehouses || []).map((w: any) => ({ label: w.name, value: w.id }))}
            />
          </Form.Item>
          <Form.Item name="lowStock" valuePropName="checked">
            <Select
              placeholder="预警"
              allowClear
              style={{ width: 140 }}
              options={[
                { label: '仅看需补货', value: 'true' },
                { label: '仅看正常', value: 'false' },
              ]}
            />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">筛选</Button>
              <Button onClick={() => setFilters({ page: 1, pageSize: 10 })} icon={<ReloadOutlined />}>重置</Button>
              {has('inventory:adjust') && (
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdjustOpen(true)}>
                  库存调整
                </Button>
              )}
            </Space>
          </Form.Item>
        </Form>
      </Card>

      <Card style={{ marginTop: 16 }} bordered={false} title="库存数据">
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
            showTotal: (t) => `共 ${t} 条`,
            onChange: (page, pageSize) => setFilters((f: any) => ({ ...f, page, pageSize })),
          }}
        />
      </Card>

      {/* 库存调整弹窗 */}
      <Modal
        title="库存调整"
        open={adjustOpen}
        onCancel={() => setAdjustOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={adjustMut.isPending}
        width={520}
      >
        <Form form={form} layout="vertical" onFinish={(v) => adjustMut.mutate(v)}>
          <Form.Item name="productId" label="商品" rules={[{ required: true }]}>
            <Select
              showSearch
              placeholder="选择商品"
              optionFilterProp="label"
              options={(products?.items || []).map((p: any) => ({
                label: `${p.sku} - ${p.name}`,
                value: p.id,
              }))}
            />
          </Form.Item>
          <Form.Item name="warehouseId" label="仓库" rules={[{ required: true }]}>
            <Select
              placeholder="选择仓库"
              options={(warehouses || []).map((w: any) => ({ label: w.name, value: w.id }))}
            />
          </Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true }]} initialValue="in">
            <Select
              options={[
                { label: '入库 (+)', value: 'in' },
                { label: '出库 (-)', value: 'out' },
                { label: '盘点调整', value: 'adjust' },
              ]}
            />
          </Form.Item>
          <Form.Item name="delta" label="数量 (正数入库/负数出库)" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} placeholder="例如 100 或 -50" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} placeholder="调整原因/单据号" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 安全库存弹窗 */}
      <Modal
        title="设置安全库存"
        open={!!safetyOpen}
        onCancel={() => setSafetyOpen(null)}
        onOk={() => safetyForm.submit()}
        confirmLoading={safetyMut.isPending}
      >
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary">{safetyOpen?.product?.name} · {safetyOpen?.warehouse?.name}</Text>
        </div>
        <Form
          form={safetyForm}
          layout="vertical"
          onFinish={(v) => safetyMut.mutate({ id: safetyOpen.id, ...v })}
        >
          <Form.Item name="safetyStock" label="安全库存阈值" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

// ============ 调拨单 Tab ============
function TransferTab() {
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 10 });
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { has } = usePermission();

  const { data, isLoading } = useQuery({
    queryKey: ['transfers', filters],
    queryFn: () => inventoryApi.transfers(filters),
  });
  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => warehouseApi.list(),
  });
  const { data: products } = useQuery({
    queryKey: ['products-all'],
    queryFn: () => productApi.list({ page: 1, pageSize: 500 }),
  });

  const createMut = useMutation({
    mutationFn: inventoryApi.createTransfer,
    onSuccess: () => {
      message.success('调拨单已创建');
      setCreateOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['transfers'] });
    },
  });
  const shipMut = useMutation({
    mutationFn: inventoryApi.shipTransfer,
    onSuccess: () => {
      message.success('已发货');
      qc.invalidateQueries({ queryKey: ['transfers'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory-logs'] });
      setDetail(null);
    },
  });
  const receiveMut = useMutation({
    mutationFn: inventoryApi.receiveTransfer,
    onSuccess: () => {
      message.success('已收货');
      qc.invalidateQueries({ queryKey: ['transfers'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory-logs'] });
      setDetail(null);
    },
  });
  const cancelMut = useMutation({
    mutationFn: inventoryApi.cancelTransfer,
    onSuccess: () => {
      message.success('已取消');
      qc.invalidateQueries({ queryKey: ['transfers'] });
    },
  });

  const statusMap: Record<string, { color: string; text: string }> = {
    draft: { color: 'default', text: '草稿' },
    shipped: { color: 'blue', text: '已发货' },
    received: { color: 'green', text: '已收货' },
    cancel: { color: 'red', text: '已取消' },
  };

  const columns = [
    { title: '调拨单号', dataIndex: 'transferNo', width: 180 },
    { title: '调出仓', dataIndex: ['fromWarehouse', 'name'], width: 140 },
    { title: '调入仓', dataIndex: ['toWarehouse', 'name'], width: 140 },
    {
      title: '商品数',
      width: 100,
      render: (_: any, r: any) => `${r.items?.length || 0} 种`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => <Tag color={statusMap[v]?.color}>{statusMap[v]?.text || v}</Tag>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-',
    },
    { title: '备注', dataIndex: 'remark', ellipsis: true },
    {
      title: '操作',
      width: 220,
      fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Space size="small">
          <Button size="small" type="link" onClick={async () => {
            const d = await inventoryApi.transferDetail(r.id);
            setDetail(d);
          }}>详情</Button>
          {has('inventory:transfer') && r.status === 'draft' && (
            <>
              <Button size="small" type="link" onClick={() => shipMut.mutate(r.id)}>发货</Button>
              <Button size="small" type="link" danger onClick={() => cancelMut.mutate(r.id)}>取消</Button>
            </>
          )}
          {has('inventory:transfer') && r.status === 'shipped' && (
            <Button size="small" type="link" onClick={() => receiveMut.mutate(r.id)}>收货</Button>
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
          <Form.Item name="status">
            <Select
              placeholder="状态"
              allowClear
              style={{ width: 140 }}
              options={[
                { label: '草稿', value: 'draft' },
                { label: '已发货', value: 'shipped' },
                { label: '已收货', value: 'received' },
                { label: '已取消', value: 'cancel' },
              ]}
            />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">筛选</Button>
              <Button onClick={() => setFilters({ page: 1, pageSize: 10 })} icon={<ReloadOutlined />}>重置</Button>
              {has('inventory:transfer') && (
                <Button type="primary" icon={<SwapOutlined />} onClick={() => setCreateOpen(true)}>
                  新建调拨
                </Button>
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
            onChange: (page, pageSize) => setFilters((f: any) => ({ ...f, page, pageSize })),
          }}
        />
      </Card>

      {/* 新建调拨 */}
      <Modal
        title="新建调拨单"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
        width={680}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) => createMut.mutate(v)}
        >
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="fromWarehouseId" label="调出仓库" rules={[{ required: true }]}>
                <Select
                  placeholder="选择调出仓"
                  options={(warehouses || []).map((w: any) => ({ label: w.name, value: w.id }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="toWarehouseId" label="调入仓库" rules={[{ required: true }]}>
                <Select
                  placeholder="选择调入仓"
                  options={(warehouses || []).map((w: any) => ({ label: w.name, value: w.id }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="调拨商品" required>
            <Form.List name="items">
              {(fields, { add, remove }) => (
                <>
                  {fields.map((f) => (
                    <Row gutter={8} key={f.key} style={{ marginBottom: 8 }}>
                      <Col span={14}>
                        <Form.Item
                          {...f}
                          name={[f.name, 'productId']}
                          rules={[{ required: true, message: '请选择商品' }]}
                          noStyle
                        >
                          <Select
                            showSearch
                            placeholder="商品"
                            optionFilterProp="label"
                            options={(products?.items || []).map((p: any) => ({
                              label: `${p.sku} - ${p.name}`,
                              value: p.id,
                            }))}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item
                          {...f}
                          name={[f.name, 'quantity']}
                          rules={[{ required: true, message: '请输入数量' }]}
                          noStyle
                        >
                          <InputNumber min={1} style={{ width: '100%' }} placeholder="数量" />
                        </Form.Item>
                      </Col>
                      <Col span={2}>
                        <Button danger onClick={() => remove(f.name)}>删</Button>
                      </Col>
                    </Row>
                  ))}
                  <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ quantity: 1 })}>
                    添加商品
                  </Button>
                </>
              )}
            </Form.List>
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 详情 */}
      <Modal
        title={`调拨单详情 ${detail?.transferNo || ''}`}
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={null}
        width={720}
      >
        {detail && (
          <>
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="调出仓">{detail.fromWarehouse?.name}</Descriptions.Item>
              <Descriptions.Item label="调入仓">{detail.toWarehouse?.name}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={statusMap[detail.status]?.color}>{statusMap[detail.status]?.text || detail.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">{dayjs(detail.createdAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
              {detail.shipTime && <Descriptions.Item label="发货时间">{dayjs(detail.shipTime).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>}
              {detail.receiveTime && <Descriptions.Item label="收货时间">{dayjs(detail.receiveTime).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>}
              <Descriptions.Item label="备注" span={2}>{detail.remark || '-'}</Descriptions.Item>
            </Descriptions>
            <Table
              size="small"
              style={{ marginTop: 12 }}
              dataSource={detail.items || []}
              rowKey="id"
              pagination={false}
              columns={[
                { title: 'SKU', dataIndex: ['product', 'sku'], width: 160 },
                { title: '商品', dataIndex: ['product', 'name'] },
                { title: '数量', dataIndex: 'quantity', width: 100, align: 'right' as const },
              ]}
            />
          </>
        )}
      </Modal>
    </div>
  );
}

// ============ 盘点单 Tab ============
function CheckTab() {
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 10 });
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { has } = usePermission();

  const { data, isLoading } = useQuery({
    queryKey: ['checks', filters],
    queryFn: () => inventoryApi.checks(filters),
  });
  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => warehouseApi.list(),
  });
  const { data: products } = useQuery({
    queryKey: ['products-all'],
    queryFn: () => productApi.list({ page: 1, pageSize: 500 }),
  });

  const createMut = useMutation({
    mutationFn: inventoryApi.createCheck,
    onSuccess: () => {
      message.success('盘点单已创建');
      setCreateOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['checks'] });
    },
  });
  const applyMut = useMutation({
    mutationFn: inventoryApi.applyCheck,
    onSuccess: () => {
      message.success('已确认盘点, 库存已更新');
      qc.invalidateQueries({ queryKey: ['checks'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory-logs'] });
    },
  });

  const statusMap: Record<string, { color: string; text: string }> = {
    draft: { color: 'default', text: '草稿' },
    done: { color: 'green', text: '已确认' },
    cancel: { color: 'red', text: '已取消' },
  };

  const columns = [
    { title: '盘点单号', dataIndex: 'checkNo', width: 180 },
    { title: '仓库', dataIndex: ['warehouse', 'name'], width: 160 },
    {
      title: '商品数',
      width: 100,
      render: (_: any, r: any) => `${r.items?.length || 0} 种`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => <Tag color={statusMap[v]?.color}>{statusMap[v]?.text || v}</Tag>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      title: '操作',
      width: 220,
      fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Space size="small">
          <Button size="small" type="link" onClick={async () => {
            const d = await inventoryApi.checkDetail(r.id);
            setDetail(d);
          }}>详情</Button>
          {has('inventory:stocktaking') && r.status === 'draft' && (
            <Button size="small" type="link" onClick={() => applyMut.mutate(r.id)}>确认盘点</Button>
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
          <Form.Item name="status">
            <Select
              placeholder="状态"
              allowClear
              style={{ width: 140 }}
              options={[
                { label: '草稿', value: 'draft' },
                { label: '已确认', value: 'done' },
                { label: '已取消', value: 'cancel' },
              ]}
            />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">筛选</Button>
              <Button onClick={() => setFilters({ page: 1, pageSize: 10 })} icon={<ReloadOutlined />}>重置</Button>
              {has('inventory:stocktaking') && (
                <Button type="primary" icon={<ScanOutlined />} onClick={() => setCreateOpen(true)}>
                  新建盘点
                </Button>
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
          scroll={{ x: 900 }}
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
        title="新建盘点单"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
        width={680}
      >
        <Form form={form} layout="vertical" onFinish={(v) => createMut.mutate(v)}>
          <Form.Item name="warehouseId" label="盘点仓库" rules={[{ required: true }]}>
            <Select
              placeholder="选择仓库"
              options={(warehouses || []).map((w: any) => ({ label: w.name, value: w.id }))}
            />
          </Form.Item>
          <Form.Item label="盘点商品 (填入实盘数量)" required>
            <Form.List name="items">
              {(fields, { add, remove }) => (
                <>
                  {fields.map((f) => (
                    <Row gutter={8} key={f.key} style={{ marginBottom: 8 }}>
                      <Col span={16}>
                        <Form.Item
                          {...f}
                          name={[f.name, 'productId']}
                          rules={[{ required: true, message: '请选择商品' }]}
                          noStyle
                        >
                          <Select
                            showSearch
                            placeholder="商品"
                            optionFilterProp="label"
                            options={(products?.items || []).map((p: any) => ({
                              label: `${p.sku} - ${p.name}`,
                              value: p.id,
                            }))}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item
                          {...f}
                          name={[f.name, 'actualQty']}
                          rules={[{ required: true, message: '请输入实盘数' }]}
                          noStyle
                        >
                          <InputNumber min={0} style={{ width: '100%' }} placeholder="实盘数" />
                        </Form.Item>
                      </Col>
                      <Col span={2}>
                        <Button danger onClick={() => remove(f.name)}>删</Button>
                      </Col>
                    </Row>
                  ))}
                  <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ actualQty: 0 })}>
                    添加商品
                  </Button>
                </>
              )}
            </Form.List>
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`盘点单详情 ${detail?.checkNo || ''}`}
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={null}
        width={760}
      >
        {detail && (
          <>
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="仓库">{detail.warehouse?.name}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={statusMap[detail.status]?.color}>{statusMap[detail.status]?.text || detail.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">{dayjs(detail.createdAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
              {detail.checkedAt && <Descriptions.Item label="确认时间">{dayjs(detail.checkedAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>}
              <Descriptions.Item label="备注" span={2}>{detail.remark || '-'}</Descriptions.Item>
            </Descriptions>
            <Table
              size="small"
              style={{ marginTop: 12 }}
              dataSource={detail.items || []}
              rowKey="id"
              pagination={false}
              columns={[
                { title: 'SKU', dataIndex: ['product', 'sku'], width: 160 },
                { title: '商品', dataIndex: ['product', 'name'] },
                { title: '账面库存', dataIndex: 'systemQty', width: 100, align: 'right' as const },
                { title: '实盘数', dataIndex: 'actualQty', width: 100, align: 'right' as const },
                {
                  title: '差异',
                  width: 100,
                  align: 'right' as const,
                  render: (v: number) => v === 0 ? <Tag>0</Tag> : v > 0 ? <Tag color="green">+{v}</Tag> : <Tag color="red">{v}</Tag>,
                },
              ]}
            />
          </>
        )}
      </Modal>
    </div>
  );
}

// ============ 出入库记录 Tab ============
function LogsTab() {
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 20 });
  const { data, isLoading } = useQuery({
    queryKey: ['inventory-logs', filters],
    queryFn: () => inventoryApi.logs(filters),
  });
  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => warehouseApi.list(),
  });

  const typeMap: Record<string, { color: string; text: string; icon: any }> = {
    in: { color: 'green', text: '入库', icon: <ImportOutlined /> },
    out: { color: 'red', text: '出库', icon: <ExportOutlined /> },
    adjust: { color: 'blue', text: '调整', icon: <ScanOutlined /> },
    lock: { color: 'orange', text: '占用', icon: <ScanOutlined /> },
    unlock: { color: 'cyan', text: '释放', icon: <ScanOutlined /> },
  };
  const sourceMap: Record<string, string> = {
    manual: '手动',
    order: '订单',
    transfer: '调拨',
    check: '盘点',
  };

  const columns = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-',
    },
    { title: '商品', dataIndex: ['product', 'name'], render: (_: any, r: any) => (
        <div>
          <div>{r.product?.name}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>{r.product?.sku}</Text>
        </div>
      )
    },
    { title: '仓库', dataIndex: ['warehouse', 'name'], width: 140 },
    {
      title: '类型',
      dataIndex: 'type',
      width: 90,
      render: (v: string) => <Tag color={typeMap[v]?.color} icon={typeMap[v]?.icon}>{typeMap[v]?.text || v}</Tag>,
    },
    {
      title: '数量',
      dataIndex: 'quantity',
      width: 90,
      align: 'right' as const,
      render: (v: number) => v > 0 ? <span style={{ color: '#52c41a' }}>+{v}</span> : <span style={{ color: '#f5222d' }}>{v}</span>,
    },
    { title: '变更前', dataIndex: 'beforeQty', width: 90, align: 'right' as const },
    { title: '变更后', dataIndex: 'afterQty', width: 90, align: 'right' as const },
    { title: '来源', dataIndex: 'source', width: 80, render: (v: string) => sourceMap[v] || v },
    { title: '关联单号', dataIndex: 'refId', width: 180, ellipsis: true },
    { title: '备注', dataIndex: 'remark', ellipsis: true },
  ];

  return (
    <div>
      <Card bordered={false}>
        <Form
          layout="inline"
          onFinish={(v) => setFilters((f: any) => ({ ...f, ...v, page: 1 }))}
        >
          <Form.Item name="type">
            <Select
              placeholder="类型"
              allowClear
              style={{ width: 120 }}
              options={[
                { label: '入库', value: 'in' },
                { label: '出库', value: 'out' },
                { label: '调整', value: 'adjust' },
              ]}
            />
          </Form.Item>
          <Form.Item name="warehouseId">
            <Select
              placeholder="仓库"
              allowClear
              style={{ width: 180 }}
              options={(warehouses || []).map((w: any) => ({ label: w.name, value: w.id }))}
            />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">筛选</Button>
              <Button onClick={() => setFilters({ page: 1, pageSize: 20 })} icon={<ReloadOutlined />}>重置</Button>
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
    </div>
  );
}

// ============ 入口 ============
export default function InventoryList() {
  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>库存管理</Title>
      <Text type="secondary">多仓多 SKU 实时库存 · 出入库 · 调拨 · 盘点</Text>
      <Tabs
        style={{ marginTop: 12 }}
        defaultActiveKey="list"
        items={[
          { key: 'list', label: '库存清单', children: <InventoryTab /> },
          { key: 'transfer', label: '库存调拨', children: <TransferTab /> },
          { key: 'check', label: '库存盘点', children: <CheckTab /> },
          { key: 'log', label: '出入库记录', children: <LogsTab /> },
        ]}
      />
    </div>
  );
}
