import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Table,
  Tag,
  Space,
  Button,
  Input,
  Select,
  Form,
  Typography,
  Image,
  message,
  Popconfirm,
} from 'antd';
import {
  SearchOutlined,
  ReloadOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { productApi } from '../api';
import { usePermission } from '../hooks/usePermission';

const { Title, Text } = Typography;

const STATUS = [
  { value: 1, label: '在售', color: 'green' },
  { value: 0, label: '下架', color: 'default' },
  { value: 2, label: '违规', color: 'red' },
];
const STATUS_MAP = Object.fromEntries(STATUS.map((s) => [s.value, s]));

export default function ProductList() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 10 });
  const qc = useQueryClient();
  const { has } = usePermission();

  const { data, isLoading } = useQuery({
    queryKey: ['products', filters],
    queryFn: () => productApi.list(filters),
  });

  const removeMut = useMutation({
    mutationFn: productApi.remove,
    onSuccess: () => {
      message.success('删除成功');
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });

  const columns = [
    {
      title: '图片',
      dataIndex: 'image',
      width: 70,
      render: (v: string) => (v ? <Image src={v} width={40} height={40} style={{ borderRadius: 4 }} /> : '-'),
    },
    { title: 'SKU', dataIndex: 'sku', width: 130, fixed: 'left' as const },
    { title: '商品名称', dataIndex: 'name', width: 220, ellipsis: true },
    { title: '类目', dataIndex: 'category', width: 110, render: (v: string) => v || '-' },
    { title: '品牌', dataIndex: 'brand', width: 110, render: (v: string) => v || '-' },
    {
      title: '成本价',
      dataIndex: 'costPrice',
      width: 100,
      align: 'right' as const,
      render: (v: number, r: any) => `${r.currency || 'USD'} ${(+v || 0).toFixed(2)}`,
    },
    {
      title: '售价',
      dataIndex: 'salePrice',
      width: 100,
      align: 'right' as const,
      render: (v: number, r: any) => `${r.currency || 'USD'} ${(+v || 0).toFixed(2)}`,
    },
    {
      title: '毛利率',
      width: 90,
      align: 'right' as const,
      render: (_: any, r: any) => {
        const m = r.costPrice > 0 ? ((r.salePrice - r.costPrice) / r.salePrice) * 100 : 0;
        return <Tag color={m > 40 ? 'green' : m > 20 ? 'blue' : 'orange'}>{m.toFixed(1)}%</Tag>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: number) => {
        const s = STATUS_MAP[v] || { label: '未知', color: 'default' };
        return <Tag color={s.color}>{s.label}</Tag>;
      },
    },
    {
      title: '操作',
      key: 'op',
      width: 140,
      fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Space>
          {has('product:update') && (
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => navigate(`/product/sku/edit/${r.id}`)}>
              编辑
            </Button>
          )}
          {has('product:delete') && (
            <Popconfirm
              title="确认删除该商品?"
              onConfirm={() => removeMut.mutate(r.id)}
            >
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>SKU 列表</Title>
      <Text type="secondary">内部 SKU 库 · 共 {data?.total || 0} 条</Text>

      <Card style={{ marginTop: 16 }} bordered={false}>
        <Form
          layout="inline"
          onFinish={(v) => setFilters((f: any) => ({ ...f, ...v, page: 1 }))}
        >
          <Form.Item name="keyword">
            <Input placeholder="SKU / 商品名 / 品牌" allowClear prefix={<SearchOutlined />} style={{ width: 260 }} />
          </Form.Item>
          <Form.Item name="status">
            <Select placeholder="状态" allowClear style={{ width: 140 }} options={STATUS.map((s) => ({ label: s.label, value: s.value }))} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">筛选</Button>
              <Button
                onClick={() =>
                  setFilters({ page: 1, pageSize: 10 })
                }
                icon={<ReloadOutlined />}
              >
                重置
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      <Card
        style={{ marginTop: 16 }}
        bordered={false}
        title="商品数据"
        extra={
          has('product:create') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/product/sku/create')}>
              新增商品
            </Button>
          )
        }
      >
        <Table
          size="middle"
          columns={columns as any}
          dataSource={data?.items || []}
          loading={isLoading}
          rowKey="id"
          scroll={{ x: 1300 }}
          pagination={{
            current: filters.page,
            pageSize: filters.pageSize,
            total: data?.total || 0,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (page, pageSize) => setFilters((f: any) => ({ ...f, page, pageSize })),
          }}
        />
      </Card>
    </div>
  );
}
