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

const { Title, Text } = Typography;

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending: { label: '待付款', color: 'orange' },
  pay: { label: '已付款', color: 'blue' },
  toship: { label: '待发货', color: 'gold' },
  shipped: { label: '已发货', color: 'cyan' },
  done: { label: '已完成', color: 'green' },
  cancel: { label: '已取消', color: 'default' },
};

// 快捷入口: 点击跳转到对应业务模块
const SHORTCUTS = [
  { key: 'product', title: '产品管理', desc: 'SKU / 商品', icon: <TagsOutlined />, color: '#2B5CF6', bg: '#EEF3FF', path: '/product/sku/list' },
  { key: 'order', title: '订单管理', desc: '订单 / 售后', icon: <ShoppingCartOutlined />, color: '#00B264', bg: '#E8F9F1', path: '/order/list' },
  { key: 'auth', title: '授权中心', desc: '店铺授权', icon: <SafetyOutlined />, color: '#722ED1', bg: '#F5EEFF', path: '/auth/shop' },
  { key: 'purchase', title: '采购管理', desc: '采购 / 供应商', icon: <ImportOutlined />, color: '#FA8C16', bg: '#FFF3E6', path: '/purchase/supplier' },
  { key: 'warehouse', title: '仓库管理', desc: '库存 / 出入库', icon: <InboxOutlined />, color: '#13C2C2', bg: '#E6FBFB', path: '/warehouse/inventory' },
  { key: 'logistics', title: '物流分拨', desc: '渠道 / 面单', icon: <TruckOutlined />, color: '#F5222D', bg: '#FFF0F0', path: '/logistics/channel' },
  { key: 'finance', title: '财务管理', desc: '利润 / 对账', icon: <DollarOutlined />, color: '#FA541C', bg: '#FFF2E8', path: '/finance/profit' },
  { key: 'data', title: '数据中心', desc: '报表 / BI', icon: <BarChartOutlined />, color: '#1677FF', bg: '#E6F4FF', path: '/data/overview' },
];

// KPI 卡片点击跳转映射
const KPI_LINK: Record<string, string> = {
  在售商品: '/product/sku/list',
  待发货: '/order/handle/toship',
  活跃店铺: '/auth/shop',
  仓库数: '/warehouse/inventory',
  累计订单: '/order/list',
  累计销售额: '/finance/profit',
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: () => dashboardApi.overview(),
  });

  const trendOption = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['销售额', '订单数'], right: 10, top: 0 },
    grid: { left: 40, right: 20, top: 30, bottom: 30 },
    xAxis: { type: 'category', data: (data?.trend || []).map((t: any) => t.date) },
    yAxis: [
      { type: 'value', name: '销售额(USD)' },
      { type: 'value', name: '订单数', position: 'right' },
    ],
    series: [
      {
        name: '销售额',
        type: 'line',
        smooth: true,
        areaStyle: { opacity: 0.15 },
        itemStyle: { color: '#1677ff' },
        data: (data?.trend || []).map((t: any) => t.amount),
      },
      {
        name: '订单数',
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
        name: '平台店铺数',
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
        { title: '累计销售额', value: data.kpi.totalAmount, suffix: 'USD', icon: <DollarOutlined style={{ fontSize: 22, color: '#1677ff' }} /> },
        { title: '累计订单', value: data.kpi.totalOrders, suffix: '单', icon: <ShoppingCartOutlined style={{ fontSize: 22, color: '#52c41a' }} /> },
        { title: '在售商品', value: data.kpi.activeProducts, suffix: 'SKU', icon: <ShoppingOutlined style={{ fontSize: 22, color: '#faad14' }} /> },
        { title: '待发货', value: data.kpi.pendingShip, suffix: '单', icon: <ClockCircleOutlined style={{ fontSize: 22, color: '#f5222d' }} /> },
        { title: '活跃店铺', value: data.kpi.activeShops, suffix: '家', icon: <ShopOutlined style={{ fontSize: 22, color: '#722ed1' }} /> },
        { title: '仓库数', value: data.kpi.warehouses, suffix: '个', icon: <DatabaseOutlined style={{ fontSize: 22, color: '#13c2c2' }} /> },
      ]
    : [];

  const statusList = (data?.statusStats || []).map((s: any) => ({
    ...s,
    ...(STATUS_LABEL[s.status] || { label: s.status, color: 'default' }),
  }));

  const todos = data
    ? [
        { text: `${data.todos.pendingShip} 笔订单待发货`, tag: '紧急', color: 'red', path: '/order/handle/toship' },
        { text: `${data.todos.lowStock} 个 SKU 库存预警`, tag: '关注', color: 'orange', path: '/warehouse/warning' },
        { text: `${data.todos.pendingRefund ?? 0} 笔退款单待处理`, tag: '待办', color: 'gold', path: '/order/aftersale/refund' },
        { text: `${data.todos.illegalProducts ?? 0} 件商品涉嫌违规`, tag: '合规', color: 'purple', path: '/product/online/illegal' },
      ].filter((it) => !/^0 (笔|个|件)/.test(it.text))
    : [];

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>首页总览</Title>
      <Text type="secondary">
        {data ? `当前租户: ${data.kpi.totalOrders} 笔订单 / ${data.kpi.activeShops} 家店铺 / ${data.kpi.activeProducts} 个 SKU` : '加载中...'}
      </Text>

      {isLoading || !data ? (
        <Skeleton active style={{ marginTop: 16 }} />
      ) : (
        <>
          {/* ===== 快捷入口 ===== */}
          <Card bordered={false} style={{ marginTop: 16 }} title="快捷入口">
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
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#1F2329' }}>{s.title}</div>
                      <div style={{ fontSize: 12, color: '#86909C', marginTop: 2 }}>{s.desc}</div>
                    </div>
                  </div>
                </Col>
              ))}
            </Row>
          </Card>

          {/* ===== KPI 卡片 ===== */}
          <Row gutter={16} style={{ marginTop: 16 }}>
            {kpis.map((k) => (
              <Col key={k.title} xs={24} sm={12} md={8} lg={4}>
                <Card
                  bordered={false}
                  hoverable
                  bodyStyle={{ padding: 16, cursor: KPI_LINK[k.title] ? 'pointer' : 'default' }}
                  onClick={() => KPI_LINK[k.title] && navigate(KPI_LINK[k.title])}
                >
                  <Statistic
                    title={k.title}
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
              <Card title="近 7 天销售趋势" extra={<a onClick={() => navigate('/data/sale')}>查看报表</a>} bordered={false}>
                <ReactECharts option={trendOption} style={{ height: 300 }} />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card title="平台店铺分布" bordered={false}>
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
              <Card title={<Space><RiseOutlined />订单状态分布</Space>} bordered={false}>
                <List
                  dataSource={statusList}
                  renderItem={(item: any) => (
                    <List.Item style={{ padding: '10px 0' }}>
                      <List.Item.Meta
                        avatar={<Badge color={item.color} />}
                        title={<Tag color={item.color}>{item.label}</Tag>}
                      />
                      <Text strong>{item.count} 笔</Text>
                    </List.Item>
                  )}
                />
              </Card>
            </Col>
            <Col xs={24} md={12}>
              <Card title={<Space><FireOutlined />待办中心</Space>} bordered={false}>
                <List
                  dataSource={todos}
                  locale={{ emptyText: '暂无待办事项' }}
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
