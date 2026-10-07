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
import { useTranslation } from '../i18n';

const { Title, Text } = Typography;

// ============ 供应商 Tab ============
function SupplierTab() {
  const { t } = useTranslation();
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
      message.success(t('common.createSuccess'));
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      setEditing(null);
    },
  });
  const updateMut = useMutation({
    mutationFn: (vars: any) => supplierApi.update(vars.id, vars.data),
    onSuccess: () => {
      message.success(t('common.updateSuccess'));
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      setEditing(null);
    },
  });
  const removeMut = useMutation({
    mutationFn: supplierApi.remove,
    onSuccess: () => {
      message.success(t('common.deleteSuccess'));
      qc.invalidateQueries({ queryKey: ['suppliers'] });
    },
  });

  const onSubmit = async () => {
    const v = await form.validateFields();
    if (editing?.id) updateMut.mutate({ id: editing.id, data: v });
    else createMut.mutate(v);
  };

  const columns = [
    { title: t('pages.purchaseList.colCode'), dataIndex: 'code', width: 140 },
    { title: t('pages.purchaseList.colName'), dataIndex: 'name', width: 200, ellipsis: true },
    { title: t('pages.purchaseList.colContact'), dataIndex: 'contact', width: 100, render: (v: string) => v || '-' },
    { title: t('pages.purchaseList.colPhone'), dataIndex: 'phone', width: 140, render: (v: string) => v || '-' },
    { title: t('pages.purchaseList.colEmail'), dataIndex: 'email', width: 180, ellipsis: true },
    { title: t('pages.purchaseList.colAddress'), dataIndex: 'address', ellipsis: true },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 100,
      render: (v: number) => v === 1 ? <Tag color="green">{t('pages.purchaseList.statusEnabled')}</Tag> : <Tag>{t('pages.purchaseList.statusDisabled')}</Tag>,
    },
    {
      title: t('common.operation'),
      width: 180,
      fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Space size="small">
          {has('supplier:create') && (
            <Button size="small" type="link" icon={<EditOutlined />} onClick={() => {
              setEditing(r);
              form.setFieldsValue(r);
            }}>{t('common.edit')}</Button>
          )}
          {has('supplier:create') && (
            <Popconfirm title={t('common.deleteConfirm')} onConfirm={() => removeMut.mutate(r.id)}>
              <Button size="small" type="link" danger icon={<DeleteOutlined />}>{t('common.delete')}</Button>
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
            <Input placeholder={t('pages.purchaseList.supplierKeywordPlaceholder')} allowClear prefix={<SearchOutlined />} style={{ width: 240 }} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">{t('common.filter')}</Button>
              <Button onClick={() => setFilters({ page: 1, pageSize: 10 })} icon={<ReloadOutlined />}>{t('common.reset')}</Button>
              {has('supplier:create') && (
                <Button type="primary" icon={<PlusOutlined />} onClick={() => {
                  setEditing({});
                  form.resetFields();
                }}>{t('pages.purchaseList.addSupplier')}</Button>
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
        title={editing?.id ? t('pages.purchaseList.editSupplier') : t('pages.purchaseList.addSupplier')}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={onSubmit}
        confirmLoading={createMut.isPending || updateMut.isPending}
        width={560}
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="code" label={t('pages.purchaseList.colCode')} rules={[{ required: true }]}><Input disabled={!!editing?.id} /></Form.Item></Col>
            <Col span={12}><Form.Item name="name" label={t('pages.purchaseList.colName')} rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="contact" label={t('pages.purchaseList.colContact')}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="phone" label={t('pages.purchaseList.colPhone')}><Input /></Form.Item></Col>
            <Col span={24}><Form.Item name="email" label={t('pages.purchaseList.colEmail')}><Input /></Form.Item></Col>
            <Col span={24}><Form.Item name="address" label={t('pages.purchaseList.colAddress')}><Input.TextArea rows={2} /></Form.Item></Col>
            <Col span={12}><Form.Item name="status" label={t('common.status')} initialValue={1}><Select options={[{ label: t('pages.purchaseList.statusEnabled'), value: 1 }, { label: t('pages.purchaseList.statusDisabled'), value: 0 }]} /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
}

// ============ 采购单 Tab ============
function PurchaseTab() {
  const { t } = useTranslation();
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
      message.success(t('pages.purchaseList.purchaseCreated'));
      setCreateOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['purchases'] });
    },
  });
  const approveMut = useMutation({
    mutationFn: purchaseApi.approve,
    onSuccess: () => {
      message.success(t('pages.purchaseList.approved'));
      qc.invalidateQueries({ queryKey: ['purchases'] });
    },
  });
  const receiveMut = useMutation({
    mutationFn: (vars: { id: string; data: { warehouseId: string } }) =>
      purchaseApi.receive(vars.id, vars.data),
    onSuccess: () => {
      message.success(t('pages.purchaseList.receivedSuccess'));
      qc.invalidateQueries({ queryKey: ['purchases'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory-logs'] });
    },
  });
  const cancelMut = useMutation({
    mutationFn: purchaseApi.cancel,
    onSuccess: () => {
      message.success(t('pages.purchaseList.cancelled'));
      qc.invalidateQueries({ queryKey: ['purchases'] });
    },
  });

  const statusMap: Record<string, { color: string; text: string }> = {
    draft: { color: 'default', text: t('pages.purchaseList.statusDraft') },
    approved: { color: 'blue', text: t('pages.purchaseList.statusApproved') },
    arrived: { color: 'green', text: t('pages.purchaseList.statusArrived') },
    cancel: { color: 'red', text: t('pages.purchaseList.statusCancelled') },
  };

  const columns = [
    { title: t('pages.purchaseList.colPurchaseNo'), dataIndex: 'purchaseNo', width: 180 },
    { title: t('pages.purchaseList.colSupplier'), dataIndex: ['supplier', 'name'], width: 160 },
    { title: t('pages.purchaseList.colInboundWarehouse'), dataIndex: ['warehouse', 'name'], width: 140 },
    {
      title: t('pages.purchaseList.colProductCount'),
      width: 90,
      render: (_: any, r: any) => t('pages.purchaseList.productCountValue', { count: r.items?.length || 0 }),
    },
    {
      title: t('pages.purchaseList.colTotalAmount'),
      dataIndex: 'totalAmount',
      width: 120,
      align: 'right' as const,
      render: (v: number, r: any) => `${r.currency} ${(+v).toFixed(2)}`,
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 100,
      render: (v: string) => <Tag color={statusMap[v]?.color}>{statusMap[v]?.text || v}</Tag>,
    },
    {
      title: t('pages.purchaseList.colCreatedAt'),
      dataIndex: 'createdAt',
      width: 160,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      title: t('common.operation'),
      width: 260,
      fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Space size="small">
          <Button size="small" type="link" onClick={async () => {
            const d = await purchaseApi.detail(r.id);
            setDetail(d);
          }}>{t('common.detail')}</Button>
          {has('purchase:approve') && r.status === 'draft' && (
            <>
              <Button size="small" type="link" icon={<CheckOutlined />} onClick={() => approveMut.mutate(r.id)}>{t('pages.purchaseList.actionApprove')}</Button>
              <Button size="small" type="link" danger onClick={() => cancelMut.mutate(r.id)}>{t('common.cancel')}</Button>
            </>
          )}
          {has('inventory:adjust') && r.status === 'approved' && (
            <Button size="small" type="link" icon={<ImportOutlined />} onClick={() => receiveMut.mutate({ id: r.id, data: { warehouseId: r.warehouseId } })}>{t('pages.purchaseList.actionReceive')}</Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 12 }}>
        <Col span={6}><Card bordered={false}><Statistic title={t('pages.purchaseList.statPurchaseTotal')} value={data?.total || 0} prefix={<TeamOutlined />} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title={t('pages.purchaseList.statSuppliers')} value={(suppliers || []).length} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title={t('pages.purchaseList.statWarehouses')} value={(warehouses || []).length} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title={t('pages.purchaseList.statSku')} value={(products?.total || 0)} /></Card></Col>
      </Row>
      <Card bordered={false}>
        <Form
          layout="inline"
          onFinish={(v) => setFilters((f: any) => ({ ...f, ...v, page: 1 }))}
        >
          <Form.Item name="status">
            <Select
              placeholder={t('common.status')} allowClear style={{ width: 140 }}
              options={Object.entries(statusMap).map(([k, v]) => ({ label: v.text, value: k }))}
            />
          </Form.Item>
          <Form.Item name="supplierId">
            <Select
              placeholder={t('pages.purchaseList.colSupplier')} allowClear style={{ width: 180 }}
              options={(suppliers || []).map((s: any) => ({ label: s.name, value: s.id }))}
            />
          </Form.Item>
          <Form.Item name="keyword">
            <Input placeholder={t('pages.purchaseList.colPurchaseNo')} allowClear style={{ width: 180 }} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">{t('common.filter')}</Button>
              <Button onClick={() => setFilters({ page: 1, pageSize: 10 })} icon={<ReloadOutlined />}>{t('common.reset')}</Button>
              {has('purchase:create') && (
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>{t('pages.purchaseList.createPurchase')}</Button>
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
        title={t('pages.purchaseList.createPurchase')}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
        width={760}
      >
        <Form form={form} layout="vertical" onFinish={(v) => createMut.mutate(v)}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="supplierId" label={t('pages.purchaseList.colSupplier')} rules={[{ required: true }]}>
                <Select
                  placeholder={t('pages.purchaseList.selectSupplier')}
                  options={(suppliers || []).map((s: any) => ({ label: s.name, value: s.id }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="warehouseId" label={t('pages.purchaseList.colInboundWarehouse')} rules={[{ required: true }]}>
                <Select
                  placeholder={t('pages.purchaseList.selectWarehouse')}
                  options={(warehouses || []).map((w: any) => ({ label: w.name, value: w.id }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="currency" label={t('common.currency')} initialValue="CNY">
                <Select options={[{ label: 'CNY', value: 'CNY' }, { label: 'USD', value: 'USD' }, { label: 'EUR', value: 'EUR' }]} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label={t('pages.purchaseList.labelPurchaseItems')} required>
            <Form.List name="items">
              {(fields, { add, remove }) => (
                <>
                  {fields.map((f) => (
                    <Row gutter={8} key={f.key} style={{ marginBottom: 8 }}>
                      <Col span={10}>
                        <Form.Item {...f} name={[f.name, 'productId']} rules={[{ required: true }]} noStyle>
                          <Select
                            showSearch
                            placeholder={t('pages.purchaseList.colProduct')}
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
                          <InputNumber min={1} style={{ width: '100%' }} placeholder={t('pages.purchaseList.colQuantity')} />
                        </Form.Item>
                      </Col>
                      <Col span={7}>
                        <Form.Item {...f} name={[f.name, 'unitPrice']} rules={[{ required: true }]} noStyle>
                          <InputNumber min={0} step={0.01} style={{ width: '100%' }} placeholder={t('pages.purchaseList.colUnitPrice')} />
                        </Form.Item>
                      </Col>
                      <Col span={2}><Button danger onClick={() => remove(f.name)}>{t('pages.purchaseList.actionRemoveItem')}</Button></Col>
                    </Row>
                  ))}
                  <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ quantity: 1, unitPrice: 0 })}>{t('pages.purchaseList.addProduct')}</Button>
                </>
              )}
            </Form.List>
          </Form.Item>
          <Form.Item name="remark" label={t('pages.purchaseList.labelRemark')}><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t('pages.purchaseList.detailTitleWithNo', { no: detail?.purchaseNo || '' })}
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={null}
        width={760}
      >
        {detail && (
          <>
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label={t('pages.purchaseList.colSupplier')}>{detail.supplier?.name}</Descriptions.Item>
              <Descriptions.Item label={t('pages.purchaseList.colInboundWarehouse')}>{detail.warehouse?.name}</Descriptions.Item>
              <Descriptions.Item label={t('pages.purchaseList.colTotalAmount')}>{detail.currency} {(+detail.totalAmount).toFixed(2)}</Descriptions.Item>
              <Descriptions.Item label={t('common.status')}>
                <Tag color={statusMap[detail.status]?.color}>{statusMap[detail.status]?.text}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t('pages.purchaseList.colCreatedAt')}>{dayjs(detail.createdAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
              <Descriptions.Item label={t('pages.purchaseList.labelRemark')} span={2}>{detail.remark || '-'}</Descriptions.Item>
            </Descriptions>
            <Table
              size="small"
              style={{ marginTop: 12 }}
              dataSource={detail.items || []}
              rowKey="id"
              pagination={false}
              columns={[
                { title: 'SKU', dataIndex: ['product', 'sku'], width: 160 },
                { title: t('pages.purchaseList.colProduct'), dataIndex: ['product', 'name'] },
                { title: t('pages.purchaseList.colQuantity'), dataIndex: 'quantity', width: 100, align: 'right' as const },
                { title: t('pages.purchaseList.colUnitPrice'), dataIndex: 'unitPrice', width: 100, align: 'right' as const, render: (v: number) => (+v).toFixed(2) },
                { title: t('pages.purchaseList.colItemAmount'), dataIndex: 'amount', width: 120, align: 'right' as const, render: (v: number) => (+v).toFixed(2) },
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
  const { t } = useTranslation();
  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>{t('pages.purchaseList.pageTitle')}</Title>
      <Text type="secondary">{t('pages.purchaseList.pageSubtitle')}</Text>
      <Tabs
        style={{ marginTop: 12 }}
        defaultActiveKey="supplier"
        items={[
          { key: 'supplier', label: t('pages.purchaseList.tabSupplier'), children: <SupplierTab /> },
          { key: 'order', label: t('pages.purchaseList.tabPurchaseOrder'), children: <PurchaseTab /> },
        ]}
      />
    </div>
  );
}
