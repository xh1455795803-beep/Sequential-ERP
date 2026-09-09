// 业务 API 聚合
import { get, post, put, del } from './http';

export interface UserInfo {
  id: string;
  username: string;
  name: string;
  email?: string;
  phone?: string;
  tenantId: string;
  tenantName: string;
  roles: string[];
  permissions: string[];
}

export interface LoginResult {
  token: string;
  user: UserInfo;
}

export const authApi = {
  login: (username: string, password: string) =>
    post<LoginResult>('/auth/login', { username, password }),
  sendCode: (type: 'phone' | 'email', account: string) =>
    post<{ ok: boolean; devCode?: string; message?: string }>('/auth/send-code', { type, account }),
  loginByCode: (type: 'phone' | 'email', account: string, code: string) =>
    post<LoginResult>('/auth/login/code', { type, account, code }),
  wechatLogin: (code: string) =>
    post<LoginResult>('/auth/wechat/login', { code }),
  profile: () => get<UserInfo>('/auth/profile'),
  logout: () => post('/auth/logout'),
};

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const userApi = {
  list: (params: any) => get<PageResult<any>>('/users', params),
  detail: (id: string) => get<any>(`/users/${id}`),
};

export const roleApi = {
  list: () => get<any[]>('/roles'),
};

export const platformApi = {
  list: () => get<any[]>('/platforms'),
};

export const shopApi = {
  list: (params: any) => get<PageResult<any>>('/shops', params),
  detail: (id: string) => get<any>(`/shops/${id}`),
  create: (data: any) => post<any>('/shops', data),
  refresh: (id: string) => put<any>(`/shops/${id}/refresh`),
  remove: (id: string) => del(`/shops/${id}`),
};

export const productApi = {
  list: (params: any) => get<PageResult<any>>('/products', params),
  detail: (id: string) => get<any>(`/products/${id}`),
  create: (data: any) => post<any>('/products', data),
  update: (id: string, data: any) => put<any>(`/products/${id}`, data),
  remove: (id: string) => del(`/products/${id}`),
};

export const orderApi = {
  list: (params: any) => get<PageResult<any>>('/orders', params),
  detail: (id: string) => get<any>(`/orders/${id}`),
  stats: () => get<any>('/orders/stats'),
  pay: (id: string) => post<any>(`/orders/${id}/pay`),
  toship: (id: string) => post<any>(`/orders/${id}/toship`),
  ship: (id: string, body: { trackingNo: string; carrier?: string; remark?: string }) =>
    post<any>(`/orders/${id}/ship`, body),
  cancel: (id: string, body: { reason: string; confirmToken?: string }) =>
    post<any>(`/orders/${id}/cancel`, body),
  refund: (id: string, body: { amount: number; reason: string; confirmToken: string }) =>
    post<any>(`/orders/${id}/refund`, body),
  complete: (id: string) => post<any>(`/orders/${id}/complete`),
  batchShip: (body: { ids: string[]; trackingNo: string; carrier?: string }) =>
    post<any>('/orders/batch/ship', body),
  batchCancel: (body: { ids: string[]; reason: string; confirmToken: string }) =>
    post<any>('/orders/batch/cancel', body),
  batchComplete: (body: { ids: string[] }) =>
    post<any>('/orders/batch/complete', body),
  createManual: (body: any) => post<any>('/orders/manual', body),
};

// 敏感操作二次确认
export interface ConfirmTokenResp {
  token: string;
  expiresAt: number;
  description?: string;
}
export const confirmApi = {
  prepare: (body: { action: string; payload: Record<string, any>; description?: string }) =>
    post<ConfirmTokenResp>('/confirm/prepare', body),
};

