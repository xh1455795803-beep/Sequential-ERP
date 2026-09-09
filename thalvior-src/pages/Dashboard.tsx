import { useQuery } from '@tanstack/react-query';
import {
  Row,
  Col,
  Card,
  Statistic,
  List,
  Tag,
  Space,
  Typography,
  Badge,
  Skeleton,
  Empty,
} from 'antd';
import {
  DollarOutlined,
  ShoppingCartOutlined,
  ShoppingOutlined,
  ClockCircleOutlined,
  ShopOutlined,
  DatabaseOutlined,
  RiseOutlined,
  FireOutlined,
  TagsOutlined,
  ImportOutlined,
  InboxOutlined,
  TruckOutlined,
  BarChartOutlined,
  SafetyOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { dashboardApi } from '../api';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../i18n';

const { Title, Text } = Typography;

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending: { label: 'pages.dashboard.status.pending', color: 'orange' },
  pay: { label: 'pages.dashboard.status.pay', color: 'blue' },
  toship: { label: 'pages.dashboard.status.toship', color: 'gold' },
  shipped: { label: 'pages.dashboard.status.shipped', color: 'cyan' },
  done: { label: 'pages.dashboard.status.done', color: 'green' },
  cancel: { label: 'pages.dashboard.status.cancel', color: 'default' },
};

// 快捷入口: 点击跳转到对应业务模块
const SHORTCUTS = [
  { key: 'product', title: 'pages.dashboard.shortcut.product.title', desc: 'pages.dashboard.shortcut.product.desc', icon: <TagsOutlined />, color: '#2B5CF6', bg: '#EEF3FF', path: '/product/sku/list' },
  { key: 'order', title: 'pages.dashboard.shortcut.order.title', desc: 'pages.dashboard.shortcut.order.desc', icon: <ShoppingCartOutlined />, color: '#00B264', bg: '#E8F9F1', path: '/order/list' },
  { key: 'auth', title: 'pages.dashboard.shortcut.auth.title', desc: 'pages.dashboard.shortcut.auth.desc', icon: <SafetyOutlined />, color: '#722ED1', bg: '#F5EEFF', path: '/auth/shop' },
  { key: 'purchase', title: 'pages.dashboard.shortcut.purchase.title', desc: 'pages.dashboard.shortcut.purchase.desc', icon: <ImportOutlined />, color: '#FA8C16', bg: '#FFF3E6', path: '/purchase/supplier' },
  { key: 'warehouse', title: 'pages.dashboard.shortcut.warehouse.title', desc: 'pages.dashboard.shortcut.warehouse.desc', icon: <InboxOutlined />, color: '#13C2C2', bg: '#E6FBFB', path: '/warehouse/inventory' },
  { key: 'logistics', title: 'pages.dashboard.shortcut.logistics.title', desc: 'pages.dashboard.shortcut.logistics.desc', icon: <TruckOutlined />, color: '#F5222D', bg: '#FFF0F0', path: '/logistics/channel' },
  { key: 'finance', title: 'pages.dashboard.shortcut.finance.title', desc: 'pages.dashboard.shortcut.finance.desc', icon: <DollarOutlined />, color: '#FA541C', bg: '#FFF2E8', path: '/finance/profit' },
  { key: 'data', title: 'pages.dashboard.shortcut.data.title', desc: 'pages.dashboard.shortcut.data.desc', icon: <BarChartOutlined />, color: '#1677FF', bg: '#E6F4FF', path: '/data/overview' },
];

