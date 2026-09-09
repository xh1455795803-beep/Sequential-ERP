import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Table,
  Tag,
  Space,
  Button,
  Input,
  Select,
  Form,
  Row,
  Col,
  Typography,
  Drawer,
  Image,
  InputNumber,
  message,
  Popconfirm,
  Tabs,
  Divider,
  Descriptions,
} from 'antd';
import {
  SearchOutlined,
  ReloadOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
  TagsOutlined,
  DollarOutlined,
  CarOutlined,
  PictureOutlined,
} from '@ant-design/icons';
import { productApi } from '../api';
import { usePermission } from '../hooks/usePermission';

const { Title, Text } = Typography;

const STATUS = [
  { value: 1, label: '在售', color: 'green' },
  { value: 0, label: '下架', color: 'default' },
  { value: 2, label: '违规', color: 'red' },
];
const STATUS_MAP = Object.fromEntries(STATUS.map((s) => [s.value, s]));

const CURRENCIES = ['USD', 'CNY', 'EUR', 'GBP', 'JPY', 'HKD', 'SGD', 'AUD', 'CAD', 'MYR', 'THB', 'VND', 'BRL'];

export default function ProductList() {
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 10 });
  const [editing, setEditing] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState('basic');
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { has } = usePermission();

  const { data, isLoading } = useQuery({
    queryKey: ['products', filters],
    queryFn: () => productApi.list(filters),
  });

  const createMut = useMutation({
    mutationFn: productApi.create,
    onSuccess: () => {
      message.success('创建成功');
      qc.invalidateQueries({ queryKey: ['products'] });
      setEditing(null);
    },
  });
  const updateMut = useMutation({
    mutationFn: (vars: { id: string; data: any }) => productApi.update(vars.id, vars.data),
    onSuccess: () => {
      message.success('更新成功');
      qc.invalidateQueries({ queryKey: ['products'] });
      setEditing(null);
    },
  });
  const removeMut = useMutation({
    mutationFn: productApi.remove,
    onSuccess: () => {
      message.success('删除成功');
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });

  const onSubmit = async () => {
    try {
      const vals = await form.validateFields();
      // 去除空字符串字段
      const cleaned: any = {};
      for (const [k, v] of Object.entries(vals)) {
        if (v !== undefined && v !== null && v !== '') cleaned[k] = v;
      }
      if (editing?.id) {
        updateMut.mutate({ id: editing.id, data: cleaned });
      } else {
        createMut.mutate(cleaned);
      }
    } catch (e) {
      // 校验失败: 定位到出错的 Tab
      setActiveTab('basic');
    }
  };

  const openCreate = () => {
    setEditing({});
    setActiveTab('basic');
    form.resetFields();
    form.setFieldsValue({ status: 1, currency: 'USD' });
  };
  const openEdit = (row: any) => {
    setEditing(row);
    setActiveTab('basic');
    form.setFieldsValue(row);
  };

  const columns = [
    {
      title: '图片',
      dataIndex: 'image',
      width: 70,
      render: (v: string) => (v ? <Image src={v} width={40} height={40} style={{ borderRadius: 4 }} /> : '-'),
    },
    { title: 'SKU', dataIndex: 'sku', width: 130, fixed: 'left' as const },
    { title: '商品名称', dataIndex: 'name', width: 220, ellipsis: true },
    { title: '类目', dataIndex: 'category', width: 110, render: (v: string) => v || '-' },
    { title: '品牌', dataIndex: 'brand', width: 110, render: (v: string) => v || '-' },
    {
      title: '成本价',
      dataIndex: 'costPrice',
      width: 100,
      align: 'right' as const,
      render: (v: number, r: any) => `${r.currency || 'USD'} ${(+v || 0).toFixed(2)}`,
    },
    {
      title: '售价',
      dataIndex: 'salePrice',
      width: 100,
      align: 'right' as const,
      render: (v: number, r: any) => `${r.currency || 'USD'} ${(+v || 0).toFixed(2)}`,
    },
    {
      title: '毛利率',
      width: 90,
      align: 'right' as const,
      render: (_: any, r: any) => {
        const m = r.costPrice > 0 ? ((r.salePrice - r.costPrice) / r.salePrice) * 100 : 0;
        return <Tag color={m > 40 ? 'green' : m > 20 ? 'blue' : 'orange'}>{m.toFixed(1)}%</Tag>;
      },
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
      title: '操作',
      key: 'op',
      width: 140,
      fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Space>
          {has('product:update') && (
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>
              编辑
            </Button>
          )}
          {has('product:delete') && (
            <Popconfirm
              title="确认删除该商品?"
              onConfirm={() => removeMut.mutate(r.id)}
            >
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const inputStyle = { width: '100%' };

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>SKU 列表</Title>
      <Text type="secondary">内部 SKU 库 · 共 {data?.total || 0} 条</Text>

      <Card style={{ marginTop: 16 }} bordered={false}>
        <Form
          layout="inline"
          onFinish={(v) => setFilters((f: any) => ({ ...f, ...v, page: 1 }))}
        >
          <Form.Item name="keyword">
            <Input placeholder="SKU / 商品名 / 品牌" allowClear prefix={<SearchOutlined />} style={{ width: 260 }} />
          </Form.Item>
          <Form.Item name="status">
            <Select placeholder="状态" allowClear style={{ width: 140 }} options={STATUS.map((s) => ({ label: s.label, value: s.value }))} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">筛选</Button>
              <Button
                onClick={() =>
                  setFilters({ page: 1, pageSize: 10 })
                }
                icon={<ReloadOutlined />}
              >
                重置
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      <Card
        style={{ marginTop: 16 }}
        bordered={false}
        title="商品数据"
        extra={
          has('product:create') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增商品
            </Button>
          )
        }
      >
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

      {/* ===== 完整商品编辑抽屉 (参照妙手 ERP 商品编辑) ===== */}
      <Drawer
        title={
          <Space>
            {editing?.id ? <EditOutlined /> : <PlusOutlined />}
            {editing?.id ? `编辑商品 · ${editing.sku}` : '新增商品'}
          </Space>
        }
        width={760}
        open={!!editing}
        onClose={() => setEditing(null)}
        destroyOnClose={false}
        footer={
          <div style={{ textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setEditing(null)}>取消</Button>
              <Button
                type="primary"
                loading={createMut.isPending || updateMut.isPending}
                onClick={onSubmit}
              >
                保 存
              </Button>
            </Space>
          </div>
        }
      >
        {editing && (
          <Form form={form} layout="vertical" requiredMark={false} preserve={false}>
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              items={[
                {
                  key: 'basic',
                  label: (
                    <span><TagsOutlined /> 基本信息</span>
                  ),
                  children: (
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item name="sku" label="SKU 编码" rules={[{ required: true, message: '请输入 SKU' }]}
                          extra={editing?.id ? 'SKU 创建后不可修改' : undefined}>
                          <Input placeholder="例如 SKU-10001" disabled={!!editing?.id} style={inputStyle} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="name" label="商品名称" rules={[{ required: true, message: '请输入商品名称' }]}>
                          <Input placeholder="商品名称" style={inputStyle} maxLength={200} showCount />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="category" label="商品类目">
                          <Input placeholder="例如 手机壳 / 配件" style={inputStyle} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="brand" label="品牌">
                          <Input placeholder="品牌名称" style={inputStyle} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="status" label="商品状态" initialValue={1}>
                          <Select options={STATUS.map((s) => ({ label: s.label, value: s.value }))} style={inputStyle} />
                        </Form.Item>
                      </Col>
                    </Row>
                  ),
                },
                {
                  key: 'price',
                  label: (
                    <span><DollarOutlined /> 价格与库存</span>
                  ),
                  children: (
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item name="costPrice" label="成本价" tooltip="商品采购成本, 用于利润计算">
                          <InputNumber min={0} step={0.01} style={inputStyle} addonAfter={form.getFieldValue('currency') || 'USD'} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="salePrice" label="售价" rules={[{ required: true, message: '请输入售价' }]}>
                          <InputNumber min={0} step={0.01} style={inputStyle} addonAfter={form.getFieldValue('currency') || 'USD'} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="currency" label="币种" initialValue="USD">
                          <Select
                            options={CURRENCIES.map((c) => ({ label: c, value: c }))}
                            style={inputStyle}
                            onChange={() => form.setFieldsValue(form.getFieldsValue())}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={24}>
                        <Divider titlePlacement="left" orientationMargin={0} plain style={{ fontSize: 13, color: '#86909C' }}>
                          成本利润参考
                        </Divider>
                        <Descriptions size="small" column={3} bordered>
                          <Descriptions.Item label="毛利额">
                            <Text type={(+form.getFieldValue('salePrice') - +form.getFieldValue('costPrice')) >= 0 ? 'success' : 'danger'}>
                              {((+form.getFieldValue('salePrice') || 0) - (+form.getFieldValue('costPrice') || 0)).toFixed(2)}
                            </Text>
                          </Descriptions.Item>
                          <Descriptions.Item label="毛利率">
                            <Text type="success">
                              {(() => {
                                const s = +form.getFieldValue('salePrice') || 0;
                                const c = +form.getFieldValue('costPrice') || 0;
                                return s > 0 ? (((s - c) / s) * 100).toFixed(1) + '%' : '-';
                              })()}
                            </Text>
                          </Descriptions.Item>
                          <Descriptions.Item label="库存数量">
                            <Text>{editing?.id ? '见库存模块' : '创建后可设置'}</Text>
                          </Descriptions.Item>
                        </Descriptions>
                        <div style={{ marginTop: 8 }}>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            <InfoCircleOutlined /> 库存请在「仓库管理 → 库存清单」中按仓库维护
                          </Text>
                        </div>
                      </Col>
                    </Row>
                  ),
                },
                {
                  key: 'logistics',
                  label: (
                    <span><CarOutlined /> 物流信息</span>
                  ),
                  children: (
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item name="weight" label="重量 (kg)">
                          <InputNumber min={0} step={0.01} style={inputStyle} placeholder="0.00" />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="length" label="长度 (cm)">
                          <InputNumber min={0} step={0.1} style={inputStyle} placeholder="0.0" />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="width" label="宽度 (cm)">
                          <InputNumber min={0} step={0.1} style={inputStyle} placeholder="0.0" />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="height" label="高度 (cm)">
                          <InputNumber min={0} step={0.1} style={inputStyle} placeholder="0.0" />
                        </Form.Item>
                      </Col>
                      <Col span={24}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          重量与尺寸将用于运费预估、物流渠道匹配及海关申报
                        </Text>
                      </Col>
                    </Row>
                  ),
                },
                {
                  key: 'media',
                  label: (
                    <span><PictureOutlined /> 图片与描述</span>
                  ),
                  children: (
                    <Row gutter={16}>
                      <Col span={24}>
                        <Form.Item name="image" label="主图 URL">
                          <Input placeholder="https://..." style={inputStyle} />
                        </Form.Item>
                      </Col>
                      <Col span={24}>
                        <Form.Item shouldUpdate={(prev, cur) => prev.image !== cur.image} label="主图预览">
                          {({ getFieldValue }) =>
                            getFieldValue('image') ? (
                              <Image src={getFieldValue('image')} width={120} height={120} style={{ borderRadius: 8, objectFit: 'cover' }} fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==" />
                            ) : (
                              <div
                                style={{
                                  width: 120,
                                  height: 120,
                                  borderRadius: 8,
                                  background: '#F7F8FA',
                                  border: '1px dashed #D5D8DE',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  color: '#86909C',
                                  fontSize: 12,
                                }}
                              >
                                暂无图片
                              </div>
                            )
                          }
                        </Form.Item>
                      </Col>
                      <Col span={24}>
                        <Form.Item name="description" label="商品描述">
                          <Input.TextArea rows={6} placeholder="商品详细描述, 支持多平台商品刊登" maxLength={2000} showCount />
                        </Form.Item>
                      </Col>
                    </Row>
                  ),
                },
              ]}
            />
          </Form>
        )}
      </Drawer>
    </div>
  );
}