// 打印 (拣货单 / 面单)
export const printApi = {
  picklist: (ids: string[]) =>
    get<{ html: string; summary: { orderCount: number; itemCount: number; warehouseCount: number } }>(
      `/print/picklist?ids=${encodeURIComponent(ids.join(','))}`,
    ),
  label: (orderId: string, template?: string) =>
    get<{ html: string; template: string; trackingNo: string; carrier: string }>(
      `/print/label/${orderId}${template ? `?template=${template}` : ''}`,
    ),
  templates: () =>
    get<Array<{ code: string; carrier: string; notes?: string; width: number; height: number }>>(
      '/print/templates',
    ),
  suggest: (country: string, currency: string) =>
    get<{ carrier: string }>(`/print/suggest?country=${country}&currency=${currency}`),
};

// 售后单 (退款 / 退货)
export const aftersaleApi = {
  list: (params: any) => get<PageResult<any>>('/aftersales', params),
  detail: (id: string) => get<any>(`/aftersales/${id}`),
  stats: () => get<any>('/aftersales/stats'),
  create: (body: any) => post<any>('/aftersales', body),
  review: (id: string, body: { action: 'approve' | 'reject'; rejectReason?: string; refundAmount?: number; remark?: string }) =>
    post<any>(`/aftersales/${id}/review`, body),
  receive: (id: string, body: { returnCarrier: string; returnTrackingNo: string }) =>
    post<any>(`/aftersales/${id}/receive`, body),
  complete: (id: string, body?: { remark?: string }) =>
    post<any>(`/aftersales/${id}/complete`, body),
  cancel: (id: string, body?: { reason?: string }) =>
    post<any>(`/aftersales/${id}/cancel`, body),
  exportCsv: (body: { ids?: string[]; status?: string; type?: string; keyword?: string }) =>
    post<{ filename: string; content: string; count: number }>('/aftersales/export', body),
};

export const inventoryApi = {
  list: (params: any) => get<PageResult<any>>('/inventory', params),
  summary: () => get<any>('/inventory/summary'),
  adjust: (data: any) => post<any>('/inventory/adjust', data),
  setSafetyStock: (id: string, safetyStock: number) =>
    put<any>(`/inventory/${id}/safety-stock`, { safetyStock }),
  logs: (params: any) => get<PageResult<any>>('/inventory/logs', params),
  // 调拨
  transfers: (params: any) => get<PageResult<any>>('/inventory/transfers', params),
  transferDetail: (id: string) => get<any>(`/inventory/transfers/${id}`),
  createTransfer: (data: any) => post<any>('/inventory/transfers', data),
  shipTransfer: (id: string) => post<any>(`/inventory/transfers/${id}/ship`),
  receiveTransfer: (id: string) => post<any>(`/inventory/transfers/${id}/receive`),
  cancelTransfer: (id: string) => post<any>(`/inventory/transfers/${id}/cancel`),
  // 盘点
  checks: (params: any) => get<PageResult<any>>('/inventory/checks', params),
  checkDetail: (id: string) => get<any>(`/inventory/checks/${id}`),
  createCheck: (data: any) => post<any>('/inventory/checks', data),
  applyCheck: (id: string) => post<any>(`/inventory/checks/${id}/apply`),
};

export const warehouseApi = {
  list: () => get<any[]>('/warehouses'),
  create: (data: any) => post<any>('/warehouses', data),
  update: (id: string, data: any) => put<any>(`/warehouses/${id}`, data),
};

// 仓库采购物流财务 API 后续在各自页面补充
export const purchaseApi = {
  list: (params: any) => get<PageResult<any>>('/purchases', params),
  detail: (id: string) => get<any>(`/purchases/${id}`),
  create: (data: any) => post<any>('/purchases', data),
  approve: (id: string) => post<any>(`/purchases/${id}/approve`),
  receive: (id: string, data: { warehouseId: string }) =>
    post<any>(`/purchases/${id}/receive`, data),
  cancel: (id: string) => post<any>(`/purchases/${id}/cancel`),
};

export const logisticsApi = {
  channels: () => get<any[]>('/logistics/channels'),
  createChannel: (data: any) => post<any>('/logistics/channels', data),
  track: (trackingNo: string) => get<any>(`/logistics/track/${trackingNo}`),
};

