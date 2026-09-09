/**
 * 财务记账: 会计科目 / 记账凭证 / 余额对账 / 科目余额表 / 利润表
 */
import { useMemo, useState } from 'react';
import {
  Button,
  Card,
  Col,
  DatePicker,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  BookOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  StopOutlined,
  SwapOutlined,
  DeleteOutlined,
  EditOutlined,
  SearchOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { Dayjs } from 'dayjs';
import { bookkeepingApi, type Account, type JournalEntry, type JournalLine, type Reconciliation } from '../api';

const { Title, Text } = Typography;

const ACCOUNT_TYPES: Record<string, { label: string; color: string }> = {
  asset: { label: '资产', color: 'blue' },
  liability: { label: '负债', color: 'orange' },
  equity: { label: '权益', color: 'purple' },
  income: { label: '收入', color: 'green' },
  expense: { label: '支出', color: 'red' },
};

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'default' },
  posted: { label: '已过账', color: 'success' },
  reversed: { label: '已冲销', color: 'red' },
};

const RECON_STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending: { label: '待对账', color: 'default' },
  balanced: { label: '已平衡', color: 'success' },
  abnormal: { label: '异常', color: 'red' },
  adjusting: { label: '调整中', color: 'processing' },
  closed: { label: '已关闭', color: 'default' },
};

interface Props {
  tab?: 'overview' | 'coa' | 'voucher' | 'reconcile' | 'trial' | 'income';
}

// =============== 工具 ===============

function money(n: number | string | undefined, currency = 'CNY'): string {
  const v = Number(n || 0);
  return v.toLocaleString('zh-CN', { style: 'currency', currency, minimumFractionDigits: 2 });
}

function defaultPeriod() {
  return dayjs().format('YYYY-MM');
}

// =============== 总览 ===============

function OverviewTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['bk-overview'], queryFn: () => bookkeepingApi.overview() });
  const init = useMutation({
    mutationFn: () => bookkeepingApi.initAccounts(),
    onSuccess: (r) => {
      message.success(r.initialized ? `已初始化 ${r.count} 个默认科目` : `当前租户已存在 ${r.count} 个科目`);
      qc.invalidateQueries({ queryKey: ['bk-overview'] });
      qc.invalidateQueries({ queryKey: ['bk-accounts'] });
    },
  });

  const o: any = data || {};
  const recent: any[] = o.recent || [];
  const entries: any[] = o.entries || [];
  const statusMap: Record<string, number> = {};
  let totalDebit = 0;
  for (const e of entries) {
    statusMap[e.status] = e._count?.id || 0;
    totalDebit += e._sum?.totalDebit || 0;
  }

  return (
    <Row gutter={[16, 16]}>
      <Col span={6}>
        <Card loading={isLoading}>
          <Statistic title="会计科目" value={o.accountCount || 0} prefix={<BookOutlined />} />
          <Button
            type="link"
            size="small"
            onClick={() => init.mutate()}
            loading={init.isPending}
            style={{ padding: 0, marginTop: 8 }}
          >
            初始化默认科目表
          </Button>
        </Card>
      </Col>
      <Col span={6}>
        <Card loading={isLoading}>
          <Statistic title="凭证总数" value={entries.reduce((s, e) => s + (e._count?.id || 0), 0)} prefix={<FileTextOutlined />} />
          <Space style={{ marginTop: 8 }}>
            <Tag color="default">草稿 {statusMap.draft || 0}</Tag>
            <Tag color="success">已过账 {statusMap.posted || 0}</Tag>
            <Tag color="red">已冲销 {statusMap.reversed || 0}</Tag>
          </Space>
        </Card>
      </Col>
      <Col span={6}>
        <Card loading={isLoading}>
          <Statistic title="借方累计发生额" value={totalDebit} precision={2} prefix="¥" />
        </Card>
      </Col>
      <Col span={6}>
        <Card loading={isLoading}>
          <Statistic
            title="最近对账期间"
            value={o.lastReconcile?.period || '-'}
            valueStyle={{ fontSize: 22 }}
          />
          {o.lastReconcile && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {o.lastReconcile.account?.code} {o.lastReconcile.account?.name}
            </Text>
          )}
        </Card>
      </Col>

      <Col span={24}>
        <Card title="最近凭证" loading={isLoading}>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={recent}
            columns={[
              { title: '凭证号', dataIndex: 'voucherNo', width: 140 },
              { title: '摘要', dataIndex: 'summary', ellipsis: true },
              {
                title: '借/贷',
                width: 160,
                render: (_: any, r: any) => {
                  const debit = r.lines?.filter((l: any) => l.direction === 'debit').reduce((s: number, l: any) => s + l.amount, 0) || 0;
                  const credit = r.lines?.filter((l: any) => l.direction === 'credit').reduce((s: number, l: any) => s + l.amount, 0) || 0;
                  return (
                    <span>
                      <Text type="danger">{money(debit)}</Text>
                      {' / '}
                      <Text type="success">{money(credit)}</Text>
                    </span>
                  );
                },
              },
              {
                title: '状态',
                dataIndex: 'status',
                width: 100,
                render: (s: string) => <Tag color={STATUS_MAP[s]?.color}>{STATUS_MAP[s]?.label || s}</Tag>,
              },
              { title: '日期', dataIndex: 'entryDate', width: 110, render: (d: string) => dayjs(d).format('YYYY-MM-DD') },
            ]}
            locale={{ emptyText: <Empty description="还没有任何凭证" /> }}
          />
        </Card>
      </Col>

      <Col span={24}>
        <Card>
          <Title level={5}>记账流程</Title>
          <ol style={{ paddingLeft: 20, lineHeight: 2, color: 'rgba(0,0,0,0.65)' }}>
            <li>首次使用: 在「会计科目」页确认/初始化默认科目表 (资产/负债/权益/收入/支出)</li>
            <li>日常记账: 在「记账凭证」页登记新凭证, 录入借/贷分录 (借贷必须平衡)</li>
            <li>过账: 草稿凭证可编辑, 过账后自动更新科目余额, 不可再改</li>
            <li>冲销: 过账后发现错误可一键冲销, 自动生成反向凭证</li>
            <li>对账: 在「余额对账」按月录入实际余额, 系统自动比对账面余额生成差异</li>
            <li>报表: 科目余额表 / 利润表 实时汇总, 支持按期间筛选</li>
          </ol>
        </Card>
      </Col>
    </Row>
  );
}

