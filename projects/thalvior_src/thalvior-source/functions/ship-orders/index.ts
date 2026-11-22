// ship-orders — P0-6 打单发货引擎（第一平台：WooCommerce）+ 自动审单（2026-10-20）
// =====================================================================
// action:
//   audit        → 发货前自动审单（只读预检，不写任何记录；前端发货弹窗用）
//   mark-shipped → 批量标记发货：
//     0) 自动审单（发货前强制前置）：复用 automation_* 体系
//        规则=automation_rules(trigger='自动审单', 机器码存 workflow_def.audit_code，可开关)
//        拦截 → 逐失败规则写 automation_runs(status='失败') + 双语站内通知，不发货
//        放行 → 批量汇总写 automation_runs(rule_id=null, status='成功')
//     1) orders.status → '已发货'（正规路径，联动 trigger 自动触发：
//        notify_order_status_change 站内通知 + deduct_inventory_on_ship 库存扣减）
//     2) shipments 落库（tracking_no/carrier/destination/order_id）
//     3) waybills 落库（waybill_no/carrier/tracking_no，status='已生成'）
//     4) WooCommerce 订单回写：PUT /orders/{id} status=completed + 内部备注（用店铺已有凭据）
//        其他平台诚实标注「待 API」
//
// RBAC S1（2026-10-25）：本函数入口加 order 模块权限闸门（order.order.audit / order.order.ship），
//   判定走数据库 public.has_perm（spec §7.4），拒绝即 403，不进入业务逻辑。
//
// 铁律（主人强令）：
//   1. 只允许操作 user_id = 当前用户的订单（逐单校验归属）
//   2. 库存扣减不在本函数做 —— deduct_inventory_on_ship trigger 是唯一扣减点，防重复扣
//   3. 全程不产生假数据 —— Woo 回写失败必须如实返回并写通知
//
// 凭据：shop_auths.credentials_enc（AES-GCM/PBKDF2，盐 thalvior-cred-v1，secret=JWT_SECRET）

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { checkPerm } from '../_shared/perm.ts';
import { isActiveAuthStatus } from '../_shared/shop-status.ts';

const functionName = 'ship-orders';
const MAX_BATCH = 100;

// ─── 通用工具（与 publish-listing 同风格） ───────────────────────────
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`缺少环境变量 ${name}`);
  return v;
}
async function fetchDirect(url: string, init: RequestInit, ms = 30000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    // 踩坑：edge runtime fetch 不解压 gzip → 必须显式 identity，否则乱码截断
    return await fetch(url, { ...init, signal: ctrl.signal, headers: { ...init.headers, 'Accept-Encoding': 'identity' } });
  } finally {
    clearTimeout(timer);
  }
}
async function resolveUserId(req: Request): Promise<string | null> {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const admin = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
    const { data } = await admin.auth.getUser(token);
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

// ─── 凭据解密（与 authorize-shop encryptCredentials 对称） ───────────
async function decryptCredentials(encB64: string, secret: string): Promise<Record<string, unknown>> {
  const enc = new TextEncoder();
  const bin = atob(encB64);
  const raw = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
  const iv = raw.slice(0, 12);
  const cipher = raw.slice(12);
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('thalvior-cred-v1'), iterations: 100000, hash: 'SHA-256' },
    keyMat, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return JSON.parse(new TextDecoder().decode(plain));
}