export const financeApi = {
  profit: (params: any) => get<any>('/finance/profit', params),
  records: (params: any) => get<PageResult<any>>('/finance/records', params),
  rates: () => get<any[]>('/finance/rates'),
  createRate: (data: any) => post<any>('/finance/rates', data),
  reconcile: (params: any) => get<any>('/finance/reconcile', params),
};

export const systemApi = {
  users: (params: any) => get<PageResult<any>>('/users', params),
  userCreate: (data: any) => post<any>('/users', data),
  userUpdate: (id: string, data: any) => put<any>(`/users/${id}`, data),
  userRemove: (id: string) => del(`/users/${id}`),
  roles: () => get<any[]>('/roles'),
  roleCreate: (data: any) => post<any>('/roles', data),
  roleUpdate: (id: string, data: any) => put<any>(`/roles/${id}`, data),
  opLogs: (params: any) => get<PageResult<any>>('/system/op-logs', params),
};

export const supplierApi = {
  list: (params: any) => get<PageResult<any>>('/suppliers', params),
  all: () => get<any[]>('/suppliers/all'),
  create: (data: any) => post<any>('/suppliers', data),
  update: (id: string, data: any) => put<any>(`/suppliers/${id}`, data),
  remove: (id: string) => del(`/suppliers/${id}`),
};

export const dashboardApi = {
  overview: () => get<any>('/dashboard/overview'),
};

// 平台同步
export const syncApi = {
  adapters: () => get<Array<{ code: string; displayName: string }>>('/platform-sync/adapters'),
  run: (body: { shopId: string; type: 'product' | 'order' | 'inventory' | 'shop' }) =>
    post<any>('/platform-sync/run', body),
  tasks: (params: { shopId?: string; platform?: string; page?: number; pageSize?: number }) =>
    get<PageResult<any>>('/platform-sync/tasks', params),
  taskDetail: (id: string) => get<any>(`/platform-sync/tasks/${id}`),
};

// 数据备份
export const backupApi = {
  overview: () => get<any>('/backup/overview'),
  list: (params: any) => get<PageResult<any>>('/backup', params),
  detail: (id: string) => get<any>(`/backup/${id}`),
  create: (body: { type?: 'manual' | 'auto' | 'restore-drill'; note?: string } = {}) =>
    post<any>('/backup', body),
  downloadUrl: (id: string) => `/api/backup/${id}/download`,
  drill: (id: string) => post<any>(`/backup/${id}/drill`),
  restore: (id: string) => post<any>(`/backup/${id}/restore`),
  remove: (id: string) => post<any>(`/backup/${id}/remove`),
};

// 定时任务
export const schedulerApi = {
  jobs: () => get<any[]>('/scheduler/jobs'),
  detail: (id: string) => get<any>(`/scheduler/jobs/${id}`),
  toggle: (id: string, enabled: boolean) => post<any>(`/scheduler/jobs/${id}/toggle`, { enabled }),
  run: (idOrCode: string) => post<any>(`/scheduler/jobs/${idOrCode}/run`),
  logs: (id: string, params: { page?: number; pageSize?: number } = {}) =>
    get<PageResult<any>>(`/scheduler/jobs/${id}/logs`, params),
};

// Webhook
export const webhookApi = {
  overview: () => get<any>('/webhook-admin/overview'),
  events: (params: any) => get<PageResult<any>>('/webhook-admin/events', params),
  detail: (id: string) => get<any>(`/webhook-admin/events/${id}`),
  replay: (id: string) => post<any>(`/webhook-admin/events/${id}/replay`),
  retryFailed: () => post<any>('/webhook-admin/retry-failed'),
};

// ============ P1 模块 ============

