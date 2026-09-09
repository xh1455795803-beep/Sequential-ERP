// BI 数据看板 - 销售漏斗 / 商品排行 / 地理分布 / 时段分析 / 客户价值 / 库存健康度
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Row,
  Col,
  Card,
  Statistic,
  Segmented,
  Tag,
  Space,
  Typography,
  Skeleton,
  Empty,
  Table,
  Progress,
  List,
  Tooltip,
} from 'antd';
import {
  DollarOutlined,
  ShoppingCartOutlined,
  RiseOutlined,
  FallOutlined,
  PercentageOutlined,
  UserOutlined,
  GlobalOutlined,
  ClockCircleOutlined,
  StockOutlined,
  FireOutlined,
  CrownOutlined,
  WarningOutlined,
  TrophyOutlined,
  FundOutlined,
  ShopOutlined,
  AimOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { biApi } from '../api';

const { Title, Text } = Typography;

type RangeKey = '7d' | '30d' | '90d' | 'all';
const RANGE_OPTIONS: { label: string; value: RangeKey }[] = [
  { label: '近 7 天', value: '7d' },
  { label: '近 30 天', value: '30d' },
  { label: '近 90 天', value: '90d' },
  { label: '全部', value: 'all' },
];

// 漏斗状态顺序 (从上游到下游)
const FUNNEL_STAGES: { key: string; label: string; color: string }[] = [
  { key: 'pending', label: '待付款', color: '#faad14' },
  { key: 'pay', label: '已付款', color: '#1677ff' },
  { key: 'toship', label: '待发货', color: '#13c2c2' },
  { key: 'shipped', label: '已发货', color: '#722ed1' },
  { key: 'done', label: '已完成', color: '#52c41a' },
];

// RFM 标签颜色
const RFM_TIER_COLOR: Record<string, string> = {
  '高价值客户': 'red',
  '重点保持客户': 'volcano',
  '重点发展客户': 'orange',
  '重点挽留客户': 'gold',
  '一般价值客户': 'blue',
  '低价值客户': 'default',
};

export default function BiDashboardPage() {
  const [range, setRange] = useState<RangeKey>('30d');

  // 一次性拉取综合看板数据
  const { data, isLoading } = useQuery({
    queryKey: ['bi-overview', range],
    queryFn: () => biApi.overview(range),
  });

  // KPI 卡片
  const kpiCards = data?.kpi
    ? [
        {
          title: '销售额',
          value: data.kpi.totalAmount,
          suffix: 'USD',
          precision: 2,
          icon: <DollarOutlined style={{ color: '#1677ff' }} />,
          growth: data.kpi.amountGrowth,
        },
        {
          title: '订单数',
          value: data.kpi.orderCount,
          suffix: '单',
          icon: <ShoppingCartOutlined style={{ color: '#52c41a' }} />,
          growth: data.kpi.countGrowth,
        },
        {
          title: '毛利润',
          value: data.kpi.grossProfit,
          suffix: 'USD',
          precision: 2,
          icon: <FundOutlined style={{ color: '#fa541c' }} />,
        },
        {
          title: '毛利率',
          value: data.kpi.grossMargin,
          suffix: '%',
          precision: 2,
          icon: <PercentageOutlined style={{ color: '#722ed1' }} />,
        },
        {
          title: '客单价',
          value: data.kpi.aov,
          suffix: 'USD',
          precision: 2,
          icon: <CrownOutlined style={{ color: '#faad14' }} />,
        },
      ]
    : [];

  // 销售趋势图配置
  const trendOption = {
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    legend: { data: ['销售额', '订单数', '利润'], right: 10, top: 0 },
    grid: { left: 50, right: 50, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: (data?.salesTrend || []).map((t: any) => t.date) },
    yAxis: [
      { type: 'value', name: '金额(USD)', position: 'left' },
      { type: 'value', name: '订单数', position: 'right' },
    ],
    series: [
      {
        name: '销售额',
        type: 'line',
        smooth: true,
        areaStyle: { opacity: 0.15 },
        itemStyle: { color: '#1677ff' },
        data: (data?.salesTrend || []).map((t: any) => t.amount),
      },
      {
        name: '利润',
        type: 'line',
        smooth: true,
        itemStyle: { color: '#fa541c' },
        data: (data?.salesTrend || []).map((t: any) => t.profit),
      },
      {
        name: '订单数',
        type: 'bar',
        yAxisIndex: 1,
        itemStyle: { color: '#52c41a', opacity: 0.5 },
        barWidth: 14,
        data: (data?.salesTrend || []).map((t: any) => t.count),
      },
    ],
  };

  // 销售漏斗图配置
  const funnelData = (data?.funnel?.stages || []).map((s: any) => ({
    name: FUNNEL_STAGES.find((f) => f.key === s.status)?.label || s.status,
    value: s.count,
    itemStyle: { color: FUNNEL_STAGES.find((f) => f.key === s.status)?.color || '#999' },
  }));
  const funnelOption = {
    tooltip: {
      trigger: 'item',
      formatter: (p: any) => `${p.name}<br/>${p.value} 单<br/>转化率 ${p.percent}%`,
    },
    legend: { bottom: 0, data: funnelData.map((d: any) => d.name) },
    series: [
      {
        name: '销售漏斗',
        type: 'funnel',
        left: '10%',
        right: '10%',
        top: 20,
        bottom: 40,
        width: '80%',
        min: 0,
        max: Math.max(...funnelData.map((d: any) => d.value), 1),
        minSize: '0%',
        maxSize: '100%',
        sort: 'descending',
        gap: 2,
        label: { show: true, position: 'inside', formatter: '{b}\n{c} 单' },
        data: funnelData,
      },
    ],
  };

  // 商品 TOP 排行 - 横向柱状图
  const topProductsOption = {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 100, right: 30, top: 10, bottom: 30 },
    xAxis: { type: 'value', name: '销售额(USD)' },
    yAxis: {
      type: 'category',
      inverse: true,
      data: (data?.topProducts || []).map((p: any) => p.name).reverse(),
      axisLabel: { width: 90, overflow: 'truncate' },
    },
    series: [
      {
        name: '销售额',
        type: 'bar',
        itemStyle: { color: '#1677ff', borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', formatter: '{c}' },
        data: (data?.topProducts || []).map((p: any) => p.amount).reverse(),
      },
    ],
  };

  // 国家分布 - 饼图
  const countryOption = {
    tooltip: { trigger: 'item', formatter: '{b}<br/>{c} 单 ({d}%)' },
    legend: { type: 'scroll', orient: 'vertical', right: 10, top: 'middle' },
    series: [
      {
        name: '订单分布',
        type: 'pie',
        radius: ['40%', '70%'],
        center: ['38%', '50%'],
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
        label: { show: false },
        data: (data?.countryDist || []).map((c: any) => ({ name: c.country, value: c.count })),
      },
    ],
  };

  // 平台分布 - 玫瑰图
  const platformOption = {
    tooltip: { trigger: 'item', formatter: '{b}<br/>{c} 单 ({d}%)' },
    legend: { bottom: 0 },
    series: [
      {
        name: '平台分布',
        type: 'pie',
        radius: [30, 100],
        center: ['50%', '45%'],
        roseType: 'area',
        itemStyle: { borderRadius: 4 },
        data: (data?.platformDist || []).map((p: any) => ({ name: p.platform, value: p.count })),
      },
    ],
  };

  // 时段分布 - 柱状图
  const hourlyOption = {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 40, right: 20, top: 20, bottom: 30 },
    xAxis: {
      type: 'category',
      data: (data?.hourlyDist || []).map((h: any) => `${h.hour}时`),
    },
    yAxis: { type: 'value', name: '订单数' },
    series: [
      {
        name: '订单数',
        type: 'bar',
        itemStyle: {
          color: (params: any) => {
            // 颜色随订单数高低渐变
            const max = Math.max(...(data?.hourlyDist || []).map((h: any) => h.count), 1);
            const ratio = params.value / max;
            const r = Math.round(22 + (250 - 22) * ratio);
            const g = Math.round(119 + (173 - 119) * ratio);
            const b = Math.round(255 + (20 - 255) * ratio);
            return `rgb(${r},${g},${b})`;
          },
          borderRadius: [4, 4, 0, 0],
        },
        data: (data?.hourlyDist || []).map((h: any) => h.count),
      },
    ],
  };

  // RFM 表格列
  const rfmColumns = [
    {
      title: '客户',
      dataIndex: 'name',
      key: 'name',
      render: (v: string, r: any) => (
        <Space>
          <UserOutlined />
          <span>{v || r.email || '匿名'}</span>
        </Space>
      ),
    },
    {
      title: 'R (最近购买)',
      dataIndex: 'recency',
      key: 'recency',
      sorter: (a: any, b: any) => a.recency - b.recency,
      render: (v: number) => <Tag>{v} 天前</Tag>,
    },
    {
      title: 'F (购买频次)',
      dataIndex: 'frequency',
      key: 'frequency',
      sorter: (a: any, b: any) => a.frequency - b.frequency,
      render: (v: number) => <Tag color="blue">{v} 次</Tag>,
    },
    {
      title: 'M (消费金额)',
      dataIndex: 'monetary',
      key: 'monetary',
      sorter: (a: any, b: any) => a.monetary - b.monetary,
      render: (v: number) => <Text strong>${v.toFixed(2)}</Text>,
    },
    {
      title: '客户分层',
      dataIndex: 'tier',
      key: 'tier',
      render: (v: string) => <Tag color={RFM_TIER_COLOR[v] || 'default'}>{v}</Tag>,
    },
  ];

  return (
    <div>
      <Row align="middle" justify="space-between" style={{ marginBottom: 12 }}>
        <Col>
          <Title level={4} style={{ margin: 0 }}>
            <FireOutlined style={{ color: '#fa541c' }} /> BI 数据看板
          </Title>
          <Text type="secondary">深度分析: 销售趋势 / 转化漏斗 / 商品排行 / 客户价值</Text>
        </Col>
        <Col>
          <Segmented
            options={RANGE_OPTIONS}
            value={range}
            onChange={(v) => setRange(v as RangeKey)}
          />
        </Col>
      </Row>

      {isLoading || !data ? (
        <Skeleton active style={{ marginTop: 16 }} />
      ) : (
        <>
          {/* KPI 卡片 */}
          <Row gutter={16}>
            {kpiCards.map((k) => (
              <Col key={k.title} xs={24} sm={12} md={8} lg={Math.floor(24 / kpiCards.length)}>
                <Card bordered={false} hoverable bodyStyle={{ padding: 16 }}>
                  <Statistic
                    title={k.title}
                    value={k.value}
                    precision={k.precision}
                    suffix={k.suffix}
                    prefix={<span style={{ marginRight: 8 }}>{k.icon}</span>}
                  />
                  {k.growth !== undefined && (
                    <div style={{ marginTop: 4, fontSize: 12 }}>
                      {k.growth >= 0 ? (
                        <Text type="success">
                          <RiseOutlined /> 环比 +{k.growth.toFixed(1)}%
                        </Text>
                      ) : (
                        <Text type="danger">
                          <FallOutlined /> 环比 {k.growth.toFixed(1)}%
                        </Text>
                      )}
                    </div>
                  )}
                </Card>
              </Col>
            ))}
          </Row>

          {/* 销售趋势 */}
          <Card
            title={<Space><LineChartOutlined />销售趋势</Space>}
            bordered={false}
            style={{ marginTop: 16 }}
            extra={<Text type="secondary">按日聚合 (金额/订单数/利润)</Text>}
          >
            {data.salesTrend?.length ? (
              <ReactECharts option={trendOption} style={{ height: 320 }} />
            ) : (
              <Empty />
            )}
          </Card>

          {/* 第二行: 漏斗 + 平台分布 */}
          <Row gutter={16} style={{ marginTop: 16 }}>
            <Col xs={24} md={14}>
              <Card title={<Space><AimOutlined />销售转化漏斗</Space>} bordered={false}>
                {funnelData.length ? (
                  <ReactECharts option={funnelOption} style={{ height: 360 }} />
                ) : (
                  <Empty />
                )}
                {data.funnel?.conversion && (
                  <div style={{ marginTop: 8 }}>
                    <Text type="secondary">整体转化率: </Text>
                    <Text strong style={{ color: '#52c41a' }}>
                      {data.funnel.conversion}%
                    </Text>
                  </div>
                )}
              </Card>
            </Col>
            <Col xs={24} md={10}>
              <Card title={<Space><ShopOutlined />平台分布</Space>} bordered={false}>
                {data.platformDist?.length ? (
                  <ReactECharts option={platformOption} style={{ height: 360 }} />
                ) : (
                  <Empty />
                )}
              </Card>
            </Col>
          </Row>

          {/* 第三行: 商品 TOP + 地理分布 */}
          <Row gutter={16} style={{ marginTop: 16 }}>
            <Col xs={24} md={14}>
              <Card title={<Space><TrophyOutlined />商品 TOP 排行</Space>} bordered={false}>
                {data.topProducts?.length ? (
                  <ReactECharts option={topProductsOption} style={{ height: 400 }} />
                ) : (
                  <Empty />
                )}
              </Card>
            </Col>
            <Col xs={24} md={10}>
              <Card title={<Space><GlobalOutlined />地理分布 (国家)</Space>} bordered={false}>
                {data.countryDist?.length ? (
                  <ReactECharts option={countryOption} style={{ height: 400 }} />
                ) : (
                  <Empty />
                )}
              </Card>
            </Col>
          </Row>

          {/* 第四行: 时段分析 + 库存健康度 */}
          <Row gutter={16} style={{ marginTop: 16 }}>
            <Col xs={24} md={14}>
              <Card
                title={<Space><ClockCircleOutlined />下单时段分布</Space>}
                bordered={false}
                extra={<Tooltip title="识别下单高峰, 用于排班与营销"><Text type="secondary">?</Text></Tooltip>}
              >
                {data.hourlyDist?.length ? (
                  <ReactECharts option={hourlyOption} style={{ height: 280 }} />
                ) : (
                  <Empty />
                )}
              </Card>
            </Col>
            <Col xs={24} md={10}>
              <Card title={<Space><StockOutlined />库存健康度</Space>} bordered={false}>
                {data.inventoryHealth ? (
                  <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <Row gutter={8}>
                      <Col span={12}>
                        <Statistic
                          title="在售 SKU"
                          value={data.inventoryHealth.totalSkus}
                          prefix={<StockOutlined />}
                        />
                      </Col>
                      <Col span={12}>
                        <Statistic
                          title="总库存"
                          value={data.inventoryHealth.totalQuantity}
                          prefix={<StockOutlined />}
                        />
                      </Col>
                    </Row>
                    <Row gutter={8}>
                      <Col span={12}>
                        <Statistic
                          title="总货值 (USD)"
                          value={data.inventoryHealth.totalValue}
                          precision={2}
                          prefix={<DollarOutlined />}
                        />
                      </Col>
                      <Col span={12}>
                        <Statistic
                          title="平均周转天数"
                          value={data.inventoryHealth.turnoverDays}
                          suffix="天"
                          prefix={<RiseOutlined />}
                        />
                      </Col>
                    </Row>
                    <div>
                      <Text type="secondary">库存预警分布</Text>
                      <div style={{ marginTop: 4 }}>
                        <Text type="danger" strong>
                          <WarningOutlined /> 严重缺货: {data.inventoryHealth.critical} SKU
                        </Text>
                        <Progress
                          percent={
                            data.inventoryHealth.totalSkus > 0
                              ? Math.round((data.inventoryHealth.critical / data.inventoryHealth.totalSkus) * 100)
                              : 0
                          }
                          size="small"
                          status="exception"
                          showInfo={false}
                        />
                      </div>
                      <div>
                        <Text style={{ color: '#faad14' }} strong>
                          <WarningOutlined /> 低库存: {data.inventoryHealth.warning} SKU
                        </Text>
                        <Progress
                          percent={
                            data.inventoryHealth.totalSkus > 0
                              ? Math.round((data.inventoryHealth.warning / data.inventoryHealth.totalSkus) * 100)
                              : 0
                          }
                          size="small"
                          strokeColor="#faad14"
                          showInfo={false}
                        />
                      </div>
                      <div>
                        <Text type="success" strong>
                          健康: {data.inventoryHealth.healthy} SKU
                        </Text>
                        <Progress
                          percent={
                            data.inventoryHealth.totalSkus > 0
                              ? Math.round((data.inventoryHealth.healthy / data.inventoryHealth.totalSkus) * 100)
                              : 0
                          }
                          size="small"
                          status="success"
                          showInfo={false}
                        />
                      </div>
                    </div>
                    {data.inventoryHealth.critical > 0 && (
                      <List
                        size="small"
                        header={<Text type="danger">需立即补货</Text>}
                        dataSource={data.inventoryHealth.topCriticalList || []}
                        renderItem={(item: any) => (
                          <List.Item style={{ padding: '4px 0' }}>
                            <Text ellipsis style={{ flex: 1 }}>
                              {item.name}
                            </Text>
                            <Tag color="red" style={{ marginLeft: 8 }}>
                              库存 {item.available}
                            </Tag>
                          </List.Item>
                        )}
                      />
                    )}
                  </Space>
                ) : (
                  <Empty />
                )}
              </Card>
            </Col>
          </Row>

          {/* 第五行: RFM 客户价值 */}
          <Card
            title={<Space><CrownOutlined />客户价值 (RFM 模型)</Space>}
            bordered={false}
            style={{ marginTop: 16 }}
            extra={<Text type="secondary">R=最近购买 F=频次 M=金额</Text>}
          >
            {data.rfm?.length ? (
              <Table
                size="small"
                rowKey={(r: any) => r.customerId || r.email || Math.random()}
                columns={rfmColumns as any}
                dataSource={data.rfm}
                pagination={false}
              />
            ) : (
              <Empty description="暂无客户数据" />
            )}
          </Card>
        </>
      )}
    </div>
  );
}

// 用作 icon 的本地组件
function LineChartOutlined() {
  return <RiseOutlined />;
}