// =============== 会计科目 ===============

function CoaTab() {
  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<string | undefined>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [form] = Form.useForm();

  const { data, isLoading } = useQuery({
    queryKey: ['bk-accounts', typeFilter],
    queryFn: () => bookkeepingApi.listAccounts(typeFilter),
  });

  const init = useMutation({
    mutationFn: () => bookkeepingApi.initAccounts(),
    onSuccess: (r) => {
      message.success(r.initialized ? `已初始化 ${r.count} 个默认科目` : `当前租户已存在 ${r.count} 个科目`);
      qc.invalidateQueries({ queryKey: ['bk-accounts'] });
    },
  });

  const save = useMutation({
    mutationFn: (body: any) =>
      editing ? bookkeepingApi.updateAccount(editing.id, body) : bookkeepingApi.createAccount(body),
    onSuccess: () => {
      message.success('已保存');
      setEditorOpen(false);
      setEditing(null);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['bk-accounts'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => bookkeepingApi.deleteAccount(id),
    onSuccess: () => {
      message.success('已删除');
      qc.invalidateQueries({ queryKey: ['bk-accounts'] });
    },
    onError: (e: any) => message.error(e?.response?.data?.message || '删除失败'),
  });

  const rows: Account[] = (data as any)?.flat || [];

  return (
    <Card
      title="会计科目 (Chart of Accounts)"
      extra={
        <Space>
          <Select
            placeholder="按类型筛选"
            allowClear
            style={{ width: 160 }}
            value={typeFilter}
            onChange={setTypeFilter}
            options={Object.entries(ACCOUNT_TYPES).map(([v, m]) => ({ value: v, label: m.label }))}
          />
          <Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['bk-accounts'] })}>
            刷新
          </Button>
          <Button onClick={() => init.mutate()} loading={init.isPending}>
            初始化默认科目
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null);
              form.resetFields();
              setEditorOpen(true);
            }}
          >
            新增科目
          </Button>
        </Space>
      }
    >
      <Table
        rowKey="id"
        size="small"
        loading={isLoading}
        dataSource={rows}
        pagination={{ pageSize: 50, showSizeChanger: false }}
        columns={[
          { title: '代码', dataIndex: 'code', width: 100 },
          { title: '名称', dataIndex: 'name' },
          {
            title: '类型',
            dataIndex: 'type',
            width: 100,
            render: (t: string) => <Tag color={ACCOUNT_TYPES[t]?.color}>{ACCOUNT_TYPES[t]?.label || t}</Tag>,
          },
          {
            title: '余额方向',
            dataIndex: 'direction',
            width: 100,
            render: (d: string) => (d === 'debit' ? '借' : '贷'),
          },
          {
            title: '当前余额',
            dataIndex: 'balance',
            width: 140,
            align: 'right' as const,
            render: (b: number, r: Account) => money(b, r.currency),
          },
          { title: '币种', dataIndex: 'currency', width: 80 },
          {
            title: '状态',
            dataIndex: 'enabled',
            width: 80,
            render: (b: boolean) => (b ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
          },
          { title: '说明', dataIndex: 'description', ellipsis: true },
          {
            title: '操作',
            width: 140,
            fixed: 'right' as const,
            render: (_: any, r: Account) => (
              <Space size="small">
                <Button
                  type="link"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setEditing(r);
                    form.setFieldsValue(r);
                    setEditorOpen(true);
                  }}
                >
                  编辑
                </Button>
                <Popconfirm title="确定删除该科目?" onConfirm={() => remove.mutate(r.id)}>
                  <Button type="link" danger size="small" icon={<DeleteOutlined />}>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
        locale={{ emptyText: <Empty description="暂无科目, 点击右上角初始化或新增" /> }}
      />

      <Modal
        title={editing ? '编辑科目' : '新增科目'}
        open={editorOpen}
        onCancel={() => {
          setEditorOpen(false);
          setEditing(null);
        }}
        onOk={() => form.submit()}
        confirmLoading={save.isPending}
        width={520}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) => save.mutate(v)}
          initialValues={{ type: 'asset', direction: 'debit', currency: 'CNY', enabled: true }}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="code" label="科目代码" rules={[{ required: true }]}>
                <Input placeholder="如 1001" disabled={!!editing} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="name" label="科目名称" rules={[{ required: true }]}>
                <Input placeholder="如 库存现金" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="type" label="类型" rules={[{ required: true }]}>
                <Select
                  options={Object.entries(ACCOUNT_TYPES).map(([v, m]) => ({ value: v, label: m.label }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="direction" label="余额方向" rules={[{ required: true }]}>
                <Select
                  options={[
                    { value: 'debit', label: '借方' },
                    { value: 'credit', label: '贷方' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="currency" label="币种">
                <Select
                  options={['CNY', 'USD', 'EUR', 'GBP', 'JPY'].map((c) => ({ value: c, label: c }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="enabled" label="是否启用">
                <Select
                  options={[
                    { value: true, label: '启用' },
                    { value: false, label: '停用' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="description" label="说明">
                <Input.TextArea rows={2} placeholder="选填" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </Card>
  );
}

// =============== 记账凭证 ===============

interface VoucherDraftLine extends JournalLine {}

function VoucherEditor({
  accounts,
  open,
  onClose,
  onSaved,
}: {
  accounts: Account[];
  open: boolean;
  onClose: () => void;
  onSaved: (e: JournalEntry) => void;
}) {
  const [form] = Form.useForm();
  const [lines, setLines] = useState<VoucherDraftLine[]>([
    { accountId: '', direction: 'debit', amount: 0, remark: '' },
    { accountId: '', direction: 'credit', amount: 0, remark: '' },
  ]);

  const totalDebit = lines.filter((l) => l.direction === 'debit').reduce((s, l) => s + Number(l.amount || 0), 0);
  const totalCredit = lines.filter((l) => l.direction === 'credit').reduce((s, l) => s + Number(l.amount || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005 && totalDebit > 0;

  const save = useMutation({
    mutationFn: (body: any) => bookkeepingApi.createEntry(body),
    onSuccess: (e) => {
      message.success(`已创建凭证 ${e.voucherNo}`);
      onSaved(e);
    },
    onError: (err: any) => message.error(err?.response?.data?.message || '保存失败'),
  });

  const addLine = () => {
    setLines([...lines, { accountId: '', direction: 'debit', amount: 0, remark: '' }]);
  };
  const updateLine = (idx: number, patch: Partial<VoucherDraftLine>) => {
    setLines(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const removeLine = (idx: number) => setLines(lines.filter((_, i) => i !== idx));

  return (
    <Drawer
      title="新建记账凭证"
      open={open}
      onClose={onClose}
      width={900}
      extra={
        <Space>
          <Tag color={balanced ? 'success' : 'error'}>
            借 {money(totalDebit)} / 贷 {money(totalCredit)} {balanced ? '已平衡' : '不平衡'}
          </Tag>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            loading={save.isPending}
            disabled={!balanced}
            onClick={() =>
              form.validateFields().then((v) => {
                if (lines.some((l) => !l.accountId || !l.amount)) {
                  message.error('请填写所有分录的科目和金额');
                  return;
                }
                save.mutate({
                  ...v,
                  entryDate: dayjs(v.entryDate).toISOString(),
                  lines: lines.map((l) => ({ ...l, amount: Number(l.amount) })),
                });
              })
            }
          >
            保存草稿
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" initialValues={{ entryDate: dayjs(), currency: 'CNY' }}>
        <Row gutter={16}>
          <Col span={16}>
            <Form.Item name="summary" label="摘要" rules={[{ required: true, message: '请输入摘要' }]}>
              <Input placeholder="如: 销售订单 ORD001 收入确认" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="entryDate" label="记账日期" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="sourceType" label="业务来源">
              <Select
                allowClear
                placeholder="选填"
                options={[
                  { value: 'manual', label: '手工录入' },
                  { value: 'order', label: '订单收入' },
                  { value: 'refund', label: '退款' },
                  { value: 'transfer', label: '调拨/转账' },
                  { value: 'fee', label: '费用' },
                  { value: 'salary', label: '薪酬' },
                ]}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="remark" label="备注">
              <Input placeholder="选填" />
            </Form.Item>
          </Col>
        </Row>
      </Form>

      <Card
        size="small"
        title="分录"
        extra={
          <Button type="dashed" icon={<PlusOutlined />} onClick={addLine}>
            增加分录
          </Button>
        }
      >
        <Table
          rowKey={(_r, idx) => `${idx}`}
          size="small"
          pagination={false}
          dataSource={lines.map((l, i) => ({ ...l, _idx: i }))}
          columns={[
            {
              title: '#',
              width: 50,
              render: (_: any, r: any) => r._idx + 1,
            },
            {
              title: '摘要',
              width: 200,
              render: (_: any, r: any) => (
                <Input
                  value={r.remark}
                  placeholder="分录说明"
                  onChange={(e) => updateLine(r._idx, { remark: e.target.value })}
                />
              ),
            },
            {
              title: '科目',
              render: (_: any, r: any) => (
                <Select
                  showSearch
                  value={r.accountId || undefined}
                  placeholder="选择科目"
                  style={{ width: '100%' }}
                  optionFilterProp="label"
                  options={accounts.map((a) => ({
                    value: a.id,
                    label: `${a.code} ${a.name}`,
                  }))}
                  onChange={(v) => updateLine(r._idx, { accountId: v })}
                />
              ),
            },
            {
              title: '方向',
              width: 100,
              render: (_: any, r: any) => (
                <Select
                  value={r.direction}
                  options={[
                    { value: 'debit', label: '借' },
                    { value: 'credit', label: '贷' },
                  ]}
                  onChange={(v) => updateLine(r._idx, { direction: v })}
                />
              ),
            },
            {
              title: '金额',
              width: 160,
              render: (_: any, r: any) => (
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  precision={2}
                  value={r.amount}
                  onChange={(v) => updateLine(r._idx, { amount: Number(v) || 0 })}
                />
              ),
            },
            {
              title: '操作',
              width: 80,
              render: (_: any, r: any) => (
                <Button type="link" danger size="small" icon={<DeleteOutlined />} onClick={() => removeLine(r._idx)} />
              ),
            },
          ]}
        />
        <div style={{ marginTop: 12, textAlign: 'right' }}>
          <Space size="large">
            <span>
              <Text type="danger">借方合计</Text> <Text strong>{money(totalDebit)}</Text>
            </span>
            <span>
              <Text type="success">贷方合计</Text> <Text strong>{money(totalCredit)}</Text>
            </span>
            <span>
              差额: <Text type={balanced ? 'success' : 'danger'}>{money(Math.abs(totalDebit - totalCredit))}</Text>
            </span>
          </Space>
        </div>
      </Card>
    </Drawer>
  );
}

function VoucherTab() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [status, setStatus] = useState<string | undefined>();
  const [keyword, setKeyword] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [detail, setDetail] = useState<JournalEntry | null>(null);
  const [from, setFrom] = useState<Dayjs | null>(null);
  const [to, setTo] = useState<Dayjs | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['bk-entries', page, pageSize, status, keyword, from?.toString(), to?.toString()],
    queryFn: () =>
      bookkeepingApi.listEntries({
        page,
        pageSize,
        status,
        keyword: keyword || undefined,
        from: from?.toISOString(),
        to: to?.toISOString(),
      }),
  });
  const accountsQ = useQuery({
    queryKey: ['bk-accounts-all'],
    queryFn: () => bookkeepingApi.listAccounts(),
  });
  const accounts: Account[] = (accountsQ.data as any)?.flat || [];

  const post = useMutation({
    mutationFn: (id: string) => bookkeepingApi.postEntry(id),
    onSuccess: (e) => {
      message.success(`凭证 ${e.voucherNo} 已过账`);
      qc.invalidateQueries({ queryKey: ['bk-entries'] });
      qc.invalidateQueries({ queryKey: ['bk-overview'] });
      setDetail(e);
    },
  });
  const reverse = useMutation({
    mutationFn: (id: string) => bookkeepingApi.reverseEntry(id, { remark: '手动冲销' }),
    onSuccess: (e) => {
      message.success(`已生成冲销凭证 ${e.voucherNo}`);
      qc.invalidateQueries({ queryKey: ['bk-entries'] });
      setDetail(null);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => bookkeepingApi.deleteEntry(id),
    onSuccess: () => {
      message.success('已删除');
      qc.invalidateQueries({ queryKey: ['bk-entries'] });
    },
  });

  const items = (data as any)?.items || [];

  return (
    <>
      <Card
        title="记账凭证"
        extra={
          <Space>
            <Input
              placeholder="凭证号 / 摘要"
              prefix={<SearchOutlined />}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onPressEnter={() => setPage(1)}
              allowClear
              style={{ width: 200 }}
            />
            <Select
              placeholder="状态"
              allowClear
              value={status}
              onChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
              style={{ width: 130 }}
              options={Object.entries(STATUS_MAP).map(([v, m]) => ({ value: v, label: m.label }))}
            />
            <DatePicker.RangePicker
              value={[from, to]}
              onChange={(v) => {
                setFrom(v?.[0] || null);
                setTo(v?.[1] || null);
                setPage(1);
              }}
            />
            <Button
              icon={<ReloadOutlined />}
              onClick={() => qc.invalidateQueries({ queryKey: ['bk-entries'] })}
            >
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditorOpen(true)}>
              新建凭证
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          size="small"
          loading={isLoading}
          dataSource={items}
          pagination={{
            current: page,
            pageSize,
            total: (data as any)?.total || 0,
            showSizeChanger: true,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
          columns={[
            { title: '凭证号', dataIndex: 'voucherNo', width: 150 },
            { title: '日期', dataIndex: 'entryDate', width: 110, render: (d: string) => dayjs(d).format('YYYY-MM-DD') },
            { title: '摘要', dataIndex: 'summary', ellipsis: true },
            {
              title: '业务来源',
              dataIndex: 'sourceType',
              width: 110,
              render: (s: string) => (s ? <Tag>{s}</Tag> : '-'),
            },
            { title: '借方', dataIndex: 'totalDebit', width: 130, align: 'right' as const, render: (v: number) => money(v) },
            { title: '贷方', dataIndex: 'totalCredit', width: 130, align: 'right' as const, render: (v: number) => money(v) },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (s: string) => <Tag color={STATUS_MAP[s]?.color}>{STATUS_MAP[s]?.label || s}</Tag>,
            },
            { title: '制单人', dataIndex: 'createdByName', width: 100 },
            {
              title: '操作',
              width: 200,
              fixed: 'right' as const,
              render: (_: any, r: JournalEntry) => (
                <Space size="small">
                  <Button type="link" size="small" onClick={() => setDetail(r)}>
                    详情
                  </Button>
                  {r.status === 'draft' && (
                    <>
                      <Button
                        type="link"
                        size="small"
                        icon={<CheckCircleOutlined />}
                        onClick={() => post.mutate(r.id)}
                        loading={post.isPending}
                      >
                        过账
                      </Button>
                      <Popconfirm title="删除该草稿?" onConfirm={() => remove.mutate(r.id)}>
                        <Button type="link" danger size="small" icon={<DeleteOutlined />}>
                          删除
                        </Button>
                      </Popconfirm>
                    </>
                  )}
                  {r.status === 'posted' && (
                    <Popconfirm title="冲销将自动生成反向凭证, 是否继续?" onConfirm={() => reverse.mutate(r.id)}>
                      <Button type="link" size="small" danger icon={<SwapOutlined />}>
                        冲销
                      </Button>
                    </Popconfirm>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <VoucherEditor
        accounts={accounts}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          setEditorOpen(false);
          qc.invalidateQueries({ queryKey: ['bk-entries'] });
          qc.invalidateQueries({ queryKey: ['bk-overview'] });
        }}
      />

      <Modal
        title={detail ? `凭证 ${detail.voucherNo}` : ''}
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={null}
        width={760}
      >
        {detail && (
          <div>
            <Row gutter={[16, 8]}>
              <Col span={12}>
                <Text type="secondary">摘要: </Text>
                <Text>{detail.summary}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary">日期: </Text>
                <Text>{dayjs(detail.entryDate).format('YYYY-MM-DD')}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary">制单人: </Text>
                <Text>{detail.createdByName || '-'}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary">过账人: </Text>
                <Text>{detail.postedByName || '-'}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary">状态: </Text>
                <Tag color={STATUS_MAP[detail.status]?.color}>{STATUS_MAP[detail.status]?.label}</Tag>
              </Col>
              <Col span={12}>
                <Text type="secondary">来源: </Text>
                <Tag>{detail.sourceType || 'manual'}</Tag>
              </Col>
            </Row>
            <Table
              size="small"
              style={{ marginTop: 16 }}
              rowKey="id"
              dataSource={detail.lines}
              pagination={false}
              columns={[
                { title: '科目', dataIndex: ['account', 'code'], width: 100, render: (c: string, r: any) => `${c} ${r.account?.name}` },
                {
                  title: '方向',
                  dataIndex: 'direction',
                  width: 80,
                  render: (d: string) => (d === 'debit' ? <Tag color="red">借</Tag> : <Tag color="green">贷</Tag>),
                },
                {
                  title: '金额',
                  dataIndex: 'amount',
                  align: 'right' as const,
                  render: (v: number) => money(v, detail.currency),
                },
                { title: '说明', dataIndex: 'remark', ellipsis: true },
              ]}
              summary={(rows) => {
                const d = rows.filter((r) => r.direction === 'debit').reduce((s, r) => s + r.amount, 0);
                const c = rows.filter((r) => r.direction === 'credit').reduce((s, r) => s + r.amount, 0);
                return (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0}>合计</Table.Summary.Cell>
                    <Table.Summary.Cell index={1}></Table.Summary.Cell>
                    <Table.Summary.Cell index={2} align="right">
                      <Text strong>{money(d, detail.currency)} / {money(c, detail.currency)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={3}></Table.Summary.Cell>
                  </Table.Summary.Row>
                );
              }}
            />
            {detail.remark && (
              <div style={{ marginTop: 12 }}>
                <Text type="secondary">备注: </Text>
                {detail.remark}
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

// =============== 余额对账 ===============

function ReconcileTab() {
  const qc = useQueryClient();
  const [period, setPeriod] = useState<string>(defaultPeriod());
  const [editorOpen, setEditorOpen] = useState(false);
  const [form] = Form.useForm();

  const accountsQ = useQuery({ queryKey: ['bk-accounts-all'], queryFn: () => bookkeepingApi.listAccounts() });
  const accounts: Account[] = ((accountsQ.data as any)?.flat || []) as Account[];

  const { data, isLoading } = useQuery({
    queryKey: ['bk-recon', period],
    queryFn: () => bookkeepingApi.listReconciliations({ period }),
  });
  const list: Reconciliation[] = (data as any) || [];

  const save = useMutation({
    mutationFn: (body: any) => bookkeepingApi.createReconciliation(body),
    onSuccess: () => {
      message.success('对账已保存');
      setEditorOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['bk-recon'] });
    },
  });
  const close = useMutation({
    mutationFn: (id: string) => bookkeepingApi.closeReconciliation(id),
    onSuccess: () => {
      message.success('对账已关闭');
      qc.invalidateQueries({ queryKey: ['bk-recon'] });
    },
  });

  // 汇总
  const total = list.length;
  const balanced = list.filter((r) => r.status === 'balanced').length;
  const abnormal = list.filter((r) => r.status === 'abnormal').length;
  const totalDiff = list.reduce((s, r) => s + Math.abs(r.diff), 0);

  return (
    <>
      <Row gutter={[16, 16]}>
        <Col span={6}>
          <Card>
            <Statistic title="期间" value={period} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="对账科目" value={total} suffix="个" />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="已平衡" value={balanced} valueStyle={{ color: '#52c41a' }} suffix={`/ ${total}`} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="异常/差异"
              value={abnormal}
              valueStyle={{ color: abnormal > 0 ? '#ff4d4f' : undefined }}
              suffix={`差额 ${money(totalDiff)}`}
            />
          </Card>
        </Col>
        <Col span={24}>
          <Card
            title="余额对账"
            extra={
              <Space>
                <DatePicker
                  picker="month"
                  value={dayjs(period)}
                  onChange={(v) => v && setPeriod(v.format('YYYY-MM'))}
                  allowClear={false}
                />
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    form.resetFields();
                    form.setFieldsValue({ period });
                    setEditorOpen(true);
                  }}
                >
                  新建对账
                </Button>
              </Space>
            }
          >
            <Table
              rowKey="id"
              size="small"
              loading={isLoading}
              dataSource={list}
              pagination={false}
              locale={{ emptyText: <Empty description="该期间还没有对账记录" /> }}
              columns={[
                { title: '期间', dataIndex: 'period', width: 100 },
                {
                  title: '科目',
                  dataIndex: ['account', 'code'],
                  width: 200,
                  render: (c: string, r: Reconciliation) => `${c} ${r.account?.name}`,
                },
                { title: '账面余额', dataIndex: 'bookBalance', align: 'right' as const, render: (v: number) => money(v) },
                { title: '实际余额', dataIndex: 'actualBalance', align: 'right' as const, render: (v: number) => money(v) },
                {
                  title: '差异',
                  dataIndex: 'diff',
                  align: 'right' as const,
                  render: (v: number) => (
                    <Text type={Math.abs(v) < 0.005 ? 'success' : 'danger'}>{money(v)}</Text>
                  ),
                },
                {
                  title: '状态',
                  dataIndex: 'status',
                  width: 110,
                  render: (s: string) => <Tag color={RECON_STATUS_MAP[s]?.color}>{RECON_STATUS_MAP[s]?.label}</Tag>,
                },
                { title: '对账人', dataIndex: 'operatorName', width: 100 },
                { title: '备注', dataIndex: 'remark', ellipsis: true },
                {
                  title: '操作',
                  width: 110,
                  render: (_: any, r: Reconciliation) =>
                    r.status !== 'closed' ? (
                      <Popconfirm title="关闭后不可修改, 确定?" onConfirm={() => close.mutate(r.id)}>
                        <Button type="link" size="small" icon={<StopOutlined />}>
                          关闭
                        </Button>
                      </Popconfirm>
                    ) : null,
                },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Modal
        title="新建余额对账"
        open={editorOpen}
        onCancel={() => setEditorOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={save.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Form.Item name="period" label="期间" rules={[{ required: true }]}>
            <DatePicker picker="month" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="accountId" label="科目" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择科目"
              options={accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name} (余额 ${money(a.balance)})` }))}
            />
          </Form.Item>
          <Form.Item name="actualBalance" label="实际余额" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} precision={2} placeholder="如银行对账单余额" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

// =============== 科目余额表 ===============

function TrialBalanceTab() {
  const [period, setPeriod] = useState<string | undefined>();
  const { data, isLoading } = useQuery({
    queryKey: ['bk-trial', period],
    queryFn: () => bookkeepingApi.trialBalance(period),
  });
  const d: any = data || { rows: [], totalDebit: 0, totalCredit: 0 };

  const downloadCsv = () => {
    const header = ['代码', '名称', '类型', '借方', '贷方', '余额'];
    const lines = (d.rows || []).map((r: any) => [
      r.code,
      r.name,
      r.type,
      r.debit.toFixed(2),
      r.credit.toFixed(2),
      r.ending.toFixed(2),
    ]);
    const csv = [header, ...lines].map((l) => l.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `科目余额表-${period || 'all'}.csv`;
    a.click();
  };

  return (
    <Card
      title="科目余额表 (Trial Balance)"
      extra={
        <Space>
          <DatePicker
            picker="month"
            value={period ? dayjs(period) : null}
            onChange={(v) => setPeriod(v ? v.format('YYYY-MM') : undefined)}
            placeholder="选择期间 (空=全部)"
            allowClear
          />
          <Button icon={<DownloadOutlined />} onClick={downloadCsv}>
            导出 CSV
          </Button>
        </Space>
      }
    >
      <Table
        rowKey="code"
        size="small"
        loading={isLoading}
        dataSource={d.rows || []}
        pagination={false}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={3}>
              <Text strong>合计</Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={1} align="right">
              <Text type="danger" strong>{money(d.totalDebit)}</Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={2} align="right">
              <Text type="success" strong>{money(d.totalCredit)}</Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={3} align="right">
              <Text strong>{money(d.totalDebit - d.totalCredit)}</Text>
            </Table.Summary.Cell>
          </Table.Summary.Row>
        )}
        columns={[
          { title: '代码', dataIndex: 'code', width: 100 },
          { title: '名称', dataIndex: 'name' },
          {
            title: '类型',
            dataIndex: 'type',
            width: 100,
            render: (t: string) => <Tag color={ACCOUNT_TYPES[t]?.color}>{ACCOUNT_TYPES[t]?.label}</Tag>,
          },
          { title: '借方', dataIndex: 'debit', width: 160, align: 'right' as const, render: (v: number) => money(v) },
          { title: '贷方', dataIndex: 'credit', width: 160, align: 'right' as const, render: (v: number) => money(v) },
          { title: '余额', dataIndex: 'ending', width: 160, align: 'right' as const, render: (v: number) => money(v) },
        ]}
      />
    </Card>
  );
}

// =============== 利润表 ===============

function IncomeTab() {
  const [period, setPeriod] = useState<string | undefined>(defaultPeriod());
  const { data, isLoading } = useQuery({
    queryKey: ['bk-income', period],
    queryFn: () => bookkeepingApi.incomeStatement(period),
  });
  const d: any = data || { lines: [], revenue: 0, expense: 0, profit: 0 };
  const revenue = (d.lines || []).filter((l: any) => l.code.startsWith('5'));
  const expense = (d.lines || []).filter((l: any) => l.code.startsWith('6'));

  return (
    <Row gutter={[16, 16]}>
      <Col span={24}>
        <Card
          title="利润表 (Income Statement)"
          extra={
            <DatePicker
              picker="month"
              value={period ? dayjs(period) : null}
              onChange={(v) => setPeriod(v ? v.format('YYYY-MM') : undefined)}
              placeholder="选择期间"
            />
          }
        >
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={8}>
              <Statistic title="营业收入" value={d.revenue || 0} precision={2} prefix="¥" valueStyle={{ color: '#52c41a' }} />
            </Col>
            <Col span={8}>
              <Statistic title="营业成本/费用" value={d.expense || 0} precision={2} prefix="¥" valueStyle={{ color: '#ff4d4f' }} />
            </Col>
            <Col span={8}>
              <Statistic
                title="净利润"
                value={d.profit || 0}
                precision={2}
                prefix="¥"
                valueStyle={{ color: (d.profit || 0) >= 0 ? '#1677ff' : '#ff4d4f' }}
              />
            </Col>
          </Row>

          <Title level={5}>收入</Title>
          <Table
            size="small"
            loading={isLoading}
            dataSource={revenue}
            pagination={false}
            rowKey="code"
            locale={{ emptyText: <Empty description="无收入记录" /> }}
            columns={[
              { title: '科目', dataIndex: 'code', width: 100, render: (c: string, r: any) => `${c} ${r.name}` },
              { title: '金额', dataIndex: 'amount', align: 'right' as const, render: (v: number) => <Text type="success">{money(v)}</Text> },
            ]}
            summary={() =>
              revenue.length > 0 ? (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0}><Text strong>合计</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    <Text type="success" strong>{money(d.revenue)}</Text>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              ) : null
            }
          />

          <Title level={5} style={{ marginTop: 24 }}>支出</Title>
          <Table
            size="small"
            loading={isLoading}
            dataSource={expense}
            pagination={false}
            rowKey="code"
            locale={{ emptyText: <Empty description="无支出记录" /> }}
            columns={[
              { title: '科目', dataIndex: 'code', width: 100, render: (c: string, r: any) => `${c} ${r.name}` },
              { title: '金额', dataIndex: 'amount', align: 'right' as const, render: (v: number) => <Text type="danger">{money(v)}</Text> },
            ]}
            summary={() =>
              expense.length > 0 ? (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0}><Text strong>合计</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    <Text type="danger" strong>{money(d.expense)}</Text>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              ) : null
            }
          />
        </Card>
      </Col>
    </Row>
  );
}

// =============== 入口 ===============

export default function BookkeepingPage({ tab = 'overview' }: Props) {
  const [active, setActive] = useState(tab);
  const items = useMemo(
    () => [
      { key: 'overview', label: '记账总览', children: <OverviewTab /> },
      { key: 'coa', label: '会计科目', children: <CoaTab /> },
      { key: 'voucher', label: '记账凭证', children: <VoucherTab /> },
      { key: 'reconcile', label: '余额对账', children: <ReconcileTab /> },
      { key: 'trial', label: '科目余额表', children: <TrialBalanceTab /> },
      { key: 'income', label: '利润表', children: <IncomeTab /> },
    ],
    [active],
  );

  return (
    <div style={{ padding: 16 }}>
      <Title level={3} style={{ marginBottom: 16 }}>
        财务记账
      </Title>
      <Tabs
        activeKey={active}
        onChange={(k) => setActive(k as any)}
        items={items}
        destroyInactiveTabPane={false}
      />
    </div>
  );
}
