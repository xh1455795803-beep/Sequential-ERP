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
import { useTranslation } from '../i18n';

const { Title, Text } = Typography;

// ============ 库存清单 Tab ============
function InventoryTab() {
  const { t } = useTranslation();
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
      message.success(t('pages.inventoryList.adjust.success'));
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
      message.success(t('pages.inventoryList.safety.success'));
      setSafetyOpen(null);
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });

  const columns = [
    {
      title: t('pages.inventoryList.product'),
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
    { title: t('pages.inventoryList.warehouse'), dataIndex: ['warehouse', 'name'], width: 140 },
    { title: t('pages.inventoryList.totalStock'), dataIndex: 'quantity', width: 90, align: 'right' as const },
    { title: t('pages.inventoryList.available'), dataIndex: 'available', width: 90, align: 'right' as const, render: (v: number) => <b>{v}</b> },
    { title: t('pages.inventoryList.locked'), dataIndex: 'locked', width: 90, align: 'right' as const },
    { title: t('pages.inventoryList.safetyStock'), dataIndex: 'safetyStock', width: 100, align: 'right' as const },
    {
      title: t('pages.inventoryList.health'),
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
      title: t('pages.inventoryList.warning'),
      width: 100,
      render: (_: any, r: any) =>
        r.available <= r.safetyStock ? (
          <Tag icon={<WarningOutlined />} color="red">{t('pages.inventoryList.needsRestock')}</Tag>
        ) : (
          <Tag color="green">{t('pages.inventoryList.normal')}</Tag>
        ),
    },
    {
      title: t('pages.inventoryList.action'),
      width: 180,
      fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Space size="small">
          {has('inventory:adjust') && (
            <Button size="small" type="link" onClick={() => {
              setSafetyOpen(r);
              safetyForm.setFieldsValue({ safetyStock: r.safetyStock });
            }}>{t('pages.inventoryList.setSafetyStock')}</Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 12 }}>
        <Col span={6}><Card bordered={false}><Statistic title={t('pages.inventoryList.stat.skuWarehouses')} value={summary?.total || 0} suffix={t('pages.inventoryList.stat.itemsSuffix')} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title={t('pages.inventoryList.stat.totalQty')} value={summary?.totalQty || 0} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title={t('pages.inventoryList.stat.available')} value={summary?.totalAvailable || 0} valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title={t('pages.inventoryList.stat.lowSku')} value={summary?.lowCount || 0} valueStyle={{ color: '#f5222d' }} prefix={<WarningOutlined />} /></Card></Col>
      </Row>

      <Card bordered={false}>
        <Form
          layout="inline"
          onFinish={(v) => setFilters((f: any) => ({ ...f, ...v, page: 1 }))}
        >
          <Form.Item name="keyword">
            <Input placeholder={t('pages.inventoryList.filter.skuProduct')} allowClear prefix={<SearchOutlined />} style={{ width: 240 }} />
          </Form.Item>
          <Form.Item name="warehouseId">
            <Select
              placeholder={t('pages.inventoryList.filter.selectWarehouse')}
              allowClear
              style={{ width: 180 }}
              options={(warehouses || []).map((w: any) => ({ label: w.name, value: w.id }))}
            />
          </Form.Item>
          <Form.Item name="lowStock" valuePropName="checked">
            <Select
              placeholder={t('pages.inventoryList.warning')}
              allowClear
              style={{ width: 140 }}
              options={[
                { label: t('pages.inventoryList.filter.onlyRestock'), value: 'true' },
                { label: t('pages.inventoryList.filter.onlyNormal'), value: 'false' },
              ]}
            />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">{t('pages.inventoryList.filter.submit')}</Button>
              <Button onClick={() => setFilters({ page: 1, pageSize: 10 })} icon={<ReloadOutlined />}>{t('pages.inventoryList.reset')}</Button>
              {has('inventory:adjust') && (
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdjustOpen(true)}>
                  {t('pages.inventoryList.adjust.button')}
                </Button>
              )}
            </Space>
          </Form.Item>
        </Form>
      </Card>

      <Card style={{ marginTop: 16 }} bordered={false} title={t('pages.inventoryList.inventoryData')}>
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
            showTotal: (count) => t('pages.inventoryList.paginationTotal', { count }),
            onChange: (page, pageSize) => setFilters((f: any) => ({ ...f, page, pageSize })),
          }}
        />
      </Card>

      {/* 库存调整弹窗 */}
      <Modal
        title={t('pages.inventoryList.adjust.modalTitle')}
        open={adjustOpen}
        onCancel={() => setAdjustOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={adjustMut.isPending}
        width={520}
      >
        <Form form={form} layout="vertical" onFinish={(v) => adjustMut.mutate(v)}>
          <Form.Item name="productId" label={t('pages.inventoryList.product')} rules={[{ required: true }]}>
            <Select
              showSearch
              placeholder={t('pages.inventoryList.adjust.selectProduct')}
              optionFilterProp="label"
              options={(products?.items || []).map((p: any) => ({
                label: `${p.sku} - ${p.name}`,
                value: p.id,
              }))}
            />
          </Form.Item>
          <Form.Item name="warehouseId" label={t('pages.inventoryList.warehouse')} rules={[{ required: true }]}>
            <Select
              placeholder={t('pages.inventoryList.filter.selectWarehouse')}
              options={(warehouses || []).map((w: any) => ({ label: w.name, value: w.id }))}
            />
          </Form.Item>
          <Form.Item name="type" label={t('pages.inventoryList.type')} rules={[{ required: true }]} initialValue="in">
            <Select
              options={[
                { label: t('pages.inventoryList.log.type.inboundAdd'), value: 'in' },
                { label: t('pages.inventoryList.log.type.outboundSub'), value: 'out' },
                { label: t('pages.inventoryList.log.type.adjust'), value: 'adjust' },
              ]}
            />
          </Form.Item>
          <Form.Item name="delta" label={t('pages.inventoryList.adjust.qtyLabel')} rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} placeholder={t('pages.inventoryList.adjust.qtyPlaceholder')} />
          </Form.Item>
          <Form.Item name="remark" label={t('pages.inventoryList.remark')}>
            <Input.TextArea rows={2} placeholder={t('pages.inventoryList.adjust.remarkPlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 安全库存弹窗 */}
      <Modal
        title={t('pages.inventoryList.safety.modalTitle')}
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
          <Form.Item name="safetyStock" label={t('pages.inventoryList.safety.threshold')} rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

// ============ 调拨单 Tab ============
function TransferTab() {
  const { t } = useTranslation();
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
      message.success(t('pages.inventoryList.transfer.created'));
      setCreateOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['transfers'] });
    },
  });
  const shipMut = useMutation({
    mutationFn: inventoryApi.shipTransfer,
    onSuccess: () => {
      message.success(t('pages.inventoryList.transfer.shipped'));
      qc.invalidateQueries({ queryKey: ['transfers'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory-logs'] });
      setDetail(null);
    },
  });
  const receiveMut = useMutation({
    mutationFn: inventoryApi.receiveTransfer,
    onSuccess: () => {
      message.success(t('pages.inventoryList.transfer.received'));
      qc.invalidateQueries({ queryKey: ['transfers'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory-logs'] });
      setDetail(null);
    },
  });
  const cancelMut = useMutation({
    mutationFn: inventoryApi.cancelTransfer,
    onSuccess: () => {
      message.success(t('pages.inventoryList.transfer.cancelled'));
      qc.invalidateQueries({ queryKey: ['transfers'] });
    },
  });

  const statusMap: Record<string, { color: string; text: string }> = {
    draft: { color: 'default', text: t('pages.inventoryList.transfer.status.draft') },
    shipped: { color: 'blue', text: t('pages.inventoryList.transfer.status.shipped') },
    received: { color: 'green', text: t('pages.inventoryList.transfer.status.received') },
    cancel: { color: 'red', text: t('pages.inventoryList.transfer.status.cancel') },
  };

  const columns = [
    { title: t('pages.inventoryList.transfer.transferNo'), dataIndex: 'transferNo', width: 180 },
    { title: t('pages.inventoryList.transfer.fromWarehouse'), dataIndex: ['fromWarehouse', 'name'], width: 140 },
    { title: t('pages.inventoryList.transfer.toWarehouse'), dataIndex: ['toWarehouse', 'name'], width: 140 },
    {
      title: t('pages.inventoryList.productCount'),
      width: 100,
      render: (_: any, r: any) => t('pages.inventoryList.productCountValue', { count: r.items?.length || 0 }),
    },
    {
      title: t('pages.inventoryList.status'),
      dataIndex: 'status',
      width: 100,
      render: (v: string) => <Tag color={statusMap[v]?.color}>{statusMap[v]?.text || v}</Tag>,
    },
    {
      title: t('pages.inventoryList.createdAt'),
      dataIndex: 'createdAt',
      width: 160,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-',
    },
    { title: t('pages.inventoryList.remark'), dataIndex: 'remark', ellipsis: true },
    {
      title: t('pages.inventoryList.action'),
      width: 220,
      fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Space size="small">
          <Button size="small" type="link" onClick={async () => {
            const d = await inventoryApi.transferDetail(r.id);
            setDetail(d);
          }}>{t('pages.inventoryList.detail')}</Button>
          {has('inventory:transfer') && r.status === 'draft' && (
            <>
              <Button size="small" type="link" onClick={() => shipMut.mutate(r.id)}>{t('pages.inventoryList.transfer.ship')}</Button>
              <Button size="small" type="link" danger onClick={() => cancelMut.mutate(r.id)}>{t('pages.inventoryList.transfer.cancel')}</Button>
            </>
          )}
          {has('inventory:transfer') && r.status === 'shipped' && (
            <Button size="small" type="link" onClick={() => receiveMut.mutate(r.id)}>{t('pages.inventoryList.transfer.receive')}</Button>
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
              placeholder={t('pages.inventoryList.status')}
              allowClear
              style={{ width: 140 }}
              options={[
                { label: t('pages.inventoryList.transfer.status.draft'), value: 'draft' },
                { label: t('pages.inventoryList.transfer.status.shipped'), value: 'shipped' },
                { label: t('pages.inventoryList.transfer.status.received'), value: 'received' },
                { label: t('pages.inventoryList.transfer.status.cancel'), value: 'cancel' },
              ]}
            />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">{t('pages.inventoryList.filter.submit')}</Button>
              <Button onClick={() => setFilters({ page: 1, pageSize: 10 })} icon={<ReloadOutlined />}>{t('pages.inventoryList.reset')}</Button>
              {has('inventory:transfer') && (
                <Button type="primary" icon={<SwapOutlined />} onClick={() => setCreateOpen(true)}>
                  {t('pages.inventoryList.transfer.createButton')}
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
        title={t('pages.inventoryList.transfer.createTitle')}
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
              <Form.Item name="fromWarehouseId" label={t('pages.inventoryList.transfer.fromWarehouse')} rules={[{ required: true }]}>
                <Select
                  placeholder={t('pages.inventoryList.transfer.selectFromWarehouse')}
                  options={(warehouses || []).map((w: any) => ({ label: w.name, value: w.id }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="toWarehouseId" label={t('pages.inventoryList.transfer.toWarehouse')} rules={[{ required: true }]}>
                <Select
                  placeholder={t('pages.inventoryList.transfer.selectToWarehouse')}
                  options={(warehouses || []).map((w: any) => ({ label: w.name, value: w.id }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label={t('pages.inventoryList.transfer.itemsLabel')} required>
            <Form.List name="items">
              {(fields, { add, remove }) => (
                <>
                  {fields.map((f) => (
                    <Row gutter={8} key={f.key} style={{ marginBottom: 8 }}>
                      <Col span={14}>
                        <Form.Item
                          {...f}
                          name={[f.name, 'productId']}
                          rules={[{ required: true, message: t('pages.inventoryList.validation.selectProduct') }]}
                          noStyle
                        >
                          <Select
                            showSearch
                            placeholder={t('pages.inventoryList.product')}
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
                          rules={[{ required: true, message: t('pages.inventoryList.validation.enterQty') }]}
                          noStyle
                        >
                          <InputNumber min={1} style={{ width: '100%' }} placeholder={t('pages.inventoryList.qty')} />
                        </Form.Item>
                      </Col>
                      <Col span={2}>
                        <Button danger onClick={() => remove(f.name)}>{t('pages.inventoryList.remove')}</Button>
                      </Col>
                    </Row>
                  ))}
                  <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ quantity: 1 })}>
                    {t('pages.inventoryList.addProduct')}
                  </Button>
                </>
              )}
            </Form.List>
          </Form.Item>
          <Form.Item name="remark" label={t('pages.inventoryList.remark')}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 详情 */}
      <Modal
        title={t('pages.inventoryList.transfer.detailTitle', { no: detail?.transferNo || '' })}
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={null}
        width={720}
      >
        {detail && (
          <>
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label={t('pages.inventoryList.transfer.fromWarehouse')}>{detail.fromWarehouse?.name}</Descriptions.Item>
              <Descriptions.Item label={t('pages.inventoryList.transfer.toWarehouse')}>{detail.toWarehouse?.name}</Descriptions.Item>
              <Descriptions.Item label={t('pages.inventoryList.status')}>
                <Tag color={statusMap[detail.status]?.color}>{statusMap[detail.status]?.text || detail.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t('pages.inventoryList.createdAt')}>{dayjs(detail.createdAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
              {detail.shipTime && <Descriptions.Item label={t('pages.inventoryList.transfer.shipTime')}>{dayjs(detail.shipTime).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>}
              {detail.receiveTime && <Descriptions.Item label={t('pages.inventoryList.transfer.receiveTime')}>{dayjs(detail.receiveTime).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>}
              <Descriptions.Item label={t('pages.inventoryList.remark')} span={2}>{detail.remark || '-'}</Descriptions.Item>
            </Descriptions>
            <Table
              size="small"
              style={{ marginTop: 12 }}
              dataSource={detail.items || []}
              rowKey="id"
              pagination={false}
              columns={[
                { title: 'SKU', dataIndex: ['product', 'sku'], width: 160 },
                { title: t('pages.inventoryList.product'), dataIndex: ['product', 'name'] },
                { title: t('pages.inventoryList.qty'), dataIndex: 'quantity', width: 100, align: 'right' as const },
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
  const { t } = useTranslation();
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
      message.success(t('pages.inventoryList.check.created'));
      setCreateOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['checks'] });
    },
  });
  const applyMut = useMutation({
    mutationFn: inventoryApi.applyCheck,
    onSuccess: () => {
      message.success(t('pages.inventoryList.check.applied'));
      qc.invalidateQueries({ queryKey: ['checks'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory-logs'] });
    },
  });

  const statusMap: Record<string, { color: string; text: string }> = {
    draft: { color: 'default', text: t('pages.inventoryList.check.status.draft') },
    done: { color: 'green', text: t('pages.inventoryList.check.status.done') },
    cancel: { color: 'red', text: t('pages.inventoryList.check.status.cancel') },
  };

  const columns = [
    { title: t('pages.inventoryList.check.checkNo'), dataIndex: 'checkNo', width: 180 },
    { title: t('pages.inventoryList.warehouse'), dataIndex: ['warehouse', 'name'], width: 160 },
    {
      title: t('pages.inventoryList.productCount'),
      width: 100,
      render: (_: any, r: any) => t('pages.inventoryList.productCountValue', { count: r.items?.length || 0 }),
    },
    {
      title: t('pages.inventoryList.status'),
      dataIndex: 'status',
      width: 100,
      render: (v: string) => <Tag color={statusMap[v]?.color}>{statusMap[v]?.text || v}</Tag>,
    },
    {
      title: t('pages.inventoryList.createdAt'),
      dataIndex: 'createdAt',
      width: 160,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      title: t('pages.inventoryList.action'),
      width: 220,
      fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Space size="small">
          <Button size="small" type="link" onClick={async () => {
            const d = await inventoryApi.checkDetail(r.id);
            setDetail(d);
          }}>{t('pages.inventoryList.detail')}</Button>
          {has('inventory:stocktaking') && r.status === 'draft' && (
            <Button size="small" type="link" onClick={() => applyMut.mutate(r.id)}>{t('pages.inventoryList.check.confirm')}</Button>
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
              placeholder={t('pages.inventoryList.status')}
              allowClear
              style={{ width: 140 }}
              options={[
                { label: t('pages.inventoryList.check.status.draft'), value: 'draft' },
                { label: t('pages.inventoryList.check.status.done'), value: 'done' },
                { label: t('pages.inventoryList.check.status.cancel'), value: 'cancel' },
              ]}
            />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">{t('pages.inventoryList.filter.submit')}</Button>
              <Button onClick={() => setFilters({ page: 1, pageSize: 10 })} icon={<ReloadOutlined />}>{t('pages.inventoryList.reset')}</Button>
              {has('inventory:stocktaking') && (
                <Button type="primary" icon={<ScanOutlined />} onClick={() => setCreateOpen(true)}>
                  {t('pages.inventoryList.check.createButton')}
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
        title={t('pages.inventoryList.check.createTitle')}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
        width={680}
      >
        <Form form={form} layout="vertical" onFinish={(v) => createMut.mutate(v)}>
          <Form.Item name="warehouseId" label={t('pages.inventoryList.check.warehouse')} rules={[{ required: true }]}>
            <Select
              placeholder={t('pages.inventoryList.filter.selectWarehouse')}
              options={(warehouses || []).map((w: any) => ({ label: w.name, value: w.id }))}
            />
          </Form.Item>
          <Form.Item label={t('pages.inventoryList.check.itemsLabel')} required>
            <Form.List name="items">
              {(fields, { add, remove }) => (
                <>
                  {fields.map((f) => (
                    <Row gutter={8} key={f.key} style={{ marginBottom: 8 }}>
                      <Col span={16}>
                        <Form.Item
                          {...f}
                          name={[f.name, 'productId']}
                          rules={[{ required: true, message: t('pages.inventoryList.validation.selectProduct') }]}
                          noStyle
                        >
                          <Select
                            showSearch
                            placeholder={t('pages.inventoryList.product')}
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
                          rules={[{ required: true, message: t('pages.inventoryList.validation.enterActualQty') }]}
                          noStyle
                        >
                          <InputNumber min={0} style={{ width: '100%' }} placeholder={t('pages.inventoryList.check.actualQty')} />
                        </Form.Item>
                      </Col>
                      <Col span={2}>
                        <Button danger onClick={() => remove(f.name)}>{t('pages.inventoryList.remove')}</Button>
                      </Col>
                    </Row>
                  ))}
                  <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ actualQty: 0 })}>
                    {t('pages.inventoryList.addProduct')}
                  </Button>
                </>
              )}
            </Form.List>
          </Form.Item>
          <Form.Item name="remark" label={t('pages.inventoryList.remark')}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t('pages.inventoryList.check.detailTitle', { no: detail?.checkNo || '' })}
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={null}
        width={760}
      >
        {detail && (
          <>
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label={t('pages.inventoryList.warehouse')}>{detail.warehouse?.name}</Descriptions.Item>
              <Descriptions.Item label={t('pages.inventoryList.status')}>
                <Tag color={statusMap[detail.status]?.color}>{statusMap[detail.status]?.text || detail.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t('pages.inventoryList.createdAt')}>{dayjs(detail.createdAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
              {detail.checkedAt && <Descriptions.Item label={t('pages.inventoryList.check.checkedAt')}>{dayjs(detail.checkedAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>}
              <Descriptions.Item label={t('pages.inventoryList.remark')} span={2}>{detail.remark || '-'}</Descriptions.Item>
            </Descriptions>
            <Table
              size="small"
              style={{ marginTop: 12 }}
              dataSource={detail.items || []}
              rowKey="id"
              pagination={false}
              columns={[
                { title: 'SKU', dataIndex: ['product', 'sku'], width: 160 },
                { title: t('pages.inventoryList.product'), dataIndex: ['product', 'name'] },
                { title: t('pages.inventoryList.check.systemQty'), dataIndex: 'systemQty', width: 100, align: 'right' as const },
                { title: t('pages.inventoryList.check.actualQty'), dataIndex: 'actualQty', width: 100, align: 'right' as const },
                {
                  title: t('pages.inventoryList.check.diff'),
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
  const { t } = useTranslation();
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
    in: { color: 'green', text: t('pages.inventoryList.log.type.in'), icon: <ImportOutlined /> },
    out: { color: 'red', text: t('pages.inventoryList.log.type.out'), icon: <ExportOutlined /> },
    adjust: { color: 'blue', text: t('pages.inventoryList.log.type.adjust'), icon: <ScanOutlined /> },
    lock: { color: 'orange', text: t('pages.inventoryList.log.type.lock'), icon: <ScanOutlined /> },
    unlock: { color: 'cyan', text: t('pages.inventoryList.log.type.unlock'), icon: <ScanOutlined /> },
  };
  const sourceMap: Record<string, string> = {
    manual: t('pages.inventoryList.log.source.manual'),
    order: t('pages.inventoryList.log.source.order'),
    transfer: t('pages.inventoryList.log.source.transfer'),
    check: t('pages.inventoryList.log.source.check'),
  };

  const columns = [
    {
      title: t('pages.inventoryList.log.time'),
      dataIndex: 'createdAt',
      width: 160,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-',
    },
    { title: t('pages.inventoryList.product'), dataIndex: ['product', 'name'], render: (_: any, r: any) => (
        <div>
          <div>{r.product?.name}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>{r.product?.sku}</Text>
        </div>
      )
    },
    { title: t('pages.inventoryList.warehouse'), dataIndex: ['warehouse', 'name'], width: 140 },
    {
      title: t('pages.inventoryList.type'),
      dataIndex: 'type',
      width: 90,
      render: (v: string) => <Tag color={typeMap[v]?.color} icon={typeMap[v]?.icon}>{typeMap[v]?.text || v}</Tag>,
    },
    {
      title: t('pages.inventoryList.log.qty'),
      dataIndex: 'quantity',
      width: 90,
      align: 'right' as const,
      render: (v: number) => v > 0 ? <span style={{ color: '#52c41a' }}>+{v}</span> : <span style={{ color: '#f5222d' }}>{v}</span>,
    },
    { title: t('pages.inventoryList.log.before'), dataIndex: 'beforeQty', width: 90, align: 'right' as const },
    { title: t('pages.inventoryList.log.after'), dataIndex: 'afterQty', width: 90, align: 'right' as const },
    { title: t('pages.inventoryList.log.sourceLabel'), dataIndex: 'source', width: 80, render: (v: string) => sourceMap[v] || v },
    { title: t('pages.inventoryList.log.refId'), dataIndex: 'refId', width: 180, ellipsis: true },
    { title: t('pages.inventoryList.remark'), dataIndex: 'remark', ellipsis: true },
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
              placeholder={t('pages.inventoryList.type')}
              allowClear
              style={{ width: 120 }}
              options={[
                { label: t('pages.inventoryList.log.type.in'), value: 'in' },
                { label: t('pages.inventoryList.log.type.out'), value: 'out' },
                { label: t('pages.inventoryList.log.type.adjust'), value: 'adjust' },
              ]}
            />
          </Form.Item>
          <Form.Item name="warehouseId">
            <Select
              placeholder={t('pages.inventoryList.warehouse')}
              allowClear
              style={{ width: 180 }}
              options={(warehouses || []).map((w: any) => ({ label: w.name, value: w.id }))}
            />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">{t('pages.inventoryList.filter.submit')}</Button>
              <Button onClick={() => setFilters({ page: 1, pageSize: 20 })} icon={<ReloadOutlined />}>{t('pages.inventoryList.reset')}</Button>
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
  const { t } = useTranslation();
  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>{t('pages.inventoryList.title')}</Title>
      <Text type="secondary">{t('pages.inventoryList.subtitle')}</Text>
      <Tabs
        style={{ marginTop: 12 }}
        defaultActiveKey="list"
        items={[
          { key: 'list', label: t('pages.inventoryList.tab.list'), children: <InventoryTab /> },
          { key: 'transfer', label: t('pages.inventoryList.tab.transfer'), children: <TransferTab /> },
          { key: 'check', label: t('pages.inventoryList.tab.check'), children: <CheckTab /> },
          { key: 'log', label: t('pages.inventoryList.tab.log'), children: <LogsTab /> },
        ]}
      />
    </div>
  );
}