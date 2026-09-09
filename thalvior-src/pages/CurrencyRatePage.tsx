// 汇率管理 / 货币换算页
import { useState } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  InputNumber,
  Select,
  Form,
  Modal,
  Popconfirm,
  message,
  Row,
  Col,
  Statistic,
  Tooltip,
  Input,
  Divider,
  Alert,
  Result,
  Empty,
  Typography,
} from 'antd';
import {
  GlobalOutlined,
  ReloadOutlined,
  PlusOutlined,
  DeleteOutlined,
  SwapOutlined,
  ThunderboltOutlined,
  InfoCircleOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { i18nApi, type Currency, type ExchangeRate } from '../api';

const { Title, Text } = Typography;

export default function CurrencyRatePage() {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [convertForm] = Form.useForm();

  // 列表
  const ratesQ = useQuery({
    queryKey: ['i18n-rates'],
    queryFn: () => i18nApi.rates(),
  });
  const currenciesQ = useQuery({
    queryKey: ['i18n-currencies'],
    queryFn: () => i18nApi.currencies(),
  });

  // 弹窗状态
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<ExchangeRate | null>(null);

  // 创建 / 更新
  const upsertMut = useMutation({
    mutationFn: (body: { from: string; to: string; rate: number; source?: string }) =>
      i18nApi.upsertRate(body),
    onSuccess: () => {
      message.success('汇率已保存');
      qc.invalidateQueries({ queryKey: ['i18n-rates'] });
      setEditOpen(false);
      form.resetFields();
    },
    onError: (e: any) => message.error(e?.message || '保存失败'),
  });

  // 删除
  const removeMut = useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => i18nApi.removeRate(from, to),
    onSuccess: () => {
      message.success('已删除');
      qc.invalidateQueries({ queryKey: ['i18n-rates'] });
    },
    onError: (e: any) => message.error(e?.message || '删除失败'),
  });

  // 初始化静态汇率
  const seedMut = useMutation({
    mutationFn: () => i18nApi.seed(),
    onSuccess: (d) => {
      message.success(`已初始化 ${d?.seeded || 0} 条静态汇率`);
      qc.invalidateQueries({ queryKey: ['i18n-rates'] });
    },
    onError: (e: any) => message.error(e?.message || '初始化失败'),
  });

  // 换算
  const [convertResult, setConvertResult] = useState<any>(null);
  const doConvert = async () => {
    const v = await convertForm.validateFields();
    try {
      const r = await i18nApi.convert({ amount: v.amount, from: v.from, to: v.to });
      setConvertResult(r);
    } catch (e: any) {
      message.error(e?.message || '换算失败');
    }
  };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setEditOpen(true);
  };

  const openEdit = (r: ExchangeRate) => {
    setEditing(r);
    form.setFieldsValue({ from: r.from, to: r.to, rate: r.rate, source: r.source });
    setEditOpen(true);
  };

  const submit = async () => {
    const v = await form.validateFields();
    upsertMut.mutate(v);
  };

  const currencies = (currenciesQ.data || []) as Currency[];

  // 按基础币种 USD 分组展示
  const groupedByBase = (rates: ExchangeRate[]) => {
    const m: Record<string, ExchangeRate[]> = {};
    rates.forEach((r) => {
      if (!m[r.from]) m[r.from] = [];
      m[r.from].push(r);
    });
    return m;
  };

  const columns = [
    {
      title: '源币种',
      dataIndex: 'from',
      key: 'from',
      width: 120,
      render: (v: string) => {
        const meta = currencies.find((c) => c.code === v);
        return (
          <Space>
            <Tag color="blue" style={{ fontFamily: 'monospace', fontSize: 14 }}>
              {meta?.symbol || ''} {v}
            </Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {meta?.nameZh || ''}
            </Text>
          </Space>
        );
      },
    },
    {
      title: '目标币种',
      dataIndex: 'to',
      key: 'to',
      width: 120,
      render: (v: string) => {
        const meta = currencies.find((c) => c.code === v);
        return (
          <Tag color="cyan" style={{ fontFamily: 'monospace', fontSize: 14 }}>
            {meta?.symbol || ''} {v}
          </Tag>
        );
      },
    },
    {
      title: '汇率',
      dataIndex: 'rate',
      key: 'rate',
      width: 140,
      align: 'right' as const,
      render: (v: number) => (
        <Text strong style={{ fontSize: 14 }}>
          ×{v.toFixed(4)}
        </Text>
      ),
    },
    {
      title: '来源',
      dataIndex: 'source',
      key: 'source',
      width: 100,
      render: (v: string) => {
        const colorMap: Record<string, string> = {
          manual: 'orange',
          static: 'default',
          api: 'green',
        };
        return <Tag color={colorMap[v] || 'default'}>{v}</Tag>;
      },
    },
    {
      title: '更新时间',
      dataIndex: 'fetchedAt',
      key: 'fetchedAt',
      width: 160,
      render: (v: string) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {v ? new Date(v).toLocaleString('zh-CN') : '-'}
        </Text>
      ),
    },
    {
      title: '操作',
      key: 'op',
      width: 160,
      fixed: 'right' as const,
      render: (_: any, r: ExchangeRate) => (
        <Space>
          <Button type="link" size="small" onClick={() => openEdit(r)}>
            编辑
          </Button>
          <Popconfirm
            title="确定删除该汇率?"
            onConfirm={() => removeMut.mutate({ from: r.from, to: r.to })}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const rates = (ratesQ.data || []) as ExchangeRate[];
  const grouped = groupedByBase(rates);
  const baseCurrencies = Object.keys(grouped);

  return (
    <div>
      <Row align="middle" justify="space-between" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={4} style={{ margin: 0 }}>
            <GlobalOutlined style={{ color: '#1677ff' }} /> 汇率管理
          </Title>
          <Text type="secondary">多币种支持 · 实时金额换算 · 链式换算经过 USD</Text>
        </Col>
        <Col>
          <Space>
            <Button
              icon={<ThunderboltOutlined />}
              loading={seedMut.isPending}
              onClick={() => seedMut.mutate()}
            >
              初始化静态汇率
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['i18n-rates'] })}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增汇率
            </Button>
          </Space>
        </Col>
      </Row>

      {/* 统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card bordered={false} bodyStyle={{ padding: 16 }}>
            <Statistic
              title="支持的币种"
              value={currencies.length}
              prefix={<GlobalOutlined />}
              suffix="种"
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card bordered={false} bodyStyle={{ padding: 16 }}>
            <Statistic
              title="已配置汇率"
              value={rates.length}
              prefix={<SwapOutlined />}
              suffix="条"
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card bordered={false} bodyStyle={{ padding: 16 }}>
            <Statistic
              title="基础币种"
              value={baseCurrencies.length}
              prefix={<Tag color="blue">BASE</Tag>}
              suffix="个"
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card bordered={false} bodyStyle={{ padding: 16 }}>
            <Tooltip title="通过 USD 中转可实现任意两币种换算">
              <Statistic
                title="换算能力"
                value={baseCurrencies.length > 0 ? '链式' : '需配置'}
                valueStyle={{ fontSize: 18, color: baseCurrencies.length > 0 ? '#52c41a' : '#999' }}
                prefix={baseCurrencies.length > 0 ? <CheckCircleOutlined /> : <InfoCircleOutlined />}
              />
            </Tooltip>
          </Card>
        </Col>
      </Row>

      {/* 金额换算器 */}
      <Card
        title={
          <Space>
            <SwapOutlined />
            金额换算器
          </Space>
        }
        bordered={false}
        style={{ marginBottom: 16 }}
      >
        <Row gutter={16} align="middle">
          <Col xs={24} sm={6}>
            <Form form={convertForm} layout="vertical" initialValues={{ amount: 100, from: 'CNY', to: 'USD' }}>
              <Form.Item label="金额" name="amount" rules={[{ required: true, message: '请输入金额' }]}>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  step={0.01}
                  placeholder="输入金额"
                  size="large"
                />
              </Form.Item>
            </Form>
          </Col>
          <Col xs={12} sm={5}>
            <Form form={convertForm} layout="vertical">
              <Form.Item label="源币种" name="from">
                <Select size="large" showSearch>
                  {currencies.map((c) => (
                    <Select.Option key={c.code} value={c.code}>
                      {c.symbol} {c.code} - {c.nameZh}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Form>
          </Col>
          <Col xs={12} sm={2} style={{ textAlign: 'center' }}>
            <SwapOutlined style={{ fontSize: 20, color: '#1677ff' }} />
          </Col>
          <Col xs={12} sm={5}>
            <Form form={convertForm} layout="vertical">
              <Form.Item label="目标币种" name="to">
                <Select size="large" showSearch>
                  {currencies.map((c) => (
                    <Select.Option key={c.code} value={c.code}>
                      {c.symbol} {c.code} - {c.nameZh}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Form>
          </Col>
          <Col xs={24} sm={6}>
            <Form.Item label=" " colon={false}>
              <Button type="primary" size="large" block icon={<SwapOutlined />} onClick={doConvert}>
                立即换算
              </Button>
            </Form.Item>
          </Col>
        </Row>

        {convertResult && (
          <Alert
            style={{ marginTop: 8 }}
            type="success"
            showIcon
            message={
              <Space size="large" wrap>
                <span>
                  <Text type="secondary">源:</Text>{' '}
                  <Text strong style={{ fontSize: 16 }}>
                    {convertResult.amount} {convertResult.from}
                  </Text>
                </span>
                <SwapOutlined />
                <span>
                  <Text type="secondary">目标:</Text>{' '}
                  <Text strong style={{ fontSize: 18, color: '#1677ff' }}>
                    {convertResult.converted} {convertResult.to}
                  </Text>
                </span>
                <Tag color="blue">汇率 ×{convertResult.rate.toFixed(4)}</Tag>
                <Tag color="default">路径: {convertResult.path.join(' → ')}</Tag>
              </Space>
            }
          />
        )}
      </Card>

      {/* 汇率列表 */}
      <Card
        title={
          <Space>
            <GlobalOutlined />
            汇率列表
            <Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
              共 {rates.length} 条
            </Text>
          </Space>
        }
        bordered={false}
      >
        {rates.length === 0 ? (
          <Empty
            description={
              <Space direction="vertical">
                <span>暂无汇率配置</span>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  点击「初始化静态汇率」可一键加载内置汇率
                </Text>
              </Space>
            }
          >
            <Button type="primary" icon={<ThunderboltOutlined />} onClick={() => seedMut.mutate()}>
              初始化静态汇率
            </Button>
          </Empty>
        ) : (
          <Table
            rowKey="id"
            loading={ratesQ.isLoading}
            dataSource={rates}
            columns={columns as any}
            scroll={{ x: 900 }}
            pagination={{
              showSizeChanger: true,
              showTotal: (t) => `共 ${t} 条`,
              pageSize: 20,
            }}
          />
        )}
      </Card>

      {/* 弹窗 */}
      <Modal
        title={editing ? '编辑汇率' : '新增汇率'}
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={submit}
        confirmLoading={upsertMut.isPending}
        okText="保存"
        cancelText="取消"
        width={520}
      >
        <Form form={form} layout="vertical" requiredMark={false} preserve={false}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="源币种"
                name="from"
                rules={[{ required: true, message: '请选择源币种' }]}
              >
                <Select disabled={!!editing} showSearch placeholder="源币种" size="large">
                  {currencies.map((c) => (
                    <Select.Option key={c.code} value={c.code}>
                      {c.symbol} {c.code}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="目标币种"
                name="to"
                rules={[{ required: true, message: '请选择目标币种' }]}
              >
                <Select disabled={!!editing} showSearch placeholder="目标币种" size="large">
                  {currencies.map((c) => (
                    <Select.Option key={c.code} value={c.code}>
                      {c.symbol} {c.code}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            label="汇率"
            name="rate"
            rules={[{ required: true, message: '请输入汇率' }]}
            extra={
              <Text type="secondary" style={{ fontSize: 12 }}>
                1 源币种 = 汇率 × 目标币种
              </Text>
            }
          >
            <InputNumber style={{ width: '100%' }} min={0.0001} step={0.0001} size="large" />
          </Form.Item>
          <Form.Item label="来源" name="source" initialValue="manual">
            <Input placeholder="manual / static / api" />
          </Form.Item>
          {editing && (
            <Alert
              type="info"
              showIcon
              message={`上次更新: ${new Date(editing.fetchedAt).toLocaleString('zh-CN')}`}
            />
          )}
        </Form>
      </Modal>
    </div>
  );
}
