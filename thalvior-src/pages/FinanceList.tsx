import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Card, Row, Col, Statistic, Table, Tabs, DatePicker, Space, Typography, Tag,
  Progress, Select, Button, Descriptions, Empty,
} from 'antd';
import {
  DownloadOutlined, ReloadOutlined, FundOutlined, GlobalOutlined, CalculatorOutlined,
  DollarOutlined, PayCircleOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import dayjs from 'dayjs';
import { financeApi } from '../api';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

// ============ 利润报表 Tab ============
function ProfitTab() {
  const [range, setRange] = useState<[any, any] | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['finance-profit', range?.[0]?.toISOString(), range?.[1]?.toISOString()],
    queryFn: () => financeApi.profit({
      from: range?.[0]?.toISOString(),
      to: range?.[1]?.toISOString(),
    }),
  });

  const summary = data?.summary;
  const byShop = data?.byShop || [];
  const byDay = data?.byDay || [];

  const lineOption = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['销售额', '成本', '净利润'], top: 0, right: 10 },
    grid: { left: 60, right: 30, top: 40, bottom: 40 },
    xAxis: { type: 'category', data: byDay.map((d: any) => d.date) },
    yAxis: { type: 'value' },
    series: [
      { name: '销售额', type: 'line', smooth: true, itemStyle: { color: '#1677ff' }, data: byDay.map((d: any) => +d.sales.toFixed(2)) },
      { name: '成本', type: 'line', smooth: true, itemStyle: { color: '#fa8c16' }, data: byDay.map((d: any) => +d.cost.toFixed(2)) },
      { name: '净利润', type: 'line', smooth: true, itemStyle: { color: '#52c41a' }, data: byDay.map((d: any) => +d.profit.toFixed(2)) },
    ],
  };

  const pieOption = useMemo(() => ({
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
      label: { formatter: '{b}\n{d}%' },
      data: [
        { value: summary?.totalCost || 0, name: '商品成本' },
        { value: summary?.totalShipFee || 0, name: '物流费' },
        { value: summary?.totalPlatformFee || 0, name: '平台费' },
        { value: Math.max(0, (summary?.totalProfit || 0)), name: '净利润' },
      ],
    }],
  }), [summary]);

  const columns = [
    { title: '店铺 ID', dataIndex: 'shopId', fixed: 'left' as const, width: 240, render: (v: string) => v?.slice(0, 12) + '...' },
    { title: '订单数', dataIndex: 'count', width: 100, align: 'right' as const },
    { title: '销售额', dataIndex: 'sales', width: 140, align: 'right' as const, render: (v: number) => v.toFixed(2) },
    { title: '成本', dataIndex: 'cost', width: 140, align: 'right' as const, render: (v: number) => v.toFixed(2) },
    {
      title: '净利润',
      dataIndex: 'profit',
      width: 140,
      align: 'right' as const,
      render: (v: number) => <span style={{ color: v > 0 ? '#52c41a' : '#f5222d', fontWeight: 600 }}>{v.toFixed(2)}</span>,
    },
    {
      title: '利润率',
      width: 100,
      align: 'right' as const,
      render: (_: any, r: any) => {
        const rate = r.sales > 0 ? (r.profit / r.sales) * 100 : 0;
        return <Tag color={rate > 30 ? 'green' : rate > 15 ? 'blue' : rate > 0 ? 'orange' : 'red'}>{rate.toFixed(1)}%</Tag>;
      },
    },
  ];

  return (
    <div>
      <Card bordered={false}>
        <Space wrap>
          <RangePicker value={range} onChange={(v) => setRange(v as any)} />
          <Button icon={<ReloadOutlined />}>刷新</Button>
          <Button icon={<DownloadOutlined />}>导出</Button>
        </Space>
      </Card>

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24} sm={12} md={6}>
          <Card bordered={false}><Statistic title="销售额" value={summary?.totalSales || 0} precision={2} prefix="$" /></Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card bordered={false}>
            <Statistic title="净利润" value={summary?.totalProfit || 0} precision={2} prefix="$" valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card bordered={false}>
            <Statistic title="利润率" value={summary?.margin || 0} precision={2} suffix="%" />
            <Progress percent={Math.min(summary?.margin || 0, 100)} showInfo={false} size="small" />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card bordered={false}>
            <Statistic title="订单数" value={summary?.orderCount || 0} prefix={<FundOutlined />} />
          </Card>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24} md={16}>
          <Card title="利润趋势" bordered={false}>
            {byDay.length > 0 ? <ReactECharts option={lineOption} style={{ height: 280 }} /> : <Empty />}
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card title="成本构成" bordered={false}>
            {summary ? <ReactECharts option={pieOption} style={{ height: 280 }} /> : <Empty />}
          </Card>
        </Col>
      </Row>

      <Card title="店铺明细" bordered={false} style={{ marginTop: 16 }}>
        <Table
          size="middle"
          dataSource={byShop}
          columns={columns as any}
          loading={isLoading}
          pagination={false}
          rowKey="shopId"
          scroll={{ x: 800 }}
        />
      </Card>
    </div>
  );
}

