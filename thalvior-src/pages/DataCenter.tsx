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
import { useTranslation } from '../i18n';

const { Title, Text } = Typography;

const STATUS_MAP: Record<string, { color: string; textKey: string }> = {
  pending: { color: 'default', textKey: 'pending' },
  pay: { color: 'cyan', textKey: 'pay' },
  toship: { color: 'blue', textKey: 'toship' },
  shipped: { color: 'green', textKey: 'shipped' },
  done: { color: 'green', textKey: 'done' },
  cancel: { color: 'red', textKey: 'cancel' },
  refund: { color: 'orange', textKey: 'refund' },
  abnormal: { color: 'red', textKey: 'abnormal' },
};

// ============ 运营总览 ============
function OverviewTab() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: () => dashboardApi.overview(),
  });
  const kpi = data?.kpi;

  const lineOption = {
    tooltip: { trigger: 'axis' },
    legend: { data: [t('pages.dataCenter.chart.salesUsd'), t('pages.dataCenter.chart.orderCount')], top: 0, right: 10 },
    grid: { left: 60, right: 60, top: 40, bottom: 40 },
    xAxis: { type: 'category', data: (data?.trend || []).map((tr: any) => tr.date) },
    yAxis: [
      { type: 'value', name: t('pages.dataCenter.chart.amount'), position: 'left' },
      { type: 'value', name: t('pages.dataCenter.chart.orderCount'), position: 'right' },
    ],
    series: [
      {
        name: t('pages.dataCenter.chart.salesUsd'), type: 'line', smooth: true, yAxisIndex: 0,
        itemStyle: { color: '#1677ff' },
        areaStyle: { color: 'rgba(22,119,255,0.1)' },
        data: (data?.trend || []).map((tr: any) => tr.amount),
      },
      {
        name: t('pages.dataCenter.chart.orderCount'), type: 'bar', yAxisIndex: 1,
        itemStyle: { color: '#52c41a', borderRadius: [4, 4, 0, 0] },
        data: (data?.trend || []).map((tr: any) => tr.count),
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
        <Col xs={12} md={6}><Card bordered={false}><Statistic title={t('pages.dataCenter.kpi.totalOrders')} value={kpi?.totalOrders || 0} prefix={<AppstoreOutlined />} loading={isLoading} /></Card></Col>
        <Col xs={12} md={6}><Card bordered={false}><Statistic title={t('pages.dataCenter.kpi.totalAmount')} value={kpi?.totalAmount || 0} precision={2} prefix="$" loading={isLoading} /></Card></Col>
        <Col xs={12} md={6}><Card bordered={false}><Statistic title={t('pages.dataCenter.kpi.activeProducts')} value={kpi?.activeProducts || 0} prefix={<RiseOutlined />} loading={isLoading} /></Card></Col>
        <Col xs={12} md={6}><Card bordered={false}><Statistic title={t('pages.dataCenter.kpi.pendingShip')} value={kpi?.pendingShip || 0} valueStyle={{ color: '#fa8c16' }} loading={isLoading} /></Card></Col>
      </Row>
      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24} md={16}>
          <Card title={t('pages.dataCenter.overview.trendTitle')} bordered={false}>
            <ReactECharts option={lineOption} style={{ height: 320 }} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card title={t('pages.dataCenter.overview.platformDistTitle')} bordered={false}>
            <ReactECharts option={pieOption} style={{ height: 320 }} />
          </Card>
        </Col>
      </Row>
      <Card title={t('pages.dataCenter.overview.statusTitle')} bordered={false} style={{ marginTop: 16 }}>
        <Space wrap>
          {(data?.statusStats || []).map((s: any) => (
            <Tag key={s.status} color={STATUS_MAP[s.status]?.color || 'default'}>
              {STATUS_MAP[s.status] ? t(`pages.dataCenter.status.${STATUS_MAP[s.status].textKey}`) : s.status}: {s.count}
            </Tag>
          ))}
        </Space>
      </Card>
    </div>
  );
}

