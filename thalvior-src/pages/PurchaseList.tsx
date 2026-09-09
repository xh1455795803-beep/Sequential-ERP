import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Tag, Space, Button, Input, Select, Form, Row, Col, Typography,
  Tabs, Modal, InputNumber, message, Popconfirm, Descriptions, Statistic,
} from 'antd';
import {
  SearchOutlined, ReloadOutlined, PlusOutlined, EditOutlined, DeleteOutlined,
  TeamOutlined, ImportOutlined, CheckOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { supplierApi, purchaseApi, warehouseApi, productApi } from '../api';
import { usePermission } from '../hooks/usePermission';

const { Title, Text } = Typography;

// ============ 供应商 Tab ============
function SupplierTab() {
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 10 });
  const [editing, setEditing] = useState<any | null>(null);
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { has } = usePermission();

  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', filters],
    queryFn: () => supplierApi.list(filters),
  });

  const createMut = useMutation({
    mutationFn: supplierApi.create,
    onSuccess: () => {
      message.success('创建成功');
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      setEditing(null);
    },
  });
  const updateMut = useMutation({
    mutationFn: (vars: any) => supplierApi.update(vars.id, vars.data),
    onSuccess: () => {
      message.success('更新成功');
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      setEditing(null);
    },
  });
  const removeMut = useMutation({
    mutationFn: supplierApi.remove,
    onSuccess: () => {
      message.success('已删除');
      qc.invalidateQueries({ queryKey: ['suppliers'] });
    },
  });

  const onSubmit = async () => {
    const v = await form.validateFields();
    if (editing?.id) updateMut.mutate({ id: editing.id, data: v });
    else createMut.mutate(v);
  };

  const columns = [
    { title: '编码', dataIndex: 'code', width: 140 },
    { title: '名称', dataIndex: 'name', width: 200, ellipsis: true },
    { title: '联系人', dataIndex: 'contact', width: 100, render: (v: string) => v || '-' },
    { title: '电话', dataIndex: 'phone', width: 140, render: (v: string) => v || '-' },
    { title: '邮箱', dataIndex: 'email', width: 180, ellipsis: true },
    { title: '地址', dataIndex: 'address', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: number) => v === 1 ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>,
    },
    {
      title: '操作',
      width: 180,
      fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Space size="small">
          {has('supplier:create') && (
            <Button size="small" type="link" icon={<EditOutlined />} onClick={() => {
              setEditing(r);
              form.setFieldsValue(r);
            }}>编辑</Button>
          )}
          {has('supplier:create') && (
            <Popconfirm title="确认删除?" onConfirm={() => removeMut.mutate(r.id)}>
              <Button size="small" type="link" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
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
            <Input placeholder="编码/名称/联系人" allowClear prefix={<SearchOutlined />} style={{ width: 240 }} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">筛选</Button>
              <Button onClick={() => setFilters({ page: 1, pageSize: 10 })} icon={<ReloadOutlined />}>重置</Button>
              {has('supplier:create') && (
                <Button type="primary" icon={<PlusOutlined />} onClick={() => {
                  setEditing({});
                  form.resetFields();
                }}>新增供应商</Button>
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
      <Modal
        title={editing?.id ? '编辑供应商' : '新增供应商'}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={onSubmit}
        confirmLoading={createMut.isPending || updateMut.isPending}
        width={560}
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="code" label="编码" rules={[{ required: true }]}><Input disabled={!!editing?.id} /></Form.Item></Col>
            <Col span={12}><Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="contact" label="联系人"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="phone" label="电话"><Input /></Form.Item></Col>
            <Col span={24}><Form.Item name="email" label="邮箱"><Input /></Form.Item></Col>
            <Col span={24}><Form.Item name="address" label="地址"><Input.TextArea rows={2} /></Form.Item></Col>
            <Col span={12}><Form.Item name="status" label="状态" initialValue={1}><Select options={[{ label: '启用', value: 1 }, { label: '停用', value: 0 }]} /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
}

// ============ 采购单 Tab ============
function PurchaseTab() {
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 10 });
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { has } = usePermission();

  const { data, isLoading } = useQuery({
    queryKey: ['purchases', filters],
    queryFn: () => purchaseApi.list(filters),
  });
  const { data: suppliers } = useQuery({
    queryKey: ['suppliers-all'],
    queryFn: () => supplierApi.all(),
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
    mutationFn: purchaseApi.create,
    onSuccess: () => {
      message.success('采购单已创建');
      setCreateOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['purchases'] });
    },
  });
  const approveMut = useMutation({
    mutationFn: purchaseApi.approve,
    onSuccess: () => {
      message.success('已审核');
      qc.invalidateQueries({ queryKey: ['purchases'] });
    },
  });
  const receiveMut = useMutation({
    mutationFn: (vars: { id: string; data: { warehouseId: string } }) =>
      purchaseApi.receive(vars.id, vars.data),
    onSuccess: () => {
      message.success('入库成功, 库存已更新');
      qc.invalidateQueries({ queryKey: ['purchases'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory-logs'] });
    },
  });
  const cancelMut = useMutation({
    mutationFn: purchaseApi.cancel,
    onSuccess: () => {
      message.success('已取消');
      qc.invalidateQueries({ queryKey: ['purchases'] });
    },
  });

  const statusMap: Record<string, { color: string; text: string }> = {
    draft: { color: 'default', text: '草稿' },
    approved: { color: 'blue', text: '已审核' },
    arrived: { color: 'green', text: '已入库' },
    cancel: { color: 'red', text: '已取消' },
  };

  const columns = [
    { title: '采购单号', dataIndex: 'purchaseNo', width: 180 },
    { title: '供应商', dataIndex: ['supplier', 'name'], width: 160 },
    { title: '入库仓', dataIndex: ['warehouse', 'name'], width: 140 },
    {
      title: '商品数',
      width: 90,
      render: (_: any, r: any) => `${r.items?.length || 0} 种`,
    },
    {
      title: '总金额',
      dataIndex: 'totalAmount',
      width: 120,
      align: 'right' as const,
      render: (v: number, r: any) => `${r.currency} ${(+v).toFixed(2)}`,
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
      width: 260,
      fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Space size="small">
          <Button size="small" type="link" onClick={async () => {
            const d = await purchaseApi.detail(r.id);
            setDetail(d);
          }}>详情</Button>
          {has('purchase:approve') && r.status === 'draft' && (
            <>
              <Button size="small" type="link" icon={<CheckOutlined />} onClick={() => approveMut.mutate(r.id)}>审核</Button>
              <Button size="small" type="link" danger onClick={() => cancelMut.mutate(r.id)}>取消</Button>
            </>
          )}
          {has('inventory:adjust') && r.status === 'approved' && (
            <Button size="small" type="link" icon={<ImportOutlined />} onClick={() => receiveMut.mutate({ id: r.id, data: { warehouseId: r.warehouseId } })}>入库</Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 12 }}>
        <Col span={6}><Card bordered={false}><Statistic title="采购单总数" value={data?.total || 0} prefix={<TeamOutlined />} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title="供应商" value={(suppliers || []).length} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title="仓库" value={(warehouses || []).length} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title="商品SKU" value={(products?.total || 0)} /></Card></Col>
      </Row>
      <Card bordered={false}>
        <Form
          layout="inline"
          onFinish={(v) => setFilters((f: any) => ({ ...f, ...v, page: 1 }))}
        >
          <Form.Item name="status">
            <Select
              placeholder="状态" allowClear style={{ width: 140 }}
              options={Object.entries(statusMap).map(([k, v]) => ({ label: v.text, value: k }))}
            />
          </Form.Item>
          <Form.Item name="supplierId">
            <Select
              placeholder="供应商" allowClear style={{ width: 180 }}
              options={(suppliers || []).map((s: any) => ({ label: s.name, value: s.id }))}
            />
          </Form.Item>
          <Form.Item name="keyword">
            <Input placeholder="采购单号" allowClear style={{ width: 180 }} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">筛选</Button>
              <Button onClick={() => setFilters({ page: 1, pageSize: 10 })} icon={<ReloadOutlined />}>重置</Button>
              {has('purchase:create') && (
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建采购单</Button>
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
        title="新建采购单"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
        width={760}
      >
        <Form form={form} layout="vertical" onFinish={(v) => createMut.mutate(v)}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="supplierId" label="供应商" rules={[{ required: true }]}>
                <Select
                  placeholder="选择供应商"
                  options={(suppliers || []).map((s: any) => ({ label: s.name, value: s.id }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="warehouseId" label="入库仓库" rules={[{ required: true }]}>
                <Select
                  placeholder="选择仓库"
                  options={(warehouses || []).map((w: any) => ({ label: w.name, value: w.id }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="currency" label="币种" initialValue="CNY">
                <Select options={[{ label: 'CNY', value: 'CNY' }, { label: 'USD', value: 'USD' }, { label: 'EUR', value: 'EUR' }]} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="采购明细" required>
            <Form.List name="items">
              {(fields, { add, remove }) => (
                <>
                  {fields.map((f) => (
                    <Row gutter={8} key={f.key} style={{ marginBottom: 8 }}>
                      <Col span={10}>
                        <Form.Item {...f} name={[f.name, 'productId']} rules={[{ required: true }]} noStyle>
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
                      <Col span={5}>
                        <Form.Item {...f} name={[f.name, 'quantity']} rules={[{ required: true }]} noStyle>
                          <InputNumber min={1} style={{ width: '100%' }} placeholder="数量" />
                        </Form.Item>
                      </Col>
                      <Col span={7}>
                        <Form.Item {...f} name={[f.name, 'unitPrice']} rules={[{ required: true }]} noStyle>
                          <InputNumber min={0} step={0.01} style={{ width: '100%' }} placeholder="单价" />
                        </Form.Item>
                      </Col>
                      <Col span={2}><Button danger onClick={() => remove(f.name)}>删</Button></Col>
                    </Row>
                  ))}
                  <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ quantity: 1, unitPrice: 0 })}>添加商品</Button>
                </>
              )}
            </Form.List>
          </Form.Item>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`采购单详情 ${detail?.purchaseNo || ''}`}
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={null}
        width={760}
      >
        {detail && (
          <>
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="供应商">{detail.supplier?.name}</Descriptions.Item>
              <Descriptions.Item label="入库仓">{detail.warehouse?.name}</Descriptions.Item>
              <Descriptions.Item label="总金额">{detail.currency} {(+detail.totalAmount).toFixed(2)}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={statusMap[detail.status]?.color}>{statusMap[detail.status]?.text}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">{dayjs(detail.createdAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
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
                { title: '单价', dataIndex: 'unitPrice', width: 100, align: 'right' as const, render: (v: number) => (+v).toFixed(2) },
                { title: '金额', dataIndex: 'amount', width: 120, align: 'right' as const, render: (v: number) => (+v).toFixed(2) },
              ]}
            />
          </>
        )}
      </Modal>
    </div>
  );
}

// ============ 入口 ============
export default function PurchaseList() {
  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>采购管理</Title>
      <Text type="secondary">供应商管理 · 采购单 · 入库</Text>
      <Tabs
        style={{ marginTop: 12 }}
        defaultActiveKey="supplier"
        items={[
          { key: 'supplier', label: '供应商', children: <SupplierTab /> },
          { key: 'order', label: '采购单', children: <PurchaseTab /> },
        ]}
      />
    </div>
  );
}