// 租户隔离
export const tenantApi = {
  overview: () => get<any>('/tenant/overview'),
  isolationTest: () => get<any>('/tenant/isolation-test'),
  list: () => get<any[]>('/tenant/list'),
  createTest: (data: { name: string; username: string; password: string }) =>
    post<any>('/tenant/create-test', data),
  deleteTest: (id: string) => post<any>(`/tenant/delete-test/${id}`, {}),
};

// 规则引擎
export interface Rule {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  scene: string;
  enabled: boolean;
  priority: number;
  conditions: any;
  actions: any[];
  description?: string;
  hitCount: number;
  lastHitAt?: string;
  createdAt: string;
}
export const ruleApi = {
  list: (params: { scene?: string; enabled?: string } = {}) =>
    get<Rule[]>('/rules', params),
  presets: () => get<any[]>('/rules/presets'),
  fromPreset: (code: string) => post<any>('/rules/from-preset', { code }),
  detail: (id: string) => get<any>(`/rules/${id}`),
  create: (data: Partial<Rule>) => post<any>('/rules', data),
  update: (id: string, data: Partial<Rule>) => put<any>(`/rules/${id}`, data),
  remove: (id: string) => del(`/rules/${id}`),
  test: (scene: string, context: any) => post<any>('/rules/test', { scene, context }),
  logs: (id: string, params: any = {}) => get<PageResult<any>>(`/rules/${id}/logs`, params),
};

// 消息中心
export const notificationApi = {
  list: (params: any = {}) => get<any>('/notifications', params),
  unread: (userId?: string) => get<any>('/notifications/unread', { userId }),
  markRead: (ids: string[]) => post<any>('/notifications/read', { ids }),
  markAllRead: () => post<any>('/notifications/read-all', {}),
  remove: (ids: string[]) => del('/notifications', { ids }),
};

// 计费 / 订阅
export const billingApi = {
  plans: () => get<any[]>('/billing/plans'),
  current: () => get<any>('/billing/current'),
  orders: (params: any = {}) => get<PageResult<any>>('/billing/orders', params),
  invoices: () => get<any[]>('/billing/invoices'),
  subscribe: (data: { planCode: string; months: number; payMethod?: string }) =>
    post<any>('/billing/subscribe', data),
  pay: (orderId: string) => post<any>(`/billing/orders/${orderId}/pay`, {}),
  invoice: (data: { billingOrderId: string; title: string; taxNo?: string; type?: string; email?: string }) =>
    post<any>('/billing/invoice', data),
  limit: (key: 'shops' | 'products' | 'orders' | 'users') =>
    get<any>(`/billing/limit/${key}`),
};

// 邀请分销
export const inviteApi = {
  overview: () => get<any>('/invite/overview'),
  codes: () => get<any[]>('/invite/codes'),
  createCode: (data: { maxUses?: number; reward?: number; rewardPct?: number; expiresAt?: string }) =>
    post<any>('/invite/codes', data),
  disableCode: (id: string) => post<any>(`/invite/codes/${id}/disable`, {}),
  rewards: () => get<any[]>('/invite/rewards'),
};

// 广告数据
export const adsApi = {
  list: (params: any = {}) => get<any[]>('/ads/list', params),
  summary: (params: any = {}) => get<any>('/ads/summary', params),
};

// 物流轨迹
export const trackingApi = {
  subscribe: (orderId: string) => post<any>('/tracking/subscribe', { orderId }),
  query: (trackingNo: string) => get<any[]>('/tracking/query', { trackingNo }),
};

// PDA 扫码
export const pdaApi = {
  scan: (code: string, type: 'order' | 'sku' | 'tracking' = 'order') =>
    post<any>('/pda/scan', { code, type }),
  batchShip: (data: { orderIds: string[]; trackingNo: string; carrier: string }) =>
    post<any>('/pda/batch-ship', data),
};

// 媒体 (图片)
export const mediaApi = {
  upload: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    // 注意: 不能手动指定 multipart/form-data, 否则丢失 boundary, 让 axios 自动设置
    return post<any>('/media/upload', fd);
  },
  list: (params: any = {}) => get<PageResult<any>>('/media', params),
  remove: (id: string) => del(`/media/${id}`),
};

