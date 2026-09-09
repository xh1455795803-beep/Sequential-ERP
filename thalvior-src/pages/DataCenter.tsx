import { useQuery } from '@tanstack/react-query';
import {
  Card, Row, Col, Statistic, Tabs, Table, Tag, Typography, Space, Empty,
} from 'antd';
import {
  BarChartOutlined, AppstoreOutlined, ShopOutlined, LineChartOutlined, FundOutlined,
  RiseOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import dayjs from 'dayjs';
import { dashboardApi, orderApi, productApi, shopApi } from '../api';

const { Title, Text } = Typography;

const STATUS_MAP: Record<string, { color: string; text: string }> = {
  pending: { color: 'default', text: '待付款' },
  pay: { color: 'cyan', text: '已付款' },
  toship: { color: 'blue', text: '待发货' },
  shipped: { color: 'green', text: '已发货' },
  done: { color: 'green', text: '已完成' },
  cancel: { color: 'red', text: '已取消' },
  refund: { color: 'orange', text: '退款' },
  abnormal: { color: 'red', text: '异常' },
};

// ============ 运营总览 ============
function OverviewTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: () => dashboardApi.overview(),
  });
  const kpi = data?.kpi;

  const lineOption = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['销售额(USD)', '订单数'], top: 0, right: 10 },
    grid: { left: 60, right: 60, top: 40, bottom: 40 },
    xAxis: { type: 'category', data: (data?.trend || []).map((t: any) => t.date) },
    yAxis: [
      { type: 'value', name: '金额', position: 'left' },
      { type: 'value', name: '订单数', position: 'right' },
    ],
    series: [
      {
        name: '销售额(USD)', type: 'line', smooth: true, yAxisIndex: 0,
        itemStyle: { color: '#1677ff' },
        areaStyle: { color: 'rgba(22,119,255,0.1)' },
        data: (data?.trend || []).map((t: any) => t.amount),
      },
      {
        name: '订单数', type: 'bar', yAxisIndex: 1,
        itemStyle: { color: '#52c41a', borderRadius: [4, 4, 0, 0] },
        data: (data?.trend || []).map((t: any) => t.count),
      },
    ],
  };

  const pieOption = {
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
      data: (data?.platformDist || []).map((p: any) => ({ name: p.name, value: p.count })),
    }],
  };

  return (
    <div>
      <Row gutter={16}>
        <Col xs={12} md={6}><Card bordered={false}><Statistic title="累计订单" value={kpi?.totalOrders || 0} prefix={<AppstoreOutlined />} loading={isLoading} /></Card></Col>
        <Col xs={12} md={6}><Card bordered={false}><Statistic title="累计销售额" value={kpi?.totalAmount || 0} precision={2} prefix="$" loading={isLoading} /></Card></Col>
        <Col xs={12} md={6}><Card bordered={false}><Statistic title="在售商品" value={kpi?.activeProducts || 0} prefix={<RiseOutlined />} loading={isLoading} /></Card></Col>
        <Col xs={12} md={6}><Card bordered={false}><Statistic title="待发货" value={kpi?.pendingShip || 0} valueStyle={{ color: '#fa8c16' }} loading={isLoading} /></Card></Col>
      </Row>
      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24} md={16}>
          <Card title="近 7 日销售趋势" bordered={false}>
            <ReactECharts option={lineOption} style={{ height: 320 }} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card title="平台分布" bordered={false}>
            <ReactECharts option={pieOption} style={{ height: 320 }} />
          </Card>
        </Col>
      </Row>
      <Card title="订单状态分布" bordered={false} style={{ marginTop: 16 }}>
        <Space wrap>
          {(data?.statusStats || []).map((s: any) => (
            <Tag key={s.status} color={STATUS_MAP[s.status]?.color || 'default'}>
              {STATUS_MAP[s.status]?.text || s.status}: {s.count}
            </Tag>
          ))}
        </Space>
      </Card>
    </div>
  );
}

// ============ 商品分析 ============
function ProductAnalysisTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['products-all'],
    queryFn: () => productApi.list({ page: 1, pageSize: 100 }),
  });
  const list = data?.items || [];
  const onSale = list.filter((p: any) => p.status === 1).length;
  const off = list.filter((p: any) => p.status === 0).length;
  const illegal = list.filter((p: any) => p.status === 2).length;

  const pieOption = {
    tooltip: { trigger: 'item' },
    series: [{
      type: 'pie',
      radius: '70%',
      label: { formatter: '{b}\n{d}%' },
      data: [
        { value: onSale, name: '在售', itemStyle: { color: '#52c41a' } },
        { value: off, name: '下架', itemStyle: { color: '#d9d9d9' } },
        { value: illegal, name: '违规', itemStyle: { color: '#f5222d' } },
      ],
    }],
  };

  const columns = [
    { title: 'SKU', dataIndex: 'sku', width: 140 },
    { title: '商品', dataIndex: 'name', ellipsis: true },
    { title: '类目', dataIndex: 'category', width: 120, render: (v: string) => v || '-' },
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
      title: '毛利率',
      width: 100,
      align: 'right' as const,
      render: (_: any, r: any) => {
        const m = r.salePrice > 0 ? ((r.salePrice - r.costPrice) / r.salePrice) * 100 : 0;
        return <Tag color={m > 40 ? 'green' : m > 20 ? 'blue' : 'orange'}>{m.toFixed(1)}%</Tag>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: number) => {
        const m: any = { 1: { color: 'green', text: '在售' }, 0: { color: 'default', text: '下架' }, 2: { color: 'red', text: '违规' } };
        return <Tag color={m[v]?.color}>{m[v]?.text || v}</Tag>;
      },
    },
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 12 }}>
        <Col span={8}><Card bordered={false}><Statistic title="在售商品" value={onSale} valueStyle={{ color: '#52c41a' }} loading={isLoading} /></Card></Col>
        <Col span={8}><Card bordered={false}><Statistic title="下架商品" value={off} loading={isLoading} /></Card></Col>
        <Col span={8}><Card bordered={false}><Statistic title="违规商品" value={illegal} valueStyle={{ color: '#f5222d' }} loading={isLoading} /></Card></Col>
      </Row>
      <Row gutter={16}>
        <Col xs={24} md={8}>
          <Card title="商品状态" bordered={false}>
            <ReactECharts option={pieOption} style={{ height: 280 }} />
          </Card>
        </Col>
        <Col xs={24} md={16}>
          <Card title="商品列表" bordered={false}>
            <Table
              size="middle"
              dataSource={list.slice(0, 20)}
              columns={columns as any}
              rowKey="id"
              loading={isLoading}
              pagination={false}
              scroll={{ x: 800 }}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}

