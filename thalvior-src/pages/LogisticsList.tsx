import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Tag, Space, Button, Input, Select, Form, Row, Col, Typography,
  Tabs, Modal, message, Timeline, Statistic,
} from 'antd';
import {
  ReloadOutlined, PlusOutlined,
  SendOutlined, CompassOutlined, CheckCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { logisticsApi, orderApi } from '../api';
import { usePermission } from '../hooks/usePermission';
import { useTranslation } from '../i18n';

const { Title, Text } = Typography;

const CARRIER_VALUES = ['yuantong', 'shunfeng', 'ems', 'dhl', 'ups', 'fedex', 'yanwen', 'yunexpress'];

// ============ 渠道管理 Tab ============
function ChannelTab() {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<any | null>(null);
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { has } = usePermission();

  const CARRIERS = CARRIER_VALUES.map((v) => ({
    value: v,
    label: t(`pages.logisticsList.carrier.${v}`),
  }));

  const { data, isLoading } = useQuery({
    queryKey: ['logistics-channels'],
    queryFn: () => logisticsApi.channels(),
  });

  const createMut = useMutation({
    mutationFn: logisticsApi.createChannel,
    onSuccess: () => {
      message.success(t('pages.logisticsList.channelTab.createSuccess'));
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['logistics-channels'] });
    },
  });

  const columns = [
    { title: t('pages.logisticsList.channelTab.colCode'), dataIndex: 'code', width: 140 },
    { title: t('pages.logisticsList.channelTab.colName'), dataIndex: 'name', width: 200 },
    {
      title: t('pages.logisticsList.channelTab.colCarrier'),
      dataIndex: 'carrier',
      width: 160,
      render: (v: string) => CARRIERS.find((c) => c.value === v)?.label || v,
    },
    {
      title: t('pages.logisticsList.channelTab.colType'),
      dataIndex: 'type',
      width: 100,
      render: (v: number) => v === 1
        ? <Tag color="blue">{t('pages.logisticsList.type.self')}</Tag>
        : <Tag>{t('pages.logisticsList.type.third')}</Tag>,
    },
    {
      title: t('pages.logisticsList.channelTab.colStatus'),
      dataIndex: 'enabled',
      width: 100,
      render: (v: number) => v === 1
        ? <Tag color="green">{t('pages.logisticsList.enabled.on')}</Tag>
        : <Tag>{t('pages.logisticsList.enabled.off')}</Tag>,
    },
    {
      title: t('pages.logisticsList.channelTab.colCreatedAt'),
      dataIndex: 'createdAt',
      width: 160,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-',
    },
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 12 }}>
        <Col span={6}><Card bordered={false}><Statistic title={t('pages.logisticsList.channelTab.statTotal')} value={(data || []).length} prefix={<SendOutlined />} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title={t('pages.logisticsList.channelTab.statEnabled')} value={(data || []).filter((d: any) => d.enabled === 1).length} valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title={t('pages.logisticsList.channelTab.statSelf')} value={(data || []).filter((d: any) => d.type === 1).length} /></Card></Col>
        <Col span={6}><Card bordered={false}><Statistic title={t('pages.logisticsList.channelTab.statThird')} value={(data || []).filter((d: any) => d.type !== 1).length} /></Card></Col>
      </Row>
      <Card bordered={false} extra={has('logistics:channel') && (
        <Button type="primary" icon={<PlusOutlined />} onClick={() => {
          setEditing({});
          form.resetFields();
        }}>{t('pages.logisticsList.channelTab.createButton')}</Button>
      )}>
        <Table
          size="middle"
          columns={columns as any}
          dataSource={data || []}
          loading={isLoading}
          rowKey="id"
          pagination={false}
        />
      </Card>
      <Modal
        title={editing?.id ? t('pages.logisticsList.channelTab.editTitle') : t('pages.logisticsList.channelTab.addTitle')}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={async () => {
          const v = await form.validateFields();
          createMut.mutate(v);
        }}
        confirmLoading={createMut.isPending}
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="code" label={t('pages.logisticsList.channelTab.labelCode')} rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="name" label={t('pages.logisticsList.channelTab.labelName')} rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}>
              <Form.Item name="carrier" label={t('pages.logisticsList.channelTab.labelCarrier')} rules={[{ required: true }]}>
                <Select options={CARRIERS} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="type" label={t('pages.logisticsList.channelTab.labelType')} initialValue={1}>
                <Select options={[
                  { label: t('pages.logisticsList.type.self'), value: 1 },
                  { label: t('pages.logisticsList.type.third'), value: 2 },
                ]} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="apiKey" label={t('pages.logisticsList.channelTab.labelApiKey')}>
                <Input.Password placeholder={t('pages.logisticsList.channelTab.placeholderApiKey')} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
}