// 自助注册 (账号/邮箱/手机号 至少一项 + 密码 + 邀请码可选, 与后端契约一致)
export const registerApi = {
  register: (data: { username?: string; email?: string; phone?: string; password: string; inviteCode?: string }) =>
    post<any>('/auth/register', data),
};

// ============ P4 优惠券 / 营销 ============
export const couponApi = {
  list: (q: any = {}) => get<any>('/coupon/list', q),
  detail: (id: string) => get<any>(`/coupon/detail/${id}`),
  stats: () => get<any>('/coupon/stats'),
  create: (body: any) => post<any>('/coupon/create', body),
  update: (id: string, body: any) => put<any>(`/coupon/update/${id}`, body),
  remove: (id: string) => del<any>(`/coupon/delete/${id}`),
  validate: (body: any) => post<any>('/coupon/validate', body),
  apply: (body: any) => post<any>('/coupon/apply', body),
  refund: (orderId: string) => post<any>(`/coupon/refund/${orderId}`),
  promotions: () => get<any[]>('/coupon/promotions'),
  createPromotion: (body: any) => post<any>('/coupon/promotions', body),
};
export const biApi = {
  overview: (range: '7d' | '30d' | '90d' | 'all' = '30d') =>
    get<any>('/bi/overview', { range }),
  kpi: (range: '7d' | '30d' | '90d' | 'all' = '30d') =>
    get<any>('/bi/kpi', { range }),
  salesTrend: (range: '7d' | '30d' | '90d' | 'all' = '30d') =>
    get<any[]>('/bi/sales-trend', { range }),
  funnel: (range: '7d' | '30d' | '90d' | 'all' = '30d') =>
    get<any>('/bi/funnel', { range }),
  topProducts: (range: '7d' | '30d' | '90d' | 'all' = '30d', limit = 10) =>
    get<any[]>('/bi/top-products', { range, limit }),
  country: (range: '7d' | '30d' | '90d' | 'all' = '30d') =>
    get<any[]>('/bi/country', { range }),
  platform: (range: '7d' | '30d' | '90d' | 'all' = '30d') =>
    get<any[]>('/bi/platform', { range }),
  hourly: (range: '7d' | '30d' | '90d' | 'all' = '30d') =>
    get<any[]>('/bi/hourly', { range }),
  rfm: (range: '7d' | '30d' | '90d' | 'all' = '30d', limit = 20) =>
    get<any[]>('/bi/rfm', { range, limit }),
  inventoryHealth: () => get<any>('/bi/inventory-health'),
};

// ============ P4 多语言 / 多币种 ============
export interface Currency {
  code: string;
  symbol: string;
  name: string;
  nameZh: string;
}
export interface ExchangeRate {
  id: string;
  from: string;
  to: string;
  rate: number;
  source: string;
  fetchedAt: string;
  createdAt: string;
  updatedAt: string;
}
export interface ConvertResult {
  from: string;
  to: string;
  amount: number;
  converted: number;
  rate: number;
  path: string[];
}
export const i18nApi = {
  currencies: () => get<Currency[]>('/i18n/currencies'),
  rates: () => get<ExchangeRate[]>('/i18n/rates'),
  upsertRate: (body: { from: string; to: string; rate: number; source?: string }) =>
    post<ExchangeRate>('/i18n/rates', body),
  removeRate: (from: string, to: string) => del<any>(`/i18n/rates/${from}/${to}`),
  convert: (body: { amount: number; from: string; to: string }) =>
    post<ConvertResult>('/i18n/convert', body),
  convertBatch: (items: { amount: number; from: string; to: string }[]) =>
    post<ConvertResult[]>('/i18n/convert/batch', { items }),
  seed: () => post<any>('/i18n/rates/seed', {}),
};

