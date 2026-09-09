// 实时数据大屏
// - WebSocket 连接后端 /realtime
// - 实时显示: 销售指标 / 订单流 / 库存预警
// - 全屏大屏模式
import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  Card,
  Row,
  Col,
  Statistic,
  Tag,
  Space,
  Typography,
  Button,
  Badge,
  Empty,
  Progress,
  List,
  Divider,
  Tooltip,
} from 'antd';
import {
  FullscreenOutlined,
  FullscreenExitOutlined,
  ReloadOutlined,
  WifiOutlined,
  DisconnectOutlined,
  ShoppingCartOutlined,
  DollarOutlined,
  WarningOutlined,
  RiseOutlined,
  ClockCircleOutlined,
  GlobalOutlined,
  ThunderboltOutlined,
  ApiOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import dayjs from 'dayjs';
import { useAuthStore } from '../store/auth';

const { Title, Text } = Typography;

const API_BASE = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3000/api';

export default function RealtimeDashboard() {
  const { user, token } = useAuthStore();
  const [connected, setConnected] = useState(false);
  const [metrics, setMetrics] = useState<any>(null);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [inventoryAlerts, setInventoryAlerts] = useState<any[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [serverTime, setServerTime] = useState(new Date());
  const [orderChart, setOrderChart] = useState<number[]>(new Array(20).fill(0));
  const [orderLabels, setOrderLabels] = useState<string[]>(new Array(20).fill(''));
  const socketRef = useRef<Socket | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 连接 WebSocket
  useEffect(() => {
    if (!user) return;
    const socket = io(`${API_BASE.replace('/api', '')}/realtime`, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 2000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      console.log('[Realtime] connected');
    });
    socket.on('disconnect', () => {
      setConnected(false);
      console.log('[Realtime] disconnected');
    });
    socket.on('metrics', (data: any) => {
      setMetrics(data);
      setServerTime(new Date());
    });
    socket.on('recent-orders', (data: any[]) => {
      setRecentOrders(data);
      // 累积订单流图表
      setOrderChart((prev) => {
        const next = [...prev.slice(1), data.length];
        return next;
      });
      setOrderLabels((prev) => {
        const next = [...prev.slice(1), dayjs().format('HH:mm:ss')];
        return next;
      });
    });
    socket.on('inventory-alerts', (data: any[]) => {
      setInventoryAlerts(data);
    });

    return () => {
      socket.disconnect();
    };
  }, [user]);

  // 全屏
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // 当前租户指标
  const myMetrics = metrics?.perTenant?.find((p: any) => p.tenantId === user?.tenantId);

  // 订单流图表 option
  const orderChartOption = {
    grid: { top: 10, right: 10, bottom: 20, left: 30 },
    xAxis: {
      type: 'category',
      data: orderLabels,
      axisLabel: { color: '#8c8c8c', fontSize: 10 },
      axisLine: { lineStyle: { color: '#303030' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#8c8c8c' },
      splitLine: { lineStyle: { color: '#303030' } },
    },
    series: [{
      type: 'line',
      smooth: true,
      data: orderChart,
      symbol: 'circle',
      symbolSize: 6,
      lineStyle: { color: '#52c41a', width: 2 },
      itemStyle: { color: '#52c41a' },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(82,196,26,0.4)' },
            { offset: 1, color: 'rgba(82,196,26,0)' },
          ],
        },
      },
    }],
    tooltip: { trigger: 'axis' },
  };

  return (
    <div ref={containerRef} style={{ background: isFullscreen ? '#000' : 'transparent', minHeight: '100vh', padding: isFullscreen ? 16 : 0 }}>
      <Row align="middle" justify="space-between" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={3} style={{ margin: 0, color: isFullscreen ? '#fff' : undefined }}>
            <ThunderboltOutlined style={{ color: '#fa8c16' }} /> 实时数据大屏
          </Title>
          <Text type="secondary">
            <ClockCircleOutlined /> {serverTime.toLocaleString('zh-CN')}
          </Text>
        </Col>
        <Col>
          <Space size="large">
            <Badge
              status={connected ? 'success' : 'error'}
              text={
                <Text style={{ color: isFullscreen ? '#fff' : undefined }}>
                  {connected ? <><WifiOutlined /> WebSocket 已连接</> : <><DisconnectOutlined /> 已断开</>}
                </Text>
              }
            />
            <Text type="secondary">
              <ApiOutlined /> 客户端: {user?.tenantName || '-'}
            </Text>
            <Button
              icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
              onClick={toggleFullscreen}
            >
              {isFullscreen ? '退出全屏' : '全屏'}
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => window.location.reload()}>
              重连
            </Button>
          </Space>
        </Col>
      </Row>

      {/* 顶部指标卡片 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card bordered={false} bodyStyle={{ padding: 16, background: isFullscreen ? '#141414' : undefined }}>
            <Statistic
              title={<span style={{ color: isFullscreen ? '#fff' : undefined }}>今日订单</span>}
              value={myMetrics?.todayOrders || 0}
              prefix={<ShoppingCartOutlined style={{ color: '#1677ff' }} />}
              suffix="单"
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card bordered={false} bodyStyle={{ padding: 16, background: isFullscreen ? '#141414' : undefined }}>
            <Statistic
              title={<span style={{ color: isFullscreen ? '#fff' : undefined }}>今日销售额</span>}
              value={(myMetrics?.todaySales || 0).toFixed(2)}
              prefix={<DollarOutlined style={{ color: '#52c41a' }} />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card bordered={false} bodyStyle={{ padding: 16, background: isFullscreen ? '#141414' : undefined }}>
            <Statistic
              title={<span style={{ color: isFullscreen ? '#fff' : undefined }}>待处理订单</span>}
              value={myMetrics?.pendingOrders || 0}
              prefix={<ClockCircleOutlined style={{ color: '#fa8c16' }} />}
              suffix="单"
              valueStyle={{ color: '#fa8c16' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card bordered={false} bodyStyle={{ padding: 16, background: isFullscreen ? '#141414' : undefined }}>
            <Statistic
              title={<span style={{ color: isFullscreen ? '#fff' : undefined }}>库存预警</span>}
              value={myMetrics?.lowStock || 0}
              prefix={<WarningOutlined style={{ color: '#ff4d4f' }} />}
              suffix="项"
              valueStyle={{ color: '#ff4d4f' }}
            />
          </Card>
        </Col>
      </Row>

      {/* 第二行: 全局指标 + 订单流图 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={8}>
          <Card
            title={
              <Space>
                <GlobalOutlined />
                <span style={{ color: isFullscreen ? '#fff' : undefined }}>全平台总览</span>
              </Space>
            }
            bordered={false}
            bodyStyle={{ background: isFullscreen ? '#141414' : undefined }}
          >
            <Space direction="vertical" style={{ width: '100%' }} size={12}>
              <Row>
                <Col span={12}>
                  <Statistic
                    title={<span style={{ color: isFullscreen ? '#fff' : undefined }}>租户数</span>}
                    value={metrics?.totalTenants || 0}
                  />
                </Col>
                <Col span={12}>
                  <Statistic
                    title={<span style={{ color: isFullscreen ? '#fff' : undefined }}>今日总订单</span>}
                    value={metrics?.totalTodayOrders || 0}
                    prefix={<ShoppingCartOutlined />}
                  />
                </Col>
              </Row>
              <Divider style={{ margin: '8px 0' }} />
              <Statistic
                title={<span style={{ color: isFullscreen ? '#fff' : undefined }}>全平台今日销售</span>}
                value={(metrics?.totalTodaySales || 0).toFixed(2)}
                prefix={<RiseOutlined style={{ color: '#52c41a' }} />}
                valueStyle={{ color: '#52c41a', fontSize: 24 }}
              />
              <div>
                <Text type="secondary">总待处理: {metrics?.totalPending || 0}</Text>
                <Progress
                  percent={Math.min(100, ((metrics?.totalPending || 0) / Math.max(1, (metrics?.totalTodayOrders || 1))) * 100)}
                  showInfo={false}
                  strokeColor="#fa8c16"
                />
              </div>
              <div>
                <Text type="secondary">总库存预警: {metrics?.totalLowStock || 0}</Text>
                <Progress
                  percent={Math.min(100, ((metrics?.totalLowStock || 0) / Math.max(1, (metrics?.totalTenants || 1) * 10)) * 100)}
                  showInfo={false}
                  strokeColor="#ff4d4f"
                />
              </div>
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={16}>
          <Card
            title={
              <Space>
                <RiseOutlined />
                <span style={{ color: isFullscreen ? '#fff' : undefined }}>订单流 (实时)</span>
                <Tag color="green">LIVE</Tag>
              </Space>
            }
            bordered={false}
            bodyStyle={{ background: isFullscreen ? '#141414' : undefined, padding: 12 }}
          >
            <ReactECharts option={orderChartOption} style={{ height: 280 }} />
          </Card>
        </Col>
      </Row>

      {/* 第三行: 实时订单 + 库存预警 */}
      <Row gutter={16}>
        <Col xs={24} lg={12}>
          <Card
            title={
              <Space>
                <ShoppingCartOutlined />
                <span style={{ color: isFullscreen ? '#fff' : undefined }}>实时订单</span>
                {recentOrders.length > 0 && <Badge count={recentOrders.length} />}
              </Space>
            }
            bordered={false}
            bodyStyle={{ background: isFullscreen ? '#141414' : undefined }}
          >
            {recentOrders.length === 0 ? (
              <Empty description={<span style={{ color: isFullscreen ? '#fff' : undefined }}>等待订单推送...</span>} />
            ) : (
              <List
                size="small"
                dataSource={recentOrders}
                renderItem={(o: any) => (
                  <List.Item style={{ borderBottom: isFullscreen ? '1px solid #303030' : undefined }}>
                    <Space>
                      <Tag color="blue">{o.orderNo || o.id.slice(-6)}</Tag>
                      <Text style={{ color: isFullscreen ? '#fff' : undefined }} strong>
                        {(o.currency || 'USD')} {o.totalAmount?.toFixed(2) || '0.00'}
                      </Text>
                      <Tag color="default">{o.country || '-'}</Tag>
                      <Text type="secondary" style={{ fontSize: 12 }}>{o.buyerName || '-'}</Text>
                      <Tag color={
                        o.status === 'pending' ? 'default' :
                        o.status === 'paid' ? 'cyan' :
                        o.status === 'shipped' ? 'blue' :
                        o.status === 'done' || o.status === 'completed' ? 'green' :
                        o.status === 'cancelled' ? 'red' : 'default'
                      }>{o.status}</Tag>
                    </Space>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {o.age < 60 ? `${o.age}s前` : `${Math.round(o.age / 60)}m前`}
                    </Text>
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            title={
              <Space>
                <WarningOutlined />
                <span style={{ color: isFullscreen ? '#fff' : undefined }}>库存预警</span>
                {inventoryAlerts.length > 0 && <Badge count={inventoryAlerts.length} style={{ backgroundColor: '#ff4d4f' }} />}
              </Space>
            }
            bordered={false}
            bodyStyle={{ background: isFullscreen ? '#141414' : undefined }}
          >
            {inventoryAlerts.length === 0 ? (
              <Empty description={<span style={{ color: isFullscreen ? '#fff' : undefined }}>暂无库存预警</span>} />
            ) : (
              <List
                size="small"
                dataSource={inventoryAlerts}
                renderItem={(i: any) => (
                  <List.Item style={{ borderBottom: isFullscreen ? '1px solid #303030' : undefined }}>
                    <Space>
                      <Tag color="orange">SKU</Tag>
                      <Text code style={{ fontSize: 12 }}>{i.sku || i.productId?.slice(-8)}</Text>
                      <Tag color="red">库存: {i.quantity}</Tag>
                    </Space>
                    <Tooltip title={i.warehouseId}>
                      <Text type="secondary" style={{ fontSize: 12 }}>{i.warehouseId?.slice(-6) || '-'}</Text>
                    </Tooltip>
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
