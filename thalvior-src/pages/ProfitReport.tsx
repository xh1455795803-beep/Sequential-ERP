import { useState, useMemo } from 'react';
import {
  Card,
  Row,
  Col,
  Statistic,
  Table,
  DatePicker,
  Select,
  Button,
  Space,
  Typography,
  Tag,
  Progress,
} from 'antd';
import { DownloadOutlined, ReloadOutlined, FundOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

function genProfit() {
  const shops = ['Amazon-US-店1', 'Shopee-马来-店2', 'TikTok-印尼-店3', 'Lazada-泰国-店4', 'eBay-DE-店5', '速卖通-俄-店6'];
  return shops.map((s, i) => {
    const sales = 30000 + Math.floor(Math.random() * 200000);
    const cost = sales * (0.35 + Math.random() * 0.15);
    const ship = sales * (0.05 + Math.random() * 0.05);
    const fee = sales * (0.08 + Math.random() * 0.05);
    const profit = sales - cost - ship - fee;
    return {
      key: String(i),
      shop: s,
      sales: +sales.toFixed(2),
      cost: +cost.toFixed(2),
      ship: +ship.toFixed(2),
      fee: +fee.toFixed(2),
      profit: +profit.toFixed(2),
      rate: +((profit / sales) * 100).toFixed(2),
    };
  });
}

export default function ProfitReport() {
  const [data] = useState(() => genProfit());

  const totals = useMemo(() => {
    const sum = (k: keyof (typeof data)[number]) => data.reduce((s, x) => s + (x[k] as number), 0);
    const sales = sum('sales');
    const profit = sum('profit');
    return {
      sales,
      profit,
      rate: +((profit / sales) * 100).toFixed(2),
      orders: 4320,
    };
  }, [data]);

  const barOption = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['销售额', '净利润'], top: 0, right: 10 },
    grid: { left: 60, right: 30, top: 40, bottom: 40 },
    xAxis: { type: 'category', data: data.map((d) => d.shop) },
    yAxis: { type: 'value' },
    series: [
      {
        name: '销售额',
        type: 'bar',
        barWidth: 18,
        itemStyle: { color: '#1677ff', borderRadius: [4, 4, 0, 0] },
        data: data.map((d) => d.sales),
      },
      {
        name: '净利润',
        type: 'bar',
        barWidth: 18,
        itemStyle: { color: '#52c41a', borderRadius: [4, 4, 0, 0] },
        data: data.map((d) => d.profit),
      },
    ],
  };

  const pieOption = {
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    series: [
      {
        name: '成本构成',
        type: 'pie',
        radius: ['40%', '70%'],
        itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
        label: { formatter: '{b}\n{d}%' },
        data: [
          { value: 38, name: '商品成本' },
          { value: 22, name: '物流费用' },
          { value: 18, name: '平台佣金' },
          { value: 12, name: '广告费' },
          { value: 10, name: '其他' },
        ],
      },
    ],
  };

  const columns = [
    { title: '店铺', dataIndex: 'shop', fixed: 'left' as const, width: 180 },
    { title: '销售额(USD)', dataIndex: 'sales', align: 'right' as const, render: (v: number) => v.toLocaleString() },
    { title: '商品成本', dataIndex: 'cost', align: 'right' as const, render: (v: number) => v.toLocaleString() },
    { title: '物流费用', dataIndex: 'ship', align: 'right' as const, render: (v: number) => v.toLocaleString() },
    { title: '平台佣金', dataIndex: 'fee', align: 'right' as const, render: (v: number) => v.toLocaleString() },
    {
      title: '净利润',
      dataIndex: 'profit',
      align: 'right' as const,
      render: (v: number) => (
        <span style={{ color: v > 0 ? '#52c41a' : '#f5222d', fontWeight: 600 }}>
          {v.toLocaleString()}
        </span>
      ),
    },
    {
      title: '利润率',
      dataIndex: 'rate',
      align: 'right' as const,
      render: (v: number) => (
        <Tag color={v > 30 ? 'green' : v > 15 ? 'blue' : v > 0 ? 'orange' : 'red'}>
          {v}%
        </Tag>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>利润报表</Title>
      <Text type="secondary">按店铺 / 平台 / SKU 多维度分析真实利润, 扣除商品成本 / 物流 / 平台费 / 广告</Text>

      <Card bordered={false} style={{ marginTop: 12 }}>
        <Space wrap>
          <RangePicker defaultValue={[dayjs().subtract(30, 'day'), dayjs()]} />
          <Select
            defaultValue="shop"
            style={{ width: 160 }}
            options={[
              { label: '按店铺', value: 'shop' },
              { label: '按平台', value: 'platform' },
              { label: '按 SKU', value: 'sku' },
            ]}
          />
          <Select
            defaultValue="all"
            style={{ width: 180 }}
            options={[{ label: '全部平台', value: 'all' }, { label: 'Amazon', value: 'Amazon' }, { label: 'Shopee', value: 'Shopee' }]}
          />
          <Button icon={<ReloadOutlined />}>刷新</Button>
          <Button icon={<DownloadOutlined />}>导出</Button>
        </Space>
      </Card>

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24} sm={12} md={6}>
          <Card bordered={false}><Statistic title="销售额" value={totals.sales} precision={2} prefix="$" /></Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card bordered={false}>
            <Statistic
              title="净利润"
              value={totals.profit}
              precision={2}
              prefix="$"
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card bordered={false}>
            <Statistic
              title="利润率"
              value={totals.rate}
              precision={2}
              suffix="%"
              valueStyle={{ color: totals.rate > 20 ? '#52c41a' : '#faad14' }}
            />
            <Progress percent={Math.min(totals.rate, 100)} showInfo={false} size="small" />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card bordered={false}>
            <Statistic title="订单数" value={totals.orders} prefix={<FundOutlined />} />
          </Card>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24} md={16}>
          <Card title="店铺利润对比" bordered={false}>
            <ReactECharts option={barOption} style={{ height: 320 }} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card title="成本构成" bordered={false}>
            <ReactECharts option={pieOption} style={{ height: 320 }} />
          </Card>
        </Col>
      </Row>

      <Card title="店铺明细" bordered={false} style={{ marginTop: 16 }}>
        <Table
          size="middle"
          dataSource={data}
          columns={columns as any}
          pagination={false}
          scroll={{ x: 1000 }}
          summary={() => (
            <Table.Summary fixed>
              <Table.Summary.Row style={{ fontWeight: 600, background: '#fafafa' }}>
                <Table.Summary.Cell index={0}>合计</Table.Summary.Cell>
                <Table.Summary.Cell align="right" index={1}>{totals.sales.toLocaleString()}</Table.Summary.Cell>
                <Table.Summary.Cell align="right" index={2}>{data.reduce((s, x) => s + x.cost, 0).toLocaleString()}</Table.Summary.Cell>
                <Table.Summary.Cell align="right" index={3}>{data.reduce((s, x) => s + x.ship, 0).toLocaleString()}</Table.Summary.Cell>
                <Table.Summary.Cell align="right" index={4}>{data.reduce((s, x) => s + x.fee, 0).toLocaleString()}</Table.Summary.Cell>
                <Table.Summary.Cell align="right" index={5}>
                  <span style={{ color: '#52c41a' }}>{totals.profit.toLocaleString()}</span>
                </Table.Summary.Cell>
                <Table.Summary.Cell align="right" index={6}>
                  <Tag color="green">{totals.rate}%</Tag>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            </Table.Summary>
          )}
        />
      </Card>
    </div>
  );
}