// ============ P4 工作流引擎 ============
export interface WorkflowStep {
  order: number;
  name: string;
  type: 'role' | 'user' | 'auto';
  approvers: string[];
  anyApprove?: boolean;
  condition?: any;
}
export interface WorkflowDefinition {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  business: string;
  description?: string;
  enabled: boolean;
  steps: string;             // JSON
  version: number;
  hitCount: number;
  createdAt: string;
  updatedAt: string;
}
export interface WorkflowInstance {
  id: string;
  tenantId: string;
  definitionId: string;
  business: string;
  businessId: string;
  businessNo?: string;
  title: string;
  applicantId?: string;
  applicantName?: string;
  status: 'pending' | 'running' | 'approved' | 'rejected' | 'cancelled' | 'terminated';
  currentStep: number;
  totalSteps: number;
  context?: string;
  result?: string;
  startedAt: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
  steps?: any[];
  logs?: any[];
  definition?: WorkflowDefinition;
}
export const workflowApi = {
  // 定义
  listDefinitions: (params: { business?: string; tenantId?: string } = {}) =>
    get<WorkflowDefinition[]>('/workflow/definitions', params),
  getDefinition: (id: string) => get<WorkflowDefinition>(`/workflow/definitions/${id}`),
  createDefinition: (body: any) => post<WorkflowDefinition>('/workflow/definitions', body),
  updateDefinition: (id: string, body: any) => put<WorkflowDefinition>(`/workflow/definitions/${id}`, body),
  removeDefinition: (id: string) => del<any>(`/workflow/definitions/${id}`),
  createPreset: (preset: 'order_refund' | 'purchase' | 'aftersale' | 'manual_order') =>
    post<WorkflowDefinition>(`/workflow/definitions/preset/${preset}`, {}),
  // 实例
  start: (body: any) => post<WorkflowInstance>('/workflow/start', body),
  approve: (id: string, body: { comment?: string }) =>
    post<WorkflowInstance>(`/workflow/instances/${id}/approve`, body),
  reject: (id: string, body: { comment: string }) =>
    post<WorkflowInstance>(`/workflow/instances/${id}/reject`, body),
  transfer: (id: string, body: { toUserId: string; toUserName?: string; comment?: string }) =>
    post<WorkflowInstance>(`/workflow/instances/${id}/transfer`, body),
  cancel: (id: string, body: { comment?: string }) =>
    post<WorkflowInstance>(`/workflow/instances/${id}/cancel`, body),
  listInstances: (params: any = {}) => get<WorkflowInstance[]>('/workflow/instances', params),
  getInstance: (id: string) => get<WorkflowInstance>(`/workflow/instances/${id}`),
  myPending: () => get<WorkflowInstance[]>('/workflow/my-pending'),
  byBusiness: (business: string, businessId: string) =>
    get<WorkflowInstance>('/workflow/by-business', { business, businessId }),
};

// ============ 报表导出 ============
export interface ExportColumn {
  header: string;
  key: string;
  width?: number;
  formatter?: (v: any, row: any) => any;
}
export const exportApi = {
  orders: (body: { format: 'excel' | 'pdf' | 'csv'; filters?: any }) =>
    post<any>('/export/orders', body),
  products: (body: { format: 'excel' | 'pdf' | 'csv'; filters?: any }) =>
    post<any>('/export/products', body),
  inventory: (body: { format: 'excel' | 'pdf' | 'csv'; filters?: any }) =>
    post<any>('/export/inventory', body),
  finance: (body: { format: 'excel' | 'pdf' | 'csv'; filters?: any }) =>
    post<any>('/export/finance', body),
  custom: (body: { format: 'excel' | 'pdf' | 'csv'; config: any }) =>
    post<any>('/export/custom', body),
};

