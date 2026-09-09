// 优惠券 / 营销中心
import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  Table, Tag, Space, Button, Form, Input, Select, InputNumber, DatePicker, Modal, message,
  Card, Row, Col, Statistic, Progress, Drawer, Descriptions, Tabs, Switch, Divider, Typography, Popconfirm,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, GiftOutlined, TagsOutlined, PercentageOutlined, CarOutlined,
  EditOutlined, DeleteOutlined, EyeOutlined, CopyOutlined, FireOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import { couponApi } from '../api';
import dayjs, { Dayjs } from 'dayjs';

const { Title, Text, Paragraph } = Typography;
const { RangePicker } = DatePicker;

// 类型映射
const TYPE_META: Record<string, { label: string; color: string; icon: any; unit: string }> = {
  amount: { label: '满减', color: 'red', icon: <TagsOutlined />, unit: 'USD' },
  percent: { label: '折扣', color: 'orange', icon: <PercentageOutlined />, unit: '%' },
  shipping: { label: '免邮', color: 'blue', icon: <CarOutlined />, unit: '' },
};

const SCOPE_META: Record<string, string> = {
  all: '全场',
  category: '指定分类',
  product: '指定商品',
};

export default function CouponsPage() {
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 10 });
  const [editing, setEditing] = useState<any | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('coupons');
  const [form] = Form.useForm();
  const qc = useQueryClient();

  // 列表
  const { data, isLoading } = useQuery({
    queryKey: ['coupons', filters],
    queryFn: () => couponApi.list(filters),
  });

  // 统计
  const { data: stats } = useQuery({
    queryKey: ['coupon-stats'],
    queryFn: couponApi.stats,
  });

  // 满减促销
  const { data: promotions } = useQuery({
    queryKey: ['promotions'],
    queryFn: couponApi.promotions,
  });

  // mutations
  const createMut = useMutation({
    mutationFn: couponApi.create,
    onSuccess: () => {
      message.success('创建成功');
      setEditOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['coupons'] });
      qc.invalidateQueries({ queryKey: ['coupon-stats'] });
    },
    onError: (e: any) => message.error(e?.message || '创建失败'),
  });
  const updateMut = useMutation({
    mutationFn: (vars: any) => couponApi.update(vars.id, vars.body),
    onSuccess: () => {
      message.success('更新成功');
      setEditOpen(false);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['coupons'] });
    },
    onError: (e: any) => message.error(e?.message || '更新失败'),
  });
  const removeMut = useMutation({
    mutationFn: couponApi.remove,
    onSuccess: () => {
      message.success('已删除');
      qc.invalidateQueries({ queryKey: ['coupons'] });
      qc.invalidateQueries({ queryKey: ['coupon-stats'] });
    },
    onError: (e: any) => message.error(e?.message || '删除失败'),
  });
  const createPromoMut = useMutation({
    mutationFn: couponApi.createPromotion,
    onSuccess: () => {
      message.success('促销创建成功');
      qc.invalidateQueries({ queryKey: ['promotions'] });
    },
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      type: 'amount',
      value: 10,
      minAmount: 0,
      totalQuota: 0,
      perUserLimit: 1,
      status: 'active',
      range: [dayjs(), dayjs().add(30, 'day')],
    });
    setEditOpen(true);
  };

  const openEdit = (row: any) => {
    setEditing(row);
    form.setFieldsValue({
      ...row,
      range: [dayjs(row.startsAt), dayjs(row.endsAt)],
    });
    setEditOpen(true);
  };

  const submit = async () => {
    const v = await form.validateFields();
    const body: any = {
      name: v.name,
      code: v.code?.toUpperCase(),
      type: v.type,
      value: v.value,
      minAmount: v.minAmount || 0,
      maxDiscount: v.maxDiscount,
      totalQuota: v.totalQuota || 0,
      perUserLimit: v.perUserLimit || 1,
      scope: v.scope || 'all',
      scopeIds: v.scopeIds,
      status: v.status,
      description: v.description,
      startsAt: v.range?.[0]?.toISOString(),
      endsAt: v.range?.[1]?.toISOString(),
    };
    if (editing) {
      updateMut.mutate({ id: editing.id, body });
    } else {
      createMut.mutate(body);
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    message.success(`已复制: ${code}`);
  };

  // 表格列
  const columns = [
    {
      title: '优惠码 / 名称', dataIndex: 'name', key: 'name',
      render: (v: string, r: any) => (
        <Space direction="vertical" size={0}>
          <Text strong>{v}</Text>
          <Space size={4}>
            <Tag color="default" style={{ fontFamily: 'monospace' }}>{r.code}</Tag>
            <Button type="link" size="small" icon={<CopyOutlined />} onClick={() => copyCode(r.code)} />
          </Space>
        </Space>
      ),
    },
    {
      title: '类型', dataIndex: 'type', key: 'type',
      render: (v: string) => {
        const m = TYPE_META[v];
        return <Tag color={m.color} icon={m.icon}>{m.label}</Tag>;
      },
    },
    {
      title: '面值', dataIndex: 'value', key: 'value',
      render: (v: number, r: any) => {
        const m = TYPE_META[r.type];
        if (r.type === 'amount') return <Text strong>${v}</Text>;
        if (r.type === 'percent') return <><Text strong>{v}%</Text>{r.maxDiscount && <Tag>上限 ${r.maxDiscount}</Tag>}</>;
        return <Tag>免运费</Tag>;
      },
    },
    {
      title: '门槛', dataIndex: 'minAmount', key: 'minAmount',
      render: (v: number) => v > 0 ? `满 $${v}` : <Text type="secondary">无门槛</Text>,
    },
    {
      title: '使用 / 配额', key: 'usage', width: 180,
      render: (_: any, r: any) => {
        const used = r.usedCount;
        const total = r.totalQuota || Infinity;
        const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
        return (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Text>{used} / {total > 0 ? total : '∞'}</Text>
            {total > 0 && <Progress percent={pct} size="small" showInfo={false} />}
          </Space>
        );
      },
    },
    {
      title: '有效期', key: 'period', width: 200,
      render: (_: any, r: any) => (
        <Space direction="vertical" size={0} style={{ fontSize: 12 }}>
          <span>{dayjs(r.startsAt).format('YYYY-MM-DD')}</span>
          <span style={{ color: '#999' }}>至 {dayjs(r.endsAt).format('YYYY-MM-DD')}</span>
        </Space>
      ),
    },
    {
      title: '状态', dataIndex: 'status', key: 'status',
      render: (v: string) => {
        if (v === 'active') return <Tag color="green">进行中</Tag>;
        if (v === 'disabled') return <Tag>已停用</Tag>;
        return <Tag color="orange">已过期</Tag>;
      },
    },
    {
      title: '操作', key: 'ops', width: 180, fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={async () => {
            const d = await couponApi.detail(r.id);
            setDetail(d);
            setDetailOpen(true);
          }}>详情</Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm title="确定删除?" onConfirm={() => removeMut.mutate(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // 促销表格列
  const promoColumns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    {
      title: '类型', dataIndex: 'type', key: 'type',
      render: (v: string) => {
        if (v === 'full_reduce') return <Tag color="red">满减</Tag>;
        if (v === 'full_discount') return <Tag color="orange">满件折</Tag>;
        return <Tag>限时特价</Tag>;
      },
    },
    {
      title: '档位', dataIndex: 'rules', key: 'rules',
      render: (v: any) => {
        try {
          const r = typeof v === 'string' ? JSON.parse(v) : v;
          return (
            <Space direction="vertical" size={2}>
              {(r.tiers || []).map((t: any, i: number) => (
                <Tag key={i} color="blue">满 {t.min} 减/折 {t.discount}</Tag>
              ))}
            </Space>
          );
        } catch { return <Text type="secondary">-</Text>; }
      },
    },
    {
      title: '有效期', key: 'period',
      render: (_: any, r: any) => `${dayjs(r.startsAt).format('MM-DD')} ~ ${dayjs(r.endsAt).format('MM-DD')}`,
    },
    {
      title: '状态', dataIndex: 'status', key: 'status',
      render: (v: string) => v === 'active' ? <Tag color="green">进行中</Tag> : <Tag>已停用</Tag>,
    },
  ];

  return (
    <div>
      <Row align="middle" justify="space-between" style={{ marginBottom: 12 }}>
        <Col>
          <Title level={4} style={{ margin: 0 }}>
            <GiftOutlined style={{ color: '#fa541c' }} /> 营销中心
          </Title>
          <Text type="secondary">优惠券 / 满减促销 / 折扣码</Text>
        </Col>
        <Col>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['coupons'] })}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建优惠券</Button>
          </Space>
        </Col>
      </Row>

      {/* 统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card bordered={false} bodyStyle={{ padding: 16 }}>
            <Statistic title="优惠券总数" value={stats?.totalCoupons || 0} prefix={<GiftOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card bordered={false} bodyStyle={{ padding: 16 }}>
            <Statistic title="进行中" value={stats?.activeCoupons || 0} valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card bordered={false} bodyStyle={{ padding: 16 }}>
            <Statistic title="累计核销" value={stats?.totalUsages || 0} prefix={<ThunderboltOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card bordered={false} bodyStyle={{ padding: 16 }}>
            <Statistic
              title="累计优惠金额"
              value={stats?.totalDiscount || 0}
              precision={2}
              prefix="$"
              valueStyle={{ color: '#fa541c' }}
            />
          </Card>
        </Col>
      </Row>

      <Card bordered={false}>
        <Tabs activeKey={activeTab} onChange={setActiveTab}
          items={[
            {
              key: 'coupons',
              label: <span><GiftOutlined /> 优惠券</span>,
              children: (
                <>
                  <Space style={{ marginBottom: 12 }} wrap>
                    <Input.Search
                      placeholder="搜索名称 / 优惠码"
                      allowClear
                      style={{ width: 240 }}
                      onSearch={(v) => setFilters((f: any) => ({ ...f, keyword: v, page: 1 }))}
                    />
                    <Select
                      placeholder="状态"
                      allowClear
                      style={{ width: 120 }}
                      options={[
                        { value: 'active', label: '进行中' },
                        { value: 'disabled', label: '已停用' },
                        { value: 'expired', label: '已过期' },
                      ]}
                      onChange={(v) => setFilters((f: any) => ({ ...f, status: v, page: 1 }))}
                    />
                  </Space>
                  <Table
                    rowKey="id"
                    loading={isLoading}
                    dataSource={data?.list || []}
                    columns={columns as any}
                    scroll={{ x: 1100 }}
                    pagination={{
                      current: filters.page,
                      pageSize: filters.pageSize,
                      total: data?.total || 0,
                      showSizeChanger: true,
                      onChange: (p, ps) => setFilters((f: any) => ({ ...f, page: p, pageSize: ps })),
                    }}
                  />
                </>
              ),
            },
            {
              key: 'promotions',
              label: <span><FireOutlined /> 满减促销</span>,
              children: (
                <>
                  <Space style={{ marginBottom: 12 }}>
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={() => {
                        Modal.confirm({
                          title: '创建满减促销',
                          width: 600,
                          content: (
                            <PromotionForm
                              onSubmit={(body) => {
                                createPromoMut.mutate(body);
                                Modal.destroyAll();
                              }}
                            />
                          ),
                        });
                      }}
                    >
                      新建促销
                    </Button>
                  </Space>
                  <Table
                    rowKey="id"
                    dataSource={promotions || []}
                    columns={promoColumns as any}
                    pagination={false}
                  />
                </>
              ),
            },
          ]}
        />
      </Card>

      {/* 编辑弹窗 */}
      <Modal
        title={editing ? '编辑优惠券' : '新建优惠券'}
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={submit}
        width={640}
        confirmLoading={createMut.isPending || updateMut.isPending}
        okText={editing ? '更新' : '创建'}
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
                <Input placeholder="例: 双11大促" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="code" label="优惠码 (大写)" rules={[{ required: true, message: '请输入优惠码' }]}>
                <Input placeholder="例: SALE2026" style={{ textTransform: 'uppercase' }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="type" label="类型" rules={[{ required: true }]}>
                <Select
                  options={[
                    { value: 'amount', label: '满减' },
                    { value: 'percent', label: '折扣' },
                    { value: 'shipping', label: '免邮' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="value" label="面值" rules={[{ required: true }]}>
                <InputNumber style={{ width: '100%' }} min={0} placeholder="10" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="maxDiscount" label="折扣上限">
                <InputNumber style={{ width: '100%' }} min={0} placeholder="可选" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="minAmount" label="使用门槛">
                <InputNumber style={{ width: '100%' }} min={0} placeholder="0" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="totalQuota" label="总配额 (0=不限)">
                <InputNumber style={{ width: '100%' }} min={0} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="perUserLimit" label="每人限领">
                <InputNumber style={{ width: '100%' }} min={1} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="range" label="有效期" rules={[{ required: true, message: '请选择有效期' }]}>
            <RangePicker showTime style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} placeholder="可选, 客户可见" />
          </Form.Item>

          <Form.Item name="status" label="状态">
            <Select
              options={[
                { value: 'active', label: '启用' },
                { value: 'disabled', label: '停用' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 详情抽屉 */}
      <Drawer
        title="优惠券详情"
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width={520}
      >
        {detail && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="名称">{detail.name}</Descriptions.Item>
            <Descriptions.Item label="优惠码">
              <Tag color="default" style={{ fontFamily: 'monospace' }}>{detail.code}</Tag>
              <Button size="small" type="link" icon={<CopyOutlined />} onClick={() => copyCode(detail.code)}>复制</Button>
            </Descriptions.Item>
            <Descriptions.Item label="类型">
              <Tag color={TYPE_META[detail.type]?.color} icon={TYPE_META[detail.type]?.icon}>
                {TYPE_META[detail.type]?.label}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="面值">
              {detail.type === 'amount' && `$${detail.value}`}
              {detail.type === 'percent' && `${detail.value}%${detail.maxDiscount ? ` (上限 $${detail.maxDiscount})` : ''}`}
              {detail.type === 'shipping' && '免运费'}
            </Descriptions.Item>
            <Descriptions.Item label="使用门槛">
              {detail.minAmount > 0 ? `满 $${detail.minAmount}` : '无门槛'}
            </Descriptions.Item>
            <Descriptions.Item label="使用情况">
              {detail.usedCount} / {detail.totalQuota || '∞'}
            </Descriptions.Item>
            <Descriptions.Item label="每人限领">{detail.perUserLimit}</Descriptions.Item>
            <Descriptions.Item label="适用范围">{SCOPE_META[detail.scope] || detail.scope}</Descriptions.Item>
            <Descriptions.Item label="有效期">
              {dayjs(detail.startsAt).format('YYYY-MM-DD HH:mm')} ~ {dayjs(detail.endsAt).format('YYYY-MM-DD HH:mm')}
            </Descriptions.Item>
            <Descriptions.Item label="使用次数">{detail.usageCount}</Descriptions.Item>
            {detail.description && (
              <Descriptions.Item label="说明">{detail.description}</Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Drawer>
    </div>
  );
}

// 满减促销表单
function PromotionForm({ onSubmit }: { onSubmit: (b: any) => void }) {
  const [form] = Form.useForm();
  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={(v) => onSubmit({
        ...v,
        rules: { tiers: v.tiers || [] },
        startsAt: v.range?.[0]?.toISOString(),
        endsAt: v.range?.[1]?.toISOString(),
      })}
      initialValues={{ type: 'full_reduce', tiers: [{ min: 200, discount: 30 }] }}
    >
      <Form.Item name="name" label="促销名称" rules={[{ required: true }]}>
        <Input placeholder="例: 双11全场满减" />
      </Form.Item>
      <Form.Item name="type" label="类型">
        <Select
          options={[
            { value: 'full_reduce', label: '满减 (满 X 减 Y)' },
            { value: 'full_discount', label: '满件折 (满 X 件打 Y 折)' },
          ]}
        />
      </Form.Item>
      <Form.Item label="档位" name="tiers" tooltip="按金额从高到低, 自动匹配最优惠档">
        <TiersEditor />
      </Form.Item>
      <Form.Item name="range" label="有效期" rules={[{ required: true }]}>
        <RangePicker showTime style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item name="description" label="说明">
        <Input.TextArea rows={2} />
      </Form.Item>
      <Button type="primary" htmlType="submit" block>创建</Button>
    </Form>
  );
}

function TiersEditor({ value = [], onChange }: any) {
  const update = (idx: number, k: string, v: any) => {
    const next = [...value];
    next[idx] = { ...next[idx], [k]: Number(v) || 0 };
    onChange?.(next);
  };
  const add = () => onChange?.([...(value || []), { min: 0, discount: 0 }]);
  const remove = (idx: number) => onChange?.(value.filter((_: any, i: number) => i !== idx));
  return (
    <div>
      {(value || []).map((t: any, i: number) => (
        <Space key={i} style={{ marginBottom: 4, display: 'flex' }}>
          <InputNumber min={0} value={t.min} onChange={(v) => update(i, 'min', v)} placeholder="满" />
          <span>减/折</span>
          <InputNumber min={0} value={t.discount} onChange={(v) => update(i, 'discount', v)} placeholder="优惠" />
          <Button size="small" danger onClick={() => remove(i)}>删</Button>
        </Space>
      ))}
      <Button size="small" onClick={add} icon={<PlusOutlined />}>加档位</Button>
    </div>
  );
}