// ============ 商品分析 ============
function ProductAnalysisTab() {
  const { t } = useTranslation();
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
        { value: onSale, name: t('pages.dataCenter.product.statusOnSale'), itemStyle: { color: '#52c41a' } },
        { value: off, name: t('pages.dataCenter.product.statusOffShelf'), itemStyle: { color: '#d9d9d9' } },
        { value: illegal, name: t('pages.dataCenter.product.statusViolation'), itemStyle: { color: '#f5222d' } },
      ],
    }],
  };

  const columns = [
    { title: 'SKU', dataIndex: 'sku', width: 140 },
    { title: t('pages.dataCenter.product.colProduct'), dataIndex: 'name', ellipsis: true },
    { title: t('pages.dataCenter.product.colCategory'), dataIndex: 'category', width: 120, render: (v: string) => v || '-' },
    {
      title: t('pages.dataCenter.product.colCostPrice'),
      dataIndex: 'costPrice',
      width: 120,
      align: 'right' as const,
      render: (v: number, r: any) => `${r.currency} ${(+v).toFixed(2)}`,
    },
    {
      title: t('pages.dataCenter.product.colSalePrice'),
      dataIndex: 'salePrice',
      width: 120,
      align: 'right' as const,
      render: (v: number, r: any) => `${r.currency} ${(+v).toFixed(2)}`,
    },
    {
      title: t('pages.dataCenter.product.colMargin'),
      width: 100,
      align: 'right' as const,
      render: (_: any, r: any) => {
        const m = r.salePrice > 0 ? ((r.salePrice - r.costPrice) / r.salePrice) * 100 : 0;
        return <Tag color={m > 40 ? 'green' : m > 20 ? 'blue' : 'orange'}>{m.toFixed(1)}%</Tag>;
      },
    },
    {
      title: t('pages.dataCenter.product.colStatus'),
      dataIndex: 'status',
      width: 100,
      render: (v: number) => {
        const statusTexts: Record<number, { color: string; text: string }> = {
          1: { color: 'green', text: t('pages.dataCenter.product.statusOnSale') },
          0: { color: 'default', text: t('pages.dataCenter.product.statusOffShelf') },
          2: { color: 'red', text: t('pages.dataCenter.product.statusViolation') },
        };
        return <Tag color={statusTexts[v]?.color}>{statusTexts[v]?.text || v}</Tag>;
      },
    },
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 12 }}>
        <Col span={8}><Card bordered={false}><Statistic title={t('pages.dataCenter.kpi.activeProducts')} value={onSale} valueStyle={{ color: '#52c41a' }} loading={isLoading} /></Card></Col>
        <Col span={8}><Card bordered={false}><Statistic title={t('pages.dataCenter.product.offShelfCount')} value={off} loading={isLoading} /></Card></Col>
        <Col span={8}><Card bordered={false}><Statistic title={t('pages.dataCenter.product.violationCount')} value={illegal} valueStyle={{ color: '#f5222d' }} loading={isLoading} /></Card></Col>
      </Row>
      <Row gutter={16}>
        <Col xs={24} md={8}>
          <Card title={t('pages.dataCenter.product.statusChartTitle')} bordered={false}>
            <ReactECharts option={pieOption} style={{ height: 280 }} />
          </Card>
        </Col>
        <Col xs={24} md={16}>
          <Card title={t('pages.dataCenter.product.listTitle')} bordered={false}>
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
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['shops'],
    queryFn: () => shopApi.list({ page: 1, pageSize: 50 }),
  });
  const list = data?.items || [];

  const columns = [
    { title: t('pages.dataCenter.shop.colName'), dataIndex: 'name', width: 200 },
    { title: t('pages.dataCenter.shop.colShopId'), dataIndex: 'shopId', width: 160 },
    { title: t('pages.dataCenter.shop.colPlatform'), dataIndex: ['platform', 'name'], width: 120 },
    { title: t('pages.dataCenter.shop.colRegion'), dataIndex: 'region', width: 100, render: (v: string) => v || '-' },
    { title: t('pages.dataCenter.shop.colCurrency'), dataIndex: 'currency', width: 100 },
    {
      title: t('pages.dataCenter.shop.colStatus'),
      dataIndex: 'status',
      width: 100,
      render: (v: number) => v === 1 ? <Tag color="green">{t('pages.dataCenter.shop.statusNormal')}</Tag> : v === 2 ? <Tag color="orange">{t('pages.dataCenter.shop.statusExpired')}</Tag> : <Tag>{t('pages.dataCenter.shop.statusDisabled')}</Tag>,
    },
    {
      title: t('pages.dataCenter.shop.colCreatedAt'),
      dataIndex: 'createdAt',
      width: 160,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-',
    },
  ];

  return (
    <Card bordered={false} title={t('pages.dataCenter.shop.listTitle')}>
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
  const { t } = useTranslation();
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
    { title: t('pages.dataCenter.sales.colOrderNo'), dataIndex: 'platformNo', width: 200 },
    { title: t('pages.dataCenter.sales.colBuyer'), dataIndex: 'buyerName', width: 120 },
    { title: t('pages.dataCenter.sales.colCountry'), dataIndex: 'country', width: 80 },
    {
      title: t('pages.dataCenter.sales.colAmount'),
      dataIndex: 'totalAmount',
      width: 120,
      align: 'right' as const,
      render: (v: number, r: any) => `${r.currency} ${(+v).toFixed(2)}`,
    },
    {
      title: t('pages.dataCenter.sales.colStatus'),
      dataIndex: 'status',
      width: 100,
      render: (v: string) => STATUS_MAP[v] ? <Tag color={STATUS_MAP[v].color}>{t(`pages.dataCenter.status.${STATUS_MAP[v].textKey}`)}</Tag> : <Tag>{v}</Tag>,
    },
    {
      title: t('pages.dataCenter.sales.colCreatedAt'),
      dataIndex: 'createdAt',
      width: 160,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-',
    },
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 12 }}>
        <Col span={6}><Card bordered={false}><Statistic title={t('pages.dataCenter.sales.totalSales')} value={totalSales} precision={2} prefix="$" loading={isLoading} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title={t('pages.dataCenter.sales.totalCost')} value={totalCost} precision={2} prefix="$" /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title={t('pages.dataCenter.sales.totalShipFee')} value={totalShip} precision={2} prefix="$" /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title={t('pages.dataCenter.sales.profit')} value={profit} precision={2} prefix="$" valueStyle={{ color: profit > 0 ? '#52c41a' : '#f5222d' }} /></Card></Col>
      </Row>
      <Card bordered={false} title={t('pages.dataCenter.sales.detailTitle')}>
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
  const { t } = useTranslation();
  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>{t('pages.dataCenter.title')}</Title>
      <Text type="secondary">{t('pages.dataCenter.subtitle')}</Text>
      <Tabs
        style={{ marginTop: 12 }}
        defaultActiveKey="overview"
        items={[
          { key: 'overview', label: t('pages.dataCenter.tabs.overview'), icon: <AppstoreOutlined />, children: <OverviewTab /> },
          { key: 'product', label: t('pages.dataCenter.tabs.product'), icon: <BarChartOutlined />, children: <ProductAnalysisTab /> },
          { key: 'shop', label: t('pages.dataCenter.tabs.shop'), icon: <ShopOutlined />, children: <ShopStatTab /> },
          { key: 'sale', label: t('pages.dataCenter.tabs.sales'), icon: <LineChartOutlined />, children: <SalesReportTab /> },
          { key: 'profit', label: t('pages.dataCenter.tabs.profit'), icon: <FundOutlined />, children: <Empty description={t('pages.dataCenter.comingSoon.profit')} /> },
          { key: 'traffic', label: t('pages.dataCenter.tabs.traffic'), icon: <RiseOutlined />, children: <Empty description={t('pages.dataCenter.comingSoon.traffic')} /> },
        ]}
      />
    </div>
  );
}
