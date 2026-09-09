// 广告数据报表 (P1-3.1)
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Card,
  Table,
  Tag,
  Space,
  Button,
  Form,
  Row,
  Col,
  Typography,
  Select,
  DatePicker,
  Statistic,
  Empty,
} from 'antd';
import {
  SoundOutlined,
  ReloadOutlined,
  DownloadOutlined,
  DollarOutlined,
  RiseOutlined,
  EyeOutlined,
  PercentageOutlined,
} from '@ant-design/icons';
import { adsApi, shopApi } from '../api';
import dayjs, { Dayjs } from 'dayjs';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

export default function AdsReport() {
  const [filters, setFilters] = useState<{
    shopId?: string;
    platform?: string;
    range?: [Dayjs, Dayjs];
  }>({
    range: [dayjs().subtract(30, 'day'), dayjs()],
  });
  const [form] = Form.useForm();

  const params: any = {};
  if (filters.shopId) params.shopId = filters.shopId;
  if (filters.platform) params.platform = filters.platform;
  if (filters.range?.[0]) params.from = filters.range[0].format('YYYY-MM-DD');
  if (filters.range?.[1]) params.to = filters.range[1].format('YYYY-MM-DD');

  const { data: shops = [] } = useQuery({ queryKey: ['shops-all'], queryFn: () => shopApi.list({ pageSize: 100 }).then((r: any) => r.items || []) });
  const { data: summary, isLoading: sumLoading } = useQuery({ queryKey: ['ads-summary', params], queryFn: () => adsApi.summary(params) });
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['ads-list', params], queryFn: () => adsApi.list(params) });

  // 按店铺聚合
  const byShop = useMemo(() => {
    const map: Record<string, any> = {};
    for (const r of rows) {
      if (!map[r.shopId]) {
        map[r.shopId] = {
          shopId: r.shopId,
          shopName: r.shopName,
          platform: r.platform,
          spend: 0,
          impressions: 0,
          clicks: 0,
          conversions: 0,
          revenue: 0,
          days: 0,
        };
      }
      const m = map[r.shopId];
      m.spend += r.spend;
      m.impressions += r.impressions;
      m.clicks += r.clicks;
      m.conversions += r.conversions;
      m.revenue += r.revenue;
      m.days += 1;
    }
    return Object.values(map).map((m: any) => ({
      ...m,
      ctr: m.impressions ? +((m.clicks / m.impressions) * 100).toFixed(2) : 0,
      roas: m.spend ? +(m.revenue / m.spend).toFixed(2) : 0,
      cpa: m.conversions ? +(m.spend / m.conversions).toFixed(2) : 0,
    }));
  }, [rows]);

  // 按日期聚合 (用于折线 - 简化展示前 20 天)
  const byDate = useMemo(() => {
    const map: Record<string, any> = {};
    for (const r of rows) {
      if (!map[r.date]) map[r.date] = { date: r.date, spend: 0, revenue: 0, conversions: 0 };
      const d = map[r.date];
      d.spend += r.spend;
      d.revenue += r.revenue;
      d.conversions += r.conversions;
    }
    return Object.values(map).sort((a: any, b: any) => a.date.localeCompare(b.date));
  }, [rows]);

  const onSearch = (vals: any) => {
    setFilters({
      shopId: vals.shopId,
      platform: vals.platform,
      range: vals.range,
    });
  };
  const onReset = () => {
    form.resetFields();
    form.setFieldsValue({ range: [dayjs().subtract(30, 'day'), dayjs()] });
    setFilters({ range: [dayjs().subtract(30, 'day'), dayjs()] });
  };

  const exportCsv = () => {
    const headers = ['日期', '店铺', '平台', '花费', '曝光', '点击', 'CTR(%)', '转化', '收入', 'ROAS'];
    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push([r.date, r.shopName, r.platform, r.spend, r.impressions, r.clicks, r.ctr, r.conversions, r.revenue, r.roas].join(','));
    }
    const csv = lines.join('\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ads-report-${dayjs().format('YYYYMMDD-HHmm')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}><SoundOutlined /> 广告数据报表</Title>
      <Text type="secondary">按店铺 / 平台 / 时间段汇总广告投放效果 · 当前为模拟数据, 真实接入各平台 API 后续替换</Text>

      <Row gutter={16} style={{ marginTop: 12 }}>
        <Col span={6}><Card><Statistic title="总花费" value={summary?.total?.spend || 0} prefix={<DollarOutlined />} suffix="元" precision={2} /></Card></Col>
        <Col span={6}><Card><Statistic title="总收入" value={summary?.total?.revenue || 0} prefix={<RiseOutlined />} suffix="元" precision={2} valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="ROAS" value={summary?.avgRoas || 0} prefix={<PercentageOutlined />} precision={2} valueStyle={{ color: '#1677ff' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="转化数" value={summary?.total?.conversions || 0} suffix="单" /></Card></Col>
      </Row>

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col span={6}><Card><Statistic title="曝光" value={summary?.total?.impressions || 0} prefix={<EyeOutlined />} /></Card></Col>
        <Col span={6}><Card><Statistic title="点击" value={summary?.total?.clicks || 0} /></Card></Col>
        <Col span={6}><Card><Statistic title="平均 CTR" value={summary?.avgCtr || 0} suffix="%" precision={2} /></Card></Col>
        <Col span={6}><Card><Statistic title="平均 CPA" value={summary?.cpa || 0} prefix={<DollarOutlined />} suffix="元" precision={2} /></Card></Col>
      </Row>

      <Card style={{ marginTop: 16 }} bordered={false}>
        <Form form={form} layout="inline" initialValues={filters} onFinish={onSearch}>
          <Form.Item name="shopId">
            <Select placeholder="店铺" allowClear style={{ width: 200 }} options={(shops as any[]).map((s) => ({ value: s.id, label: s.name }))} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="platform">
            <Select
              placeholder="平台"
              allowClear
              style={{ width: 140 }}
              options={[
                { value: 'shopee', label: 'Shopee' },
                { value: 'lazada', label: 'Lazada' },
                { value: 'tiktok', label: 'TikTok' },
                { value: 'amazon', label: 'Amazon' },
                { value: 'aliexpress', label: 'AliExpress' },
                { value: 'ebay', label: 'eBay' },
              ]}
            />
          </Form.Item>
          <Form.Item name="range">
            <RangePicker />
          </Form.Item>
          <Form.Item><Button type="primary" htmlType="submit">查询</Button></Form.Item>
          <Form.Item><Button icon={<ReloadOutlined />} onClick={onReset}>重置</Button></Form.Item>
          <Form.Item><Button icon={<DownloadOutlined />} onClick={exportCsv}>导出 CSV</Button></Form.Item>
        </Form>
      </Card>

      <Card title="按店铺汇总" style={{ marginTop: 16 }} bordered={false} size="small">
        <Table
          size="small"
          rowKey="shopId"
          loading={isLoading}
          dataSource={byShop}
          pagination={false}
          columns={[
            { title: '店铺', dataIndex: 'shopName', width: 180 },
            { title: '平台', dataIndex: 'platform', width: 110, render: (v) => <Tag color="blue">{v}</Tag> },
            { title: '天数', dataIndex: 'days', width: 80, align: 'right' as const },
            { title: '花费', dataIndex: 'spend', width: 110, align: 'right' as const, render: (v: number) => v.toFixed(2) },
            { title: '曝光', dataIndex: 'impressions', width: 110, align: 'right' as const },
            { title: '点击', dataIndex: 'clicks', width: 100, align: 'right' as const },
            { title: 'CTR', dataIndex: 'ctr', width: 90, align: 'right' as const, render: (v: number) => `${v}%` },
            { title: '转化', dataIndex: 'conversions', width: 90, align: 'right' as const },
            { title: '收入', dataIndex: 'revenue', width: 110, align: 'right' as const, render: (v: number) => v.toFixed(2) },
            { title: 'ROAS', dataIndex: 'roas', width: 90, align: 'right' as const, render: (v: number) => <b style={{ color: v >= 2 ? '#52c41a' : v >= 1 ? '#fa8c16' : '#f5222d' }}>{v}</b> },
            { title: 'CPA', dataIndex: 'cpa', width: 100, align: 'right' as const, render: (v: number) => v.toFixed(2) },
          ]}
        />
      </Card>

      <Card title="按日期趋势" style={{ marginTop: 16 }} bordered={false} size="small">
        {byDate.length > 0 ? (
          <TrendChart data={byDate} />
        ) : (
          <Empty description="暂无数据" />
        )}
      </Card>

      <Card title="详细数据" style={{ marginTop: 16 }} bordered={false} size="small">
        <Table
          size="small"
          rowKey={(r: any) => `${r.date}-${r.shopId}`}
          loading={isLoading}
          dataSource={rows}
          pagination={{ pageSize: 20 }}
          columns={[
            { title: '日期', dataIndex: 'date', width: 110 },
            { title: '店铺', dataIndex: 'shopName', width: 160 },
            { title: '平台', dataIndex: 'platform', width: 100, render: (v) => <Tag>{v}</Tag> },
            { title: '花费', dataIndex: 'spend', width: 100, align: 'right' as const, render: (v: number) => v.toFixed(2) },
            { title: '曝光', dataIndex: 'impressions', width: 100, align: 'right' as const },
            { title: '点击', dataIndex: 'clicks', width: 90, align: 'right' as const },
            { title: 'CTR(%)', dataIndex: 'ctr', width: 90, align: 'right' as const },
            { title: '转化', dataIndex: 'conversions', width: 80, align: 'right' as const },
            { title: '收入', dataIndex: 'revenue', width: 100, align: 'right' as const, render: (v: number) => v.toFixed(2) },
            { title: 'ROAS', dataIndex: 'roas', width: 90, align: 'right' as const, render: (v: number) => <b style={{ color: v >= 2 ? '#52c41a' : v >= 1 ? '#fa8c16' : '#f5222d' }}>{v}</b> },
          ]}
          scroll={{ x: 1100 }}
        />
      </Card>
    </div>
  );
}

// 简化的趋势图 (SVG)
function TrendChart({ data }: { data: any[] }) {
  if (!data.length) return null;
  const W = 1000;
  const H = 200;
  const padL = 50, padR = 20, padT = 20, padB = 30;
  const maxSpend = Math.max(...data.map((d: any) => d.spend), 1);
  const maxRevenue = Math.max(...data.map((d: any) => d.revenue), 1);
  const max = Math.max(maxSpend, maxRevenue);
  const stepX = (W - padL - padR) / Math.max(1, data.length - 1);

  const path = (key: string) => data.map((d: any, i: number) => {
    const x = padL + i * stepX;
    const y = H - padB - (d[key] / max) * (H - padT - padB);
    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={W} height={H} style={{ display: 'block' }}>
        {/* 网格 */}
        {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
          <line key={i} x1={padL} y1={H - padB - p * (H - padT - padB)} x2={W - padR} y2={H - padB - p * (H - padT - padB)} stroke="#f0f0f0" />
        ))}
        {/* 花费线 */}
        <path d={path('spend')} stroke="#1677ff" strokeWidth={2} fill="none" />
        {/* 收入线 */}
        <path d={path('revenue')} stroke="#52c41a" strokeWidth={2} fill="none" />
        {/* 转化柱 */}
        {data.map((d: any, i: number) => {
          const x = padL + i * stepX;
          const h = (d.conversions / Math.max(...data.map((x: any) => x.conversions), 1)) * 30;
          return <rect key={i} x={x - 2} y={H - padB - h} width={4} height={h} fill="#fa8c16" />;
        })}
        {/* X 轴日期 (按 5 个) */}
        {data.map((d: any, i: number) => {
          if (data.length > 10 && i % Math.ceil(data.length / 8) !== 0) return null;
          return <text key={i} x={padL + i * stepX} y={H - 8} fontSize={10} fill="#999" textAnchor="middle">{d.date.slice(5)}</text>;
        })}
        {/* 图例 */}
        <g transform={`translate(${padL}, 6)`}>
          <rect width={10} height={10} fill="#1677ff" /><text x={14} y={9} fontSize={11} fill="#666">花费</text>
          <rect x={60} width={10} height={10} fill="#52c41a" /><text x={74} y={9} fontSize={11} fill="#666">收入</text>
          <rect x={120} width={10} height={10} fill="#fa8c16" /><text x={134} y={9} fontSize={11} fill="#666">转化数</text>
        </g>
      </svg>
    </div>
  );
}