// ============ 平台对账 Tab ============
function ReconcileTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['finance-reconcile'],
    queryFn: () => financeApi.reconcile({}),
  });

  return (
    <div>
      <Row gutter={16}>
        <Col span={6}><Card bordered={false}><Statistic title="订单数" value={data?.totalOrder || 0} loading={isLoading} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title="订单总额" value={data?.totalAmount || 0} precision={2} prefix="$" /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title="平台佣金" value={data?.platformFee || 0} precision={2} prefix="$" valueStyle={{ color: '#fa8c16' }} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title="广告费" value={data?.adFee || 0} precision={2} prefix="$" valueStyle={{ color: '#fa8c16' }} /></Card></Col>
      </Row>
      <Card title="结算明细" bordered={false} style={{ marginTop: 16 }}>
        <Descriptions column={2} bordered>
          <Descriptions.Item label="订单总额 (USD)">$ {data?.totalAmount?.toFixed(2)}</Descriptions.Item>
          <Descriptions.Item label="平台佣金 (8%)">$ {data?.platformFee?.toFixed(2)}</Descriptions.Item>
          <Descriptions.Item label="广告费 (5%)">$ {data?.adFee?.toFixed(2)}</Descriptions.Item>
          <Descriptions.Item label="净收入">
            <span style={{ color: '#52c41a', fontWeight: 600 }}>$ {data?.netIncome?.toFixed(2)}</span>
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </div>
  );
}

// ============ 费用流水 Tab ============
function RecordsTab() {
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 20 });
  const { data, isLoading } = useQuery({
    queryKey: ['finance-records', filters],
    queryFn: () => financeApi.records(filters),
  });

  const typeMap: Record<string, { color: string; text: string }> = {
    income: { color: 'green', text: '收入' },
    expense: { color: 'red', text: '支出' },
    refund: { color: 'orange', text: '退款' },
  };

  const columns = [
    {
      title: '时间',
      dataIndex: 'occurredAt',
      width: 160,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 100,
      render: (v: string) => <Tag color={typeMap[v]?.color}>{typeMap[v]?.text || v}</Tag>,
    },
    { title: '类目', dataIndex: 'category', width: 120 },
    {
      title: '金额',
      dataIndex: 'amount',
      width: 140,
      align: 'right' as const,
      render: (v: number, r: any) => `${r.currency} ${(+v).toFixed(2)}`,
    },
    { title: '关联单号', dataIndex: 'refId', width: 200, ellipsis: true },
    { title: '备注', dataIndex: 'remark' },
  ];

  return (
    <Card bordered={false}>
      <Space style={{ marginBottom: 12 }}>
        <Select
          placeholder="类型"
          allowClear
          style={{ width: 140 }}
          options={Object.entries(typeMap).map(([k, v]) => ({ label: v.text, value: k }))}
          onChange={(v) => setFilters((f: any) => ({ ...f, type: v, page: 1 }))}
        />
      </Space>
      <Table
        size="middle"
        dataSource={data?.items || []}
        columns={columns as any}
        loading={isLoading}
        rowKey="id"
        pagination={{
          current: filters.page,
          pageSize: filters.pageSize,
          total: data?.total || 0,
          showSizeChanger: true,
          onChange: (page, pageSize) => setFilters((f: any) => ({ ...f, page, pageSize })),
        }}
      />
    </Card>
  );
}

