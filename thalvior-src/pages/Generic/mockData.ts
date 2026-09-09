// 通用页面 Mock 数据生成器
// 根据路由 path 自动匹配数据模板, 渲染表格 / 列表 / 详情
// 当后端接口尚未实现时, 前端先用 mock 数据展示真实业务场景

import dayjs from 'dayjs';

export type ColumnType =
  | 'text'
  | 'tag'
  | 'money'
  | 'date'
  | 'datetime'
  | 'number'
  | 'image'
  | 'progress'
  | 'boolean';

export interface ColumnDef {
  title: string;
  dataIndex: string;
  width?: number;
  type?: ColumnType;
  tagColors?: Record<string, string>;
  options?: Array<{ value: string; label: string; color?: string }>;
  suffix?: string;
  fixed?: 'left' | 'right';
  ellipsis?: boolean;
}

export interface ListConfig {
  title: string;
  subtitle?: string;
  columns: ColumnDef[];
  rowCount?: number;
  filters?: Array<{
    name: string;
    label: string;
    type?: 'text' | 'select';
    placeholder?: string;
    options?: Array<{ label: string; value: string }>;
  }>;
  statCards?: Array<{ label: string; color?: string }>;
}

// ============= 基础随机工具 =============
let _seed = 0;
const seed = (s: number) => { _seed = s; };
const rand = () => {
  _seed = (_seed * 9301 + 49297) % 233280;
  return _seed / 233280;
};
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

const PLATFORMS = ['Amazon', 'Shopee', 'TikTok Shop', 'Lazada', 'eBay', 'AliExpress'];
const COUNTRIES = ['US', 'DE', 'JP', 'UK', 'FR', 'IT', 'ES', 'CA', 'MX', 'BR', 'AU', 'SG', 'MY', 'TH', 'PH', 'VN', 'ID'];
const CURRENCIES = ['USD', 'EUR', 'JPY', 'GBP', 'CNY'];
const CATEGORIES = ['电子配件', '家居日用', '美妆个护', '服饰配件', '玩具乐器', '户外运动', '宠物用品', '母婴玩具'];

const STATUS_POOL = [
  { value: 'enabled', label: '启用', color: 'green' },
  { value: 'disabled', label: '禁用', color: 'default' },
  { value: 'pending', label: '待处理', color: 'orange' },
];

function pastDate(days = 90) {
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(rand() * days));
  return d.toISOString();
}
function price(min = 1, max = 200) {
  return +(min + rand() * (max - min)).toFixed(2);
}
function qty(min = 1, max = 10) {
  return Math.floor(min + rand() * (max - min));
}

// ============= 通用生成器(覆盖 80% 场景) =============
const NAMES = ['张伟', '李娜', '王芳', '刘洋', '陈静', '杨明', '黄丽', '赵磊', '周婷', '吴军', '徐丽', '孙鹏', '马莉', '朱强', '胡杰'];
const REFUND_REASONS = ['商品质量问题', '尺码不合适', '与描述不符', '不想要了', '收到错误商品', '物流太慢', '包装损坏', '色差严重'];
const SUPPLIERS = ['深圳XX电子', '义乌XX日用品厂', '广州XX贸易', '1688自营仓', '东莞XX塑胶', '金华XX五金'];
const CARRIERS = ['顺丰国际', 'UPS', 'FedEx', 'DHL', 'EMS', '云途', '燕文', '万邑通'];
const AD_STATUS = [
  { value: 'running', label: '投放中', color: 'green' },
  { value: 'paused', label: '已暂停', color: 'orange' },
  { value: 'ended', label: '已结束', color: 'default' },
];
const WAREHOUSES = ['深圳自营仓', '义乌保税仓', '广州中心仓', '上海集运仓', '宁波海外仓'];

function smartValue(c: ColumnDef, i: number): any {
  const k = (c.dataIndex || '').toLowerCase();
  // 编号类: 订单号/编号/ID/SKU/Code/Tracking
  if (k.includes('no') || k.includes('id') || k.endsWith('order') || k.includes('code') || k.includes('sku') || k.includes('tracking')) {
    return `${(c.dataIndex || 'X').replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 3) || 'X'}${String(10000 + Math.floor(rand() * 89999))}`;
  }
  // 百分比/比率类: 数字 + %
  if (k.includes('rate') || k.includes('ratio') || k.includes('acos') || k.includes('roas') || k.includes('ctr') || k.includes('percent')) {
    return +(rand() * 30 + 1).toFixed(2);
  }
  // 活动名
  if (k.includes('campaign') || k.includes('activity') || k.includes('event')) {
    return `${pick(CATEGORIES)}${pick(['春季促销', '夏季新品', '秋季大促', '年终清仓', '会员日', '品牌周'])}`;
  }
  // 来源/类型 (text 类型, 不是 tag)
  if (k.includes('source') || k.includes('from')) {
    return pick(['采购入库', '调拨入库', '退货入库', '盘盈入库', '赠品入库', '初始库存']);
  }
  // 姓名类
  if (k.includes('name') || k.includes('buyer') || k.includes('user') || k.includes('owner') || k.includes('operator')) {
    return pick(NAMES);
  }
  // 描述/原因/备注
  if (k.includes('reason') || k.includes('desc') || k.includes('remark') || k.includes('detail')) {
    return pick(REFUND_REASONS);
  }
  // 业务实体
  if (k.includes('supplier')) return pick(SUPPLIERS);
  if (k.includes('carrier')) return pick(CARRIERS);
  if (k.includes('warehouse')) return pick(WAREHOUSES);
  if (k.includes('shop')) return `${pick(['深圳', '上海', '北京', '广州', '杭州'])}${pick(['旗舰', '专营', '官方', '自营'])}店`;
  if (k.includes('platform')) return pick(PLATFORMS);
  if (k.includes('country')) return pick(COUNTRIES);
  if (k.includes('category') || k.includes('product')) return pick(CATEGORIES);
  if (k.includes('template') || k.includes('tpl')) return `${pick(['标准', '紧凑', '大件', '易碎', '冷链'])}模板`;
  if (k.includes('address') || k.includes('addr')) return `${pick(['广东省', '浙江省', '上海市', '北京市'])}${pick(['深圳市', '杭州市', '广州市'])}${pick(['南山', '福田', '罗湖', '西湖'])}区`;
  if (k.includes('phone') || k.includes('mobile') || k.includes('tel')) return `1${Math.floor(3 + rand() * 6)}${String(Math.floor(rand() * 100000000)).padStart(8, '0')}`;
  if (k.includes('email')) return `${pick(['zhang', 'li', 'wang', 'liu', 'chen'])}@${pick(['gmail.com', '163.com', 'qq.com'])}`;
  // 默认: 用列标题 + 不同随机后缀
  return `${c.title}-${i}`;
}

function genByColumns(cols: ColumnDef[], path: string, n: number): Record<string, any>[] {
  let h = 0;
  for (let i = 0; i < path.length; i++) h = (h * 31 + path.charCodeAt(i)) >>> 0;
  seed(h);
  const out: Record<string, any>[] = [];
  for (let i = 0; i < n; i++) {
    const row: Record<string, any> = {};
    row.id = `${path.replace(/\//g, '_')}_${i}`;
    row.platform = pick(PLATFORMS);
    row.shop = `${pick(['深圳', '上海', '北京', '广州'])}${pick(['旗舰', '专营', '官方', '自营'])}店`;
    row.country = pick(COUNTRIES);
    row.currency = pick(CURRENCIES);
    row.productName = `${pick(CATEGORIES)} ${pick(['Pro', 'Lite', 'X', 'Plus', 'Max'])}`;
    row.sku = `SKU-${Math.floor(rand() * 90000 + 10000)}`;
    row.quantity = qty(1, 5);
    row.price = price(5, 80);
    row.amount = +(row.price * row.quantity).toFixed(2);
    row.status = pick(['enabled', 'enabled', 'pending']);
    row.createdAt = pastDate(60);
    row.updatedAt = pastDate(30);
    for (const c of cols) {
      const k = c.dataIndex;
      if (row[k] !== undefined) continue;
      if (c.options) {
        const opt = pick(c.options);
        row[k] = opt.value;
        if (c.type === 'tag') row[`${k}_label`] = opt.label;
      } else if (c.type === 'tag') {
        row[k] = pick(['enabled', 'disabled', 'pending']);
      } else if (c.type === 'boolean') {
        row[k] = rand() > 0.5;
      } else if (c.type === 'progress') {
        row[k] = Math.floor(rand() * 100);
      } else if (c.type === 'money') {
        row[k] = price(5, 200);
      } else if (c.type === 'number') {
        row[k] = qty(1, 100);
      } else if (c.type === 'date') {
        row[k] = pastDate(60);
      } else if (c.type === 'datetime') {
        row[k] = pastDate(60);
      } else if (c.type === 'image') {
        row[k] = `https://picsum.photos/seed/${path.replace(/\//g, '')}${i}/80/80`;
      } else {
        row[k] = smartValue(c, i);
      }
    }
    out.push(row);
  }
  return out;
}

