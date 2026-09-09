// PDA 扫码发货 (Phase 1 小修补)
// - 一单一码: 扫描运单号/订单号, 匹配订单
// - 批量: 一次扫多个后, 提交批量发货
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Input,
  InputNumber,
  Select,
  Button,
  Space,
  Form,
  Table,
  Tag,
  Typography,
  message,
  Row,
  Col,
  Statistic,
  Alert,
} from 'antd';
import { ScanOutlined, ReloadOutlined, SendOutlined, DeleteOutlined, ClearOutlined } from '@ant-design/icons';
import { pdaApi } from '../api';
import { useAuthStore } from '../store/auth';

const { Title, Text } = Typography;

type ScanType = 'order' | 'sku' | 'tracking';

interface ScannedItem {
  key: string;
  code: string;
  type: ScanType;
  ok: boolean;
  orderId?: string;
  orderNo?: string;
  status?: string;
  message?: string;
  items?: { sku: string; name?: string; qty: number }[];
  scannedAt: number;
}

const STATUS_TAG: Record<string, string> = {
  pay: 'orange',
  toship: 'gold',
  shipped: 'green',
  done: 'blue',
  cancel: 'red',
  not_found: 'red',
};

export default function PdaScanPage() {
  const [form] = Form.useForm();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const codeRef = useRef<any>(null);

  const [scanType, setScanType] = useState<ScanType>('order');
  const [code, setCode] = useState('');
  const [list, setList] = useState<ScannedItem[]>([]);
  const [trackingNo, setTrackingNo] = useState('');
  const [carrier, setCarrier] = useState('顺丰');
  const [result, setResult] = useState<any | null>(null);

  // 自动聚焦扫码输入框
  useEffect(() => {
    codeRef.current?.focus?.();
  }, []);

  const scanMut = useMutation({
    mutationFn: ({ code, type }: { code: string; type: ScanType }) => pdaApi.scan(code, type),
    onSuccess: (data: any) => {
      const item: ScannedItem = {
        key: `${Date.now()}-${Math.random()}`,
        code,
        type: scanType,
        ok: !!data?.ok,
        orderId: data?.orderId,
        orderNo: data?.orderNo,
        status: data?.status,
        message: data?.message,
        items: data?.items,
        scannedAt: Date.now(),
      };
      setList((prev) => [item, ...prev].slice(0, 200));
      if (!data?.ok) message.warning(`未识别: ${data?.message || code}`);
      setCode('');
      // 立刻回扫
      setTimeout(() => codeRef.current?.focus?.(), 50);
    },
    onError: (e: any) => {
      message.error(`扫描失败: ${e?.message || '网络错误'}`);
    },
  });

  const shipMut = useMutation({
    mutationFn: () =>
      pdaApi.batchShip({
        orderIds: list.filter((i) => i.ok && i.orderId).map((i) => i.orderId!),
        trackingNo,
        carrier,
      }),
    onSuccess: (data: any) => {
      setResult(data);
      message.success(`批量发货完成, 成功 ${data?.count || 0} 单`);
      qc.invalidateQueries({ queryKey: ['orders'] });
      setList([]);
      setTrackingNo('');
    },
    onError: (e: any) => message.error(`发货失败: ${e?.message}`),
  });

  const onScan = () => {
    const v = (code || '').trim();
    if (!v) return message.warning('请输入或扫码');
    scanMut.mutate({ code: v, type: scanType });
  };

  // 回车扫描
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onScan();
    }
  };

  const removeItem = (key: string) => setList((prev) => prev.filter((i) => i.key !== key));
  const clearAll = () => setList([]);
  const okCount = list.filter((i) => i.ok).length;
  const validIds = list.filter((i) => i.ok && i.orderId).length;

  const columns = [
    { title: '扫码内容', dataIndex: 'code', width: 200, ellipsis: true },
    { title: '类型', dataIndex: 'type', width: 90, render: (v: ScanType) => <Tag>{v}</Tag> },
    {
      title: '结果',
      dataIndex: 'ok',
      width: 80,
      render: (v: boolean, r: ScannedItem) => (
        <Tag color={v ? 'green' : 'red'}>{v ? '✓' : '✗'}</Tag>
      ),
    },
    { title: '订单号', dataIndex: 'orderNo', width: 180 },
    {
      title: '订单状态',
      dataIndex: 'status',
      width: 110,
      render: (v: string) => v ? <Tag color={STATUS_TAG[v] || 'default'}>{v}</Tag> : '-',
    },
    { title: '消息', dataIndex: 'message', ellipsis: true },
    {
      title: '操作',
      key: 'op',
      width: 80,
      render: (_: any, r: ScannedItem) => (
        <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => removeItem(r.key)} />
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>
        <ScanOutlined /> PDA 扫码发货
      </Title>
      <Text type="secondary">
        扫码枪 / 手动输入, 匹配订单后批量发货 · 当前操作员: {user?.name || '-'}
      </Text>

      <Row gutter={16} style={{ marginTop: 12 }}>
        <Col span={6}>
          <Card>
            <Statistic title="累计扫描" value={list.length} suffix="次" />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="可发货"
              value={okCount}
              suffix="单"
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="异常"
              value={list.length - okCount}
              suffix="次"
              valueStyle={{ color: '#ff4d4f' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="可批量发货"
              value={validIds}
              suffix="单"
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
      </Row>

      <Card style={{ marginTop: 16 }} bordered={false}>
        <Form layout="inline" onSubmitCapture={onScan}>
          <Form.Item label="类型">
            <Select
              value={scanType}
              onChange={setScanType}
              style={{ width: 130 }}
              options={[
                { value: 'order', label: '订单号' },
                { value: 'tracking', label: '运单号' },
                { value: 'sku', label: 'SKU' },
              ]}
            />
          </Form.Item>
          <Form.Item label="扫码">
            <Input
              ref={codeRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="扫码或输入后回车"
              style={{ width: 340 }}
              autoFocus
              allowClear
              prefix={<ScanOutlined />}
            />
          </Form.Item>
          <Form.Item>
            <Button type="primary" onClick={onScan} loading={scanMut.isPending} icon={<ScanOutlined />}>
              扫描
            </Button>
          </Form.Item>
          <Form.Item>
            <Button icon={<ClearOutlined />} onClick={clearAll} disabled={!list.length}>
              清空
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Card
        title={`已扫描 (${list.length})`}
        style={{ marginTop: 16 }}
        bordered={false}
        extra={
          <Space>
            <Input
              placeholder="物流单号"
              value={trackingNo}
              onChange={(e) => setTrackingNo(e.target.value)}
              style={{ width: 200 }}
            />
            <Select
              value={carrier}
              onChange={setCarrier}
              style={{ width: 130 }}
              options={['顺丰', '圆通', '中通', '韵达', 'EMS', '京东', '其他'].map((v) => ({ value: v, label: v }))}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={() => {
                if (!validIds) return message.warning('无可发货订单');
                if (!trackingNo.trim()) return message.warning('请填写物流单号');
                Modal.confirm({
                  title: `确认批量发货 ${validIds} 单?`,
                  content: `承运商: ${carrier} · 单号: ${trackingNo}`,
                  onOk: () => shipMut.mutate(),
                });
              }}
              loading={shipMut.isPending}
              disabled={!validIds}
            >
              批量发货 ({validIds})
            </Button>
          </Space>
        }
      >
        {result && (
          <Alert
            type={result.ok ? 'success' : 'error'}
            message={`上次发货结果: 成功 ${result.count || 0} / 失败 ${(result.results || []).filter((r: any) => !r.ok).length}`}
            showIcon
            closable
            style={{ marginBottom: 12 }}
            onClose={() => setResult(null)}
          />
        )}
        <Table
          size="small"
          rowKey="key"
          dataSource={list}
          columns={columns as any}
          pagination={{ pageSize: 20 }}
          scroll={{ x: 900 }}
          locale={{ emptyText: '暂无扫描记录, 开始扫码吧' }}
        />
      </Card>
    </div>
  );
}

// 动态引入 Modal 避免循环依赖报错
import { Modal } from 'antd';