// ============ 汇率管理 Tab ============
function RatesTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['finance-rates'],
    queryFn: () => financeApi.rates(),
  });
  const columns = [
    { title: '源币种', dataIndex: 'from', width: 120, render: (v: string) => <Tag color="blue">{v}</Tag> },
    { title: '目标币种', dataIndex: 'to', width: 120, render: (v: string) => <Tag color="cyan">{v}</Tag> },
    { title: '汇率', dataIndex: 'rate', width: 140, align: 'right' as const, render: (v: number) => v.toFixed(4) },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 200,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-',
    },
  ];
  return (
    <Card bordered={false}>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<ReloadOutlined />}>刷新汇率</Button>
        <Button>添加汇率</Button>
      </Space>
      <Table
        size="middle"
        dataSource={data || []}
        columns={columns as any}
        loading={isLoading}
        rowKey={(r: any) => `${r.from}-${r.to}`}
        pagination={false}
      />
    </Card>
  );
}

// ============ 成本核算 Tab ============
function CostTab() {
  const { data: products } = useQuery({
    queryKey: ['products-all'],
    queryFn: () => import('../api').then(m => m.productApi.list({ page: 1, pageSize: 100 })),
  });
  const list = products?.items || [];
  const totals = {
    cost: list.reduce((s: number, p: any) => s + (+p.costPrice || 0), 0),
    sale: list.reduce((s: number, p: any) => s + (+p.salePrice || 0), 0),
  };
  const margin = totals.sale > 0 ? ((totals.sale - totals.cost) / totals.sale) * 100 : 0;

  const columns = [
    { title: 'SKU', dataIndex: 'sku', width: 140 },
    { title: '商品', dataIndex: 'name', ellipsis: true },
    {
      title: '成本价',
      dataIndex: 'costPrice',
      width: 120,
      align: 'right' as const,
      render: (v: number, r: any) => `${r.currency} ${(+v).toFixed(2)}`,
    },
    {
      title: '售价',
      dataIndex: 'salePrice',
      width: 120,
      align: 'right' as const,
      render: (v: number, r: any) => `${r.currency} ${(+v).toFixed(2)}`,
    },
    {
      title: '毛利润',
      width: 120,
      align: 'right' as const,
      render: (_: any, r: any) => {
        const profit = (+r.salePrice || 0) - (+r.costPrice || 0);
        return <span style={{ color: profit > 0 ? '#52c41a' : '#f5222d' }}>{profit.toFixed(2)}</span>;
      },
    },
    {
      title: '毛利率',
      width: 100,
      align: 'right' as const,
      render: (_: any, r: any) => {
        const m = r.salePrice > 0 ? ((r.salePrice - r.costPrice) / r.salePrice) * 100 : 0;
        return <Tag color={m > 40 ? 'green' : m > 20 ? 'blue' : 'orange'}>{m.toFixed(1)}%</Tag>;
      },
    },
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 12 }}>
        <Col span={8}><Card bordered={false}><Statistic title="总成本" value={totals.cost} precision={2} prefix={<PayCircleOutlined />} /></Card></Col>
        <Col span={8}><Card bordered={false}><Statistic title="总售价" value={totals.sale} precision={2} prefix={<DollarOutlined />} /></Card></Col>
        <Col span={8}><Card bordered={false}><Statistic title="平均毛利率" value={margin} precision={2} suffix="%" /></Card></Col>
      </Row>
      <Card bordered={false} title="SKU 成本核算">
        <Table
          size="middle"
          dataSource={list}
          columns={columns as any}
          rowKey="id"
          pagination={{ pageSize: 20 }}
        />
      </Card>
    </div>
  );
}

// ============ 入口 ============
export default function FinanceList() {
  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>财务管理</Title>
      <Text type="secondary">利润分析 · 平台对账 · 费用流水 · 汇率管理 · 成本核算</Text>
      <Tabs
        style={{ marginTop: 12 }}
        defaultActiveKey="profit"
        items={[
          { key: 'profit', label: '利润报表', icon: <FundOutlined />, children: <ProfitTab /> },
          { key: 'reconcile', label: '平台对账', icon: <CalculatorOutlined />, children: <ReconcileTab /> },
          { key: 'records', label: '费用流水', icon: <PayCircleOutlined />, children: <RecordsTab /> },
          { key: 'rates', label: '汇率管理', icon: <GlobalOutlined />, children: <RatesTab /> },
          { key: 'cost', label: '成本核算', icon: <DollarOutlined />, children: <CostTab /> },
        ]}
      />
    </div>
  );
}