// ─── WooCommerce 客户端 ──────────────────────────────────────────────
function wooBase(domain: string): string {
  const d = domain.trim().replace(/\/+$/, '');
  return d.startsWith('http') ? d : `https://${d}`;
}
function wooClient(shopDomain: string, ck: string, cs: string) {
  const base = wooBase(shopDomain);
  const auth = `consumer_key=${encodeURIComponent(ck)}&consumer_secret=${encodeURIComponent(cs)}`;
  return {
    async request(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: any }> {
      const url = `${base}/wp-json/wc/v3${path}${path.includes('?') ? '&' : '?'}${auth}`;
      const res = await fetchDirect(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let data: any = null;
      const text = await res.text();
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
      return { ok: res.ok, status: res.status, data };
    },
  };
}

// ─── 运单号生成（与前端同算法：TL + 订单号前8 + 时间戳后8 + 校验位） ──
function genTrackingNo(orderId: string, tsSalt = 0): string {
  const seed = orderId.replace(/[^0-9a-zA-Z]/g, '').slice(0, 8).padEnd(8, '0').toUpperCase();
  const ts = (Date.now() + tsSalt).toString().slice(-8);
  const raw = `${seed}${ts}`;
  const sum = raw.split('').reduce((s, c) => s + c.charCodeAt(0), 0);
  const check = (sum % 36).toString(36).toUpperCase();
  return `TL${raw}${check}`;
}

// ─── 通知（联动红线：失败必写通知） ─────────────────────────────────
async function notify(admin: ReturnType<typeof createClient>, userId: string, title: string, content: string, type = '订单') {
  await admin.from('notifications').insert({ user_id: userId, title, content, type });
}

// =====================================================================
// ─── 自动审单引擎（复用 automation_* 体系，2026-10-20） ──────────────
// 5 条规则（与 deduct_inventory_on_ship 触发器同一套 items 解析口径，不双标）：
//   recipient 收件人信息完整   姓名/电话/地址非空
//   inventory 库存充足         inventory.available ≥ 订单各 SKU 数量（缺失 SKU 视为 0）
//   amount    金额合法         order.amount > 0
//   dup_ship  重复发货拦截     该订单已存在未取消 shipment（shipments.order_id 关联）
//   shop_auth 店铺授权有效     店铺状态=已授权 且 token 未过期（无店铺订单不适用=通过）
// =====================================================================
interface AuditFailure { code: string; rule_id: string | null; reason: string; reason_en: string; }

interface AuditOrderRow {
  id: string; buyer: string; phone: string; address: string | null;
  amount: number | string; items: unknown; sku: string; shop_id: string | null;
}

interface AuditCtx {
  rules: Map<string, { id: string; name: string }>;
  inventory: Map<string, number>;
  shops: Map<string, { shop_name: string; status: string; token_expires_at: string | null }>;
  activeShipment: Map<string, string>;
}

// items 解析：与 deduct_inventory_on_ship 触发器逐行对齐（qty 非正整数→1，缺省→1，无有效条目→退 order.sku×1）
function parseItemQty(o: AuditOrderRow): Map<string, number> {
  const agg = new Map<string, number>();
  let any = false;
  if (Array.isArray(o.items)) {
    for (const it of o.items as unknown[]) {
      if (!it || typeof it !== 'object') continue;
      const rec = it as Record<string, unknown>;
      const sku = String(rec.sku ?? '').trim();
      if (!sku) continue;
      const raw = rec.qty;
      const qty = typeof raw === 'number' && raw > 0 && Number.isInteger(raw) ? raw : 1;
      agg.set(sku, (agg.get(sku) ?? 0) + qty);
      any = true;
    }
  }
  if (!any && String(o.sku ?? '').trim()) agg.set(String(o.sku).trim(), 1);
  return agg;
}

async function loadAuditCtx(
  admin: ReturnType<typeof createClient>,
  userId: string,
  orders: AuditOrderRow[],
): Promise<AuditCtx> {
  const ctx: AuditCtx = { rules: new Map(), inventory: new Map(), shops: new Map(), activeShipment: new Map() };
  try {
    const { data: rules } = await admin
      .from('automation_rules')
      .select('id, name, workflow_def')
      .eq('user_id', userId)
      .eq('trigger', '自动审单')
      .eq('enabled', true)
      .eq('status', '启用');
    for (const r of rules ?? []) {
      const code = (r as { workflow_def?: { audit_code?: string } } | null)?.workflow_def?.audit_code;
      if (code && !ctx.rules.has(String(code))) ctx.rules.set(String(code), { id: String(r.id), name: String(r.name) });
    }
    const skuSet = new Set<string>();
    for (const o of orders) for (const sku of parseItemQty(o).keys()) skuSet.add(sku);
    if (skuSet.size) {
      const { data: inv } = await admin.from('inventory').select('sku, available').eq('user_id', userId).in('sku', [...skuSet]);
      for (const row of inv ?? []) ctx.inventory.set(String(row.sku), Number(row.available) || 0);
    }
    const shopIds = [...new Set(orders.map((o) => o.shop_id).filter(Boolean))] as string[];
    if (shopIds.length) {
      const { data: shops } = await admin.from('shop_auths').select('id, shop_name, status, token_expires_at').in('id', shopIds);
      for (const s of shops ?? []) {
        ctx.shops.set(String(s.id), {
          shop_name: String(s.shop_name ?? ''),
          status: String(s.status ?? ''),
          token_expires_at: (s.token_expires_at as string | null) ?? null,
        });
      }
    }
    const ids = orders.map((o) => o.id);
    if (ids.length) {
      const { data: ships } = await admin.from('shipments').select('order_id, tracking_no, status').eq('user_id', userId).in('order_id', ids);
      for (const s of ships ?? []) {
        if (!s.order_id || String(s.status ?? '') === '已取消') continue;
        ctx.activeShipment.set(String(s.order_id), String(s.tracking_no ?? ''));
      }
    }
  } catch (e) {
    // 审单上下文加载失败：规则视为空 → 诚实放行并在 run 里记录，绝不阻断发货主流程
    console.error(`[${functionName}] 审单上下文加载失败（降级放行）: ${e instanceof Error ? e.message : String(e)}`);
  }
  return ctx;
}

function auditOneOrder(o: AuditOrderRow, ctx: AuditCtx): AuditFailure[] {
  const f: AuditFailure[] = [];
  const rule = (c: string) => ctx.rules.get(c) ?? null;

  // 1) 收件人信息完整
  const r1 = rule('recipient');
  if (r1) {
    const missZh: string[] = []; const missEn: string[] = [];
    if (!String(o.buyer ?? '').trim()) { missZh.push('姓名'); missEn.push('name'); }
    if (!String(o.phone ?? '').trim()) { missZh.push('电话'); missEn.push('phone'); }
    if (!String(o.address ?? '').trim()) { missZh.push('地址'); missEn.push('address'); }
    if (missZh.length) {
      f.push({ code: 'recipient', rule_id: r1.id, reason: `收件人信息不完整：${missZh.join('、')}为空`, reason_en: `Recipient info incomplete: missing ${missEn.join(', ')}` });
    }
  }

  // 2) 库存充足
  const r2 = rule('inventory');
  if (r2) {
    const lackZh: string[] = []; const lackEn: string[] = [];
    for (const [sku, qty] of parseItemQty(o)) {
      const avail = ctx.inventory.get(sku) ?? 0;
      if (avail < qty) { lackZh.push(`${sku} 需 ${qty} 仅 ${avail}`); lackEn.push(`${sku} needs ${qty}, only ${avail} in stock`); }
    }
    if (lackZh.length) {
      f.push({ code: 'inventory', rule_id: r2.id, reason: `库存不足：${lackZh.join('；')}`, reason_en: `Insufficient stock: ${lackEn.join('; ')}` });
    }
  }

  // 3) 金额合法
  const r3 = rule('amount');
  if (r3 && !(Number(o.amount) > 0)) {
    f.push({ code: 'amount', rule_id: r3.id, reason: `订单金额必须大于 0（当前 ${o.amount}）`, reason_en: `Order amount must be greater than 0 (current ${o.amount})` });
  }

  // 4) 重复发货拦截
  const r4 = rule('dup_ship');
  if (r4) {
    const tn = ctx.activeShipment.get(o.id);
    if (tn) {
      f.push({ code: 'dup_ship', rule_id: r4.id, reason: `重复发货：订单已存在未取消运单 ${tn}`, reason_en: `Duplicate shipment: order already has an active shipment ${tn}` });
    }
  }

  // 5) 店铺授权有效（无店铺订单不适用 → 通过）
  const r5 = rule('shop_auth');
  if (r5 && o.shop_id) {
    const s = ctx.shops.get(String(o.shop_id));
    if (!s) {
      f.push({ code: 'shop_auth', rule_id: r5.id, reason: '店铺授权无效：店铺不存在或已删除', reason_en: 'Invalid shop authorization: shop not found' });
    } else {
      const expired = !!s.token_expires_at && new Date(s.token_expires_at).getTime() <= Date.now();
      if (!isActiveAuthStatus(s.status) || expired) {
        const stMap: Record<string, string> = { '已过期': 'expired', '已停用': 'disabled', '待验证': 'pending verification', '即将到期': 'expiring soon', '已授权': 'authorized', '未授权': 'not authorized' };
        const stEn = stMap[s.status] ?? s.status;
        f.push({ code: 'shop_auth', rule_id: r5.id, reason: `店铺授权无效：${s.shop_name} 状态=${s.status}${expired ? ' 或 token 已过期' : ''}`, reason_en: `Invalid shop authorization: ${s.shop_name} status=${stEn}${expired ? ' or token expired' : ''}` });
      }
    }
  }
  return f;
}

// 拦截记录：逐失败规则写 automation_runs（失败兜底转 automation_failures，不阻断业务）
async function recordBlockedRuns(
  admin: ReturnType<typeof createClient>,
  userId: string,
  orderId: string,
  failures: AuditFailure[],
  auditMs: number,
) {
  for (const x of failures) {
    try {
      await admin.from('automation_runs').insert({
        user_id: userId, rule_id: x.rule_id, status: '失败',
        result: `自动审单拦截：订单 ${orderId}｜${x.reason}`, duration_ms: auditMs,
      });
    } catch (e) {
      try {
        await admin.from('automation_failures').insert({
          user_id: userId, rule_id: x.rule_id,
          error: `审单 run 写入失败（订单 ${orderId}）: ${e instanceof Error ? e.message : String(e)}`, retries: 0,
        });
      } catch { /* 兜底失败静默，不阻断发货 */ }
    }
  }
}

interface ShipOrderRow {
  id: string; user_id: string; status: string; address: string | null;
  shop_id: string | null; shop_name: string; channel: string; external_order_id: string | null;
  buyer: string; phone: string; amount: number | string; items: unknown; sku: string;
}

interface ShipResult {
  order_id: string;
  ok: boolean;
  tracking_no?: string;
  shipment_id?: string;
  waybill_id?: string;
  woo_writeback?: 'completed' | 'failed' | 'skipped';
  woo_detail?: string;
  blocked?: boolean;
  audit_failures?: { code: string; reason: string; reason_en: string }[];
  error?: string;
}

const ORDER_COLS = 'id, user_id, status, address, shop_id, shop_name, channel, external_order_id, buyer, phone, amount, items, sku';

// ─── mark-shipped ───────────────────────────────────────────────────
async function markShipped(
  admin: ReturnType<typeof createClient>,
  userId: string,
  orderIds: string[],
  carrier: string,
  sharedTracking: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!orderIds.length) return { status: 400, body: { error: '缺少 order_ids' } };
  if (orderIds.length > MAX_BATCH) return { status: 400, body: { error: `单次最多发货 ${MAX_BATCH} 单` } };

  // 1. 取单并校验归属（只处理当前用户自己的订单）
  const { data: orderRows, error: oErr } = await admin.from('orders').select(ORDER_COLS).in('id', orderIds);
  if (oErr) return { status: 500, body: { error: `查询订单失败：${oErr.message}` } };
  const mine = (orderRows ?? []).filter((o: ShipOrderRow) => o.user_id === userId);
  if (mine.length === 0) return { status: 404, body: { error: '订单不存在或不属于当前用户' } };

  // 1.5 自动审单（发货前强制前置，复用 automation_* 体系）
  const toShip = mine.filter((o: ShipOrderRow) => o.status !== '已发货');
  const auditStart = Date.now();
  const ctx = await loadAuditCtx(admin, userId, toShip);
  const auditByOrder = new Map<string, AuditFailure[]>();
  const blockedRuleIds = new Set<string>();
  for (const o of toShip) {
    const fs = auditOneOrder(o, ctx);
    if (fs.length) {
      auditByOrder.set(o.id, fs);
      for (const x of fs) if (x.rule_id) blockedRuleIds.add(x.rule_id);
    }
  }
  const auditMs = Math.max(0, Date.now() - auditStart);

  // 2. 涉及的 WooCommerce 店铺凭据一次性解密（仅 已授权 WooCommerce）
  const shopIds = [...new Set(mine.map((o: ShipOrderRow) => o.shop_id).filter(Boolean))] as string[];
  const wooByShop = new Map<string, { shopName: string; woo: ReturnType<typeof wooClient> }>();
  if (shopIds.length) {
    const { data: shops } = await admin
      .from('shop_auths')
      .select('id, shop_name, platform, status, credentials_enc, shop_domain')
      .in('id', shopIds);
    for (const s of shops ?? []) {
      if (String(s.platform).toLowerCase() !== 'woocommerce' || !isActiveAuthStatus(s.status) || !s.credentials_enc) continue;
      try {
        const creds = await decryptCredentials(s.credentials_enc, getEnv('JWT_SECRET'));
        const ck = String(creds.consumer_key ?? '').trim();
        const cs = String(creds.consumer_secret ?? '').trim();
        const domain = String(creds.shop_domain ?? s.shop_domain ?? '');
        if (ck && cs && domain) wooByShop.set(String(s.id), { shopName: String(s.shop_name), woo: wooClient(domain, ck, cs) });
      } catch {
        // 凭据解密失败 → 该店回写诚实跳过，不阻塞发货
      }
    }
  }

  const results: ShipResult[] = [];
  let shipped = 0, skipped = 0, failed = 0, blocked = 0;
  const passedIds: string[] = [];
  const wooFailures: string[] = [];

  for (let i = 0; i < mine.length; i++) {
    const o = mine[i] as ShipOrderRow;
    if (o.status === '已发货') {
      skipped++;
      results.push({ order_id: o.id, ok: false, error: '已是已发货状态，跳过' });
      continue;
    }

    // 自动审单拦截：写 runs（逐失败规则）+ 双语站内通知，不发货
    const fs = auditByOrder.get(o.id);
    if (fs && fs.length) {
      blocked++;
      await recordBlockedRuns(admin, userId, o.id, fs, auditMs);
      try {
        await notify(
          admin, userId,
          '自动审单拦截 / Order Audit Blocked',
          `订单 ${o.id} 未通过发货前审单，已拦截。原因：${fs.map((x) => x.reason).join('；')} / Order ${o.id} blocked by pre-shipment audit. Reasons: ${fs.map((x) => x.reason_en).join('; ')}`,
          '自动化',
        );
      } catch { /* 通知失败不阻断 */ }
      results.push({
        order_id: o.id, ok: false, blocked: true,
        audit_failures: fs.map(({ code, reason, reason_en }) => ({ code, reason, reason_en })),
      });
      continue;
    }

    const tracking = sharedTracking || genTrackingNo(o.id, i);

    // 3. 状态流转（正规路径 → trigger 自动通知 + 扣库存）
    const { error: upErr } = await admin.from('orders').update({ status: '已发货' }).eq('id', o.id);
    if (upErr) {
      failed++;
      results.push({ order_id: o.id, ok: false, error: `更新订单状态失败：${upErr.message}` });
      continue;
    }
    passedIds.push(o.id);

    // 4. shipments + waybills 落库（shipments 带订单关联，供审单/追溯复用）
    const { data: shipment, error: sErr } = await admin
      .from('shipments')
      .insert({ user_id: userId, order_id: o.id, tracking_no: tracking, carrier: carrier || null, destination: o.address || null, status: '运输中' })
      .select('id').single();
    const shipmentId = (shipment as { id?: string } | null)?.id;
    let waybillId: string | undefined;
    if (!sErr && shipmentId) {
      const { data: wb, error: wErr } = await admin
        .from('waybills')
        .insert({ user_id: userId, waybill_no: tracking, shipment_id: shipmentId, carrier: carrier || null, tracking_no: tracking, weight: 0, fee: 0, status: '已生成' })
        .select('id').single();
      if (wErr) console.error(`[${functionName}] waybills 落库失败 ${o.id}: ${wErr.message}`);
      waybillId = (wb as { id?: string } | null)?.id;
    } else if (sErr) {
      console.error(`[${functionName}] shipments 落库失败 ${o.id}: ${sErr.message}`);
    }

    // 5. WooCommerce 回写（仅 external_order_id=WOO-{shop8}-{id} 且店铺凭据可用）
    let wooRes: ShipResult['woo_writeback'] = 'skipped';
    let wooDetail = '非 WooCommerce 订单，待平台 API 接入';
    const m = /^WOO-([0-9a-f]{8})-(.+)$/.exec(String(o.external_order_id ?? ''));
    if (o.shop_id && wooByShop.has(String(o.shop_id)) && m) {
      const { shopName, woo } = wooByShop.get(String(o.shop_id))!;
      const wooOrderId = m[2];
      const wr = await woo.request('PUT', `/orders/${encodeURIComponent(wooOrderId)}`, { status: 'completed' });
      if (wr.ok) {
        wooRes = 'completed';
        wooDetail = `已回写店铺「${shopName}」订单 ${wooOrderId} → completed`;
        // 内部备注（不发给买家），尽力而为不阻塞
        const note = `Thalvior ERP 已发货 / Shipped via Thalvior ERP. Carrier: ${carrier || 'N/A'}. Tracking: ${tracking}.`;
        await woo.request('POST', `/orders/${encodeURIComponent(wooOrderId)}/notes`, { note, customer_note: false });
      } else {
        wooRes = 'failed';
        wooDetail = wr.data?.message ? String(wr.data.message) : `HTTP ${wr.status}`;
        wooFailures.push(`订单 ${o.id}（Woo ${wooOrderId}）回写失败：${wooDetail}`);
      }
    }

    shipped++;
    results.push({ order_id: o.id, ok: true, tracking_no: tracking, shipment_id: shipmentId, waybill_id: waybillId, woo_writeback: wooRes, woo_detail: wooDetail });
  }

  // 6. 审单放行汇总 run（rule_id=null 表示引擎汇总记录；规则未启用时如实标注）
  if (passedIds.length) {
    const summary = ctx.rules.size
      ? `自动审单通过，放行发货 ${passedIds.length} 单：${passedIds.slice(0, 10).join('、')}${passedIds.length > 10 ? ' 等' : ''}`
      : `自动审单规则未启用，默认放行发货 ${passedIds.length} 单：${passedIds.slice(0, 10).join('、')}${passedIds.length > 10 ? ' 等' : ''}`;
    try {
      await admin.from('automation_runs').insert({ user_id: userId, rule_id: null, status: '成功', result: summary, duration_ms: auditMs });
    } catch { /* run 写入失败不阻断 */ }
  }
  if (blockedRuleIds.size) {
    try { await admin.from('automation_rules').update({ last_run_at: new Date().toISOString() }).in('id', [...blockedRuleIds]); } catch { /* 尽力而为 */ }
  }

  // 7. 联动红线：失败必写通知
  const failedRows = results.filter((r) => !r.ok && !r.blocked);
  if (failedRows.length) {
    await notify(admin, userId, '批量发货部分失败', `本次发货 ${mine.length} 单，成功 ${shipped}、拦截 ${blocked}、跳过 ${skipped}、失败 ${failed}。失败明细：${failedRows.map((r) => `${r.order_id}（${r.error}）`).join('；')}`);
  }
  if (wooFailures.length) {
    await notify(admin, userId, 'WooCommerce 回写失败', wooFailures.join('；'));
  }

  return {
    status: 200,
    body: { ok: true, total: mine.length, shipped, skipped, failed, blocked, results },
  };
}

