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
import { useTranslation } from '../i18n';

const { Title, Text } = Typography;

export default function ProductList() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 10 });
  const qc = useQueryClient();
  const { has } = usePermission();
  const { t } = useTranslation();

  const STATUS = [
    { value: 1, label: t('pages.productList.status.onSale'), color: 'green' },
    { value: 0, label: t('pages.productList.status.offShelf'), color: 'default' },
    { value: 2, label: t('pages.productList.status.violation'), color: 'red' },
  ];
  const STATUS_MAP = Object.fromEntries(STATUS.map((s) => [s.value, s]));

  const { data, isLoading } = useQuery({
    queryKey: ['products', filters],
    queryFn: () => productApi.list(filters),
  });

  const removeMut = useMutation({
    mutationFn: productApi.remove,
    onSuccess: () => {
      message.success(t('pages.productList.removeSuccess'));
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });

  const columns = [
    {
      title: t('pages.productList.colImage'),
      dataIndex: 'image',
      width: 70,
      render: (v: string) => (v ? <Image src={v} width={40} height={40} style={{ borderRadius: 4 }} /> : '-'),
    },
    { title: t('pages.productList.colSku'), dataIndex: 'sku', width: 130, fixed: 'left' as const },
    { title: t('pages.productList.colName'), dataIndex: 'name', width: 220, ellipsis: true },
    { title: t('pages.productList.colCategory'), dataIndex: 'category', width: 110, render: (v: string) => v || '-' },
    { title: t('pages.productList.colBrand'), dataIndex: 'brand', width: 110, render: (v: string) => v || '-' },
    {
      title: t('pages.productList.colCostPrice'),
      dataIndex: 'costPrice',
      width: 100,
      align: 'right' as const,
      render: (v: number, r: any) => `${r.currency || 'USD'} ${(+v || 0).toFixed(2)}`,
    },
    {
      title: t('pages.productList.colSalePrice'),
      dataIndex: 'salePrice',
      width: 100,
      align: 'right' as const,
      render: (v: number, r: any) => `${r.currency || 'USD'} ${(+v || 0).toFixed(2)}`,
    },
    {
      title: t('pages.productList.colMarginRate'),
      width: 90,
      align: 'right' as const,
      render: (_: any, r: any) => {
        const m = r.costPrice > 0 ? ((r.salePrice - r.costPrice) / r.salePrice) * 100 : 0;
        return <Tag color={m > 40 ? 'green' : m > 20 ? 'blue' : 'orange'}>{m.toFixed(1)}%</Tag>;
      },
    },
    {
      title: t('pages.productList.colStatus'),
      dataIndex: 'status',
      width: 90,
      render: (v: number) => {
        const s = STATUS_MAP[v] || { label: t('pages.productList.statusUnknown'), color: 'default' };
        return <Tag color={s.color}>{s.label}</Tag>;
      },
    },
    {
      title: t('pages.productList.colOperation'),
      key: 'op',
      width: 140,
      fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Space>
          {has('product:update') && (
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => navigate(`/product/sku/edit/${r.id}`)}>
              {t('pages.productList.opEdit')}
            </Button>
          )}
          {has('product:delete') && (
            <Popconfirm
              title={t('pages.productList.confirmDelete')}
              onConfirm={() => removeMut.mutate(r.id)}
            >
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                {t('pages.productList.opDelete')}
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>{t('pages.productList.titleList')}</Title>
      <Text type="secondary">{t('pages.productList.subtitle', { total: data?.total || 0 })}</Text>

      <Card style={{ marginTop: 16 }} bordered={false}>
        <Form
          layout="inline"
          onFinish={(v) => setFilters((f: any) => ({ ...f, ...v, page: 1 }))}
        >
          <Form.Item name="keyword">
            <Input placeholder={t('pages.productList.filterKeywordPlaceholder')} allowClear prefix={<SearchOutlined />} style={{ width: 260 }} />
          </Form.Item>
          <Form.Item name="status">
            <Select placeholder={t('pages.productList.filterStatusPlaceholder')} allowClear style={{ width: 140 }} options={STATUS.map((s) => ({ label: s.label, value: s.value }))} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">{t('pages.productList.filter')}</Button>
              <Button
                onClick={() =>
                  setFilters({ page: 1, pageSize: 10 })
                }
                icon={<ReloadOutlined />}
              >
                {t('pages.productList.reset')}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      <Card
        style={{ marginTop: 16 }}
        bordered={false}
        title={t('pages.productList.cardTitle')}
        extra={
          has('product:create') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/product/sku/create')}>
              {t('pages.productList.create')}
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
            showTotal: (total) => t('pages.productList.totalItems', { total }),
            onChange: (page, pageSize) => setFilters((f: any) => ({ ...f, page, pageSize })),
          }}
        />
      </Card>
    </div>
  );
}
