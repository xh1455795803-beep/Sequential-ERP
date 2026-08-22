// 订单路由：创建（预占库存）+ 状态机流转（支付/发货/完成/取消）
const express = require('express');
const ledger = require('../inventory-ledger');
const { query, withTransaction } = require('../db');
const { PLANS, generateOrderNo, isTenantExpired } = require('../util');

const router = express.Router();

// 状态机：允许的流转路径
const TRANSITIONS = {
  pay:      { from: ['PENDING'],   to: 'PAID' },
  ship:     { from: ['PAID'],      to: 'SHIPPED' },
  complete: { from: ['SHIPPED'],   to: 'COMPLETED' },
  cancel:   { from: ['PENDING', 'PAID'], to: 'CANCELLED' }
};

const STATUS_LABELS = {
  PENDING: '待付款', PAID: '已付款', SHIPPED: '已发货', COMPLETED: '已完成', CANCELLED: '已取消'
};

router.get('/', async (req, res, next) => {
  try {
    const { status } = req.query;
    const params = [req.user.tenantId];
    let where = 'WHERE o.tenant_id = ?';
    if (status) { where += ' AND o.status = ?'; params.push(status); }
    const rows = await query(
      `SELECT o.*, s.name AS shop_name, sh.tracking_no, sh.shipping_cost, c.name AS carrier_name,
              (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
       FROM orders o
       LEFT JOIN shops s ON s.tenant_id = o.tenant_id AND s.id = o.shop_id
       LEFT JOIN shipments sh ON sh.tenant_id = o.tenant_id AND sh.order_id = o.id
       LEFT JOIN carriers c ON c.tenant_id = o.tenant_id AND c.id = sh.carrier_id
       ${where}
       GROUP BY o.id ORDER BY o.id DESC LIMIT 200`,
      params
    );
    res.json({ items: rows });
  } catch (err) { next(err); }
});