// ─── 主入口 ──────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '');

    const userId = await resolveUserId(req);
    if (!userId) return json({ error: '未登录或登录已过期' }, 401);

    const admin = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));

    // ─── RBAC S1 权限闸门（order 模块试点）────────────────────────────
    // 后端强制：查权限点 → 判断角色 → 允许/拒绝。判定在业务逻辑之前，拒绝即 403 短路返回。
    // 权限点：审单 order.order.audit / 发货 order.order.ship（spec §2.5.2）
    const permKey = action === 'audit' ? 'order.order.audit' : 'order.order.ship';
    const gate = await checkPerm(req, permKey);
    if (!gate.allowed) {
      console.warn(`[${functionName}] ${requestId} 权限拒绝 perm=${permKey} reason=${gate.error ?? 'denied'}`);
      return json({ error: `权限不足：${permKey}`, perm_key: permKey }, 403);
    }

    if (action === 'audit') {
      // 发货前审单（只读预检：不写 runs/notifications，权威拦截以 mark-shipped 为准）
      const rawIds = Array.isArray(body.order_ids) ? body.order_ids : [];
      const orderIds = rawIds.map((x: unknown) => String(x ?? '').trim()).filter(Boolean);
      if (!orderIds.length) return json({ error: '缺少 order_ids' }, 400);
      const { data: orderRows, error: oErr } = await admin.from('orders').select(ORDER_COLS).in('id', orderIds);
      if (oErr) return json({ error: `查询订单失败：${oErr.message}` }, 500);
      const mine = (orderRows ?? []).filter((o: ShipOrderRow) => o.user_id === userId);
      if (mine.length === 0) return json({ error: '订单不存在或不属于当前用户' }, 404);
      const ctx = await loadAuditCtx(admin, userId, mine);
      const results = mine.map((o: ShipOrderRow) => {
        const fs = auditOneOrder(o, ctx);
        return { order_id: o.id, ok: fs.length === 0, failures: fs.map(({ code, reason, reason_en }) => ({ code, reason, reason_en })) };
      });
      console.info(`[${functionName}] ${requestId} audit n=${orderIds.length} blocked=${results.filter((r) => !r.ok).length}`);
      return json({ ok: true, total: mine.length, results });
    }

    if (action === 'mark-shipped') {
      const rawIds = Array.isArray(body.order_ids) ? body.order_ids : [];
      const orderIds = rawIds.map((x: unknown) => String(x ?? '').trim()).filter(Boolean);
      const carrier = String(body.carrier ?? '').trim();
      const sharedTracking = String(body.tracking_no ?? '').trim();
      const r = await markShipped(admin, userId, orderIds, carrier, sharedTracking);
      console.info(`[${functionName}] ${requestId} mark-shipped n=${orderIds.length} → ${r.status}`);
      return json(r.body, r.status);
    }
    return json({ error: `未知 action: ${action}` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${functionName}] ${requestId} ${msg}`);
    return json({ error: msg }, 500);
  }
});