// KPI 卡片点击跳转映射
const KPI_LINK: Record<string, string> = {
  activeProducts: '/product/sku/list',
  pendingShip: '/order/handle/toship',
  activeShops: '/auth/shop',
  warehouses: '/warehouse/inventory',
  totalOrders: '/order/list',
  totalAmount: '/finance/profit',
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: () => dashboardApi.overview(),
  });

  const trendOption = {
    tooltip: { trigger: 'axis' },
    legend: { data: [t('pages.dashboard.chart.sales'), t('pages.dashboard.chart.orderCount')], right: 10, top: 0 },
    grid: { left: 40, right: 20, top: 30, bottom: 30 },
    xAxis: { type: 'category', data: (data?.trend || []).map((t: any) => t.date) },
    yAxis: [
      { type: 'value', name: t('pages.dashboard.chart.salesUsd') },
      { type: 'value', name: t('pages.dashboard.chart.orderCount'), position: 'right' },
    ],
    series: [
      {
        name: t('pages.dashboard.chart.sales'),
        type: 'line',
        smooth: true,
        areaStyle: { opacity: 0.15 },
        itemStyle: { color: '#1677ff' },
        data: (data?.trend || []).map((t: any) => t.amount),
      },
      {
        name: t('pages.dashboard.chart.orderCount'),
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        itemStyle: { color: '#52c41a' },
        data: (data?.trend || []).map((t: any) => t.count),
      },
    ],
  };

  const platformOption = {
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    series: [
      {
        name: t('pages.dashboard.chart.platformShops'),
        type: 'pie',
        radius: ['45%', '70%'],
        avoidLabelOverlap: false,
        itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
        label: { show: true, formatter: '{b}\n{d}%' },
        data: (data?.platformDist || []).map((p: any) => ({ name: p.name, value: p.count })),
      },
    ],
  };

  const kpis = data
    ? [
        { key: 'totalAmount', titleKey: 'pages.dashboard.kpi.totalAmount', value: data.kpi.totalAmount, suffix: 'USD', icon: <DollarOutlined style={{ fontSize: 22, color: '#1677ff' }} /> },
        { key: 'totalOrders', titleKey: 'pages.dashboard.kpi.totalOrders', value: data.kpi.totalOrders, suffix: t('pages.dashboard.unit.order'), icon: <ShoppingCartOutlined style={{ fontSize: 22, color: '#52c41a' }} /> },
        { key: 'activeProducts', titleKey: 'pages.dashboard.kpi.activeProducts', value: data.kpi.activeProducts, suffix: 'SKU', icon: <ShoppingOutlined style={{ fontSize: 22, color: '#faad14' }} /> },
        { key: 'pendingShip', titleKey: 'pages.dashboard.kpi.pendingShip', value: data.kpi.pendingShip, suffix: t('pages.dashboard.unit.order'), icon: <ClockCircleOutlined style={{ fontSize: 22, color: '#f5222d' }} /> },
        { key: 'activeShops', titleKey: 'pages.dashboard.kpi.activeShops', value: data.kpi.activeShops, suffix: t('pages.dashboard.unit.shop'), icon: <ShopOutlined style={{ fontSize: 22, color: '#722ed1' }} /> },
        { key: 'warehouses', titleKey: 'pages.dashboard.kpi.warehouses', value: data.kpi.warehouses, suffix: t('pages.dashboard.unit.item'), icon: <DatabaseOutlined style={{ fontSize: 22, color: '#13c2c2' }} /> },
      ]
    : [];

  const statusList = (data?.statusStats || []).map((s: any) => ({
    ...s,
    ...(STATUS_LABEL[s.status] || { label: s.status, color: 'default' }),
  }));

  const todos = data
    ? [
        { text: t('pages.dashboard.todos.pendingShip', { count: data.todos.pendingShip }), count: data.todos.pendingShip, tag: t('pages.dashboard.todos.tagUrgent'), color: 'red', path: '/order/handle/toship' },
        { text: t('pages.dashboard.todos.lowStock', { count: data.todos.lowStock }), count: data.todos.lowStock, tag: t('pages.dashboard.todos.tagWatch'), color: 'orange', path: '/warehouse/warning' },
        { text: t('pages.dashboard.todos.pendingRefund', { count: data.todos.pendingRefund ?? 0 }), count: data.todos.pendingRefund ?? 0, tag: t('pages.dashboard.todos.tagTodo'), color: 'gold', path: '/order/aftersale/refund' },
        { text: t('pages.dashboard.todos.illegalProducts', { count: data.todos.illegalProducts ?? 0 }), count: data.todos.illegalProducts ?? 0, tag: t('pages.dashboard.todos.tagCompliance'), color: 'purple', path: '/product/online/illegal' },
      ].filter((it) => it.count > 0)
    : [];

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>{t('pages.dashboard.title')}</Title>
      <Text type="secondary">
        {data ? t('pages.dashboard.tenantSummary', { totalOrders: data.kpi.totalOrders, activeShops: data.kpi.activeShops, activeProducts: data.kpi.activeProducts }) : t('pages.dashboard.loading')}
      </Text>

      {isLoading || !data ? (
        <Skeleton active style={{ marginTop: 16 }} />
      ) : (
        <>
          {/* ===== 快捷入口 ===== */}
          <Card bordered={false} style={{ marginTop: 16 }} title={t('pages.dashboard.shortcutsSection')}>
            <Row gutter={[12, 12]}>
              {SHORTCUTS.map((s) => (
                <Col key={s.key} xs={12} sm={8} md={6} lg={6} xl={3}>
                  <div
                    onClick={() => navigate(s.path)}
                    style={{
                      background: '#fff',
                      border: '1px solid #F0F1F5',
                      borderRadius: 10,
                      padding: '14px 12px',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      transition: 'all 0.2s',
                    }}
                    className="shortcut-card"
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.borderColor = s.color;
                      (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 16px ${s.color}22`;
                      (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.borderColor = '#F0F1F5';
                      (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                      (e.currentTarget as HTMLElement).style.transform = 'none';
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 9,
                          background: s.bg,
                          color: s.color,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 18,
                        }}
                      >
                        {s.icon}
                      </div>
                      <ArrowRightOutlined style={{ color: '#C9CDD4', fontSize: 12 }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#1F2329' }}>{t(s.title)}</div>
                      <div style={{ fontSize: 12, color: '#86909C', marginTop: 2 }}>{t(s.desc)}</div>
                    </div>
                  </div>
                </Col>
              ))}
            </Row>
          </Card>

          {/* ===== KPI 卡片 ===== */}
          <Row gutter={16} style={{ marginTop: 16 }}>
            {kpis.map((k) => (
              <Col key={k.key} xs={24} sm={12} md={8} lg={4}>
                <Card
                  bordered={false}
                  hoverable
                  bodyStyle={{ padding: 16, cursor: KPI_LINK[k.key] ? 'pointer' : 'default' }}
                  onClick={() => KPI_LINK[k.key] && navigate(KPI_LINK[k.key])}
                >
                  <Statistic
                    title={t(k.titleKey)}
                    value={k.value}
                    suffix={k.suffix}
                    prefix={<span style={{ marginRight: 8 }}>{k.icon}</span>}
                  />
                </Card>
              </Col>
            ))}
          </Row>

          <Row gutter={16} style={{ marginTop: 16 }}>
            <Col xs={24} md={16}>
              <Card title={t('pages.dashboard.trendTitle')} extra={<a onClick={() => navigate('/data/sale')}>{t('pages.dashboard.viewReport')}</a>} bordered={false}>
                <ReactECharts option={trendOption} style={{ height: 300 }} />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card title={t('pages.dashboard.platformDistTitle')} bordered={false}>
                {platformOption.series[0].data.length ? (
                  <ReactECharts option={platformOption} style={{ height: 300 }} />
                ) : (
                  <Empty />
                )}
              </Card>
            </Col>
          </Row>

          <Row gutter={16} style={{ marginTop: 16 }}>
            <Col xs={24} md={12}>
              <Card title={<Space><RiseOutlined />{t('pages.dashboard.orderStatusTitle')}</Space>} bordered={false}>
                <List
                  dataSource={statusList}
                  renderItem={(item: any) => (
                    <List.Item style={{ padding: '10px 0' }}>
                      <List.Item.Meta
                        avatar={<Badge color={item.color} />}
                        title={<Tag color={item.color}>{t(item.label)}</Tag>}
                      />
                      <Text strong>{t('pages.dashboard.orderCount', { count: item.count })}</Text>
                    </List.Item>
                  )}
                />
              </Card>
            </Col>
            <Col xs={24} md={12}>
              <Card title={<Space><FireOutlined />{t('pages.dashboard.todoTitle')}</Space>} bordered={false}>
                <List
                  dataSource={todos}
                  locale={{ emptyText: t('pages.dashboard.todoEmpty') }}
                  renderItem={(item: any) => (
                    <List.Item
                      style={{ padding: '10px 0', cursor: 'pointer' }}
                      onClick={() => item.path && navigate(item.path)}
                    >
                      <List.Item.Meta
                        avatar={<Badge status={item.color === 'red' ? 'error' : 'processing'} />}
                        title={<Space>{item.text}</Space>}
                      />
                      <Tag color={item.color}>{item.tag}</Tag>
                    </List.Item>
                  )}
                />
              </Card>
            </Col>
          </Row>
        </>
      )}
    </div>
  );
}