// ============ 物流轨迹 Tab ============
function TrackTab() {
  const { t } = useTranslation();
  const [trackingNo, setTrackingNo] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const onTrack = async () => {
    if (!trackingNo) {
      message.warning(t('pages.logisticsList.trackTab.warningEmpty'));
      return;
    }
    setLoading(true);
    try {
      const r = await logisticsApi.track(trackingNo);
      setResult(r);
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const statusText = (s: string) => {
    if (s === 'delivered') return t('pages.logisticsList.trackStatus.delivered');
    if (s === 'in_transit') return t('pages.logisticsList.trackStatus.in_transit');
    return t('pages.logisticsList.trackStatus.shipped');
  };

  return (
    <div>
      <Card bordered={false}>
        <Space.Compact style={{ width: '100%', maxWidth: 600 }}>
          <Input
            size="large"
            placeholder={t('pages.logisticsList.trackTab.placeholderTrackNo')}
            value={trackingNo}
            onChange={(e) => setTrackingNo(e.target.value)}
            onPressEnter={onTrack}
            prefix={<CompassOutlined />}
          />
          <Button size="large" type="primary" loading={loading} onClick={onTrack}>{t('pages.logisticsList.trackTab.buttonQuery')}</Button>
        </Space.Compact>
        <div style={{ marginTop: 12, color: '#999', fontSize: 12 }}>
          {t('pages.logisticsList.trackTab.supportHint')}
        </div>
      </Card>

      {result && (
        <Card style={{ marginTop: 16 }} bordered={false}
          title={<Space><span>{t('pages.logisticsList.trackTab.trackingNoLabel')} {result.trackingNo}</span><Tag color="blue">{result.carrier}</Tag></Space>}
        >
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={6}>
              <Statistic
                title={t('pages.logisticsList.trackTab.colStatus')}
                value={statusText(result.status)}
                valueStyle={{ color: result.status === 'delivered' ? '#52c41a' : '#1890ff' }}
                prefix={result.status === 'delivered' ? <CheckCircleOutlined /> : <CompassOutlined />}
              />
            </Col>
            <Col span={18}>
              <Card size="small">
                <div style={{ fontWeight: 'bold', marginBottom: 4 }}>{t('pages.logisticsList.trackTab.latestUpdate')}</div>
                <div style={{ color: '#666' }}>
                  {result.lastEvent?.time ? dayjs(result.lastEvent.time).format('YYYY-MM-DD HH:mm') : '-'}
                  {' '}{result.lastEvent?.location} - {result.lastEvent?.action}
                </div>
                <div style={{ color: '#999', marginTop: 4 }}>{result.lastEvent?.detail}</div>
              </Card>
            </Col>
          </Row>
          <Title level={5}>{t('pages.logisticsList.trackTab.timelineTitle')}</Title>
          <Timeline
            items={(result.events || []).map((e: any) => ({
              color: 'blue',
              children: (
                <div>
                  <div style={{ fontWeight: 'bold' }}>{e.action} - {e.location}</div>
                  <div style={{ color: '#666', fontSize: 13 }}>{e.detail}</div>
                  <div style={{ color: '#999', fontSize: 12 }}>{dayjs(e.time).format('YYYY-MM-DD HH:mm:ss')}</div>
                </div>
              ),
            }))}
          />
        </Card>
      )}
    </div>
  );
}

// ============ 面单打印 Tab ============
function WaybillTab() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 20, status: 'toship' });
  const { data, isLoading } = useQuery({
    queryKey: ['orders', filters],
    queryFn: () => orderApi.list(filters),
  });
  const { data: channels } = useQuery({
    queryKey: ['logistics-channels'],
    queryFn: () => logisticsApi.channels(),
  });

  const orderStatusMap: Record<string, { color: string; text: string }> = {
    pending: { color: 'default', text: t('pages.logisticsList.orderStatus.pending') },
    pay: { color: 'cyan', text: t('pages.logisticsList.orderStatus.pay') },
    toship: { color: 'blue', text: t('pages.logisticsList.orderStatus.toship') },
    shipped: { color: 'green', text: t('pages.logisticsList.orderStatus.shipped') },
    done: { color: 'green', text: t('pages.logisticsList.orderStatus.done') },
    cancel: { color: 'red', text: t('pages.logisticsList.orderStatus.cancel') },
  };

  const onPrint = (record: any) => {
    Modal.info({
      title: t('pages.logisticsList.waybillTab.generatedTitle'),
      width: 500,
      content: (
        <div>
          <p>{t('pages.logisticsList.waybillTab.orderNoLabel')}: {record.platformNo}</p>
          <p>{t('pages.logisticsList.waybillTab.buyerLabel')}: {record.buyerName}</p>
          <p>{t('pages.logisticsList.waybillTab.countryLabel')}: {record.country}</p>
          <p>{t('pages.logisticsList.waybillTab.carrierRecommendLabel')}: {(channels || [])[0]?.name || t('pages.logisticsList.waybillTab.noChannelConfig')}</p>
          <p style={{ color: '#999' }}>{t('pages.logisticsList.waybillTab.printHint')}</p>
        </div>
      ),
    });
  };

  const columns = [
    { title: t('pages.logisticsList.waybillTab.colOrderNo'), dataIndex: 'platformNo', width: 200 },
    { title: t('pages.logisticsList.waybillTab.colBuyer'), dataIndex: 'buyerName', width: 120 },
    { title: t('pages.logisticsList.waybillTab.colCountry'), dataIndex: 'country', width: 80 },
    {
      title: t('pages.logisticsList.waybillTab.colAmount'),
      dataIndex: 'totalAmount',
      width: 120,
      align: 'right' as const,
      render: (v: number, r: any) => `${r.currency} ${(+v).toFixed(2)}`,
    },
    {
      title: t('pages.logisticsList.waybillTab.colStatus'),
      dataIndex: 'status',
      width: 100,
      render: (v: string) => {
        return <Tag color={orderStatusMap[v]?.color}>{orderStatusMap[v]?.text || v}</Tag>;
      },
    },
    {
      title: t('pages.logisticsList.waybillTab.colActions'),
      width: 160,
      fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Button size="small" type="primary" onClick={() => onPrint(r)} disabled={r.status !== 'toship'}>
          {t('pages.logisticsList.waybillTab.btnPrint')}
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Card bordered={false}>
        <Form
          layout="inline"
          onFinish={(v) => setFilters((f: any) => ({ ...f, ...v, page: 1 }))}
        >
          <Form.Item name="platformNo">
            <Input placeholder={t('pages.logisticsList.waybillTab.placeholderOrderNo')} allowClear style={{ width: 200 }} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">{t('pages.logisticsList.waybillTab.btnQuery')}</Button>
              <Button onClick={() => setFilters({ page: 1, pageSize: 20, status: 'toship' })} icon={<ReloadOutlined />}>{t('pages.logisticsList.waybillTab.btnReset')}</Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
      <Card style={{ marginTop: 16 }} bordered={false} title={t('pages.logisticsList.waybillTab.cardTitle')}>
        <Table
          size="middle"
          columns={columns as any}
          dataSource={data?.items || []}
          loading={isLoading}
          rowKey="id"
          scroll={{ x: 900 }}
          pagination={{
            current: filters.page,
            pageSize: filters.pageSize,
            total: data?.total || 0,
            showSizeChanger: true,
            onChange: (page, pageSize) => setFilters((f: any) => ({ ...f, page, pageSize })),
          }}
        />
      </Card>
    </div>
  );
}

// ============ 入口 ============
export default function LogisticsList() {
  const { t } = useTranslation();
  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>{t('pages.logisticsList.title')}</Title>
      <Text type="secondary">{t('pages.logisticsList.subtitle')}</Text>
      <Tabs
        style={{ marginTop: 12 }}
        defaultActiveKey="channel"
        items={[
          { key: 'channel', label: t('pages.logisticsList.tab.channel'), children: <ChannelTab /> },
          { key: 'waybill', label: t('pages.logisticsList.tab.waybill'), children: <WaybillTab /> },
          { key: 'track', label: t('pages.logisticsList.tab.track'), children: <TrackTab /> },
        ]}
      />
    </div>
  );
}
