import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Table, Tag, Space, Button, Input, Form, Row, Col, Typography, Statistic, Drawer, Descriptions, Popconfirm, message, Empty } from 'antd';
import { SearchOutlined, ReloadOutlined, ShopOutlined, PlusOutlined, SyncOutlined, DisconnectOutlined } from '@ant-design/icons';
import { shopApi, syncApi } from '../api';
import { useNavigate } from 'react-router-dom';
import AuthButton from '../components/AuthButton';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

export default function ShopList() {
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
      message.success('Token 已刷新');
      qc.invalidateQueries({ queryKey: ['shops'] });
    } catch (e: any) {
      message.error(e?.message || '刷新失败');
    }
  };

  const handleUnbind = async (id: string) => {
    try {
      await shopApi.remove(id);
      message.success('已解绑');
      qc.invalidateQueries({ queryKey: ['shops'] });
    } catch (e: any) {
      message.error(e?.message || '解绑失败');
    }
  };

  const handleHealthCheck = async (id: string) => {
    try {
      await syncApi.run({ shopId: id, type: 'shop' });
      message.success('验权任务已触发, 查看同步中心');
      qc.invalidateQueries({ queryKey: ['sync-tasks'] });
    } catch (e: any) {
      message.error(e?.message || '触发失败');
    }
  };

  const columns = [
    {
      title: '店铺名',
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
      title: '平台',
      dataIndex: ['platform', 'name'],
      width: 120,
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    { title: '店铺 ID', dataIndex: 'shopId', width: 160 },
    { title: '国家/地区', dataIndex: 'region', width: 110 },
    { title: '币种', dataIndex: 'currency', width: 90 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: number) => {
        const m: Record<number, { label: string; color: string }> = {
          1: { label: '正常', color: 'green' },
          0: { label: '停用', color: 'default' },
          2: { label: '授权过期', color: 'red' },
        };
        return <Tag color={m[v]?.color}>{m[v]?.label}</Tag>;
      },
    },
    {
      title: 'Token 过期',
      dataIndex: 'tokenExpiresAt',
      width: 170,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      title: '授权时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'op',
      width: 280,
      fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Space size={4} wrap>
          <Button size="small" type="link" onClick={() => setDetail(r)}>详情</Button>
          <AuthButton size="small" type="link" perm="auth:shop:bind" onClick={() => handleHealthCheck(r.id)} icon={<SyncOutlined />}>
            验权
          </AuthButton>
          <AuthButton size="small" type="link" perm="auth:shop:bind" onClick={() => handleRefresh(r.id)}>
            刷Token
          </AuthButton>
          <Popconfirm title="确定解绑此店铺?" onConfirm={() => handleUnbind(r.id)} okType="danger">
            <AuthButton size="small" type="link" danger perm="auth:shop:unbind" icon={<DisconnectOutlined />}>
              解绑
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
      <Title level={4} style={{ marginTop: 0 }}>店铺列表</Title>
      <Text type="secondary">跨平台多店铺统一管理 · 共 {total} 家</Text>

      <Row gutter={16} style={{ marginTop: 12 }}>
        <Col span={6}><Card bordered={false}><Statistic title="店铺总数" value={total} suffix="家" /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title="当前页活跃" value={active} suffix="家" valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title="覆盖地区" value={regions} suffix="个" /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title="已对接平台" value={items.length ? new Set(items.map((x: any) => x.platform?.id)).size : 0} suffix="个" /></Card></Col>
      </Row>

      <Card style={{ marginTop: 16 }} bordered={false}>
        <Form
          layout="inline"
          onFinish={(v) => setFilters((f: any) => ({ ...f, ...v, page: 1 }))}
        >
          <Form.Item name="keyword">
            <Input placeholder="店铺名 / 店铺 ID / 地区" allowClear prefix={<SearchOutlined />} style={{ width: 280 }} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">搜索</Button>
              <Button onClick={() => setFilters({ page: 1, pageSize: 10 })} icon={<ReloadOutlined />}>重置</Button>
              <AuthButton type="primary" perm="auth:shop:bind" icon={<PlusOutlined />} onClick={() => navigate('/auth/bind')}>
                授权新店铺
              </AuthButton>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      <Card style={{ marginTop: 16 }} bordered={false} title="店铺列表">
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
              showTotal: (t) => `共 ${t} 条`,
              onChange: (page, pageSize) => setFilters((f: any) => ({ ...f, page, pageSize })),
            }}
          />
        ) : (
          !isLoading && <Empty description="暂无数据" />
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
            <Descriptions.Item label="平台">{detail.platform?.name}</Descriptions.Item>
            <Descriptions.Item label="店铺 ID">{detail.shopId}</Descriptions.Item>
            <Descriptions.Item label="国家/地区">{detail.region}</Descriptions.Item>
            <Descriptions.Item label="结算币种">{detail.currency}</Descriptions.Item>
            <Descriptions.Item label="授权时间">{dayjs(detail.createdAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
            <Descriptions.Item label="Token 过期">{detail.tokenExpiresAt ? dayjs(detail.tokenExpiresAt).format('YYYY-MM-DD HH:mm') : '-'}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={detail.status === 1 ? 'green' : 'red'}>
                {detail.status === 1 ? '正常' : '已停用'}
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
