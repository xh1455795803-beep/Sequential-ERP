import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Table, Tag, Space, Button, Input, Form, Row, Col, Typography, Statistic, Drawer, Descriptions, Popconfirm, message, Empty } from 'antd';
import { SearchOutlined, ReloadOutlined, ShopOutlined, PlusOutlined, SyncOutlined, DisconnectOutlined } from '@ant-design/icons';
import { shopApi, syncApi } from '../api';
import { useNavigate } from 'react-router-dom';
import AuthButton from '../components/AuthButton';
import dayjs from 'dayjs';
import { useTranslation } from '../i18n';

const { Title, Text } = Typography;

export default function ShopList() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 10 });
  const [detail, setDetail] = useState<any | null>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['shops', filters],
    queryFn: () => shopApi.list(filters),
  });

  const handleRefresh = async (id: string) => {
    try {
      await shopApi.refresh(id);
      message.success(t('pages.shopList.message.tokenRefreshed'));
      qc.invalidateQueries({ queryKey: ['shops'] });
    } catch (e: any) {
      message.error(e?.message || t('pages.shopList.message.refreshFailed'));
    }
  };

  const handleUnbind = async (id: string) => {
    try {
      await shopApi.remove(id);
      message.success(t('pages.shopList.message.unbound'));
      qc.invalidateQueries({ queryKey: ['shops'] });
    } catch (e: any) {
      message.error(e?.message || t('pages.shopList.message.unbindFailed'));
    }
  };

  const handleHealthCheck = async (id: string) => {
    try {
      await syncApi.run({ shopId: id, type: 'shop' });
      message.success(t('pages.shopList.message.healthTriggered'));
      qc.invalidateQueries({ queryKey: ['sync-tasks'] });
    } catch (e: any) {
      message.error(e?.message || t('pages.shopList.message.triggerFailed'));
    }
  };

  const columns = [
    {
      title: t('pages.shopList.col.shopName'),
      dataIndex: 'name',
      width: 200,
      fixed: 'left' as const,
      render: (v: string, r: any) => (
        <a onClick={() => setDetail(r)}>
          <Space>
            <ShopOutlined style={{ color: '#1677ff' }} />
            {v}
          </Space>
        </a>
      ),
    },
    {
      title: t('pages.shopList.col.platform'),
      dataIndex: ['platform', 'name'],
      width: 120,
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    { title: t('pages.shopList.col.shopId'), dataIndex: 'shopId', width: 160 },
    { title: t('pages.shopList.col.region'), dataIndex: 'region', width: 110 },
    { title: t('pages.shopList.col.currency'), dataIndex: 'currency', width: 90 },
    {
      title: t('pages.shopList.col.status'),
      dataIndex: 'status',
      width: 100,
      render: (v: number) => {
        const m: Record<number, { label: string; color: string }> = {
          1: { label: t('pages.shopList.status.normal'), color: 'green' },
          0: { label: t('pages.shopList.status.disabled'), color: 'default' },
          2: { label: t('pages.shopList.status.expired'), color: 'red' },
        };
        return <Tag color={m[v]?.color}>{m[v]?.label}</Tag>;
      },
    },
    {
      title: t('pages.shopList.col.tokenExpiresAt'),
      dataIndex: 'tokenExpiresAt',
      width: 170,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      title: t('pages.shopList.col.authorizedAt'),
      dataIndex: 'createdAt',
      width: 170,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: t('pages.shopList.col.action'),
      key: 'op',
      width: 280,
      fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Space size={4} wrap>
          <Button size="small" type="link" onClick={() => setDetail(r)}>{t('pages.shopList.action.detail')}</Button>
          <AuthButton size="small" type="link" perm="auth:shop:bind" onClick={() => handleHealthCheck(r.id)} icon={<SyncOutlined />}>
            {t('pages.shopList.action.health')}
          </AuthButton>
          <AuthButton size="small" type="link" perm="auth:shop:bind" onClick={() => handleRefresh(r.id)}>
            {t('pages.shopList.action.refreshToken')}
          </AuthButton>
          <Popconfirm title={t('pages.shopList.unbind.confirmTitle')} onConfirm={() => handleUnbind(r.id)} okType="danger">
            <AuthButton size="small" type="link" danger perm="auth:shop:unbind" icon={<DisconnectOutlined />}>
              {t('pages.shopList.action.unbind')}
            </AuthButton>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const total = data?.total || 0;
  const items = data?.items || [];
  const active = items.filter((x: any) => x.status === 1).length;
  const regions = new Set(items.map((x: any) => x.region).filter(Boolean)).size;

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>{t('pages.shopList.title')}</Title>
      <Text type="secondary">{t('pages.shopList.subtitle', { total })}</Text>

      <Row gutter={16} style={{ marginTop: 12 }}>
        <Col span={6}><Card bordered={false}><Statistic title={t('pages.shopList.stat.total')} value={total} suffix={t('pages.shopList.stat.shopSuffix')} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title={t('pages.shopList.stat.active')} value={active} suffix={t('pages.shopList.stat.shopSuffix')} valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title={t('pages.shopList.stat.regions')} value={regions} suffix={t('pages.shopList.stat.regionSuffix')} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title={t('pages.shopList.stat.platforms')} value={items.length ? new Set(items.map((x: any) => x.platform?.id)).size : 0} suffix={t('pages.shopList.stat.platformSuffix')} /></Card></Col>
      </Row>

      <Card style={{ marginTop: 16 }} bordered={false}>
        <Form
          layout="inline"
          onFinish={(v) => setFilters((f: any) => ({ ...f, ...v, page: 1 }))}
        >
          <Form.Item name="keyword">
            <Input placeholder={t('pages.shopList.filter.keyword')} allowClear prefix={<SearchOutlined />} style={{ width: 280 }} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">{t('pages.shopList.filter.search')}</Button>
              <Button onClick={() => setFilters({ page: 1, pageSize: 10 })} icon={<ReloadOutlined />}>{t('pages.shopList.filter.reset')}</Button>
              <AuthButton type="primary" perm="auth:shop:bind" icon={<PlusOutlined />} onClick={() => navigate('/auth/bind')}>
                {t('pages.shopList.action.bind')}
              </AuthButton>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      <Card style={{ marginTop: 16 }} bordered={false} title={t('pages.shopList.title')}>
        {items.length ? (
          <Table
            size="middle"
            columns={columns as any}
            dataSource={items}
            loading={isLoading}
            rowKey="id"
            scroll={{ x: 1300 }}
            pagination={{
              current: filters.page,
              pageSize: filters.pageSize,
              total,
              showSizeChanger: true,
              showTotal: (count) => t('pages.shopList.paginationTotal', { count }),
              onChange: (page, pageSize) => setFilters((f: any) => ({ ...f, page, pageSize })),
            }}
          />
        ) : (
          !isLoading && <Empty description={t('pages.shopList.empty')} />
        )}
      </Card>

      <Drawer
        title={detail?.name}
        open={!!detail}
        onClose={() => setDetail(null)}
        width={500}
      >
        {detail && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label={t('pages.shopList.col.platform')}>{detail.platform?.name}</Descriptions.Item>
            <Descriptions.Item label={t('pages.shopList.col.shopId')}>{detail.shopId}</Descriptions.Item>
            <Descriptions.Item label={t('pages.shopList.col.region')}>{detail.region}</Descriptions.Item>
            <Descriptions.Item label={t('pages.shopList.detail.currency')}>{detail.currency}</Descriptions.Item>
            <Descriptions.Item label={t('pages.shopList.col.authorizedAt')}>{dayjs(detail.createdAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
            <Descriptions.Item label={t('pages.shopList.col.tokenExpiresAt')}>{detail.tokenExpiresAt ? dayjs(detail.tokenExpiresAt).format('YYYY-MM-DD HH:mm') : '-'}</Descriptions.Item>
            <Descriptions.Item label={t('pages.shopList.col.status')}>
              <Tag color={detail.status === 1 ? 'green' : 'red'}>
                {detail.status === 1 ? t('pages.shopList.status.normal') : t('pages.shopList.detail.disabled')}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Access Token">
              <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{detail.accessToken || '-'}</code>
            </Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </div>
  );
}