// ============ 店铺统计 ============
function ShopStatTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['shops'],
    queryFn: () => shopApi.list({ page: 1, pageSize: 50 }),
  });
  const list = data?.items || [];

  const columns = [
    { title: '店铺名称', dataIndex: 'name', width: 200 },
    { title: '店铺 ID', dataIndex: 'shopId', width: 160 },
    { title: '平台', dataIndex: ['platform', 'name'], width: 120 },
    { title: '区域', dataIndex: 'region', width: 100, render: (v: string) => v || '-' },
    { title: '币种', dataIndex: 'currency', width: 100 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: number) => v === 1 ? <Tag color="green">正常</Tag> : v === 2 ? <Tag color="orange">授权过期</Tag> : <Tag>停用</Tag>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-',
    },
  ];

  return (
    <Card bordered={false} title="店铺列表">
      <Table
        size="middle"
        dataSource={list}
        columns={columns as any}
        rowKey="id"
        loading={isLoading}
        pagination={false}
      />
    </Card>
  );
}

// ============ 销售报表 ============
function SalesReportTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['orders-sales'],
    queryFn: () => orderApi.list({ page: 1, pageSize: 50 }),
  });
  const list = data?.items || [];

  const totalSales = list.reduce((s: number, o: any) => s + (+o.totalAmount || 0), 0);
  const totalCost = list.reduce((s: number, o: any) => s + (+o.costAmount || 0), 0);
  const totalShip = list.reduce((s: number, o: any) => s + (+o.shipFee || 0), 0);
  const profit = totalSales - totalCost - totalShip;

  const columns = [
    { title: '订单号', dataIndex: 'platformNo', width: 200 },
    { title: '买家', dataIndex: 'buyerName', width: 120 },
    { title: '国家', dataIndex: 'country', width: 80 },
    {
      title: '金额',
      dataIndex: 'totalAmount',
      width: 120,
      align: 'right' as const,
      render: (v: number, r: any) => `${r.currency} ${(+v).toFixed(2)}`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => <Tag color={STATUS_MAP[v]?.color}>{STATUS_MAP[v]?.text || v}</Tag>,
    },
    {
      title: '下单时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-',
    },
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 12 }}>
        <Col span={6}><Card bordered={false}><Statistic title="销售额" value={totalSales} precision={2} prefix="$" loading={isLoading} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title="成本" value={totalCost} precision={2} prefix="$" /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title="物流费" value={totalShip} precision={2} prefix="$" /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title="毛利" value={profit} precision={2} prefix="$" valueStyle={{ color: profit > 0 ? '#52c41a' : '#f5222d' }} /></Card></Col>
      </Row>
      <Card bordered={false} title="销售明细">
        <Table
          size="middle"
          dataSource={list}
          columns={columns as any}
          rowKey="id"
          loading={isLoading}
          pagination={{ pageSize: 20 }}
        />
      </Card>
    </div>
  );
}

// ============ 入口 ============
export default function DataCenter() {
  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>数据中心</Title>
      <Text type="secondary">运营总览 · 商品 · 店铺 · 销售 · 流量分析</Text>
      <Tabs
        style={{ marginTop: 12 }}
        defaultActiveKey="overview"
        items={[
          { key: 'overview', label: '运营总览', icon: <AppstoreOutlined />, children: <OverviewTab /> },
          { key: 'product', label: '商品分析', icon: <BarChartOutlined />, children: <ProductAnalysisTab /> },
          { key: 'shop', label: '店铺统计', icon: <ShopOutlined />, children: <ShopStatTab /> },
          { key: 'sale', label: '销售报表', icon: <LineChartOutlined />, children: <SalesReportTab /> },
          { key: 'profit', label: '利润分析', icon: <FundOutlined />, children: <Empty description="请前往 财务管理 → 利润报表 查看" /> },
          { key: 'traffic', label: '流量分析', icon: <RiseOutlined />, children: <Empty description="流量数据需要广告数据接入" /> },
        ]}
      />
    </div>
  );
}