// 发货记录列表（订单 + 发运单 + 物流商联查）
router.get('/shipments/list', async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT sh.id, sh.tracking_no, sh.shipping_cost, sh.created_at AS shipped_at,
              o.id AS order_id, o.order_no, o.buyer_name, o.country, o.status AS order_status, o.total_amount,
              c.name AS carrier_name, c.tracking_url
       FROM shipments sh
       JOIN orders o ON o.tenant_id = sh.tenant_id AND o.id = sh.order_id
       LEFT JOIN carriers c ON c.tenant_id = sh.tenant_id AND c.id = sh.carrier_id
       WHERE sh.tenant_id = ? ORDER BY sh.id DESC LIMIT 200`,
      [req.user.tenantId]
    );
    res.json({ items: rows });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const orders = await query(
      `SELECT o.*, s.name AS shop_name FROM orders o
       LEFT JOIN shops s ON s.tenant_id = o.tenant_id AND s.id = o.shop_id
       WHERE o.tenant_id = ? AND o.id = ?`,
      [req.user.tenantId, req.params.id]
    );
    if (!orders.length) return res.status(404).json({ error: '订单不存在' });
    const items = await query(
      `SELECT oi.*, p.sku, p.name FROM order_items oi
       JOIN products p ON p.tenant_id = oi.tenant_id AND p.id = oi.product_id
       WHERE oi.order_id = ?`,
      [req.params.id]
    );
    res.json({ item: { ...orders[0], items } });
  } catch (err) { next(err); }
});

// 创建订单：校验套餐月单量 → 校验库存 → 预占（reserved += qty）
router.post('/', async (req, res, next) => {
  try {
    const { shop_id, buyer_name, country, items } = req.body || {};
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: '订单至少包含一个商品行' });
    for (const it of items) {
      const q = parseInt(it.qty, 10);
      if (!it.product_id || !Number.isInteger(q) || q <= 0) {
        return res.status(400).json({ error: '商品行参数不合法（product_id + 正整数 qty）' });
      }
    }

    const tenants = await query('SELECT * FROM tenants WHERE id = ?', [req.user.tenantId]);
    const tenant = tenants[0];
    if (!tenant || tenant.status !== 'active') return res.status(403).json({ error: '租户状态异常，请联系客服' });
    if (isTenantExpired(tenant)) return res.status(403).json({ error: '体验/订阅已到期，请续费后继续使用' });
    const plan = PLANS[tenant.plan] || PLANS.trial;

    const monthCount = await query(
      'SELECT COUNT(*) AS c FROM orders WHERE tenant_id = ? AND created_at >= DATE_FORMAT(NOW(), "%Y-%m-01")',
      [req.user.tenantId]
    );
    if (monthCount[0].c >= plan.monthlyOrders) {
      return res.status(403).json({ error: `本月订单量已达套餐上限（${plan.name} ${plan.monthlyOrders === Infinity ? '不限' : plan.monthlyOrders + ' 单'}），请升级套餐` });
    }

    const order = await withTransaction(async conn => {
      // 逐行锁定库存并校验可用量
      for (const it of items) {
        const [inv] = await conn.query(
          `SELECT i.id, i.qty_on_hand, i.qty_reserved, p.sku, p.name FROM inventory i
           JOIN products p ON p.tenant_id = i.tenant_id AND p.id = i.product_id
           WHERE i.tenant_id = ? AND i.product_id = ? AND i.warehouse = 'MAIN' FOR UPDATE`,
          [req.user.tenantId, it.product_id]
        );
        if (!inv.length) throw Object.assign(new Error('商品不存在'), { status: 404 });
        const available = inv[0].qty_on_hand - inv[0].qty_reserved;
        if (available < it.qty) {
          throw Object.assign(new Error(`商品「${inv[0].name}」可用库存不足（可用 ${available}，需 ${it.qty}）`), { status: 400 });
        }
      }

      // 币种与汇率：取店铺币种 + 当前汇率（下单时点锁定）
      let currency = 'CNY', rate = 1;
      if (shop_id) {
        const [shops] = await conn.query('SELECT currency FROM shops WHERE tenant_id = ? AND id = ?', [req.user.tenantId, shop_id]);
        if (shops.length) currency = shops[0].currency || 'CNY';
      }
      if (currency !== 'CNY') {
        const [rates] = await conn.query('SELECT rate FROM exchange_rates WHERE code = ?', [currency]);
        rate = rates.length ? Number(rates[0].rate) : 1;
      }

      const total = items.reduce((s, it) => s + Number(it.unit_price || 0) * it.qty, 0);
      const orderNo = generateOrderNo();
      const [r] = await conn.query(
        'INSERT INTO orders (tenant_id, order_no, shop_id, status, total_amount, buyer_name, country, currency, exchange_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [req.user.tenantId, orderNo, shop_id || null, 'PENDING', total.toFixed(2), buyer_name || null, country || null, currency, rate]
      );
      for (const it of items) {
        await conn.query(
          'INSERT INTO order_items (tenant_id, order_id, product_id, qty, unit_price) VALUES (?, ?, ?, ?, ?)',
          [req.user.tenantId, r.insertId, it.product_id, it.qty, it.unit_price || 0]
        );
        await conn.query(
          "UPDATE inventory SET qty_reserved = qty_reserved + ? WHERE tenant_id = ? AND product_id = ? AND warehouse = 'MAIN'",
          [it.qty, req.user.tenantId, it.product_id]
        );
        await ledger.record(conn, { tenantId: req.user.tenantId, productId: it.product_id, warehouse: 'MAIN', changeType: 'reserve', qtyChange: it.qty, qtyBefore: inv[0].qty_reserved, qtyAfter: inv[0].qty_reserved + it.qty, balanceField: 'reserved', refType: 'order', refId: r.insertId, operator: req.user.username, remark: '订单创建预占' });
      }
      const [rows] = await conn.query('SELECT * FROM orders WHERE id = ?', [r.insertId]);
      return rows[0];
    });
    res.json({ item: order });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: '订单号冲突，请重试' });
    next(err);
  }
});

// 状态流转：pay/ship/complete/cancel
// ship 需附加物流信息：carrier_id / tracking_no / shipping_cost
router.post('/:id/status', async (req, res, next) => {
  try {
    const { action, carrier_id, tracking_no, shipping_cost } = req.body || {};
    const t = TRANSITIONS[action];
    if (!t) return res.status(400).json({ error: '不支持的操作（pay/ship/complete/cancel）' });
    if (action === 'ship' && !carrier_id) {
      return res.status(400).json({ error: '发货请选择物流商' });
    }

    const order = await withTransaction(async conn => {
      const [rows] = await conn.query(
        'SELECT * FROM orders WHERE tenant_id = ? AND id = ? FOR UPDATE',
        [req.user.tenantId, req.params.id]
      );
      if (!rows.length) throw Object.assign(new Error('订单不存在'), { status: 404 });
      const o = rows[0];
      if (!t.from.includes(o.status)) {
        throw Object.assign(new Error(`订单当前状态「${STATUS_LABELS[o.status]}」不允许执行该操作`), { status: 400 });
      }

      const [items] = await conn.query('SELECT * FROM order_items WHERE order_id = ?', [o.id]);

      if (action === 'ship') {
        // 校验物流商归属
        const [carriers] = await conn.query(
          'SELECT id, name FROM carriers WHERE tenant_id = ? AND id = ?',
          [req.user.tenantId, carrier_id]
        );
        if (!carriers.length) throw Object.assign(new Error('物流商不存在'), { status: 400 });

        // 发货：在库扣减 + 释放占用
        for (const it of items) {
          const [inv] = await conn.query(
            "SELECT id, qty_on_hand FROM inventory WHERE tenant_id = ? AND product_id = ? AND warehouse = 'MAIN' FOR UPDATE",
            [req.user.tenantId, it.product_id]
          );
          if (!inv.length || inv[0].qty_on_hand < it.qty) {
            throw Object.assign(new Error('库存数据异常，无法发货'), { status: 400 });
          }
          await conn.query(
            "UPDATE inventory SET qty_on_hand = qty_on_hand - ?, qty_reserved = qty_reserved - ? WHERE id = ?",
            [it.qty, it.qty, inv[0].id]
          );
          await ledger.record(conn, { tenantId: req.user.tenantId, productId: it.product_id, warehouse: 'MAIN', changeType: 'outbound', qtyChange: -it.qty, qtyBefore: inv[0].qty_on_hand, qtyAfter: inv[0].qty_on_hand - it.qty, balanceField: 'on_hand', refType: 'order', refId: o.id, operator: req.user.username, remark: '订单发货出库' });
        }

        // 写发货记录（运费计入利润核算）
        await conn.query(
          `INSERT INTO shipments (tenant_id, order_id, carrier_id, tracking_no, shipping_cost)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE carrier_id = VALUES(carrier_id), tracking_no = VALUES(tracking_no), shipping_cost = VALUES(shipping_cost)`,
          [req.user.tenantId, o.id, carrier_id, tracking_no || null, Number(shipping_cost) || 0]
        );
      } else if (action === 'cancel') {
        // 取消：仅释放占用，未发货不动在库
        for (const it of items) {
          await conn.query(
            "UPDATE inventory SET qty_reserved = qty_reserved - ? WHERE tenant_id = ? AND product_id = ? AND warehouse = 'MAIN'",
            [it.qty, req.user.tenantId, it.product_id]
          );
          await ledger.record(conn, { tenantId: req.user.tenantId, productId: it.product_id, warehouse: 'MAIN', changeType: 'release', qtyChange: -it.qty, qtyBefore: 0, qtyAfter: 0, balanceField: 'reserved', refType: 'order', refId: o.id, operator: req.user.username, remark: '订单取消释放' });
        }
      }

      await conn.query('UPDATE orders SET status = ? WHERE id = ?', [t.to, o.id]);
      const [after] = await conn.query('SELECT * FROM orders WHERE id = ?', [o.id]);
      return after[0];
    });
    res.json({ item: order });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// 订单发货信息（物流商 / 运单号 / 运费）
router.get('/:id/shipment', async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT s.*, c.name AS carrier_name, c.tracking_url FROM shipments s
       LEFT JOIN carriers c ON c.tenant_id = s.tenant_id AND c.id = s.carrier_id
       WHERE s.tenant_id = ? AND s.order_id = ?`,
      [req.user.tenantId, req.params.id]
    );
    res.json({ item: rows[0] || null });
  } catch (err) { next(err); }
});