const TEMPLATES: Record<string, ListConfig> = {
  // 授权中心
  '/auth/group': {
    title: '店铺分组',
    subtitle: '按地区 / 业务线对店铺分组管理',
    columns: [
      { title: '分组名称', dataIndex: 'name', width: 200, fixed: 'left' },
      { title: '店铺数', dataIndex: 'shopCount', width: 100, type: 'number' },
      { title: '负责人', dataIndex: 'owner', width: 130 },
      { title: '创建时间', dataIndex: 'createdAt', width: 160, type: 'datetime' },
      { title: '状态', dataIndex: 'status', width: 100, type: 'tag', options: STATUS_POOL },
    ],
  },
  '/auth/platform': {
    title: '平台管理',
    subtitle: '跨境电商平台对接配置',
    columns: [
      { title: '平台', dataIndex: 'name', width: 130, fixed: 'left' },
      { title: 'code', dataIndex: 'code', width: 130 },
      { title: '店铺数', dataIndex: 'shopCount', width: 100, type: 'number' },
      { title: '状态', dataIndex: 'status', width: 100, type: 'tag', options: STATUS_POOL },
      { title: 'API版本', dataIndex: 'apiVersion', width: 120 },
      { title: '最近同步', dataIndex: 'lastSync', width: 160, type: 'datetime' },
    ],
  },
  '/auth/log': {
    title: '授权日志',
    subtitle: '店铺授权 / 续期 / 解除操作记录',
    columns: [
      { title: '店铺', dataIndex: 'shop', width: 180 },
      { title: '平台', dataIndex: 'platform', width: 120 },
      { title: '操作', dataIndex: 'action', width: 120, type: 'tag' },
      { title: '操作人', dataIndex: 'operator', width: 130 },
      { title: '结果', dataIndex: 'result', width: 100, type: 'tag' },
      { title: '时间', dataIndex: 'time', width: 160, type: 'datetime' },
      { title: '详情', dataIndex: 'detail', ellipsis: true },
    ],
  },
  '/auth/api-log': {
    title: '接口同步日志',
    subtitle: '平台 API 调用实时日志',
    columns: [
      { title: '时间', dataIndex: 'time', width: 160, type: 'datetime' },
      { title: '平台', dataIndex: 'platform', width: 120 },
      { title: '店铺', dataIndex: 'shop', width: 180, ellipsis: true },
      { title: '接口', dataIndex: 'endpoint', width: 200 },
      { title: '方法', dataIndex: 'method', width: 80, type: 'tag' },
      { title: '耗时', dataIndex: 'cost', width: 80, suffix: 'ms' },
      { title: '状态码', dataIndex: 'statusCode', width: 90, type: 'tag' },
    ],
  },
  '/auth/task': {
    title: '任务列表',
    subtitle: '拉单 / 拉商品 / 推库存等同步任务',
    columns: [
      { title: '任务 ID', dataIndex: 'taskId', width: 110 },
      { title: '类型', dataIndex: 'type', width: 120, type: 'tag' },
      { title: '店铺', dataIndex: 'shop', width: 180, ellipsis: true },
      { title: '平台', dataIndex: 'platform', width: 120 },
      { title: '触发', dataIndex: 'trigger', width: 90, type: 'tag' },
      { title: '状态', dataIndex: 'status', width: 100, type: 'tag' },
      { title: '进度', dataIndex: 'progress', width: 110, type: 'progress' },
      { title: '开始时间', dataIndex: 'startedAt', width: 160, type: 'datetime' },
      { title: '耗时', dataIndex: 'cost', width: 90, suffix: 's' },
    ],
  },
  '/auth/bind': {
    title: '授权新店铺',
    subtitle: '一键绑定 Amazon / Shopee / TikTok 等平台店铺',
    columns: [
      { title: '平台', dataIndex: 'platform', width: 130 },
      { title: '店铺名称', dataIndex: 'name', width: 200 },
      { title: '站点', dataIndex: 'region', width: 100 },
      { title: '绑定状态', dataIndex: 'status', width: 120, type: 'tag' },
      { title: '绑定时间', dataIndex: 'boundAt', width: 160, type: 'datetime' },
    ],
  },
  '/auth/sync': {
    title: '平台同步中心',
    subtitle: '拉单 / 拉商品 / 推库存 - 立即触发同步',
    columns: [
      { title: '店铺', dataIndex: 'shop', width: 200 },
      { title: '平台', dataIndex: 'platform', width: 130 },
      { title: '最近拉单', dataIndex: 'lastPullOrder', width: 160, type: 'datetime' },
      { title: '最近推库存', dataIndex: 'lastPushStock', width: 160, type: 'datetime' },
      { title: '今日订单', dataIndex: 'todayOrders', width: 110, type: 'number' },
      { title: '今日库存变更', dataIndex: 'todayStock', width: 130, type: 'number' },
      { title: '状态', dataIndex: 'status', width: 100, type: 'tag', options: STATUS_POOL },
    ],
  },

  // 产品管理
  '/product/sku/combo': {
    title: 'SKU 组合',
    subtitle: '套装商品 / 多规格绑定',
    columns: [
      { title: '组合 SKU', dataIndex: 'comboSku', width: 150, fixed: 'left' },
      { title: '组合名称', dataIndex: 'comboName', width: 220, ellipsis: true },
      { title: '子 SKU', dataIndex: 'subSkus', width: 200, ellipsis: true },
      { title: '数量', dataIndex: 'quantity', width: 80, type: 'number' },
      { title: '组合价', dataIndex: 'price', width: 110, type: 'money' },
      { title: '状态', dataIndex: 'status', width: 100, type: 'tag', options: STATUS_POOL },
      { title: '更新时间', dataIndex: 'updatedAt', width: 160, type: 'datetime' },
    ],
  },
  '/product/sku/map': {
    title: 'SKU 映射',
    subtitle: '内部 SKU 与平台 SKU 映射关系',
    columns: [
      { title: '内部 SKU', dataIndex: 'localSku', width: 150, fixed: 'left' },
      { title: '商品名称', dataIndex: 'name', width: 220, ellipsis: true },
      { title: '平台', dataIndex: 'platform', width: 130 },
      { title: '平台 SKU', dataIndex: 'platformSku', width: 180 },
      { title: '店铺', dataIndex: 'shop', width: 180, ellipsis: true },
      { title: '映射状态', dataIndex: 'status', width: 110, type: 'tag' },
    ],
  },
  '/product/public-collect': {
    title: '公用采集箱',
    subtitle: '从其他平台 / URL 抓取的待处理商品',
    columns: [
      { title: '图片', dataIndex: 'image', width: 80, type: 'image' },
      { title: '标题', dataIndex: 'title', width: 280, ellipsis: true },
      { title: '来源', dataIndex: 'source', width: 120, type: 'tag' },
      { title: '价格', dataIndex: 'price', width: 110, type: 'money' },
      { title: '采集人', dataIndex: 'collector', width: 130 },
      { title: '采集时间', dataIndex: 'collectedAt', width: 160, type: 'datetime' },
      { title: '状态', dataIndex: 'status', width: 100, type: 'tag' },
    ],
  },
  '/product/platform-collect': {
    title: '平台采集箱',
    subtitle: '从已授权平台一键搬运的商品',
    columns: [
      { title: '图片', dataIndex: 'image', width: 80, type: 'image' },
      { title: '标题', dataIndex: 'title', width: 280, ellipsis: true },
      { title: '来源平台', dataIndex: 'sourcePlatform', width: 130 },
      { title: '价格', dataIndex: 'price', width: 110, type: 'money' },
      { title: '类目', dataIndex: 'category', width: 130 },
      { title: '采集时间', dataIndex: 'collectedAt', width: 160, type: 'datetime' },
      { title: '状态', dataIndex: 'status', width: 100, type: 'tag' },
    ],
  },
  '/product/publish': {
    title: '发布记录',
    subtitle: '商品上架 / 发布历史',
    columns: [
      { title: '商品', dataIndex: 'product', width: 240, ellipsis: true },
      { title: '目标平台', dataIndex: 'platform', width: 130 },
      { title: '店铺', dataIndex: 'shop', width: 180 },
      { title: '发布状态', dataIndex: 'status', width: 110, type: 'tag' },
      { title: '提交时间', dataIndex: 'submittedAt', width: 160, type: 'datetime' },
      { title: '完成时间', dataIndex: 'completedAt', width: 160, type: 'datetime' },
      { title: '操作人', dataIndex: 'operator', width: 130 },
    ],
  },
  '/product/price-tpl': {
    title: '定价模板',
    subtitle: '售价 / 利润率 / 加价规则模板',
    columns: [
      { title: '模板名', dataIndex: 'name', width: 200, fixed: 'left' },
      { title: '规则', dataIndex: 'rule', width: 320, ellipsis: true },
      { title: '货币', dataIndex: 'currency', width: 90 },
      { title: '关联商品', dataIndex: 'productCount', width: 110, type: 'number' },
      { title: '更新人', dataIndex: 'updatedBy', width: 130 },
      { title: '更新时间', dataIndex: 'updatedAt', width: 160, type: 'datetime' },
    ],
  },
  '/product/tpl': {
    title: '产品模板',
    subtitle: '商品标题 / 描述 / 关键词模板',
    columns: [
      { title: '模板名', dataIndex: 'name', width: 200, fixed: 'left' },
      { title: '类目', dataIndex: 'category', width: 130 },
      { title: '语言', dataIndex: 'lang', width: 90 },
      { title: '标题模板', dataIndex: 'titleTpl', width: 240, ellipsis: true },
      { title: '使用次数', dataIndex: 'useCount', width: 100, type: 'number' },
      { title: '更新时间', dataIndex: 'updatedAt', width: 160, type: 'datetime' },
    ],
  },
  '/product/image': {
    title: '图片素材库',
    subtitle: '统一管理商品主图 / 详情图 / 场景图',
    columns: [
      { title: '缩略图', dataIndex: 'image', width: 90, type: 'image' },
      { title: '文件名', dataIndex: 'name', width: 220, ellipsis: true },
      { title: '尺寸', dataIndex: 'size', width: 120 },
      { title: '大小', dataIndex: 'fileSize', width: 100, suffix: 'KB' },
      { title: '分组', dataIndex: 'group', width: 130 },
      { title: '上传时间', dataIndex: 'uploadedAt', width: 160, type: 'datetime' },
    ],
  },
  '/product/file': {
    title: '文件中心',
    subtitle: '导入 / 导出 / 模板文件管理',
    columns: [
      { title: '文件名', dataIndex: 'name', width: 240, ellipsis: true },
      { title: '类型', dataIndex: 'type', width: 120, type: 'tag' },
      { title: '用途', dataIndex: 'purpose', width: 150 },
      { title: '大小', dataIndex: 'fileSize', width: 100, suffix: 'KB' },
      { title: '上传人', dataIndex: 'uploader', width: 130 },
      { title: '上传时间', dataIndex: 'uploadedAt', width: 160, type: 'datetime' },
    ],
  },
  '/product/collect-setting': {
    title: '采集设置',
    subtitle: '采集规则 / 字段映射 / 自动上架',
    columns: [
      { title: '规则名', dataIndex: 'name', width: 200, fixed: 'left' },
      { title: '来源', dataIndex: 'source', width: 130, type: 'tag' },
      { title: '目标店铺', dataIndex: 'targetShop', width: 180, ellipsis: true },
      { title: '自动上架', dataIndex: 'autoPublish', width: 110, type: 'boolean' },
      { title: '状态', dataIndex: 'status', width: 100, type: 'tag', options: STATUS_POOL },
      { title: '更新时间', dataIndex: 'updatedAt', width: 160, type: 'datetime' },
    ],
  },
  '/product/batch': {
    title: '批量操作',
    subtitle: '批量改价 / 改库存 / 改类目等',
    columns: [
      { title: '批次号', dataIndex: 'batchNo', width: 160, fixed: 'left' },
      { title: '类型', dataIndex: 'type', width: 130, type: 'tag' },
      { title: '影响商品', dataIndex: 'count', width: 110, type: 'number' },
      { title: '成功', dataIndex: 'success', width: 90, type: 'number' },
      { title: '失败', dataIndex: 'failed', width: 90, type: 'number' },
      { title: '状态', dataIndex: 'status', width: 100, type: 'tag' },
      { title: '操作人', dataIndex: 'operator', width: 130 },
      { title: '操作时间', dataIndex: 'operatedAt', width: 160, type: 'datetime' },
    ],
  },
  '/product/move': {
    title: '商品搬家',
    subtitle: '跨平台 / 跨店铺商品搬运',
    columns: [
      { title: '任务号', dataIndex: 'taskNo', width: 150, fixed: 'left' },
      { title: '源平台', dataIndex: 'fromPlatform', width: 130 },
      { title: '目标平台', dataIndex: 'toPlatform', width: 130 },
      { title: '商品数', dataIndex: 'count', width: 100, type: 'number' },
      { title: '成功', dataIndex: 'success', width: 90, type: 'number' },
      { title: '失败', dataIndex: 'failed', width: 90, type: 'number' },
      { title: '状态', dataIndex: 'status', width: 110, type: 'tag' },
      { title: '操作时间', dataIndex: 'operatedAt', width: 160, type: 'datetime' },
    ],
  },
  '/product/ai/pick': {
    title: 'AI 选品',
    subtitle: '基于市场趋势智能推荐潜力商品',
    columns: [
      { title: '商品', dataIndex: 'name', width: 240, ellipsis: true },
      { title: '类目', dataIndex: 'category', width: 130 },
      { title: '热度', dataIndex: 'heat', width: 110, type: 'progress' },
      { title: '竞争度', dataIndex: 'competition', width: 110, type: 'tag' },
      { title: '预估毛利', dataIndex: 'margin', width: 110, type: 'tag' },
      { title: 'AI 推荐分', dataIndex: 'score', width: 110, type: 'number' },
      { title: '更新时间', dataIndex: 'updatedAt', width: 160, type: 'datetime' },
    ],
  },
  '/product/ai/translate': {
    title: 'AI 翻译',
    subtitle: '商品标题 / 描述多语言翻译',
    columns: [
      { title: '原文', dataIndex: 'src', width: 280, ellipsis: true },
      { title: '目标语言', dataIndex: 'targetLang', width: 110, type: 'tag' },
      { title: '译文', dataIndex: 'dst', width: 280, ellipsis: true },
      { title: '置信度', dataIndex: 'confidence', width: 110, type: 'tag' },
      { title: '翻译时间', dataIndex: 'time', width: 160, type: 'datetime' },
    ],
  },
  '/product/ai/title': {
    title: 'AI 标题优化',
    subtitle: '基于平台规则智能生成高曝光标题',
    columns: [
      { title: '原标题', dataIndex: 'src', width: 280, ellipsis: true },
      { title: '新标题', dataIndex: 'dst', width: 280, ellipsis: true },
      { title: '平台', dataIndex: 'platform', width: 120 },
      { title: '优化分', dataIndex: 'score', width: 100, type: 'number' },
      { title: '字数变化', dataIndex: 'lenDiff', width: 110 },
      { title: '生成时间', dataIndex: 'time', width: 160, type: 'datetime' },
    ],
  },
  '/product/ai/keyword': {
    title: 'AI 关键词挖掘',
    subtitle: '平台搜索热词 / 长尾词挖掘',
    columns: [
      { title: '关键词', dataIndex: 'keyword', width: 200, fixed: 'left' },
      { title: '搜索量', dataIndex: 'searchVolume', width: 110, type: 'number' },
      { title: '竞争度', dataIndex: 'competition', width: 110, type: 'tag' },
      { title: 'CPC', dataIndex: 'cpc', width: 90, type: 'money' },
      { title: '相关度', dataIndex: 'relevance', width: 110, type: 'tag' },
      { title: '趋势', dataIndex: 'trend', width: 110, type: 'tag' },
      { title: '更新时间', dataIndex: 'updatedAt', width: 160, type: 'datetime' },
    ],
  },

  // 订单管理 - 已在 OrderList/OrderHandle 单独实现, 此处只补充其他子页
  '/order/manual': {
    title: '手工订单',
    subtitle: '后台手工创建订单 / 补单 / 异常处理单',
    columns: [
      { title: '订单号', dataIndex: 'platformNo', width: 180, fixed: 'left' },
      { title: '店铺', dataIndex: 'shop', width: 180, ellipsis: true },
      { title: '买家', dataIndex: 'buyer', width: 130 },
      { title: '金额', dataIndex: 'amount', width: 110, type: 'money' },
      { title: '创建方式', dataIndex: 'createType', width: 130, type: 'tag' },
      { title: '创建人', dataIndex: 'creator', width: 130 },
      { title: '创建时间', dataIndex: 'createdAt', width: 160, type: 'datetime' },
      { title: '状态', dataIndex: 'status', width: 100, type: 'tag' },
    ],
  },
  '/order/split': {
    title: '分仓规则',
    subtitle: '按地区 / 库存 / 优先级自动分仓',
    columns: [
      { title: '规则名', dataIndex: 'name', width: 200, fixed: 'left' },
      { title: '匹配条件', dataIndex: 'condition', width: 240, ellipsis: true },
      { title: '目标仓库', dataIndex: 'warehouse', width: 150 },
      { title: '优先级', dataIndex: 'priority', width: 90, type: 'number' },
      { title: '状态', dataIndex: 'status', width: 100, type: 'tag', options: STATUS_POOL },
      { title: '更新时间', dataIndex: 'updatedAt', width: 160, type: 'datetime' },
    ],
  },
  '/order/review': {
    title: '审单规则',
    subtitle: '风控 / 黑名单 / 金额阈值自动审单',
    columns: [
      { title: '规则名', dataIndex: 'name', width: 200, fixed: 'left' },
      { title: '触发条件', dataIndex: 'trigger', width: 280, ellipsis: true },
      { title: '动作', dataIndex: 'action', width: 130, type: 'tag' },
      { title: '优先级', dataIndex: 'priority', width: 90, type: 'number' },
      { title: '状态', dataIndex: 'status', width: 100, type: 'tag', options: STATUS_POOL },
      { title: '更新时间', dataIndex: 'updatedAt', width: 160, type: 'datetime' },
    ],
  },
  '/order/print': {
    title: '打印发货',
    subtitle: '批量打印面单 / 配货单 / 发票',
    columns: [
      { title: '批次', dataIndex: 'batchNo', width: 150, fixed: 'left' },
      { title: '订单数', dataIndex: 'count', width: 100, type: 'number' },
      { title: '模板', dataIndex: 'template', width: 150 },
      { title: '物流', dataIndex: 'carrier', width: 130 },
      { title: '状态', dataIndex: 'status', width: 100, type: 'tag' },
      { title: '打印人', dataIndex: 'operator', width: 130 },
      { title: '打印时间', dataIndex: 'printedAt', width: 160, type: 'datetime' },
    ],
  },
  '/order/blacklist': {
    title: '订单黑名单',
    subtitle: '拒收 / 高退款率 / 风控黑名单',
    columns: [
      { title: '买家', dataIndex: 'buyer', width: 200, fixed: 'left' },
      { title: '邮箱', dataIndex: 'email', width: 220 },
      { title: '电话', dataIndex: 'phone', width: 160 },
      { title: '原因', dataIndex: 'reason', width: 200, ellipsis: true },
      { title: '命中次数', dataIndex: 'hits', width: 110, type: 'number' },
      { title: '添加人', dataIndex: 'addedBy', width: 130 },
      { title: '添加时间', dataIndex: 'addedAt', width: 160, type: 'datetime' },
    ],
  },
  '/order/batch': {
    title: '订单批量操作',
    subtitle: '批量发货 / 取消 / 标记 / 导出',
    columns: [
      { title: '批次号', dataIndex: 'batchNo', width: 160, fixed: 'left' },
      { title: '操作类型', dataIndex: 'type', width: 130, type: 'tag' },
      { title: '订单数', dataIndex: 'count', width: 100, type: 'number' },
      { title: '成功', dataIndex: 'success', width: 90, type: 'number' },
      { title: '失败', dataIndex: 'failed', width: 90, type: 'number' },
      { title: '状态', dataIndex: 'status', width: 100, type: 'tag' },
      { title: '操作人', dataIndex: 'operator', width: 130 },
      { title: '操作时间', dataIndex: 'operatedAt', width: 160, type: 'datetime' },
    ],
  },
  '/order/aftersale/refund': {
    title: '退款单',
    subtitle: '买家退款申请处理',
    columns: [
      { title: '退款单号', dataIndex: 'refundNo', width: 180, fixed: 'left' },
      { title: '原订单', dataIndex: 'orderNo', width: 180 },
      { title: '买家', dataIndex: 'buyer', width: 130 },
      { title: '金额', dataIndex: 'amount', width: 110, type: 'money' },
      { title: '原因', dataIndex: 'reason', width: 200, ellipsis: true },
      { title: '状态', dataIndex: 'status', width: 110, type: 'tag' },
      { title: '申请时间', dataIndex: 'appliedAt', width: 160, type: 'datetime' },
    ],
  },
  '/order/aftersale/return': {
    title: '退货单',
    subtitle: '退货入库 / 退款处理',
    columns: [
      { title: '退货单号', dataIndex: 'returnNo', width: 180, fixed: 'left' },
      { title: '原订单', dataIndex: 'orderNo', width: 180 },
      { title: '买家', dataIndex: 'buyer', width: 130 },
      { title: '商品', dataIndex: 'product', width: 220, ellipsis: true },
      { title: '数量', dataIndex: 'quantity', width: 80, type: 'number' },
      { title: '退款金额', dataIndex: 'refundAmount', width: 120, type: 'money' },
      { title: '状态', dataIndex: 'status', width: 110, type: 'tag' },
      { title: '入库时间', dataIndex: 'receivedAt', width: 160, type: 'datetime' },
    ],
  },
  '/order/aftersale/dispute': {
    title: '纠纷单',
    subtitle: 'A-to-Z / Chargeback / 平台介入',
    columns: [
      { title: '纠纷单号', dataIndex: 'disputeNo', width: 180, fixed: 'left' },
      { title: '原订单', dataIndex: 'orderNo', width: 180 },
      { title: '平台', dataIndex: 'platform', width: 120 },
      { title: '原因', dataIndex: 'reason', width: 220, ellipsis: true },
      { title: '金额', dataIndex: 'amount', width: 110, type: 'money' },
      { title: '状态', dataIndex: 'status', width: 110, type: 'tag' },
      { title: '申诉期限', dataIndex: 'appealDeadline', width: 160, type: 'date' },
    ],
  },

  // 托管管理
  '/custody/prepare': {
    title: '全托管备货',
    subtitle: '托管仓备货计划 / SKU 维护',
    columns: [
      { title: '备货单', dataIndex: 'planNo', width: 160, fixed: 'left' },
      { title: '托管仓', dataIndex: 'warehouse', width: 150 },
      { title: 'SKU 数', dataIndex: 'skuCount', width: 100, type: 'number' },
      { title: '备货量', dataIndex: 'qty', width: 110, type: 'number' },
      { title: '完成率', dataIndex: 'progress', width: 110, type: 'progress' },
      { title: '状态', dataIndex: 'status', width: 110, type: 'tag' },
      { title: '创建时间', dataIndex: 'createdAt', width: 160, type: 'datetime' },
    ],
  },
  '/custody/outbound': {
    title: '托管出库管理',
    subtitle: '托管仓出库 / 物流 / 签收',
    columns: [
      { title: '出库单', dataIndex: 'outboundNo', width: 160, fixed: 'left' },
      { title: '订单号', dataIndex: 'orderNo', width: 180 },
      { title: '托管仓', dataIndex: 'warehouse', width: 150 },
      { title: 'SKU', dataIndex: 'sku', width: 140 },
      { title: '数量', dataIndex: 'qty', width: 80, type: 'number' },
      { title: '物流', dataIndex: 'carrier', width: 130 },
      { title: '状态', dataIndex: 'status', width: 110, type: 'tag' },
      { title: '出库时间', dataIndex: 'outboundAt', width: 160, type: 'datetime' },
    ],
  },
  '/custody/report': {
    title: '托管报表',
    subtitle: '托管业务量 / 销售额 / 库存周转',
    columns: [
      { title: '日期', dataIndex: 'date', width: 120, type: 'date' },
      { title: '托管店铺', dataIndex: 'shop', width: 180 },
      { title: '订单数', dataIndex: 'orders', width: 100, type: 'number' },
      { title: '销售额', dataIndex: 'sales', width: 130, type: 'money' },
      { title: '出库量', dataIndex: 'outbound', width: 110, type: 'number' },
      { title: '库存周转', dataIndex: 'turnover', width: 110, type: 'tag' },
      { title: '毛利', dataIndex: 'profit', width: 110, type: 'money' },
    ],
  },
  '/custody/shop': {
    title: '托管店铺管理',
    subtitle: '托管模式下的店铺配置',
    columns: [
      { title: '店铺', dataIndex: 'name', width: 200, fixed: 'left' },
      { title: '平台', dataIndex: 'platform', width: 130 },
      { title: '托管仓', dataIndex: 'warehouse', width: 150 },
      { title: '佣金率', dataIndex: 'commission', width: 110, suffix: '%' },
      { title: '本月订单', dataIndex: 'monthOrders', width: 110, type: 'number' },
      { title: '本月销售额', dataIndex: 'monthSales', width: 130, type: 'money' },
      { title: '状态', dataIndex: 'status', width: 110, type: 'tag', options: STATUS_POOL },
    ],
  },

  // 采购管理
  '/purchase/plan': {
    title: '采购计划',
    subtitle: '根据销量 / 在途 / 安全库存智能生成采购计划',
    columns: [
      { title: '计划号', dataIndex: 'planNo', width: 160, fixed: 'left' },
      { title: 'SKU', dataIndex: 'sku', width: 140 },
      { title: '商品名称', dataIndex: 'name', width: 220, ellipsis: true },
      { title: '建议采购量', dataIndex: 'qty', width: 120, type: 'number' },
      { title: '供应商', dataIndex: 'supplier', width: 180 },
      { title: '预估金额', dataIndex: 'amount', width: 130, type: 'money' },
      { title: '优先级', dataIndex: 'priority', width: 100, type: 'tag' },
      { title: '状态', dataIndex: 'status', width: 110, type: 'tag' },
      { title: '创建时间', dataIndex: 'createdAt', width: 160, type: 'datetime' },
    ],
  },
  '/purchase/in': {
    title: '采购入库',
    subtitle: '采购到货入库登记',
    columns: [
      { title: '入库单', dataIndex: 'inNo', width: 160, fixed: 'left' },
      { title: '采购单', dataIndex: 'purchaseNo', width: 160 },
      { title: '仓库', dataIndex: 'warehouse', width: 150 },
      { title: 'SKU 数', dataIndex: 'skuCount', width: 100, type: 'number' },
      { title: '总数量', dataIndex: 'qty', width: 110, type: 'number' },
      { title: '操作人', dataIndex: 'operator', width: 130 },
      { title: '入库时间', dataIndex: 'receivedAt', width: 160, type: 'datetime' },
    ],
  },
  '/purchase/return': {
    title: '采购退货',
    subtitle: '不良品 / 过期退货出库',
    columns: [
      { title: '退货单', dataIndex: 'returnNo', width: 160, fixed: 'left' },
      { title: '采购单', dataIndex: 'purchaseNo', width: 160 },
      { title: '供应商', dataIndex: 'supplier', width: 180 },
      { title: 'SKU', dataIndex: 'sku', width: 140 },
      { title: '数量', dataIndex: 'qty', width: 90, type: 'number' },
      { title: '金额', dataIndex: 'amount', width: 120, type: 'money' },
      { title: '原因', dataIndex: 'reason', width: 200, ellipsis: true },
      { title: '状态', dataIndex: 'status', width: 110, type: 'tag' },
      { title: '创建时间', dataIndex: 'createdAt', width: 160, type: 'datetime' },
    ],
  },
  '/purchase/1688': {
    title: '1688 货源对接',
    subtitle: '1688 商品采集 / 一键下单',
    columns: [
      { title: '图片', dataIndex: 'image', width: 80, type: 'image' },
      { title: '商品标题', dataIndex: 'title', width: 280, ellipsis: true },
      { title: '供应商', dataIndex: 'supplier', width: 180 },
      { title: '价格', dataIndex: 'price', width: 110, type: 'money' },
      { title: '起订量', dataIndex: 'moq', width: 90, type: 'number' },
      { title: '评分', dataIndex: 'rating', width: 90, type: 'tag' },
      { title: '收藏数', dataIndex: 'favCount', width: 100, type: 'number' },
    ],
  },
  '/purchase/reconcile': {
    title: '采购对账',
    subtitle: '供应商账单 / 付款 / 发票对账',
    columns: [
      { title: '对账单号', dataIndex: 'reconcileNo', width: 160, fixed: 'left' },
      { title: '供应商', dataIndex: 'supplier', width: 180 },
      { title: '期间', dataIndex: 'period', width: 150 },
      { title: '订单数', dataIndex: 'orderCount', width: 100, type: 'number' },
      { title: '金额', dataIndex: 'amount', width: 130, type: 'money' },
      { title: '已付', dataIndex: 'paid', width: 130, type: 'money' },
      { title: '未付', dataIndex: 'unpaid', width: 130, type: 'money' },
      { title: '状态', dataIndex: 'status', width: 110, type: 'tag' },
    ],
  },

  // 仓库管理
  '/warehouse/setting/self': {
    title: '自营仓库',
    subtitle: '自建仓库管理',
    columns: [
      { title: '仓库编码', dataIndex: 'code', width: 120, fixed: 'left' },
      { title: '仓库名称', dataIndex: 'name', width: 180 },
      { title: '联系人', dataIndex: 'contact', width: 130 },
      { title: '电话', dataIndex: 'phone', width: 160 },
      { title: '地址', dataIndex: 'address', width: 280, ellipsis: true },
      { title: 'SKU 数', dataIndex: 'skuCount', width: 100, type: 'number' },
      { title: '状态', dataIndex: 'status', width: 100, type: 'tag', options: STATUS_POOL },
    ],
  },
  '/warehouse/setting/third': {
    title: '第三方仓库',
    subtitle: '第三方海外仓 / 代发仓绑定',
    columns: [
      { title: '仓库编码', dataIndex: 'code', width: 120, fixed: 'left' },
      { title: '仓库名称', dataIndex: 'name', width: 200 },
      { title: '服务商', dataIndex: 'provider', width: 160 },
      { title: 'API', dataIndex: 'apiEnabled', width: 90, type: 'boolean' },
      { title: '国家', dataIndex: 'country', width: 100 },
      { title: 'SKU 数', dataIndex: 'skuCount', width: 100, type: 'number' },
      { title: '状态', dataIndex: 'status', width: 100, type: 'tag', options: STATUS_POOL },
    ],
  },
  '/warehouse/setting/bind': {
    title: '平台仓绑定',
    subtitle: 'FBA / 平台仓对接',
    columns: [
      { title: '平台', dataIndex: 'platform', width: 130 },
      { title: '平台仓', dataIndex: 'platformWarehouse', width: 200 },
      { title: '本地映射仓库', dataIndex: 'localWarehouse', width: 180 },
      { title: '国家', dataIndex: 'country', width: 100 },
      { title: 'API 状态', dataIndex: 'apiStatus', width: 110, type: 'tag' },
      { title: '最近同步', dataIndex: 'lastSync', width: 160, type: 'datetime' },
    ],
  },
  '/warehouse/record/in': {
    title: '入库记录',
    subtitle: '采购入库 / 调拨入库 / 退货入库',
    columns: [
      { title: '入库单', dataIndex: 'inNo', width: 160, fixed: 'left' },
      { title: '类型', dataIndex: 'type', width: 120, type: 'tag' },
      { title: '仓库', dataIndex: 'warehouse', width: 150 },
      { title: 'SKU', dataIndex: 'sku', width: 140 },
      { title: '数量', dataIndex: 'qty', width: 90, type: 'number' },
      { title: '来源', dataIndex: 'source', width: 130 },
      { title: '操作人', dataIndex: 'operator', width: 130 },
      { title: '入库时间', dataIndex: 'createdAt', width: 160, type: 'datetime' },
    ],
  },
  '/warehouse/record/out': {
    title: '出库记录',
    subtitle: '订单出库 / 调拨出库 / 报损出库',
    columns: [
      { title: '出库单', dataIndex: 'outNo', width: 160, fixed: 'left' },
      { title: '类型', dataIndex: 'type', width: 120, type: 'tag' },
      { title: '仓库', dataIndex: 'warehouse', width: 150 },
      { title: 'SKU', dataIndex: 'sku', width: 140 },
      { title: '数量', dataIndex: 'qty', width: 90, type: 'number' },
      { title: '关联单号', dataIndex: 'refNo', width: 180 },
      { title: '操作人', dataIndex: 'operator', width: 130 },
      { title: '出库时间', dataIndex: 'createdAt', width: 160, type: 'datetime' },
    ],
  },
  '/warehouse/record/transfer': {
    title: '调拨记录',
    subtitle: 'A 仓 -> B 仓 调拨流水',
    columns: [
      { title: '调拨单', dataIndex: 'transferNo', width: 160, fixed: 'left' },
      { title: '调出仓', dataIndex: 'fromWarehouse', width: 150 },
      { title: '调入仓', dataIndex: 'toWarehouse', width: 150 },
      { title: 'SKU', dataIndex: 'sku', width: 140 },
      { title: '数量', dataIndex: 'qty', width: 90, type: 'number' },
      { title: '状态', dataIndex: 'status', width: 110, type: 'tag' },
      { title: '操作时间', dataIndex: 'createdAt', width: 160, type: 'datetime' },
    ],
  },
  '/warehouse/record/stocktaking': {
    title: '盘点记录',
    subtitle: '盘点差异 / 库存修正',
    columns: [
      { title: '盘点单', dataIndex: 'checkNo', width: 160, fixed: 'left' },
      { title: '仓库', dataIndex: 'warehouse', width: 150 },
      { title: 'SKU', dataIndex: 'sku', width: 140 },
      { title: '账面', dataIndex: 'systemQty', width: 90, type: 'number' },
      { title: '实盘', dataIndex: 'actualQty', width: 90, type: 'number' },
      { title: '差异', dataIndex: 'diff', width: 90, type: 'number' },
      { title: '操作人', dataIndex: 'operator', width: 130 },
      { title: '盘点时间', dataIndex: 'checkedAt', width: 160, type: 'datetime' },
    ],
  },
  '/warehouse/transfer': {
    title: '库存调拨',
    subtitle: 'A 仓 -> B 仓 调拨单',
    columns: [
      { title: '调拨单', dataIndex: 'transferNo', width: 160, fixed: 'left' },
      { title: '调出仓', dataIndex: 'fromWarehouse', width: 150 },
      { title: '调入仓', dataIndex: 'toWarehouse', width: 150 },
      { title: 'SKU 数', dataIndex: 'skuCount', width: 100, type: 'number' },
      { title: '总数量', dataIndex: 'qty', width: 110, type: 'number' },
      { title: '状态', dataIndex: 'status', width: 110, type: 'tag' },
      { title: '创建时间', dataIndex: 'createdAt', width: 160, type: 'datetime' },
    ],
  },
  '/warehouse/stocktaking': {
    title: '库存盘点',
    subtitle: '创建盘点单 / 录入实盘 / 自动调整',
    columns: [
      { title: '盘点单', dataIndex: 'checkNo', width: 160, fixed: 'left' },
      { title: '仓库', dataIndex: 'warehouse', width: 150 },
      { title: 'SKU 数', dataIndex: 'skuCount', width: 100, type: 'number' },
      { title: '已盘', dataIndex: 'checkedCount', width: 100, type: 'number' },
      { title: '差异', dataIndex: 'diffCount', width: 90, type: 'number' },
      { title: '状态', dataIndex: 'status', width: 110, type: 'tag' },
      { title: '盘点人', dataIndex: 'operator', width: 130 },
      { title: '创建时间', dataIndex: 'createdAt', width: 160, type: 'datetime' },
    ],
  },
  '/warehouse/warning': {
    title: '库存预警',
    subtitle: '低于安全库存 / 滞销 / 即将过期',
    columns: [
      { title: 'SKU', dataIndex: 'sku', width: 140, fixed: 'left' },
      { title: '商品', dataIndex: 'name', width: 220, ellipsis: true },
      { title: '仓库', dataIndex: 'warehouse', width: 150 },
      { title: '当前库存', dataIndex: 'qty', width: 110, type: 'number' },
      { title: '安全库存', dataIndex: 'safetyStock', width: 110, type: 'number' },
      { title: '预警级别', dataIndex: 'level', width: 110, type: 'tag' },
      { title: '日均销量', dataIndex: 'dailySales', width: 110, type: 'number' },
      { title: '可售天数', dataIndex: 'daysLeft', width: 100, type: 'number' },
    ],
  },
  '/warehouse/shelf': {
    title: '货架库位管理',
    subtitle: '货架 / 库位编码 / 容量管理',
    columns: [
      { title: '货架编码', dataIndex: 'shelfCode', width: 130, fixed: 'left' },
      { title: '仓库', dataIndex: 'warehouse', width: 150 },
      { title: '区域', dataIndex: 'zone', width: 120 },
      { title: '容量', dataIndex: 'capacity', width: 90, type: 'number' },
      { title: '已用', dataIndex: 'used', width: 90, type: 'number' },
      { title: '利用率', dataIndex: 'utilization', width: 110, type: 'progress' },
      { title: '状态', dataIndex: 'status', width: 100, type: 'tag', options: STATUS_POOL },
    ],
  },
  '/warehouse/pda': {
    title: 'PDA 作业',
    subtitle: 'PDA 上架 / 拣货 / 盘点任务',
    columns: [
      { title: '任务号', dataIndex: 'taskNo', width: 160, fixed: 'left' },
      { title: '类型', dataIndex: 'type', width: 120, type: 'tag' },
      { title: '仓库', dataIndex: 'warehouse', width: 150 },
      { title: 'SKU 数', dataIndex: 'skuCount', width: 100, type: 'number' },
      { title: '指派人', dataIndex: 'assignee', width: 130 },
      { title: '完成度', dataIndex: 'progress', width: 110, type: 'progress' },
      { title: '状态', dataIndex: 'status', width: 110, type: 'tag' },
      { title: '创建时间', dataIndex: 'createdAt', width: 160, type: 'datetime' },
    ],
  },
  '/warehouse/package': {
    title: '包材管理',
    subtitle: '包装箱 / 泡沫 / 标签等包材库存',
    columns: [
      { title: '编码', dataIndex: 'code', width: 120, fixed: 'left' },
      { title: '名称', dataIndex: 'name', width: 200 },
      { title: '规格', dataIndex: 'spec', width: 180 },
      { title: '库存', dataIndex: 'qty', width: 100, type: 'number' },
      { title: '单位', dataIndex: 'unit', width: 80 },
      { title: '预警值', dataIndex: 'warning', width: 100, type: 'number' },
      { title: '仓库', dataIndex: 'warehouse', width: 150 },
    ],
  },
  '/warehouse/sync': {
    title: '库存同步设置',
    subtitle: '平台仓 / 海外仓库存同步策略',
    columns: [
      { title: '规则名', dataIndex: 'name', width: 200, fixed: 'left' },
      { title: '源仓库', dataIndex: 'fromWarehouse', width: 150 },
      { title: '目标', dataIndex: 'toTarget', width: 200, ellipsis: true },
      { title: '同步方式', dataIndex: 'mode', width: 130, type: 'tag' },
      { title: '频率', dataIndex: 'frequency', width: 110 },
      { title: '最近同步', dataIndex: 'lastSync', width: 160, type: 'datetime' },
      { title: '状态', dataIndex: 'status', width: 110, type: 'tag', options: STATUS_POOL },
    ],
  },

  // 物流分拨
  '/logistics/channel': {
    title: '物流渠道',
    subtitle: '物流服务商 / 渠道配置',
    columns: [
      { title: '渠道编码', dataIndex: 'code', width: 130, fixed: 'left' },
      { title: '渠道名', dataIndex: 'name', width: 200 },
      { title: '服务商', dataIndex: 'carrier', width: 130 },
      { title: '类型', dataIndex: 'type', width: 110, type: 'tag' },
      { title: '支持国家', dataIndex: 'countries', width: 220 },
      { title: '今日单量', dataIndex: 'todayOrders', width: 110, type: 'number' },
      { title: '状态', dataIndex: 'enabled', width: 100, type: 'boolean' },
    ],
  },
  '/logistics/freight': {
    title: '运费模板',
    subtitle: '按重量 / 目的地 / 渠道的运费规则',
    columns: [
      { title: '模板名', dataIndex: 'name', width: 200, fixed: 'left' },
      { title: '渠道', dataIndex: 'channel', width: 150 },
      { title: '规则', dataIndex: 'rule', width: 280, ellipsis: true },
      { title: '关联商品', dataIndex: 'productCount', width: 110, type: 'number' },
      { title: '更新时间', dataIndex: 'updatedAt', width: 160, type: 'datetime' },
    ],
  },
  '/logistics/forwarder': {
    title: '货代管理',
    subtitle: '货代服务商 / 报价 / 对账',
    columns: [
      { title: '货代编码', dataIndex: 'code', width: 130, fixed: 'left' },
      { title: '货代名称', dataIndex: 'name', width: 200 },
      { title: '联系人', dataIndex: 'contact', width: 130 },
      { title: '电话', dataIndex: 'phone', width: 160 },
      { title: '本月单量', dataIndex: 'monthOrders', width: 110, type: 'number' },
      { title: '本月费用', dataIndex: 'monthCost', width: 130, type: 'money' },
      { title: '状态', dataIndex: 'status', width: 100, type: 'tag', options: STATUS_POOL },
    ],
  },
  '/logistics/print-tpl': {
    title: '打印模板',
    subtitle: '面单 / 配货单 / 发票打印模板',
    columns: [
      { title: '模板名', dataIndex: 'name', width: 200, fixed: 'left' },
      { title: '类型', dataIndex: 'type', width: 120, type: 'tag' },
      { title: '尺寸', dataIndex: 'size', width: 120 },
      { title: '使用数', dataIndex: 'useCount', width: 100, type: 'number' },
      { title: '更新时间', dataIndex: 'updatedAt', width: 160, type: 'datetime' },
    ],
  },
  '/logistics/match': {
    title: '物流匹配规则',
    subtitle: '按目的地 / 重量 / 渠道自动匹配',
    columns: [
      { title: '规则名', dataIndex: 'name', width: 200, fixed: 'left' },
      { title: '匹配条件', dataIndex: 'condition', width: 280, ellipsis: true },
      { title: '指定渠道', dataIndex: 'channel', width: 150 },
      { title: '优先级', dataIndex: 'priority', width: 90, type: 'number' },
      { title: '状态', dataIndex: 'status', width: 100, type: 'tag', options: STATUS_POOL },
      { title: '更新时间', dataIndex: 'updatedAt', width: 160, type: 'datetime' },
    ],
  },
  '/logistics/customs/tpl': {
    title: '申报模板',
    subtitle: '海关申报 HS Code / 申报价值模板',
    columns: [
      { title: '模板名', dataIndex: 'name', width: 200, fixed: 'left' },
      { title: '目的国', dataIndex: 'country', width: 100 },
      { title: 'HS Code', dataIndex: 'hsCode', width: 130 },
      { title: '申报品名', dataIndex: 'declarationName', width: 200 },
      { title: '申报价值', dataIndex: 'declarationValue', width: 130, type: 'money' },
      { title: '更新时间', dataIndex: 'updatedAt', width: 160, type: 'datetime' },
    ],
  },
  '/logistics/customs/data': {
    title: '报关资料管理',
    subtitle: '商品报关资料维护',
    columns: [
      { title: 'SKU', dataIndex: 'sku', width: 150, fixed: 'left' },
      { title: '商品名称', dataIndex: 'name', width: 220, ellipsis: true },
      { title: 'HS Code', dataIndex: 'hsCode', width: 130 },
      { title: '申报品名', dataIndex: 'declarationName', width: 200 },
      { title: '申报价值', dataIndex: 'declarationValue', width: 130, type: 'money' },
      { title: '材质', dataIndex: 'material', width: 130 },
      { title: '用途', dataIndex: 'usage', width: 150 },
    ],
  },

  // 广告
  '/ads/data': {
    title: '广告数据',
    subtitle: 'SP / SB / SD 等广告活动数据',
    columns: [
      { title: '活动', dataIndex: 'campaign', width: 240, ellipsis: true },
      { title: '类型', dataIndex: 'type', width: 110, type: 'tag' },
      { title: '店铺', dataIndex: 'shop', width: 180 },
      { title: '花费', dataIndex: 'spend', width: 130, type: 'money' },
      { title: '销售额', dataIndex: 'sales', width: 130, type: 'money' },
      { title: 'ACoS', dataIndex: 'acos', width: 100, suffix: '%' },
      { title: 'ROAS', dataIndex: 'roas', width: 100, type: 'tag' },
      { title: 'CTR', dataIndex: 'ctr', width: 90, suffix: '%' },
      { title: 'CPC', dataIndex: 'cpc', width: 100, type: 'money' },
    ],
  },
  '/ads/report': {
    title: '广告报表',
    subtitle: '按日 / 周 / 月聚合广告报表',
    columns: [
      { title: '日期', dataIndex: 'date', width: 120, type: 'date' },
      { title: '店铺', dataIndex: 'shop', width: 180 },
      { title: '活动数', dataIndex: 'campaigns', width: 100, type: 'number' },
      { title: '花费', dataIndex: 'spend', width: 130, type: 'money' },
      { title: '订单', dataIndex: 'orders', width: 100, type: 'number' },
      { title: '销售额', dataIndex: 'sales', width: 130, type: 'money' },
      { title: 'ACoS', dataIndex: 'acos', width: 100, suffix: '%' },
      { title: 'ROAS', dataIndex: 'roas', width: 100, type: 'tag' },
    ],
  },
  '/ads/record': {
    title: '广告投放记录',
    subtitle: '广告活动 / 关键词 / 调整记录',
    columns: [
      { title: '操作', dataIndex: 'action', width: 130, type: 'tag' },
      { title: '活动', dataIndex: 'campaign', width: 220, ellipsis: true },
      { title: '关键词', dataIndex: 'keyword', width: 200, ellipsis: true },
      { title: '出价', dataIndex: 'bid', width: 100, type: 'money' },
      { title: '操作人', dataIndex: 'operator', width: 130 },
      { title: '时间', dataIndex: 'time', width: 160, type: 'datetime' },
      { title: '结果', dataIndex: 'result', width: 110, type: 'tag' },
    ],
  },
  '/ads/shop': {
    title: '店铺活动管理',
    subtitle: '店铺级促销 / 优惠券 / 满减',
    columns: [
      { title: '活动名', dataIndex: 'name', width: 240, ellipsis: true },
      { title: '店铺', dataIndex: 'shop', width: 200 },
      { title: '类型', dataIndex: 'type', width: 120, type: 'tag' },
      { title: '折扣', dataIndex: 'discount', width: 110, suffix: '%' },
      { title: '开始', dataIndex: 'startAt', width: 160, type: 'datetime' },
      { title: '结束', dataIndex: 'endAt', width: 160, type: 'datetime' },
      { title: '状态', dataIndex: 'status', width: 110, type: 'tag' },
    ],
  },

  // 财务
  '/finance/fee': {
    title: '费用流水',
    subtitle: '平台费 / 广告费 / 物流费等',
    columns: [
      { title: '流水号', dataIndex: 'flowNo', width: 160, fixed: 'left' },
      { title: '类型', dataIndex: 'type', width: 120, type: 'tag' },
      { title: '店铺', dataIndex: 'shop', width: 180 },
      { title: '金额', dataIndex: 'amount', width: 130, type: 'money' },
      { title: '货币', dataIndex: 'currency', width: 90 },
      { title: '订单号', dataIndex: 'refOrderNo', width: 180 },
      { title: '发生时间', dataIndex: 'occurredAt', width: 160, type: 'datetime' },
    ],
  },
  '/finance/rate': {
    title: '汇率管理',
    subtitle: '货币汇率 / 实时更新',
    columns: [
      { title: '源币', dataIndex: 'from', width: 90, fixed: 'left' },
      { title: '目标币', dataIndex: 'to', width: 90 },
      { title: '汇率', dataIndex: 'rate', width: 130, type: 'number' },
      { title: '来源', dataIndex: 'source', width: 130, type: 'tag' },
      { title: '更新时间', dataIndex: 'updatedAt', width: 160, type: 'datetime' },
      { title: '操作人', dataIndex: 'operator', width: 130 },
      { title: '状态', dataIndex: 'status', width: 100, type: 'tag', options: STATUS_POOL },
    ],
  },
  '/finance/cost': {
    title: '成本核算',
    subtitle: '商品成本 / 物流成本 / 综合成本',
    columns: [
      { title: 'SKU', dataIndex: 'sku', width: 150, fixed: 'left' },
      { title: '商品', dataIndex: 'name', width: 240, ellipsis: true },
      { title: '采购成本', dataIndex: 'purchaseCost', width: 120, type: 'money' },
      { title: '头程', dataIndex: 'freightCost', width: 110, type: 'money' },
      { title: '包装', dataIndex: 'packageCost', width: 110, type: 'money' },
      { title: '总成本', dataIndex: 'totalCost', width: 120, type: 'money' },
      { title: '更新时间', dataIndex: 'updatedAt', width: 160, type: 'datetime' },
    ],
  },
  '/finance/payback': {
    title: '回款记录',
    subtitle: '平台打款 / 提现 / 到账',
    columns: [
      { title: '回款单', dataIndex: 'paybackNo', width: 160, fixed: 'left' },
      { title: '店铺', dataIndex: 'shop', width: 200 },
      { title: '平台', dataIndex: 'platform', width: 130 },
      { title: '金额', dataIndex: 'amount', width: 130, type: 'money' },
      { title: '货币', dataIndex: 'currency', width: 90 },
      { title: '账户', dataIndex: 'account', width: 200 },
      { title: '到账时间', dataIndex: 'arrivedAt', width: 160, type: 'datetime' },
    ],
  },
  '/finance/deduct': {
    title: '扣款明细',
    subtitle: '平台扣款 / 罚款 / 退款扣款',
    columns: [
      { title: '扣款单', dataIndex: 'deductNo', width: 160, fixed: 'left' },
      { title: '店铺', dataIndex: 'shop', width: 200 },
      { title: '原因', dataIndex: 'reason', width: 220, ellipsis: true },
      { title: '金额', dataIndex: 'amount', width: 130, type: 'money' },
      { title: '货币', dataIndex: 'currency', width: 90 },
      { title: '关联订单', dataIndex: 'refOrder', width: 180 },
      { title: '扣款时间', dataIndex: 'occurredAt', width: 160, type: 'datetime' },
    ],
  },

  // 系统设置
  '/system/import': {
    title: '导入导出中心',
    subtitle: '批量导入 / 导出数据',
    columns: [
      { title: '任务号', dataIndex: 'taskNo', width: 160, fixed: 'left' },
      { title: '类型', dataIndex: 'type', width: 120, type: 'tag' },
      { title: '模块', dataIndex: 'module', width: 130, type: 'tag' },
      { title: '总条数', dataIndex: 'total', width: 100, type: 'number' },
      { title: '成功', dataIndex: 'success', width: 90, type: 'number' },
      { title: '失败', dataIndex: 'failed', width: 90, type: 'number' },
      { title: '操作人', dataIndex: 'operator', width: 130 },
      { title: '时间', dataIndex: 'time', width: 160, type: 'datetime' },
    ],
  },
  '/system/sync': {
    title: '数据同步中心',
    subtitle: '主数据 / 缓存 / 索引同步',
    columns: [
      { title: '任务号', dataIndex: 'taskNo', width: 160, fixed: 'left' },
      { title: '类型', dataIndex: 'type', width: 130, type: 'tag' },
      { title: '目标', dataIndex: 'target', width: 180 },
      { title: '进度', dataIndex: 'progress', width: 110, type: 'progress' },
      { title: '状态', dataIndex: 'status', width: 110, type: 'tag' },
      { title: '开始时间', dataIndex: 'startedAt', width: 160, type: 'datetime' },
      { title: '耗时', dataIndex: 'cost', width: 90, suffix: 's' },
    ],
  },
  '/system/op-log': {
    title: '操作日志',
    subtitle: '用户在系统中的所有操作',
    columns: [
      { title: '时间', dataIndex: 'time', width: 160, type: 'datetime' },
      { title: '用户', dataIndex: 'username', width: 130 },
      { title: '模块', dataIndex: 'module', width: 130, type: 'tag' },
      { title: '操作', dataIndex: 'action', width: 160, type: 'tag' },
      { title: '对象', dataIndex: 'target', width: 200, ellipsis: true },
      { title: 'IP', dataIndex: 'ip', width: 130 },
      { title: '结果', dataIndex: 'result', width: 90, type: 'tag' },
    ],
  },
  '/system/audit-log': {
    title: '审计日志',
    subtitle: '安全审计 / 合规日志',
    columns: [
      { title: '时间', dataIndex: 'time', width: 160, type: 'datetime' },
      { title: '用户', dataIndex: 'username', width: 130 },
      { title: '事件类型', dataIndex: 'eventType', width: 130, type: 'tag' },
      { title: '对象', dataIndex: 'target', width: 200, ellipsis: true },
      { title: '变更前', dataIndex: 'before', width: 220, ellipsis: true },
      { title: '变更后', dataIndex: 'after', width: 220, ellipsis: true },
      { title: 'IP', dataIndex: 'ip', width: 130 },
    ],
  },
  '/system/billing/plan': {
    title: '套餐信息',
    subtitle: '当前订阅 / 配额',
    columns: [
      { title: '套餐', dataIndex: 'plan', width: 200, fixed: 'left' },
      { title: '店铺数', dataIndex: 'shops', width: 110, type: 'number' },
      { title: '订单数/月', dataIndex: 'orders', width: 130, type: 'number' },
      { title: '已用店铺', dataIndex: 'usedShops', width: 130, type: 'number' },
      { title: '已用订单', dataIndex: 'usedOrders', width: 130, type: 'number' },
      { title: '到期日', dataIndex: 'expireAt', width: 160, type: 'date' },
      { title: '状态', dataIndex: 'status', width: 110, type: 'tag' },
    ],
  },
  '/system/billing/consume': {
    title: '消费记录',
    subtitle: '按月聚合消费记录',
    columns: [
      { title: '账单号', dataIndex: 'billNo', width: 160, fixed: 'left' },
      { title: '期间', dataIndex: 'period', width: 130 },
      { title: '项目', dataIndex: 'item', width: 200 },
      { title: '金额', dataIndex: 'amount', width: 130, type: 'money' },
      { title: '状态', dataIndex: 'status', width: 110, type: 'tag' },
      { title: '生成时间', dataIndex: 'createdAt', width: 160, type: 'datetime' },
    ],
  },
  '/system/billing/renew': {
    title: '续费升级',
    subtitle: '可选套餐 / 续费',
    columns: [
      { title: '套餐', dataIndex: 'plan', width: 200, fixed: 'left' },
      { title: '价格', dataIndex: 'price', width: 130, type: 'money' },
      { title: '店铺数', dataIndex: 'shops', width: 100, type: 'number' },
      { title: '订单/月', dataIndex: 'orders', width: 110, type: 'number' },
      { title: '用户数', dataIndex: 'users', width: 100, type: 'number' },
      { title: 'AI 配额', dataIndex: 'aiQuota', width: 110, type: 'number' },
      { title: '推荐', dataIndex: 'recommended', width: 90, type: 'tag' },
    ],
  },
};

