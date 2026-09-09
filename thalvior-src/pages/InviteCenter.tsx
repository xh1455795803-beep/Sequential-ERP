// 邀请分销管理 (P2-2.2)
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
  Modal,
  Input,
  InputNumber,
  DatePicker,
  Statistic,
  message,
  Tabs,
  Descriptions,
  Empty,
  Alert,
  Popconfirm,
  Tooltip,
} from 'antd';
import {
  GiftOutlined,
  ReloadOutlined,
  PlusOutlined,
  CopyOutlined,
  StopOutlined,
  DollarOutlined,
  TeamOutlined,
  ShareAltOutlined,
  LinkOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { inviteApi } from '../api';
import dayjs, { Dayjs } from 'dayjs';

const { Title, Text } = Typography;

export default function InviteCenter() {
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<any | null>(null);
  const [form] = Form.useForm();
  const qc = useQueryClient();

  const { data: overview, isLoading: ovLoading } = useQuery({ queryKey: ['invite-overview'], queryFn: () => inviteApi.overview() });
  const { data: codes = [], isLoading: codesLoading } = useQuery({ queryKey: ['invite-codes'], queryFn: () => inviteApi.codes() });
  const { data: rewards = [], isLoading: rwLoading } = useQuery({ queryKey: ['invite-rewards'], queryFn: () => inviteApi.rewards() });

  const createMut = useMutation({
    mutationFn: inviteApi.createCode,
    onSuccess: (res: any) => {
      message.success('邀请码已生成');
      setCreateOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['invite-codes'] });
      qc.invalidateQueries({ queryKey: ['invite-overview'] });
      // 弹出详情显示邀请码
      setDetail({ ...res, _new: true });
    },
  });

  const disableMut = useMutation({
    mutationFn: inviteApi.disableCode,
    onSuccess: () => {
      message.success('已停用');
      qc.invalidateQueries({ queryKey: ['invite-codes'] });
      qc.invalidateQueries({ queryKey: ['invite-overview'] });
    },
  });

  const onCopy = (text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => message.success('已复制到剪贴板'),
      () => message.error('复制失败'),
    );
  };

  const buildLink = (code: string) => `${window.location.origin}/login?invite=${code}`;

  const codeColumns = [
    { title: '邀请码', dataIndex: 'code', width: 130, render: (v: string) => <b style={{ fontSize: 16, color: '#1677ff' }}>{v}</b> },
    {
      title: '链接', dataIndex: 'code', width: 280, ellipsis: true,
      render: (v: string) => (
        <Tooltip title="点击复制">
          <a onClick={() => onCopy(buildLink(v))}>
            <LinkOutlined /> {buildLink(v)}
          </a>
        </Tooltip>
      ),
    },
    { title: '已用 / 上限', key: 'uses', width: 130, render: (_: any, r: any) => `${r.usedCount || 0} / ${r.maxUses || '不限'}` },
    { title: '单笔奖励', dataIndex: 'reward', width: 110, render: (v: number, r: any) => v > 0 ? `¥${v}` : r.rewardPct > 0 ? `${r.rewardPct}%` : '-' },
    { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => <Tag color={v === 'active' ? 'green' : 'default'}>{v === 'active' ? '有效' : v === 'disabled' ? '已停用' : v}</Tag> },
    { title: '过期时间', dataIndex: 'expiresAt', width: 160, render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD') : '永久' },
    { title: '创建时间', dataIndex: 'createdAt', width: 160, render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
    {
      title: '操作', key: 'op', width: 180, fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Space size="small">
          <Button type="link" size="small" icon={<CopyOutlined />} onClick={() => onCopy(buildLink(r.code))}>复制链接</Button>
          {r.status === 'active' && (
            <Popconfirm title="停用后无法继续使用, 确认?" onConfirm={() => disableMut.mutate(r.id)}>
              <Button type="link" size="small" danger icon={<StopOutlined />}>停用</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const rewardColumns = [
    { title: '返佣来源', key: 'src', width: 220, render: (_: any, r: any) => <code style={{ background: '#f5f5f5', padding: '2px 6px', borderRadius: 3 }}>{r.inviteCodeId?.slice(0, 8) || r.inviteCodeId}</code> },
    { title: '金额', dataIndex: 'amount', width: 120, render: (v: number) => <b style={{ color: '#fa8c16' }}>¥{v.toFixed(2)}</b> },
    { title: '结算状态', dataIndex: 'settled', width: 120, render: (v: boolean, r: any) => v ? <Tag color="green"><CheckCircleOutlined /> 已结算</Tag> : <Tag color="orange">待结算</Tag> },
    { title: '结算时间', dataIndex: 'settledAt', width: 170, render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-' },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
  ];

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}><GiftOutlined /> 邀请分销</Title>
      <Text type="secondary">生成邀请码/链接 · 被邀请人注册付费后自动返佣 · 平台与个人双赢</Text>

      <Row gutter={16} style={{ marginTop: 12 }}>
        <Col span={6}><Card><Statistic title="邀请码" value={overview?.codesCount || 0} prefix={<ShareAltOutlined />} /></Card></Col>
        <Col span={6}><Card><Statistic title="已邀请" value={overview?.usedCount || 0} prefix={<TeamOutlined />} /></Card></Col>
        <Col span={6}><Card><Statistic title="累计返佣" value={overview?.totalReward || 0} prefix={<DollarOutlined />} suffix="元" precision={2} valueStyle={{ color: '#fa8c16' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="待结算" value={overview?.pendingReward || 0} prefix={<DollarOutlined />} suffix="元" precision={2} /></Card></Col>
      </Row>

      <Alert
        type="info"
        showIcon
        style={{ marginTop: 16 }}
        message="如何运作"
        description={
          <ol style={{ marginBottom: 0, paddingLeft: 18 }}>
            <li>生成邀请码并设置单笔返佣 (固定金额或比例)</li>
            <li>把链接发给朋友/客户/在社群里分享</li>
            <li>对方通过链接注册即建立推荐关系</li>
            <li>对方购买/续费套餐后, 系统自动按规则发放返佣到您的账户</li>
            <li>每月初批量结算上月返佣</li>
          </ol>
        }
      />

      <Card
        style={{ marginTop: 16 }}
        bordered={false}
        title="我的邀请码"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['invite'] })}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>生成邀请码</Button>
          </Space>
        }
      >
        <Table
          size="middle"
          rowKey="id"
          loading={codesLoading}
          dataSource={codes}
          columns={codeColumns as any}
          scroll={{ x: 1300 }}
          pagination={false}
          locale={{ emptyText: <Empty description="还没有邀请码, 点击右上角生成第一个" /> }}
        />
      </Card>

      <Card style={{ marginTop: 16 }} bordered={false} title="返佣明细">
        <Table
          size="middle"
          rowKey="id"
          loading={rwLoading}
          dataSource={rewards}
          columns={rewardColumns as any}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <Modal title="生成邀请码" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => form.submit()} confirmLoading={createMut.isPending}>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ maxUses: 0, reward: 50, rewardPct: 0 }}
          onFinish={(v) => {
            const body: any = { maxUses: v.maxUses, reward: v.reward, rewardPct: v.rewardPct };
            if (v.expiresAt) body.expiresAt = v.expiresAt.toISOString();
            createMut.mutate(body);
          }}
        >
          <Form.Item label="使用次数上限 (0=不限)" name="maxUses" rules={[{ required: true }]}>
            <InputNumber min={0} max={9999} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="单笔固定返佣 (元)" name="reward">
            <InputNumber min={0} step={10} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="或按比例返佣 (%)" name="rewardPct">
            <InputNumber min={0} max={100} step={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="过期时间" name="expiresAt">
            <DatePicker style={{ width: '100%' }} placeholder="不填=永久" />
          </Form.Item>
          <Alert
            type="warning"
            showIcon
            message="返佣规则: 固定金额与比例取较大者, 按订单金额计算, 套餐订阅/续费时发放"
          />
        </Form>
      </Modal>

      <Modal
        title={detail?._new ? '邀请码已创建' : '邀请码详情'}
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={<Button type="primary" onClick={() => setDetail(null)}>完成</Button>}
      >
        {detail && (
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <Card size="small" style={{ background: '#f0f7ff' }}>
              <Text>邀请码</Text>
              <div style={{ fontSize: 32, fontWeight: 700, color: '#1677ff', letterSpacing: 4, textAlign: 'center', padding: '12px 0' }}>
                {detail.code}
              </div>
              <Text>分享链接</Text>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <Input value={buildLink(detail.code)} readOnly />
                <Button type="primary" icon={<CopyOutlined />} onClick={() => onCopy(buildLink(detail.code))}>复制</Button>
              </div>
            </Card>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="使用上限">{detail.maxUses || '不限'}</Descriptions.Item>
              <Descriptions.Item label="单笔奖励">{detail.reward > 0 ? `¥${detail.reward}` : detail.rewardPct > 0 ? `${detail.rewardPct}%` : '-'}</Descriptions.Item>
              <Descriptions.Item label="过期时间">{detail.expiresAt ? dayjs(detail.expiresAt).format('YYYY-MM-DD') : '永久'}</Descriptions.Item>
              <Descriptions.Item label="状态"><Tag color="green">有效</Tag></Descriptions.Item>
            </Descriptions>
          </Space>
        )}
      </Modal>
    </div>
  );
}