// ============ AI 智能客服 ============
export interface ChatReply {
  reply: string;
  intent: string;
  suggestions: string[];
  links?: { label: string; path: string }[];
  sessionId: string;
}
export const aiSupportApi = {
  chat: (body: { sessionId?: string; message: string }) =>
    post<ChatReply>('/ai-support/chat', body),
  history: (sessionId: string) =>
    get<{ messages: { role: string; content: string; ts?: number }[] }>(`/ai-support/history/${sessionId}`),
  health: () => get<any>('/ai-support/health'),
};

// ============ 直播挂车 (已下线) ============
// 旧版 livestreamApi 已移除, 业务调整后回归核心场景

// ============ 财务记账 ============
export interface Account {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  direction: 'debit' | 'credit';
  parentId?: string;
  balance: number;
  currency: string;
  enabled: boolean;
  description?: string;
  children?: Account[];
}
export interface JournalLine {
  id?: string;
  accountId: string;
  account?: { code: string; name: string; type: string };
  direction: 'debit' | 'credit';
  amount: number;
  remark?: string;
}
export interface JournalEntry {
  id: string;
  tenantId: string;
  voucherNo: string;
  summary: string;
  entryDate: string;
  status: 'draft' | 'posted' | 'reversed';
  sourceType?: string;
  sourceId?: string;
  totalDebit: number;
  totalCredit: number;
  currency: string;
  createdByName?: string;
  postedByName?: string;
  postedAt?: string;
  remark?: string;
  lines: JournalLine[];
}
export interface Reconciliation {
  id: string;
  tenantId: string;
  period: string;
  accountId: string;
  account?: Account;
  bookBalance: number;
  actualBalance: number;
  diff: number;
  status: 'pending' | 'balanced' | 'abnormal' | 'adjusting' | 'closed';
  remark?: string;
  operatorName?: string;
  createdAt: string;
}
export const bookkeepingApi = {
  initAccounts: () => post<any>('/bookkeeping/accounts/init', {}),
  listAccounts: (type?: string) => get<any>('/bookkeeping/accounts', type ? { type } : {}),
  createAccount: (body: Partial<Account>) => post<Account>('/bookkeeping/accounts', body),
  updateAccount: (id: string, body: Partial<Account>) => put<Account>(`/bookkeeping/accounts/${id}`, body),
  deleteAccount: (id: string) => del<any>(`/bookkeeping/accounts/${id}`),

  listEntries: (params: any = {}) => get<PageResult<JournalEntry>>('/bookkeeping/entries', params),
  getEntry: (id: string) => get<JournalEntry>(`/bookkeeping/entries/${id}`),
  createEntry: (body: any) => post<JournalEntry>('/bookkeeping/entries', body),
  updateEntry: (id: string, body: any) => put<JournalEntry>(`/bookkeeping/entries/${id}`, body),
  postEntry: (id: string, body: { remark?: string } = {}) =>
    post<JournalEntry>(`/bookkeeping/entries/${id}/post`, body),
  reverseEntry: (id: string, body: { remark?: string } = {}) =>
    post<JournalEntry>(`/bookkeeping/entries/${id}/reverse`, body),
  deleteEntry: (id: string) => del<any>(`/bookkeeping/entries/${id}`),
  generateOrderVoucher: (body: any) => post<JournalEntry>('/bookkeeping/generate/order', body),

  listReconciliations: (params: any = {}) =>
    get<Reconciliation[]>('/bookkeeping/reconciliations', params),
  createReconciliation: (body: { period: string; accountId: string; actualBalance: number; remark?: string }) =>
    post<Reconciliation>('/bookkeeping/reconciliations', body),
  closeReconciliation: (id: string) => post<Reconciliation>(`/bookkeeping/reconciliations/${id}/close`, {}),

  trialBalance: (period?: string) =>
    get<any>('/bookkeeping/reports/trial-balance', period ? { period } : {}),
  incomeStatement: (period?: string) =>
    get<any>('/bookkeeping/reports/income', period ? { period } : {}),
  overview: () => get<any>('/bookkeeping/overview'),
};
