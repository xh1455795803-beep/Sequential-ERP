// 消息中心 (P1-2.4)
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Table,
  Tag,
  Space,
  Button,
  Row,
  Col,
  Typography,
  Tabs,
  Drawer,
  message,
  Modal,
  Badge,
  Empty,
} from 'antd';
import {
  BellOutlined,
  ReloadOutlined,
  CheckOutlined,
  DeleteOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import { notificationApi } from '../api';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const LEVEL_MAP: Record<string, { label: string; color: string }> = {
  info: { label: '信息', color: 'blue' },
  success: { label: '成功', color: 'green' },
  warning: { label: '警告', color: 'orange' },
  error: { label: '错误', color: 'red' },
};

export default function MessageCenter() {
  const [tab, setTab] = useState('all');
  const [detail, setDetail] = useState<any | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const qc = useQueryClient();

  const params: any = { page: 1, pageSize: 20 };
  if (tab === 'unread') params.read = '0';
  if (tab === 'read') params.read = '1';
  const { data, isLoading } = useQuery({ queryKey: ['notifications', tab], queryFn: () => notificationApi.list(params) });
  const { data: unread } = useQuery({ queryKey: ['notifications-unread'], queryFn: () => notificationApi.unread() });

  const markReadMut = useMutation({ mutationFn: notificationApi.markRead, onSuccess: () => { message.success('已标记已读'); qc.invalidateQueries({ queryKey: ['notifications'] }); qc.invalidateQueries({ queryKey: ['notifications-unread'] }); } });
  const markAllReadMut = useMutation({ mutationFn: notificationApi.markAllRead, onSuccess: () => { message.success('全部已读'); qc.invalidateQueries({ queryKey: ['notifications'] }); qc.invalidateQueries({ queryKey: ['notifications-unread'] }); } });
  const removeMut = useMutation({ mutationFn: notificationApi.remove, onSuccess: () => { message.success('已删除'); qc.invalidateQueries({ queryKey: ['notifications'] }); } });

  const onOpen = async (row: any) => {
    setDetail(row);
    if (row.read === 0) {
      await markReadMut.mutateAsync([row.id]);
    }
  };

  const onBatchRead = () => {
    if (!selectedRowKeys.length) return message.warning('请先选择');
    markReadMut.mutate(selectedRowKeys as string[]);
    setSelectedRowKeys([]);
  };
  const onBatchDelete = () => {
    if (!selectedRowKeys.length) return message.warning('请先选择');
    Modal.confirm({
      title: `确认删除 ${selectedRowKeys.length} 条?`,
      onOk: () => {
        removeMut.mutate(selectedRowKeys as string[]);
        setSelectedRowKeys([]);
      },
    });
  };

  const items = data?.items || [];
  const total = data?.total || 0;
  const unreadCount = unread?.count || 0;

  const columns = [
    { title: '级别', dataIndex: 'level', width: 90, render: (v: string) => <Tag color={LEVEL_MAP[v]?.color}>{LEVEL_MAP[v]?.label || v}</Tag> },
    { title: '标题', dataIndex: 'title', width: 240, render: (v: string, r: any) => <a onClick={() => onOpen(r)}>{r.read === 0 ? <Badge status="processing" text={v} /> : v}</a> },
    { title: '内容', dataIndex: 'content', ellipsis: true },
    { title: '关联', dataIndex: 'refType', width: 110, render: (v: string) => v ? <Tag>{v}</Tag> : '-' },
    { title: '时间', dataIndex: 'createdAt', width: 160, render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
    {
      title: '操作', key: 'op', width: 140, fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => onOpen(r)}>查看</Button>
          {r.read === 0 && <Button type="link" size="small" onClick={() => markReadMut.mutate([r.id])}>标已读</Button>}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}><BellOutlined /> 消息中心</Title>
      <Text type="secondary">系统通知 / 业务预警 / 规则触发消息 · 共 {total} 条, <Badge count={unreadCount} offset={[4, -2]}><span style={{ color: '#ff4d4f' }}>未读 {unreadCount}</span></Badge></Text>

      <Row gutter={16} style={{ marginTop: 12 }}>
        <Col span={6}><Card><Text type="secondary">总消息数</Text><div style={{ fontSize: 22, fontWeight: 600 }}>{total}</div></Card></Col>
        <Col span={6}><Card><Text type="secondary">未读</Text><div style={{ fontSize: 22, fontWeight: 600, color: '#ff4d4f' }}>{unreadCount}</div></Card></Col>
        <Col span={6}><Card><Text type="secondary">警告</Text><div style={{ fontSize: 22, fontWeight: 600, color: '#fa8c16' }}>{items.filter((i: any) => i.level === 'warning').length}</div></Card></Col>
        <Col span={6}><Card><Text type="secondary">错误</Text><div style={{ fontSize: 22, fontWeight: 600, color: '#f5222d' }}>{items.filter((i: any) => i.level === 'error').length}</div></Card></Col>
      </Row>

      <Card style={{ marginTop: 16 }} bordered={false}>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          tabBarExtraContent={
            <Space>
              {selectedRowKeys.length > 0 && (
                <>
                  <Tag color="blue">已选 {selectedRowKeys.length}</Tag>
                  <Button size="small" icon={<CheckOutlined />} onClick={onBatchRead}>标已读</Button>
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={onBatchDelete}>删除</Button>
                </>
              )}
              <Button icon={<CheckOutlined />} onClick={() => markAllReadMut.mutate()}>全部已读</Button>
              <Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['notifications'] })}>刷新</Button>
            </Space>
          }
          items={[
            { key: 'all', label: `全部 (${total})`, children: <Table size="middle" rowKey="id" loading={isLoading} dataSource={items} columns={columns as any} rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }} pagination={{ pageSize: 20 }} scroll={{ x: 1100 }} /> },
            { key: 'unread', label: `未读 (${unreadCount})`, children: <Table size="middle" rowKey="id" loading={isLoading} dataSource={items} columns={columns as any} rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }} pagination={{ pageSize: 20 }} scroll={{ x: 1100 }} /> },
            { key: 'read', label: '已读', children: <Table size="middle" rowKey="id" loading={isLoading} dataSource={items} columns={columns as any} rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }} pagination={{ pageSize: 20 }} scroll={{ x: 1100 }} /> },
          ]}
        />
      </Card>

      <Drawer title="消息详情" open={!!detail} onClose={() => setDetail(null)} width={520}>
        {detail && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Tag color={LEVEL_MAP[detail.level]?.color}>{LEVEL_MAP[detail.level]?.label}</Tag>
            <h3>{detail.title}</h3>
            <Text>{detail.content}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>时间: {dayjs(detail.createdAt).format('YYYY-MM-DD HH:mm:ss')}</Text>
            {detail.refType && <Text type="secondary" style={{ fontSize: 12 }}>关联类型: {detail.refType}</Text>}
            {detail.refId && <Text type="secondary" style={{ fontSize: 12 }}>关联 ID: {detail.refId}</Text>}
          </Space>
        )}
      </Drawer>
    </div>
  );
}
