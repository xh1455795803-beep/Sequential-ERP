// 通用列表页: 根据 path 自动生成 mock 数据 + 通用表格 / 筛选 / 分页
// 当某路由尚未实现专属页面时, 自动 fallback 到本组件
import { useMemo, useState } from 'react';
import {
  Card,
  Table,
  Tag,
  Space,
  Button,
  Input,
  Select,
  Form,
  Row,
  Col,
  Typography,
  Image,
  Progress,
  Switch,
} from 'antd';
import {
  SearchOutlined,
  ReloadOutlined,
  PlusOutlined,
  DownloadOutlined,
  FilterOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  genListConfig,
  genMockRows,
  type ColumnDef,
} from './mockData';

const { Title, Text } = Typography;

interface Props {
  path: string;
}

export default function GenericListPage({ path }: Props) {
  const cfg = useMemo(() => genListConfig(path), [path]);
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 10 });
  const [keyword, setKeyword] = useState('');
  const [form] = Form.useForm();

  // 重新生成 mock 数据 (刷新按钮)
  const [seed, setSeed] = useState(0);
  const allRows = useMemo(() => {
    if (seed === 0) return genMockRows(path, cfg);
    // 刷新时重新生成
    let h = seed;
    for (let i = 0; i < path.length; i++) h = (h * 31 + path.charCodeAt(i)) >>> 0;
    return genMockRows(path + '?seed=' + seed, cfg);
  }, [path, cfg, seed]);

  const filtered = useMemo(() => {
    let r = allRows;
    const kw = filters.keyword || keyword;
    if (kw) {
      r = r.filter((x: any) =>
        Object.values(x).some(
          (v) => typeof v === 'string' && v.toLowerCase().includes(kw.toLowerCase()),
        ),
      );
    }
    for (const f of cfg.filters || []) {
      const v = filters[f.name];
      if (v !== undefined && v !== '') {
        r = r.filter((x: any) => x[f.name] === v);
      }
    }
    return r;
  }, [allRows, filters, keyword, cfg.filters]);

  const pageSize = filters.pageSize || 10;
  const page = filters.page || 1;
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const columns = useMemo(() => buildColumns(cfg.columns), [cfg.columns]);

  const onSearch = (vals: any) => {
    setFilters((f: any) => ({ ...f, ...vals, page: 1 }));
    setKeyword(vals.keyword || '');
  };

  const onReset = () => {
    form.resetFields();
    setFilters({ page: 1, pageSize: 10 });
    setKeyword('');
  };

  // 顶部统计卡
  const stats = useMemo(() => buildStats(filtered), [filtered]);

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>{cfg.title || '业务页面'}</Title>
      {cfg.subtitle && <Text type="secondary">{cfg.subtitle} · 共 {filtered.length} 条</Text>}

      {stats.length > 0 && (
        <Row gutter={16} style={{ marginTop: 12 }}>
          {stats.map((s, i) => (
            <Col key={i} span={24 / Math.min(stats.length, 4)}>
              <Card bordered={false}>
                <Text type="secondary">{s.label}</Text>
                <div style={{ fontSize: 22, fontWeight: 600, color: s.color || '#1677ff' }}>
                  {s.value}
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Card style={{ marginTop: 16 }} bordered={false}>
        <Form form={form} layout="inline" onFinish={onSearch}>
          <Form.Item name="keyword">
            <Input
              placeholder="搜索 名称 / SKU / 编号"
              allowClear
              prefix={<SearchOutlined />}
              style={{ width: 260 }}
            />
          </Form.Item>
          {(cfg.filters || []).map((f) => (
            <Form.Item key={f.name} name={f.name}>
              {f.type === 'select' && f.options ? (
                <Select
                  placeholder={f.placeholder || f.label}
                  allowClear
                  style={{ width: 140 }}
                  options={f.options}
                />
              ) : (
                <Input placeholder={f.placeholder || f.label} allowClear />
              )}
            </Form.Item>
          ))}
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" icon={<FilterOutlined />}>筛选</Button>
              <Button onClick={onReset} icon={<ReloadOutlined />}>重置</Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      <Card
        style={{ marginTop: 16 }}
        bordered={false}
        title="数据列表"
        extra={
          <Space>
            <Button icon={<DownloadOutlined />}>导出</Button>
            <Button icon={<ReloadOutlined />} onClick={() => setSeed(Date.now() & 0xffff)}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />}>新增</Button>
          </Space>
        }
      >
        <Table
          size="middle"
          columns={columns as any}
          dataSource={paged}
          rowKey="id"
          scroll={{ x: 1400 }}
          pagination={{
            current: page,
            pageSize,
            total: filtered.length,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => setFilters((f: any) => ({ ...f, page: p, pageSize: ps })),
          }}
        />
      </Card>
    </div>
  );
}

// ============= 渲染辅助 =============
function buildColumns(cols: ColumnDef[]) {
  return cols.map((c) => {
    const col: any = {
      title: c.title,
      dataIndex: c.dataIndex,
      width: c.width,
      fixed: c.fixed,
      ellipsis: c.ellipsis,
    };
    if (!c.type) {
      return col;
    }
    col.render = (v: any, r: any) => renderCell(v, r, c);
    return col;
  });
}

function renderCell(v: any, r: any, c: ColumnDef) {
  if (v === null || v === undefined || v === '') return <Text type="secondary">-</Text>;
  switch (c.type) {
    case 'tag': {
      let color = 'default';
      let label: string = v;
      if (c.options) {
        const opt = c.options.find((o) => o.value === v);
        if (opt) {
          color = (opt as any).color || 'default';
          label = opt.label;
        }
      }
      return <Tag color={color}>{label}</Tag>;
    }
    case 'money':
      return (
        <span>
          {r.currency || ''} {Number(v).toFixed(2)}
          {c.suffix || ''}
        </span>
      );
    case 'number':
      return (
        <span>
          {v}
          {c.suffix || ''}
        </span>
      );
    case 'date':
      return dayjs(v).format('YYYY-MM-DD');
    case 'datetime':
      return dayjs(v).format('YYYY-MM-DD HH:mm');
    case 'image':
      return <Image src={v} width={40} height={40} style={{ borderRadius: 4 }} preview={false} />;
    case 'progress':
      return <Progress percent={Number(v)} size="small" />;
    case 'boolean':
      return <Switch checked={!!v} size="small" disabled />;
    default:
      return v;
  }
}

function buildStats(rows: Record<string, any>[]) {
  if (!rows.length) return [];
  const totalQty = rows.reduce((s, x) => s + (Number(x.quantity) || 0), 0);
  const totalAmount = rows.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const enabled = rows.filter((x) => x.status === 'enabled' || x.status === 'success').length;
  return [
    { label: '当前页记录', value: rows.length },
    { label: '商品件数', value: totalQty },
    { label: '总金额', value: totalAmount.toFixed(2) },
    { label: '启用/成功', value: enabled, color: '#52c41a' },
  ];
}
