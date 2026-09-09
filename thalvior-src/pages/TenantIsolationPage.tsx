// 租户隔离报告 (Phase 1 小修补)
// - 概览: 当前租户数据盘点 + 跨租户隔离数据量
// - 隔离检测: 模拟跨租户访问攻击, 验证 Prisma 不会泄漏
// - 租户列表: admin 视角列出所有租户, 可创建/删除测试租户
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Row,
  Col,
  Tabs,
  Statistic,
  Table,
  Button,
  Tag,
  Space,
  Form,
  Input,
  Modal,
  Typography,
  message,
  Alert,
  Result,
  Progress,
  Descriptions,
} from 'antd';
import {
  SafetyCertificateOutlined,
  ReloadOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { tenantApi } from '../api';
import { useAuthStore } from '../store/auth';

const { Title, Text } = Typography;

export default function TenantIsolationPage() {
  const [tab, setTab] = useState('overview');
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { user } = useAuthStore();

  const { data: overview, isLoading: ovLoading } = useQuery({
    queryKey: ['tenant-overview'],
    queryFn: () => tenantApi.overview(),
  });

  const { data: tenants, isLoading: listLoading } = useQuery({
    queryKey: ['tenant-list'],
    queryFn: () => tenantApi.list(),
  });

  const testMut = useMutation({
    mutationFn: () => tenantApi.isolationTest(),
    onSuccess: (data: any) => {
      message[data?.ok ? 'success' : 'warning'](
        data?.ok
          ? `全部 ${data.total} 项检测通过`
          : `检测完成: ${data.passed}/${data.total} 通过, ${data.failed} 项异常`,
      );
    },
    onError: (e: any) => message.error(`检测失败: ${e?.message}`),
  });

  const createMut = useMutation({
    mutationFn: (data: any) => tenantApi.createTest(data),
    onSuccess: () => {
      message.success('测试租户已创建');
      setCreateOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['tenant-list'] });
      qc.invalidateQueries({ queryKey: ['tenant-overview'] });
    },
    onError: (e: any) => message.error(`创建失败: ${e?.message}`),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => tenantApi.deleteTest(id),
    onSuccess: () => {
      message.success('测试租户已删除');
      qc.invalidateQueries({ queryKey: ['tenant-list'] });
    },
    onError: (e: any) => message.error(`删除失败: ${e?.message}`),
  });

  const testResult = testMut.data as any | undefined;
  const passRate = testResult ? Math.round(((testResult.passed || 0) / Math.max(testResult.total, 1)) * 100) : 0;

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>
        <SafetyCertificateOutlined /> 租户隔离检测
      </Title>
      <Text type="secondary">
        验证多租户数据隔离的完整性 · 防止跨租户数据泄漏 · 当前租户: {user?.tenantName}
      </Text>

      <Row gutter={16} style={{ marginTop: 12 }}>
        <Col span={6}>
          <Card>
            <Statistic title="本租户用户" value={overview?.myData?.users || 0} loading={ovLoading} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="本租户商品" value={overview?.myData?.products || 0} loading={ovLoading} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="本租户订单" value={overview?.myData?.orders || 0} loading={ovLoading} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="被隔离租户数"
              value={(overview?.total?.tenants || 0) - 1}
              loading={ovLoading}
              valueStyle={{ color: '#52c41a' }}
              suffix="个"
            />
          </Card>
        </Col>
      </Row>

      <Card style={{ marginTop: 16 }} bordered={false}>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'overview',
              label: '数据概览',
              children: (
                <Row gutter={16}>
                  <Col span={12}>
                    <Card type="inner" title="本租户数据">
                      <Descriptions column={1} bordered size="small">
                        <Descriptions.Item label="用户">{overview?.myData?.users || 0}</Descriptions.Item>
                        <Descriptions.Item label="角色">{overview?.myData?.roles || 0}</Descriptions.Item>
                        <Descriptions.Item label="店铺">{overview?.myData?.shops || 0}</Descriptions.Item>
                        <Descriptions.Item label="商品">{overview?.myData?.products || 0}</Descriptions.Item>
                        <Descriptions.Item label="订单">{overview?.myData?.orders || 0}</Descriptions.Item>
                        <Descriptions.Item label="库存">{overview?.myData?.inventory || 0}</Descriptions.Item>
                        <Descriptions.Item label="售后单">{overview?.myData?.aftersales || 0}</Descriptions.Item>
                      </Descriptions>
                    </Card>
                  </Col>
                  <Col span={12}>
                    <Card type="inner" title="全系统数据 (含其他租户)">
                      <Descriptions column={1} bordered size="small">
                        <Descriptions.Item label="用户 (总)">
                          {overview?.total?.users || 0} <Tag color="orange">已隔离 {overview?.isolated?.users || 0}</Tag>
                        </Descriptions.Item>
                        <Descriptions.Item label="店铺 (总)">
                          {overview?.total?.shops || 0} <Tag color="orange">已隔离 {overview?.isolated?.shops || 0}</Tag>
                        </Descriptions.Item>
                        <Descriptions.Item label="商品 (总)">
                          {overview?.total?.products || 0} <Tag color="orange">已隔离 {overview?.isolated?.products || 0}</Tag>
                        </Descriptions.Item>
                        <Descriptions.Item label="订单 (总)">
                          {overview?.total?.orders || 0} <Tag color="orange">已隔离 {overview?.isolated?.orders || 0}</Tag>
                        </Descriptions.Item>
                      </Descriptions>
                    </Card>
                  </Col>
                </Row>
              ),
            },
            {
              key: 'test',
              label: '隔离检测',
              children: (
                <>
                  <Alert
                    type="info"
                    showIcon
                    message="自动跨租户攻击模拟"
                    description="系统会取另一个租户的 ID, 模拟按 ID 查询/修改/删除对方数据, 验证 Prisma 因 tenantId 复合条件不匹配而拒绝。"
                    style={{ marginBottom: 16 }}
                  />
                  <Button
                    type="primary"
                    icon={<PlayCircleOutlined />}
                    loading={testMut.isPending}
                    onClick={() => testMut.mutate()}
                    size="large"
                  >
                    跑一次跨租户检测
                  </Button>

                  {testResult && (
                    <div style={{ marginTop: 24 }}>
                      <Result
                        status={testResult.skipped ? 'info' : testResult.ok ? 'success' : 'warning'}
                        title={
                          testResult.skipped
                            ? '跳过检测'
                            : testResult.ok
                            ? '隔离完全 OK'
                            : '检测到隔离风险'
                        }
                        subTitle={
                          testResult.skipped
                            ? testResult.reason
                            : `通过 ${testResult.passed} / 失败 ${testResult.failed} / 总计 ${testResult.total}`
                        }
                        extra={
                          !testResult.skipped && (
                            <Progress
                              percent={passRate}
                              status={testResult.ok ? 'success' : 'exception'}
                              style={{ maxWidth: 480, margin: '0 auto' }}
                            />
                          )
                        }
                      />

                      {testResult.tests?.length > 0 && (
                        <Table
                          size="small"
                          rowKey={(r: any) => r.name}
                          dataSource={testResult.tests}
                          pagination={false}
                          columns={[
                            { title: '检测项', dataIndex: 'name' },
                            {
                              title: '结果',
                              dataIndex: 'passed',
                              width: 100,
                              render: (v: boolean) => (
                                <Tag color={v ? 'green' : 'red'}>{v ? '通过' : '失败'}</Tag>
                              ),
                            },
                            { title: '详情', dataIndex: 'detail', ellipsis: true },
                          ]}
                        />
                      )}
                    </div>
                  )}
                </>
              ),
            },
            {
              key: 'tenants',
              label: `租户列表 (${tenants?.length || 0})`,
              children: (
                <>
                  <Space style={{ marginBottom: 12 }}>
                    <Button
                      icon={<PlusOutlined />}
                      onClick={() => {
                        form.resetFields();
                        form.setFieldsValue({
                          name: `测试租户-${Date.now().toString().slice(-6)}`,
                          username: `tester_${Date.now().toString().slice(-6)}`,
                          password: '123456',
                        });
                        setCreateOpen(true);
                      }}
                    >
                      新建测试租户
                    </Button>
                    <Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['tenant-list'] })}>
                      刷新
                    </Button>
                  </Space>
                  <Table
                    size="middle"
                    rowKey="id"
                    loading={listLoading}
                    dataSource={tenants || []}
                    pagination={false}
                    columns={[
                      { title: '租户名', dataIndex: 'name', width: 200 },
                      { title: 'ID', dataIndex: 'id', width: 240, ellipsis: true },
                      { title: '用户数', dataIndex: 'users', width: 90, align: 'right' as const },
                      { title: '店铺数', dataIndex: 'shops', width: 90, align: 'right' as const },
                      { title: '商品数', dataIndex: 'products', width: 90, align: 'right' as const },
                      { title: '订单数', dataIndex: 'orders', width: 90, align: 'right' as const },
                      {
                        title: '当前',
                        dataIndex: 'id',
                        width: 100,
                        render: (id: string) => (id === user?.tenantId ? <Tag color="blue">本租户</Tag> : <Tag>其他</Tag>),
                      },
                      {
                        title: '操作',
                        key: 'op',
                        width: 120,
                        render: (_: any, r: any) =>
                          r.id === user?.tenantId ? (
                            <Tag color="default">-</Tag>
                          ) : (
                            <Button
                              type="link"
                              danger
                              size="small"
                              icon={<DeleteOutlined />}
                              onClick={() => {
                                Modal.confirm({
                                  title: `删除租户「${r.name}」?`,
                                  content: '会级联删除该租户下所有用户/角色/店铺/商品/订单',
                                  okType: 'danger',
                                  onOk: () => deleteMut.mutate(r.id),
                                });
                              }}
                            >
                              删除
                            </Button>
                          ),
                      },
                    ]}
                  />
                </>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="新建测试租户"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(v) => createMut.mutate(v)}>
          <Form.Item label="租户名" name="name" rules={[{ required: true }]}>
            <Input placeholder="例如: 隔离测试-A" />
          </Form.Item>
          <Form.Item label="用户名" name="username" rules={[{ required: true }]}>
            <Input placeholder="例如: tester_001" />
          </Form.Item>
          <Form.Item label="密码 (明文, 仅测试用)" name="password" rules={[{ required: true }]}>
            <Input.Password placeholder="例如: 123456" />
          </Form.Item>
          <Alert
            type="warning"
            showIcon
            message="提示"
            description="该接口仅用于隔离测试, 密码以明文存储, 切勿在生产环境使用。"
          />
        </Form>
      </Modal>
    </div>
  );
}