// 通用 path fallback (没有专门模板时使用)
const FALLBACK: ListConfig = {
  title: '',
  subtitle: '',
  columns: [
    { title: 'ID', dataIndex: 'id', width: 200, fixed: 'left' },
    { title: '名称', dataIndex: 'name', width: 220, ellipsis: true },
    { title: '平台', dataIndex: 'platform', width: 130 },
    { title: '店铺', dataIndex: 'shop', width: 200, ellipsis: true },
    { title: '状态', dataIndex: 'status', width: 100, type: 'tag', options: STATUS_POOL },
    { title: '金额', dataIndex: 'amount', width: 130, type: 'money' },
    { title: '数量', dataIndex: 'quantity', width: 90, type: 'number' },
    { title: '更新时间', dataIndex: 'updatedAt', width: 160, type: 'datetime' },
  ],
};

// ============= 通用生成器: 根据 columns 自动生成行数据 =============
// genByColumns 函数已在上方定义, 此处不再重复

// ============= 入口函数 =============
export function genListConfig(path: string): ListConfig {
  const tpl = TEMPLATES[path];
  if (tpl) {
    return { ...tpl, rowCount: 28 };
  }
  return { ...FALLBACK, title: '', subtitle: '', rowCount: 22 };
}

export function genMockRows(path: string, cfg: ListConfig, count?: number): Record<string, any>[] {
  const n = count || cfg.rowCount || 20;
  // 通用回退: 根据 columns 自动生成
  return genByColumns(cfg.columns, path, n);
}

export function formatMockDate(v: any, type: 'date' | 'datetime' = 'datetime'): string {
  if (!v) return '-';
  if (typeof v === 'string') {
    if (type === 'date') return dayjs(v).format('YYYY-MM-DD');
    return dayjs(v).format('YYYY-MM-DD HH:mm');
  }
  return '-';
}
