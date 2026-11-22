import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getPoolBalance, deductFromPool, addPurchasedCredits, hasBenefit } from '../_shared/pool.ts';

const MEOO_AI_BASE_URL = 'https://ws-14w50zl0wvf8lldk.cn-beijing.maas.aliyuncs.com';
const CREDITS_PER_YUAN = 20;
const functionName = 'agent-chat';

// ===================== 基础工具 =====================

function adminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

async function resolveUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const admin = adminClient();
    const { data } = await admin.auth.getUser(token);
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

async function getSubscription(userId: string) {
  const { data } = await adminClient()
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function writeUsageLog(userId: string, serviceKey: string, serviceName: string, cost: number, status: string, credits?: number) {
  await adminClient().from('ai_usage_logs').insert({
    user_id: userId,
    service_key: serviceKey,
    service_name: serviceName,
    cost,
    credits: credits ?? null,
    status,
  });
}

async function logConversation(userId: string, role: string, content: string, intent?: string, status = '成功', durationMs?: number) {
  try {
    await adminClient().from('agent_conversations').insert({
      user_id: userId,
      role,
      content: String(content).slice(0, 4000),
      intent: intent ?? null,
      status,
      duration_ms: durationMs ?? null,
    });
  } catch (e) {
    console.error(`[${functionName}] logConversation failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function logTool(userId: string, tool: string, params: unknown, resultSummary: string, status = '成功', durationMs?: number) {
  try {
    await adminClient().from('agent_tool_logs').insert({
      user_id: userId,
      tool,
      params: typeof params === 'string' ? params.slice(0, 1000) : JSON.stringify(params ?? {}).slice(0, 1000),
      result_summary: String(resultSummary).slice(0, 1000),
      status,
      duration_ms: durationMs ?? null,
    });
  } catch (e) {
    console.error(`[${functionName}] logTool failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ===================== 页面映射（跳转） =====================

const PAGE_MAP: Record<string, { path: string; zh: string[]; en: string[] }> = {
  dashboard: { path: '/dashboard', zh: ['工作台', '首页', '概览'], en: ['dashboard', 'home', 'overview'] },
  products: { path: '/products', zh: ['商品管理', '商品列表', '商品总列表'], en: ['product', 'products'] },
  collect_box: { path: '/products/collect', zh: ['采集箱'], en: ['collect box', 'collection'] },
  material: { path: '/products/material', zh: ['素材库'], en: ['material', 'materials'] },
  auth: { path: '/auth', zh: ['店铺授权', '授权管理'], en: ['auth', 'authorization', 'shop auth'] },
  orders: { path: '/orders', zh: ['订单管理', '订单处理'], en: ['order', 'orders'] },
  listing: { path: '/listing', zh: ['刊登管理', '刊登'], en: ['listing', 'publish'] },
  inventory: { path: '/inventory', zh: ['库存', '仓储'], en: ['inventory', 'stock'] },
  reports: { path: '/reports', zh: ['数据报表', '报表'], en: ['report', 'reports'] },
  subscription: { path: '/subscription', zh: ['订阅', '充值', '套餐', '额度'], en: ['subscription', 'recharge', 'plan'] },
  finance: { path: '/finance', zh: ['财务'], en: ['finance'] },
  logistics: { path: '/logistics', zh: ['物流'], en: ['logistics'] },
  purchase: { path: '/purchase', zh: ['采购'], en: ['purchase'] },
  ai_center: { path: '/ai/market', zh: ['AI智能中心', '智能选品', '市场分析'], en: ['ai center', 'ai market'] },
  profile: { path: '/profile', zh: ['个人中心', '我的'], en: ['profile'] },
};

function resolvePage(hint: string): string | null {
  const h = String(hint || '').toLowerCase();
  for (const key of Object.keys(PAGE_MAP)) {
    const cfg = PAGE_MAP[key];
    if (cfg.path.toLowerCase() === h) return cfg.path;
    if (cfg.zh.some((w) => hint.includes(w)) || cfg.en.some((w) => h.includes(w))) return cfg.path;
  }
  return null;
}

// ===================== 规则意图识别（fast path，零 LLM 成本） =====================

interface IntentResult {
  intent: string;
  params: Record<string, unknown>;
}

function hasLink(text: string): boolean {
  return /https?:\/\/[^\s"'<>]+/i.test(text);
}

function detectIntent(message: string, link: string, page: string): IntentResult {
  const m = message || '';
  const l = link || '';
  const combined = `${m} ${l}`.trim();
  const urlMatch = m.match(/https?:\/\/[^\s"'<>]+/i);

  // 1) 采集：带链接 或 粘贴链接
  if (l || urlMatch) {
    return { intent: 'collect', params: { url: l || urlMatch![0] } };
  }

  // 2) 高危刊登：刊登/上架/发布（必须人工确认，绝不直接执行）
  if (/刊登|上架|发布|publish|list(ing)?\s*(to|on)/i.test(m)) {
    return { intent: 'publish_preview', params: {} };
  }

  // 3) 页面跳转（优先于查询类，避免“带我去商品管理”被识别为商品查询）
  if (/去|打开|跳转|跳转到|进入|前往|go to|open|navigate/i.test(m)) {
    const path = resolvePage(m);
    if (path) return { intent: 'jump', params: { path } };
  }

  // 4) 授权到期查询
  if (/到期|过期|快失效|即将失效|要续期|快到期|expiring|expired/i.test(m)) {
    return { intent: 'query_auth_expiring', params: {} };
  }

  // 4) 额度/积分查询
  if (/额度|积分|余额|配额|还剩|quota|credits|balance/i.test(m)) {
    return { intent: 'query_quota', params: {} };
  }

  // 5) 销售数据分析（报表智能解读）
  const daysMatch = m.match(/最近\s*(\d+)\s*天|近\s*(\d+)\s*天|last\s*(\d+)\s*days?/i);
  if (/分析|解读|趋势|热销|卖得(好|差)|哪个(好卖|卖得好)|排行|top\s*\d|analy(ze|sis)|trend|insight/i.test(m)) {
    const days = daysMatch ? Number(daysMatch[1] || daysMatch[2] || daysMatch[3]) : 30;
    return { intent: 'query_sales_analysis', params: { days } };
  }

  // 6) 订单/销售查询（含时间窗）
  if (/订单|销售|卖了多少|营收|成交|sales|orders?|sold/i.test(m)) {
    const days = daysMatch ? Number(daysMatch[1] || daysMatch[2] || daysMatch[3]) : 30;
    return { intent: 'query_orders', params: { days } };
  }

  // 6) 商品/草稿查询
  if (/商品|产品|草稿|products?|draft/i.test(m)) {
    const status = /草稿|draft/i.test(m) ? '草稿' : (/在售|on sale|listed/i.test(m) ? '在售' : null);
    return { intent: 'query_products', params: { status } };
  }

  // 7) 店铺列表
  if (/店铺|shops?/i.test(m)) {
    return { intent: 'query_shops', params: {} };
  }


  return { intent: 'unknown', params: {} };
}

// ===================== 工具执行 =====================

async function queryShopsTool(userId: string, lang: string) {
  const { data, error } = await adminClient()
    .from('shops')
    .select('id, name, platform, region, status, today_sales, today_orders, product_count, rating')
    .eq('user_id', userId)
    .order('today_sales', { ascending: false });
  if (error) throw new Error(error.message);
  const shops = data ?? [];
  const totalSales = shops.reduce((s, x) => s + Number(x.today_sales || 0), 0);
  const totalOrders = shops.reduce((s, x) => s + Number(x.today_orders || 0), 0);
  return { shops, totalSales, totalOrders };
}

async function queryOrdersTool(userId: string, days: number) {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const { data, error } = await adminClient()
    .from('orders')
    .select('id, buyer, product, sku, channel, amount, currency, status, created_at')
    .eq('user_id', userId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  const orders = data ?? [];
  const totalAmount = orders.reduce((s, o) => s + Number(o.amount || 0), 0);
  return { orders, days, totalAmount, orderCount: orders.length };
}

async function salesAnalysisTool(userId: string, days: number) {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const prevSince = new Date(Date.now() - days * 2 * 24 * 3600 * 1000).toISOString();
  const { data, error } = await adminClient()
    .from('orders')
    .select('id, product, sku, channel, amount, currency, status, created_at')
    .eq('user_id', userId)
    .gte('created_at', prevSince)
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  const all = data ?? [];
  const sinceTs = new Date(since).getTime();
  const cur = all.filter((o) => new Date(String(o.created_at)).getTime() >= sinceTs);
  const prev = all.filter((o) => new Date(String(o.created_at)).getTime() < sinceTs);
  const sum = (arr: Record<string, unknown>[]) => arr.reduce((s, o) => s + Number(o.amount || 0), 0);
  const curAmount = sum(cur);
  const prevAmount = sum(prev);
  const changePercent = prevAmount > 0 ? ((curAmount - prevAmount) / prevAmount) * 100 : null;
  // 热销 Top5
  const byProd: Record<string, { name: string; amount: number; count: number }> = {};
  for (const o of cur) {
    const k = String(o.product || o.sku || '未知商品');
    byProd[k] = byProd[k] || { name: k, amount: 0, count: 0 };
    byProd[k].amount += Number(o.amount || 0);
    byProd[k].count += 1;
  }
  const topProducts = Object.values(byProd).sort((a, b) => b.amount - a.amount).slice(0, 5);
  // 渠道分布
  const byChan: Record<string, number> = {};
  for (const o of cur) {
    const k = String(o.channel || '未知渠道');
    byChan[k] = (byChan[k] || 0) + Number(o.amount || 0);
  }
  const channels = Object.entries(byChan).sort((a, b) => b[1] - a[1]).map(([name, amount]) => ({ name, amount }));
  // 每日趋势
  const daily: Record<string, number> = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 3600 * 1000);
    daily[d.toISOString().slice(0, 10)] = 0;
  }
  for (const o of cur) {
    const k = String(o.created_at).slice(0, 10);
    if (k in daily) daily[k] += Number(o.amount || 0);
  }
  const trend = Object.entries(daily).map(([date, amount]) => ({ date, amount }));
  return {
    days,
    orderCount: cur.length,
    totalAmount: curAmount,
    avgPerDay: cur.length ? curAmount / days : 0,
    changePercent,
    topProducts,
    channels,
    trend,
    currency: String(cur[0]?.currency || 'USD'),
  };
}

async function queryProductsTool(userId: string, status: string | null) {
  let query = adminClient()
    .from('products')
    .select('id, name, sku, category, price, stock, status, image, sales')
    .eq('user_id', userId)
    .order('sales', { ascending: false })
    .limit(50);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const products = data ?? [];
  const byStatus: Record<string, number> = {};
  for (const p of products) byStatus[p.status || '未知'] = (byStatus[p.status || '未知'] || 0) + 1;
  return { products, byStatus, filter: status };
}

async function queryQuotaTool(userId: string) {
  const sub = await getSubscription(userId);
  const credits = await getPoolBalance(userId, 'agent');
  return {
    credits,
    plan_name: sub?.plan_name ?? '免费版',
    plan_expires_at: sub?.expires_at ?? null,
  };
}

async function queryAuthExpiringTool(userId: string) {
  const { data, error } = await adminClient()
    .from('shop_auths')
    .select('id, shop_name, platform, region, status, token_expires_at, verify_at')
    .eq('user_id', userId)
    .order('token_expires_at', { ascending: true });
  if (error) throw new Error(error.message);
  const all = data ?? [];
  const items = all.map((r) => ({
    id: r.id,
    shop_name: r.shop_name || '',
    platform: r.platform || '',
    region: r.region || '',
    status: r.status || '待验证',
    token_expires_at: r.token_expires_at ?? null,
  }));
  const expiring = items.filter((it) => it.status === '即将到期' || it.status === '已失效' || it.token_expires_at);
  return { items: expiring.length > 0 ? expiring : items, total: items.length };
}

// 采集并生成商品草稿（内部调用 collect 函数 → 落草稿到 products）
async function collectAndDraftTool(userId: string, url: string, userToken: string, projectUrlId: string, lang: string) {
  const collectUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/collect`;
  const resp = await fetch(collectUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'OneDay-App-Id': projectUrlId,
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({ url }),
  });
  const result = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = (result as { error?: string }).error || `采集失败(${resp.status})`;
    throw new Error(msg);
  }
  const product = (result as { data?: Record<string, unknown> }).data ?? {};

  // 落草稿：套用商品表结构（status=草稿，标注采集来源）
  const draftId = crypto.randomUUID();
  const { error: insErr } = await adminClient().from('products').insert({
    id: draftId,
    name: String(product.name || '未命名商品'),
    sku: String(product.sku || `COLLECT-${Date.now().toString(36).toUpperCase()}`),
    category: '采集',
    price: Number(product.price) || 0,
    stock: 0,
    status: '草稿',
    image: String(product.image || ''),
    description: String(product.description || '').slice(0, 2000),
    variants: Array.isArray(product.variants) ? product.variants : null,
    user_id: userId,
  });
  if (insErr) throw new Error(`草稿保存失败: ${insErr.message}`);

  return {
    draft_id: draftId,
    name: String(product.name || '未命名商品'),
    price: Number(product.price) || 0,
    currency: String(product.currency || ''),
    image: String(product.image || ''),
    platform: String(product.platform || ''),
    variants_count: Array.isArray(product.variants) ? product.variants.length : 0,
    source: url,
  };
}

// 图片解析生成刊登稿件（多模态 LLM → 落草稿）
async function imageToDraftTool(userId: string, imageUrl: string, text: string, apiKey: string) {
  const sys = `你是跨境电商刊登稿件生成器。请分析用户提供的商品图片${text ? '，并结合用户补充说明：' + text : ''}，输出严格 JSON（不要输出其他内容）：
{"name":"商品标题（英文为主，60字符内，含核心卖点）","price":数字,"currency":"USD","category":"商品类目（英文）","description":"英文商品描述，150-400字，包含材质/规格/适用场景/卖点","attributes":[{"name":"属性名","value":"属性值"}],"platform_hint":"建议刊登平台（如 Amazon/Shopify/eBay）"}`;
  const resp = await fetch(`${MEOO_AI_BASE_URL}/compatible-mode/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen3.8-omni-flash',
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: [{ type: 'image_url', image_url: { url: imageUrl } }] },
      ],
      stream: false,
      temperature: 0.2,
      max_tokens: 900,
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`图片解析失败(${resp.status}): ${errText.slice(0, 160)}`);
  }
  const json = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content || '';
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('图片解析无有效结果');
  const parsed = JSON.parse(match[0]);

  const draftId = crypto.randomUUID();
  const attributes = Array.isArray(parsed.attributes) ? parsed.attributes : [];
  const { error } = await adminClient().from('products').insert({
    id: draftId,
    name: String(parsed.name || '未命名商品'),
    sku: `IMG-${Date.now().toString(36).toUpperCase()}`,
    category: String(parsed.category || '图片解析'),
    price: Number(parsed.price) || 0,
    stock: 0,
    status: '草稿',
    image: imageUrl,
    description: String(parsed.description || '').slice(0, 2000),
    variants: attributes.length > 0 ? attributes : null,
    user_id: userId,
  });
  if (error) throw new Error(`草稿保存失败: ${error.message}`);
  return {
    draft_id: draftId,
    name: String(parsed.name || '未命名商品'),
    price: Number(parsed.price) || 0,
    currency: String(parsed.currency || 'USD'),
    image: imageUrl,
    platform: String(parsed.platform_hint || '图片解析'),
    attributes_count: attributes.length,
  };
}

// 高危刊登：创建待确认动作（绝不直接执行）
async function createPublishPreview(userId: string, message: string) {
  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await adminClient().from('agent_pending_actions').insert({
    user_id: userId,
    token,
    action_type: 'publish_preview',
    title: '刊登操作确认',
    detail: String(message).slice(0, 500),
    params: { message: String(message).slice(0, 500) },
    status: 'pending',
    expires_at: expiresAt,
  });
  return { token, expires_at: expiresAt };
}

// 确认高危动作
async function confirmPendingAction(userId: string, token: string) {
  const admin = adminClient();
  const { data: row } = await admin
    .from('agent_pending_actions')
    .select('*')
    .eq('user_id', userId)
    .eq('token', token)
    .maybeSingle();
  if (!row) return { ok: false, error: '确认凭证无效或不存在' };
  if (row.status === 'confirmed') return { ok: false, error: '该操作已确认过，请重新发起' };
  if (row.status === 'cancelled' || row.status === 'expired') return { ok: false, error: '该操作已失效，请重新发起' };
  const expires = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (expires < Date.now()) {
    await admin.from('agent_pending_actions').update({ status: 'expired' }).eq('id', row.id);
    return { ok: false, error: '确认已超时（10 分钟），请重新发起' };
  }
  await admin.from('agent_pending_actions').update({ status: 'confirmed' }).eq('id', row.id);
  return { ok: true, action_type: row.action_type, title: row.title, detail: row.detail };
}

// ===================== LLM 兜底（模糊指令） =====================

async function llmUnderstand(apiKey: string, message: string, history: unknown[], lang: string): Promise<{ intent: string; params: Record<string, unknown>; reply_hint: string } | null> {
  const langText = lang === 'en'
    ? 'Reply in English. Output ONLY a JSON object with keys: intent, params, reply_hint.'
    : '用中文回复。只输出一个 JSON 对象，包含键：intent、params、reply_hint。';

  const schema = `You are the intent router of a cross-border e-commerce ERP assistant. Available intents:
- query_shops: list my shops (params: {})
- query_orders: query orders/sales (params: {days: number})
- query_products: query products/drafts (params: {status: "草稿"|"在售"|null})
- query_quota: query my AI credits/subscription (params: {})
- query_auth_expiring: list shop authorizations expiring soon (params: {})
- collect: collect a product from a URL and create draft (params: {url: string})
- jump: navigate to a page (params: {path: "/products" or "/auth" or "/orders" or "/subscription" or "/reports" or "/dashboard" or "/inventory" or "/listing"})
- publish_preview: user wants to publish/list items - ALWAYS require human confirmation, do NOT execute (params: {})
- faq: general question about the platform (params: {})
- unknown: cannot determine (params: {})
Only output valid JSON, nothing else. ${langText}`;

  const body = {
    model: 'qwen3.8-omni-flash',
    messages: [
      { role: 'system', content: schema },
      ...(Array.isArray(history) ? history.slice(-6) : []),
      { role: 'user', content: message },
    ],
    stream: false,
    temperature: 0.1,
    max_tokens: 300,
  };

  const resp = await fetch(`${MEOO_AI_BASE_URL}/compatible-mode/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`LLM 意图识别失败(${resp.status}): ${errText.slice(0, 200)}`);
  }
  const json = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content || '';
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return {
      intent: String(parsed.intent || 'unknown'),
      params: (parsed.params && typeof parsed.params === 'object') ? parsed.params : {},
      reply_hint: String(parsed.reply_hint || ''),
    };
  } catch {
    return null;
  }
}

// ===================== 回复组装 =====================

function buildReply(lang: string, key: string, ...args: (string | number)[]): string {
  const zh: Record<string, string> = {
    greeting: '你好，我是 Thalvior 智能助手。你可以让我查询店铺、订单、额度，粘贴商品链接我来帮你采集生成草稿，或者让我带你跳转到任意页面。',
    query_shops: `共 ${args[0]} 个店铺，今日总销售额 ¥${args[1]}、今日总订单 ${args[2]} 单。`,
    query_orders: `最近 ${args[0]} 天共 ${args[1]} 笔订单，合计金额 ${args[2]}。`,
    query_products: `共 ${args[0]} 个商品${args[1] ? `（${args[1]}）` : ''}，其中草稿 ${args[2]} 个、在售 ${args[3]} 个。`,
    query_quota: `当前 AI 积分余额 ${args[0]} 积分${args[1] ? `，套餐：${args[1]}` : '，暂无付费套餐'}。`,
    query_auth_expiring: `共有 ${args[0]} 条店铺授权记录，以下为待处理/即将到期的授权：`,
    collect_done: `✅ 草稿已创建完成：「${args[0]}」（¥${args[1]}${args[2] ? ` ${args[2]}` : ''}）。请到商品管理-草稿核对类目、属性与素材版权。`,
    collect_fail: `采集失败：${args[0]}`,
    jump_ok: `好的，为你打开${args[0]}页面。`,
    publish_preview: '⚠️ 刊登属于高危操作，我不会直接执行。请确认目标与商品后，点击下方【确认】跳转到刊登页面人工操作；也可以取消本次操作。',
    confirm_ok: '✅ 已确认。为你跳转到刊登/商品页面，请在该页面完成最终刊登操作（系统不会自动上架）。',
    confirm_fail: `${args[0]}`,
    faq_prefix: '',
    unknown: '我没完全理解你的意思，请说得更具体一些。例如：\n• 帮我看看我有哪些店铺\n• 查询最近 7 天订单\n• 帮我采集这个链接：https://…\n• 我的积分还剩多少\n• 带我去商品管理',
    no_quota: `AI 积分不足：本次需要 ${args[0]} 积分，当前剩余 ${args[1]} 积分，请先充值或订阅套餐。`,
    image_draft_ok: `✅ 已根据图片生成刊登稿件草稿：「${args[0]}」（¥${args[1]} ${args[2]}）。本次图片解析消耗 ${args[3]} 积分。请核对类目、属性与素材版权后再刊登。`,
    batch_collect_done: `已批量采集 ${args[0]} 个链接：成功 ${args[1]} 个、失败 ${args[2]} 个。共消耗 ${args[3]} 积分（每个成功链接 3 积分），草稿已生成，请前往商品管理核对。`,
    query_sales_analysis: `近 ${args[0]} 天共 ${args[1]} 笔订单，销售额 ${args[2]}，日均 ${args[3]}。${args[4]}。热销商品与渠道分布见下方卡片。`,
  };
  const en: Record<string, string> = {
    greeting: 'Hi, I am the Thalvior assistant. Ask me about your shops, orders, credits; paste a product link to collect & draft; or ask me to jump to any page.',
    query_shops: `${args[0]} shops in total. Today: ¥${args[1]} sales, ${args[2]} orders.`,
    query_orders: `Last ${args[0]} days: ${args[1]} orders, total ${args[2]}.`,
    query_products: `${args[0]} products${args[1] ? ` (${args[1]})` : ''} — ${args[2]} drafts, ${args[3]} listed.`,
    query_quota: `AI credits: ${args[0]}${args[1] ? `, plan: ${args[1]}` : ', no paid plan'}.`,
    query_auth_expiring: `${args[0]} shop authorization(s). The following need attention:`,
    collect_done: `✅ Draft created: "${args[0]}" (¥${args[1]}${args[2] ? ` ${args[2]}` : ''}). Please review category & assets before publishing.`,
    collect_fail: `Collection failed: ${args[0]}`,
    jump_ok: `Opening the ${args[0]} page.`,
    publish_preview: '⚠️ Publishing is a high-risk action and I will never execute it directly. Confirm the target & items, then click 【Confirm】 to go to the listing page; or cancel.',
    confirm_ok: '✅ Confirmed. Taking you to the listing/products page — final publishing is done manually there (nothing is auto-listed).',
    confirm_fail: `${args[0]}`,
    faq_prefix: '',
    unknown: "I didn't get that. Try:\n• Show me my shops\n• Orders from the last 7 days\n• Collect this link: https://…\n• How many credits do I have\n• Go to products",
    no_quota: `Not enough AI credits: need ${args[0]}, you have ${args[1]}. Please recharge or subscribe.`,
    image_draft_ok: `✅ Draft created from image: "${args[0]}" (¥${args[1]} ${args[2]}). Image parsing cost ${args[3]} credits. Please review before listing.`,
    batch_collect_done: `Collected ${args[0]} links: ${args[1]} ok, ${args[2]} failed. Total cost ${args[3]} credits (3 per link). Drafts are ready in Products.`,
    query_sales_analysis: `Last ${args[0]} days: ${args[1]} orders, ${args[2]} total, ${args[3]}/day. ${args[4]}. Top products & channels below.`,
  };
  const dict = lang === 'en' ? en : zh;
  return dict[key] ?? key;
}

// ===================== 主流程 =====================

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const startTime = Date.now();

  try {
    // AI 凭证
    const projectUrlId = req.headers.get('X-Meoo-Project-Url-Id')?.trim() || '';
    const projectSecretName = `MEOO_PROJECT_API_KEY_${projectUrlId}`;
    const apiKey =
      (projectUrlId ? Deno.env.get(projectSecretName) : '') ||
      Deno.env.get('MEOO_PROJECT_API_KEY') ||
      Deno.env.get('DASHSCOPE_API_KEY') ||
      '';
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'AI 服务凭证未配置，请联系管理员' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }

    const body = await req.json();
    const message = String(body.message || '').trim();
    const history = Array.isArray(body.history) ? body.history : [];
    const page = String(body.page || '');
    const link = String(body.link || '').trim();
    const lang = String(body.lang || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh';
    const confirmToken = String(body.confirm_token || '').trim();
    const imageUrl = String(body.image_url || '').trim();
    const linkList = Array.isArray(body.link_list)
      ? body.link_list.map(String).map((s) => s.trim()).filter(Boolean)
      : [];

    // 鉴权
    const userId = await resolveUserId(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: '未登录或登录已过期，请重新登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    // ===== 高危确认分支 =====
    if (confirmToken) {
      const t0 = Date.now();
      const confirm = await confirmPendingAction(userId, confirmToken);
      await logConversation(userId, 'user', `[confirm] ${confirmToken}`, 'confirm_action');
      if (!confirm.ok) {
        await logConversation(userId, 'assistant', confirm.error, 'confirm_action', '失败', Date.now() - t0);
        return new Response(JSON.stringify({ reply: buildReply(lang, 'confirm_fail', confirm.error), intent: 'confirm_action', cards: [], actions: [] }), { headers: { 'Content-Type': 'application/json' } });
      }
      // 确认后跳转刊登/商品页（安全边界：仅跳转，绝不自动刊登）
      const actionPath = confirm.action_type === 'publish_preview' ? '/listing' : '/products';
      await logConversation(userId, 'assistant', buildReply(lang, 'confirm_ok'), 'confirm_action', '成功', Date.now() - t0);
      await logTool(userId, 'confirm_pending_action', { token: confirmToken }, `confirmed:${confirm.action_type}`, '成功', Date.now() - t0);
      return new Response(JSON.stringify({
        reply: buildReply(lang, 'confirm_ok'),
        intent: 'confirm_action',
        cards: [],
        actions: [{ type: 'jump', label: lang === 'en' ? 'Go to Listing' : '前往刊登页面', path: actionPath }],
        pending_confirm: null,
        cost: 0,
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // ===== 意图识别（规则优先） =====
    let intentResult = imageUrl
      ? { intent: 'image_draft', params: { image_url: imageUrl, text: message } }
      : (linkList.length > 1
        ? { intent: 'batch_collect', params: { urls: linkList } }
        : detectIntent(message, link, page));
    let usedLlm = false;

    // 未知意图 → LLM 兜底（扣 agent 积分）
    if (intentResult.intent === 'unknown' || intentResult.intent === 'faq') {
      const t0 = Date.now();
      const pricing = await adminClient().from('service_pricing').select('*').eq('service_key', 'agent').maybeSingle();
      const credits = pricing?.data && Number(pricing.data.credits_per_use) > 0
        ? Number(pricing.data.credits_per_use)
        : 2;
      const creditsBalance = await getPoolBalance(userId, 'agent');
      if (creditsBalance < credits) {
        return new Response(JSON.stringify({ reply: buildReply(lang, 'no_quota', String(credits), String(creditsBalance)), intent: 'unknown', cards: [], actions: [], cost: 0 }), { headers: { 'Content-Type': 'application/json' } });
      }
      const llm = await llmUnderstand(apiKey, message, history, lang);
      if (llm && llm.intent !== 'unknown') {
        intentResult = { intent: llm.intent, params: llm.params };
        usedLlm = true;
      } else {
        intentResult = { intent: 'faq', params: {} };
        usedLlm = true;
      }
      await deductFromPool(userId, 'agent', credits);
      await writeUsageLog(userId, 'agent', '对话智能助手', 0, '成功', credits);
    }

    // 记录用户消息
    await logConversation(userId, 'user', message, intentResult.intent, '成功', Date.now() - startTime);

    // ===== 工具执行 =====
    const cards: Record<string, unknown>[] = [];
    const actions: Record<string, unknown>[] = [];
    let reply = '';
    let pendingConfirm: Record<string, unknown> | null = null;
    const t0 = Date.now();
    const intent = intentResult.intent;
    const params = intentResult.params as Record<string, unknown>;

    try {
      if (intent === 'image_draft') {
        const imgUrl = String(params.image_url || '');
        if (!imgUrl) {
          reply = lang === 'en' ? 'Please upload a product image first.' : '请先上传商品图片。';
        } else {
          const pricing = await adminClient().from('service_pricing').select('*').eq('service_key', 'image_parse').maybeSingle();
          const costCredits = pricing?.data && Number(pricing.data.credits_per_use) > 0 ? Number(pricing.data.credits_per_use) : 4;
          const balance = await getPoolBalance(userId, 'agent');
          if (balance < costCredits) {
            reply = buildReply(lang, 'no_quota', String(costCredits), String(balance));
          } else {
            try {
              await deductFromPool(userId, 'agent', costCredits);
              await writeUsageLog(userId, 'image_parse', '图片解析生成刊登稿件', 0, '成功', costCredits);
              const draft = await imageToDraftTool(userId, imgUrl, String(params.text || ''), apiKey);
              cards.push({ type: 'image_draft_result', data: draft });
              reply = buildReply(lang, 'image_draft_ok', draft.name, String(draft.price), draft.currency || '', String(costCredits));
              actions.push({ type: 'jump', label: lang === 'en' ? 'Edit Draft' : '前往商品编辑页修改', path: `/products/${draft.draft_id}` });
              await logTool(userId, 'image_to_draft', { image_url: imgUrl }, `draft:${draft.name}`, '成功', Date.now() - t0);
            } catch (e2) {
              const msg = e2 instanceof Error ? e2.message : String(e2);
              reply = lang === 'en' ? `Image parse failed: ${msg}` : `图片解析失败：${msg}`;
              await logTool(userId, 'image_to_draft', { image_url: imgUrl }, msg, '失败', Date.now() - t0);
            }
          }
        }
      } else if (intent === 'collect') {
        const url = String(params.url || '');
        if (!url) {
          reply = lang === 'en' ? 'Please provide a product link.' : '请提供商品链接，我会帮你采集并生成草稿。';
        } else {
          try {
            const userToken = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
            const draft = await collectAndDraftTool(userId, url, userToken, projectUrlId, lang);
            cards.push({ type: 'collect_result', data: draft });
            reply = buildReply(lang, 'collect_done', draft.name, String(draft.price), draft.currency || '');
            actions.push({ type: 'jump', label: lang === 'en' ? 'Edit Draft' : '前往商品编辑页修改', path: `/products/${draft.draft_id}` });
            await logTool(userId, 'collect_and_draft', { url }, `draft:${draft.name}`, '成功', Date.now() - t0);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            reply = buildReply(lang, 'collect_fail', msg);
            await logTool(userId, 'collect_and_draft', { url }, msg, '失败', Date.now() - t0);
          }
        }
      } else if (intent === 'batch_collect') {
        const urls = Array.isArray(params.urls) ? params.urls.filter(Boolean) : [];
        const results: Record<string, unknown>[] = [];
        let okCount = 0;
        let failCount = 0;
        const userToken = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
        for (const u of urls) {
          try {
            const d = await collectAndDraftTool(userId, u, userToken, projectUrlId, lang);
            results.push({ ...d, ok: true });
            okCount++;
          } catch (e2) {
            results.push({ name: (e2 instanceof Error ? e2.message : String(e2)).slice(0, 80), ok: false });
            failCount++;
          }
        }
        cards.push({ type: 'batch_collect_result', data: { items: results, ok: okCount, fail: failCount } });
        reply = buildReply(lang, 'batch_collect_done', String(urls.length), String(okCount), String(failCount), String(okCount * 3));
        actions.push({ type: 'jump', label: lang === 'en' ? 'Go to Products' : '前往商品管理查看草稿', path: '/products' });
        await logTool(userId, 'batch_collect', { count: urls.length }, `ok:${okCount} fail:${failCount}`, '成功', Date.now() - t0);
      } else if (intent === 'query_shops') {
        const r = await queryShopsTool(userId, lang);
        cards.push({ type: 'shops', data: r });
        reply = buildReply(lang, 'query_shops', String(r.shops.length), String(r.totalSales), String(r.totalOrders));
        actions.push({ type: 'jump', label: lang === 'en' ? 'Shop Auth Page' : '前往店铺管理', path: '/shops' });
        await logTool(userId, 'query_shops', {}, `${r.shops.length} shops`, '成功', Date.now() - t0);
      } else if (intent === 'query_sales_analysis') {
        const days = Math.max(1, Math.min(365, Number(params.days) || 30));
        const r = await salesAnalysisTool(userId, days);
        cards.push({ type: 'sales_analysis', data: r });
        const changeText = r.changePercent === null
          ? (lang === 'en' ? 'no previous-period comparison' : '无上期对比数据')
          : (r.changePercent >= 0
            ? (lang === 'en' ? `up ${r.changePercent.toFixed(1)}% vs prev` : `环比上升 ${r.changePercent.toFixed(1)}%`)
            : (lang === 'en' ? `down ${Math.abs(r.changePercent).toFixed(1)}% vs prev` : `环比下降 ${Math.abs(r.changePercent).toFixed(1)}%`));
        reply = buildReply(lang, 'query_sales_analysis', String(days), String(r.orderCount), `¥${Number(r.totalAmount).toFixed(2)}`, String(Number(r.avgPerDay).toFixed(2)), changeText);
        actions.push({ type: 'jump', label: lang === 'en' ? 'Full Report' : '跳转数据报表页面查看完整报表', path: '/reports' });
        await logTool(userId, 'query_sales_analysis', { days }, `orders:${r.orderCount} amount:${Number(r.totalAmount).toFixed(2)}`, '成功', Date.now() - t0);
      } else if (intent === 'query_orders') {
        const days = Math.max(1, Math.min(365, Number(params.days) || 30));
        const r = await queryOrdersTool(userId, days);
        cards.push({ type: 'orders', data: r });
        reply = buildReply(lang, 'query_orders', String(days), String(r.orderCount), `¥${Number(r.totalAmount).toFixed(2)}`);
        actions.push({ type: 'jump', label: lang === 'en' ? 'Full Report' : '跳转数据报表页面查看完整报表', path: '/reports' });
        await logTool(userId, 'query_orders', { days }, `${r.orderCount} orders`, '成功', Date.now() - t0);
      } else if (intent === 'query_products') {
        const r = await queryProductsTool(userId, params.status ? String(params.status) : null);
        cards.push({ type: 'products', data: r });
        const draftCount = r.byStatus['草稿'] || 0;
        const listedCount = r.byStatus['在售'] || 0;
        reply = buildReply(lang, 'query_products', String(r.products.length), r.filter || '全部', String(draftCount), String(listedCount));
        actions.push({ type: 'jump', label: lang === 'en' ? 'Go to Products' : '前往商品管理', path: '/products' });
        await logTool(userId, 'query_products', { status: r.filter }, `${r.products.length} products`, '成功', Date.now() - t0);
      } else if (intent === 'query_quota') {
        const r = await queryQuotaTool(userId);
        cards.push({ type: 'quota', data: r });
        reply = buildReply(lang, 'query_quota', String(r.credits), r.plan_name || '');
        actions.push({ type: 'jump', label: lang === 'en' ? 'Recharge' : '前往充值/订阅', path: '/subscription' });
        await logTool(userId, 'query_quota', {}, `${r.credits} credits`, '成功', Date.now() - t0);
      } else if (intent === 'query_auth_expiring') {
        const r = await queryAuthExpiringTool(userId);
        cards.push({ type: 'auth_expiring', data: r });
        reply = buildReply(lang, 'query_auth_expiring', String(r.total));
        actions.push({ type: 'jump', label: lang === 'en' ? 'Go to Shop Auth' : '前往店铺授权页面续期', path: '/auth' });
        await logTool(userId, 'query_auth_expiring', {}, `${r.items.length} records`, '成功', Date.now() - t0);
      } else if (intent === 'jump') {
        const path = resolvePage(String(params.path || ''));
        if (path) {
          const pageName = path.replace(/^\//, '');
          reply = buildReply(lang, 'jump_ok', pageName);
          actions.push({ type: 'jump', label: lang === 'en' ? 'Go' : '立即前往', path });
          await logTool(userId, 'jump', { path }, 'ok', '成功', Date.now() - t0);
        } else {
          reply = lang === 'en' ? 'Which page? e.g. products, orders, auth, subscription, reports.' : '请问要去哪个页面？例如：商品管理、订单、店铺授权、订阅充值、数据报表。';
        }
      } else if (intent === 'publish_preview') {
        const created = await createPublishPreview(userId, message);
        pendingConfirm = {
          token: created.token,
          title: lang === 'en' ? 'Publish Confirmation' : '⚠️ 高危操作确认',
          detail: lang === 'en'
            ? 'Publishing goes live on the marketplace. I will NOT auto-publish. Confirm to go to the listing page for manual review.'
            : '刊登将商品发布到电商平台，属于不可逆的高危操作。我不会自动执行。确认后将带你到刊登页面，请人工核对后再操作。',
          confirm_label: lang === 'en' ? 'Confirm & Go' : '确认刊登',
          cancel_label: lang === 'en' ? 'Cancel' : '取消',
        };
        reply = buildReply(lang, 'publish_preview');
        await logTool(userId, 'publish_preview', {}, 'pending confirm created', '成功', Date.now() - t0);
      } else if (intent === 'faq') {
        reply = lang === 'en'
          ? 'I can help with: shop list, orders/sales, product drafts, AI credits, expiring authorizations, collecting a link into a draft, and page navigation. Publishing is always manual after confirmation.'
          : '我可以帮你：查询店铺、订单/销售、商品草稿、AI 积分、授权到期，粘贴商品链接采集生成草稿，以及页面跳转。刊登类高危操作需要你人工确认后才会跳转处理。';
        await logTool(userId, 'faq', {}, 'answered', '成功', Date.now() - t0);
      } else {
        reply = buildReply(lang, 'unknown');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      reply = lang === 'en' ? `Something went wrong: ${msg}` : `执行失败：${msg}`;
      await logTool(userId, intent, params, msg, '失败', Date.now() - t0);
    }

    // 记录助手回复
    await logConversation(userId, 'assistant', reply, intent, '成功', Date.now() - startTime);

    console.info(`[${functionName}] done ${requestId} userId=${userId.slice(0, 8)} intent=${intent} llm=${usedLlm} durationMs=${Date.now() - startTime}`);

    return new Response(JSON.stringify({
      reply,
      cards,
      actions,
      pending_confirm: pendingConfirm,
      intent,
      cost: usedLlm ? 2 : 0,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    console.error(`[${functionName}] failed ${requestId}: ${message}`);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