// ===== 面单打印（浏览器 window.open 直开，token 走 query）=====
// 返回可打印 HTML：发/收件信息 + 商品明细 + Code128 运单号条码
router.get('/:id/label', async (req, res, next) => {
  try {
    // window.open 无法带 Authorization 头，token 从 query 校验
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    let payload;
    try { payload = jwt.verify(req.query.token, config.jwtSecret); }
    catch { return res.status(401).send('<h3>登录已过期，请重新登录后再打印</h3>'); }
    const tid = payload.tenantId;

    const orders = await query('SELECT * FROM orders WHERE tenant_id = ? AND id = ?', [tid, req.params.id]);
    if (!orders.length) return res.status(404).send('<h3>订单不存在</h3>');
    const o = orders[0];
    const items = await query(
      `SELECT oi.qty, oi.unit_price, p.sku, p.name FROM order_items oi
       JOIN products p ON p.tenant_id = oi.tenant_id AND p.id = oi.product_id WHERE oi.order_id = ?`,
      [o.id]
    );
    const ships = await query(
      `SELECT sh.tracking_no, c.name AS carrier_name FROM shipments sh
       LEFT JOIN carriers c ON c.tenant_id = sh.tenant_id AND c.id = sh.carrier_id
       WHERE sh.tenant_id = ? AND sh.order_id = ?`,
      [tid, o.id]
    );
    const trackingNo = ships.length ? ships[0].tracking_no : '';
    const carrierName = ships.length ? ships[0].carrier_name : '';

    // Code128 条码 PNG（bwip-js）
    let barcode = '';
    if (trackingNo) {
      try {
        const bwipjs = require('bwip-js');
        const png = bwipjs.toBuffer({ bcid: 'code128', text: trackingNo, scale: 3, height: 12, includetext: false, padding: 4 });
        barcode = `<img src="data:image/png;base64,${png.toString('base64')}" style="height:64px" alt="barcode">`;
      } catch { barcode = `<div style="font-family:monospace;font-size:26px;font-weight:700;letter-spacing:2px">${trackingNo}</div>`; }
    }

    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const itemRows = items.map(it =>
      `<tr><td>${esc(it.sku)}</td><td>${esc(it.name)}</td><td style="text-align:center">${it.qty}</td></tr>`
    ).join('');

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>面单 ${esc(o.order_no)}</title>
<style>
  body{font-family:"Microsoft YaHei",Arial,sans-serif;margin:0;padding:16px;background:#666}
  .label{width:480px;background:#fff;margin:0 auto;padding:18px;border:2px solid #000;box-sizing:border-box}
  .hd{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:10px}
  .hd b{font-size:18px}
  .row{display:flex;margin-bottom:10px}
  .cell{flex:1}
  .k{font-size:11px;color:#555}
  .v{font-size:15px;font-weight:600}
  table{width:100%;border-collapse:collapse;font-size:12px;margin:8px 0}
  th,td{border:1px solid #999;padding:4px 6px;text-align:left}
  th{background:#eee}
  .bc{text-align:center;margin:12px 0 4px}
  .tn{font-family:monospace;font-size:18px;font-weight:700;text-align:center;letter-spacing:1px}
  .ft{font-size:11px;color:#555;text-align:center;margin-top:8px}
  @media print{body{background:#fff;padding:0}.label{border-width:1px}}
</style></head><body>
<div class="label">
  <div class="hd"><b>SHUXU ERP</b><span style="font-size:12px">${esc(carrierName || '跨境面单')}</span></div>
  <div class="row">
    <div class="cell"><div class="k">收件人</div><div class="v">${esc(o.buyer_name || '-')}</div></div>
    <div class="cell"><div class="k">国家/地区</div><div class="v">${esc(o.country || '-')}</div></div>
  </div>
  <table><thead><tr><th>SKU</th><th>商品名称</th><th style="width:50px">数量</th></tr></thead><tbody>${itemRows}</tbody></table>
  <div class="row">
    <div class="cell"><div class="k">订单号</div><div class="v">${esc(o.order_no)}</div></div>
    <div class="cell"><div class="k">金额</div><div class="v">${esc(o.currency || 'CNY')} ${Number(o.total_amount).toFixed(2)}</div></div>
  </div>
  <div class="bc">${barcode}</div>
  <div class="tn">${esc(trackingNo || '未生成运单号')}</div>
  <div class="ft">打印时间：${new Date().toLocaleString('zh-CN')} · 由数序ERP生成</div>
</div>
<script>window.onload = () => setTimeout(() => window.print(), 300)</script>
</body></html>`);
  } catch (err) { next(err); }
});

// ===== 物流轨迹查询 =====
// 优先 17track（配置 TRACK17_API_KEY 时自动订阅拉取并落库）；否则返回物流商查询链接 + 已有事件
router.get('/:id/tracking', async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT sh.id AS shipment_id, sh.tracking_no, c.name AS carrier_name, c.tracking_url
       FROM shipments sh LEFT JOIN carriers c ON c.tenant_id = sh.tenant_id AND c.id = sh.carrier_id
       WHERE sh.tenant_id = ? AND sh.order_id = ?`,
      [req.user.tenantId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: '该订单暂无发货记录' });
    const sh = rows[0];
    if (!sh.tracking_no) return res.status(400).json({ error: '该订单暂无运单号' });

    let events = [];
    let source = 'local';
    const apiKey = process.env.TRACK17_API_KEY;

    if (apiKey) {
      // 17track 订阅 + 拉取（配置密钥后生效）
      try {
        const reg = await fetch('https://api.17track.net/track/v2.2/register', {
          method: 'POST', headers: { 'Content-Type': 'application/json', '17token': apiKey },
          body: JSON.stringify([{ number: sh.tracking_no }]),
        });
        const regData = await reg.json();
        if (regData.code === 0) {
          const detail = await fetch('https://api.17track.net/track/v2.2/gettrackinfo', {
            method: 'POST', headers: { 'Content-Type': 'application/json', '17token': apiKey },
            body: JSON.stringify([{ number: sh.tracking_no, resultv2: 1 }]),
          });
          const d = await detail.json();
          const evts = (d.data && d.data[0] && d.data[0].tracking && d.data[0].tracking.providers) || [];
          const allEvents = evts.flatMap(p => (p.events || []).map(e => ({
            status: e.status || p._name || '',
            description: e.description || e.desc || '',
            location: e.location || '',
            occurred_at: e.time_iso || e.time
          })));
          if (allEvents.length) {
            // 落库缓存
            await query('DELETE FROM shipment_events WHERE tenant_id = ? AND shipment_id = ?', [req.user.tenantId, sh.shipment_id]);
            for (const e of allEvents.slice(0, 50)) {
              await query(
                'INSERT INTO shipment_events (tenant_id, shipment_id, status, description, location, occurred_at) VALUES (?,?,?,?,?,?)',
                [req.user.tenantId, sh.shipment_id, e.status, e.description, e.location, e.occurred_at ? new Date(e.occurred_at) : null]
              );
            }
            source = '17track';
          }
        }
      } catch { /* 平台异常时降级到本地缓存 */ }
    }

    events = await query(
      'SELECT status, description, location, occurred_at FROM shipment_events WHERE tenant_id = ? AND shipment_id = ? ORDER BY occurred_at DESC LIMIT 50',
      [req.user.tenantId, sh.shipment_id]
    );

    res.json({
      tracking_no: sh.tracking_no,
      carrier_name: sh.carrier_name,
      track_url: sh.tracking_url ? sh.tracking_url + encodeURIComponent(sh.tracking_no) : null,
      source,
      events
    });
  } catch (err) { next(err); }
});

module.exports = router;
