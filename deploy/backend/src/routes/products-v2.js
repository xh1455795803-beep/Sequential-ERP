/**
 * V2.0 商品完整模块（飞书文档 V2.2 顶配商品编辑页 10大模块）
 * 模块覆盖：
 *   1. 基础信息扩展（inner_sku/英文名/多级分类/品牌/产地/经营状态/类型/来源渠道/定时上下架/SEO/中文名）
 *   2. 规格变体（变体SKU/条码/主推/单变体状态/组合套装）
 *   3. 多平台刊登（关联店铺/平台编码/差异化标题/同步规则/差异化定价）
 *   4. 库存仓储（仓库归属/安全库存/超卖风控/在途/呆滞/分配策略）
 *   5. 定价成本（采购成本/平台费率模板/头尾程运费/利润保底/多币种/广告分摊/AI定价/阶梯/价保）
 *   6. 物流重量（净重毛重/尺寸/打包尺寸/计费模式/敏感属性/时效/物流黑白名单/特殊包装）
 *   7. 跨境合规（HS编码/报关信息/VAT/资质/知识产权风控/禁售地区）
 *   8. AI智能配置（预测周期/补货优先级/风险检测开关/AI标签）
 *   9. 权限日志（敏感字段权限/审计日志/版本回溯 - 审计日志走全局中间件）
 *  10. 预售/赠品/审核发布（预售开关+最晚发货/赠品绑定/草稿-审核-发布流程/批量操作/主体归属）
 *
 * 数据库表使用 migrate-v5 创建的：products(45扩展列) / product_variants / product_listings
 *                      / product_compliance / product_promo
 */
const express = require('express');
const crypto = require('crypto');
const { query, withTransaction } = require('../db');
const quota = require('../middleware/quota');

const router = express.Router();

/* ========== 1. 商品列表（分页+基础搜索，详情接口返回 10大模块完整数据） ========== */
router.get('/', async (req, res, next) => {
  try {
    const { keyword, biz_status, product_type, category, page, size } = req.query;
    const where = ['p.tenant_id = ?']; const params = [req.user.tenantId];
    if (keyword) { where.push('(p.name LIKE ? OR p.name_en LIKE ? OR p.sku LIKE ? OR p.inner_sku LIKE ?)');
                  const k = `%${keyword}%`; params.push(k, k, k, k); }
    if (biz_status)   { where.push('p.biz_status = ?');   params.push(biz_status); }
    if (product_type) { where.push('p.product_type = ?'); params.push(product_type); }
    if (category)     { where.push('p.category = ?');     params.push(category); }
    const pg = parseInt(page, 10) || 1;
    const sz = Math.min(parseInt(size, 10) || 30, 200);
    const offset = (pg - 1) * sz;
    const rows = await query(
      `SELECT p.*, i.qty_on_hand, i.qty_reserved, (i.qty_on_hand - i.qty_reserved) AS qty_available,
              (SELECT COUNT(*) FROM product_variants v WHERE v.tenant_id = p.tenant_id AND v.product_id = p.id) AS variants_count,
              (SELECT COUNT(*) FROM product_listings l WHERE l.tenant_id = p.tenant_id AND l.product_id = p.id) AS listings_count
       FROM products p
       LEFT JOIN inventory i ON i.tenant_id = p.tenant_id AND i.product_id = p.id AND i.warehouse = 'MAIN'
       WHERE ${where.join(' AND ')}
       ORDER BY p.id DESC LIMIT ? OFFSET ?`,
      [...params, sz, offset]
    );
    const [{ c }] = await query(`SELECT COUNT(*) AS c FROM products p WHERE ${where.join(' AND ')}`, params);
    res.json({ items: rows, total: c, page: pg, size: sz });
  } catch (e) { next(e); }
});

/* ========== 2. 商品完整详情（10 大模块聚合返回） ========== */
router.get('/:id', async (req, res, next) => {
  try {
    const [p] = await query('SELECT * FROM products WHERE tenant_id = ? AND id = ?', [req.user.tenantId, req.params.id]);
    if (!p) return res.status(404).json({ error: '商品不存在' });
    const variants  = await query('SELECT * FROM product_variants WHERE tenant_id = ? AND product_id = ? ORDER BY id', [req.user.tenantId, p.id]);
    const listings  = await query(
      `SELECT l.*, s.name AS shop_name, s.platform, s.country AS shop_country
       FROM product_listings l LEFT JOIN shops s ON s.id = l.shop_id AND s.tenant_id = l.tenant_id
       WHERE l.tenant_id = ? AND l.product_id = ? ORDER BY l.id`,
      [req.user.tenantId, p.id]
    );
    const [compliance] = await query('SELECT * FROM product_compliance WHERE tenant_id = ? AND product_id = ?', [req.user.tenantId, p.id]);
    const [promo]      = await query('SELECT * FROM product_promo WHERE tenant_id = ? AND product_id = ?', [req.user.tenantId, p.id]);
    const inv = await query(
      `SELECT warehouse, qty_on_hand, qty_reserved, (qty_on_hand - qty_reserved) AS qty_available
       FROM inventory WHERE tenant_id = ? AND product_id = ?`, [req.user.tenantId, p.id]
    );
    res.json({
      product: p,
      variants, listings, compliance: compliance || null, promo: promo || null,
      inventory: inv
    });
  } catch (e) { next(e); }
});

/* ========== 3. 新建商品（基础信息 + 可选的变体/刊登/合规/预售一次性写入） ========== */
router.post('/', quota.guard('product', 1), async (req, res, next) => {
  try {
    const b = req.body || {};
    const base = b.basic || b;
    if (!base.sku && !base.inner_sku) return res.status(400).json({ error: 'SKU 必填' });
    if (!base.name || !base.name_en) return res.status(400).json({ error: '商品中文 + 英文名称必填' });

    const productId = await withTransaction(async conn => {
      // 基础列映射（只保留非空）
      const colMap = {
        sku: base.sku || base.inner_sku,
        inner_sku: base.inner_sku || base.sku,
        name: base.name, name_en: base.name_en, name_cn: base.name_cn || null,
        category: base.category || null, brand: base.brand || null,
        origin_country: base.origin_country || null,
        biz_status: base.biz_status || 'draft',
        product_type: base.product_type || 'normal',
        source_channel: base.source_channel || null,
        seo_tags_json: base.seo_tags ? JSON.stringify(base.seo_tags) : null,
        price: base.price || base.sale_price || 0,
        cost: base.cost || base.purchase_cost || 0,
        // 库存仓储
        warehouse_code: base.warehouse_code || 'MAIN',
        safe_stock: base.safe_stock != null ? base.safe_stock : 5,
        oversell_protect: base.oversell_protect != null ? (base.oversell_protect ? 1 : 0) : 1,
        in_transit_qty: base.in_transit_qty || 0,
        dead_stock_days: base.dead_stock_days || 180,
        allocate_policy: base.allocate_policy ? JSON.stringify(base.allocate_policy) : null,
        // 定价成本财务
        fee_template_id: base.fee_template_id || null,
        base_ship_cost_head: base.base_ship_cost_head || 0,
        base_ship_cost_tail: base.base_ship_cost_tail || 0,
        min_profit_rate: base.min_profit_rate != null ? base.min_profit_rate : 15,
        price_tier_json: base.price_tiers ? JSON.stringify(base.price_tiers) : null,
        price_protect_json: base.price_protect ? JSON.stringify(base.price_protect) : null,
        ad_cost_rule_json: base.ad_cost_rule ? JSON.stringify(base.ad_cost_rule) : null,
        // 物流重量
        weight_g: base.weight_g || null,
        gross_weight_g: base.gross_weight_g || null,
        length_cm: base.length_cm || null, width_cm: base.width_cm || null, height_cm: base.height_cm || null,
        pack_length_cm: base.pack_length_cm || null, pack_width_cm: base.pack_width_cm || null, pack_height_cm: base.pack_height_cm || null,
        ship_fee_mode: base.ship_fee_mode || 'actual',
        sensitive_attr: base.sensitive_attr || 'normal',
        ship_days: base.ship_days || 3,
        ship_whitelist_json: base.ship_whitelist ? JSON.stringify(base.ship_whitelist) : null,
        ship_blacklist_json: base.ship_blacklist ? JSON.stringify(base.ship_blacklist) : null,
        special_pack_json: base.special_pack ? JSON.stringify(base.special_pack) : null,
        // AI
        ai_forecast_days: base.ai_forecast_days || 15,
        replenish_priority: base.replenish_priority || 'normal',
        risk_detect_enabled: base.risk_detect_enabled != null ? (base.risk_detect_enabled ? 1 : 0) : 1,
        ai_tags_json: base.ai_tags ? JSON.stringify(base.ai_tags) : null,
        // 币种
        sale_currency: base.sale_currency || 'USD',
        // 归属
        owner_user_id: base.owner_user_id || null,
        supplier_id: base.supplier_id || null,
        commission_base: base.commission_base || null
      };
      const keys = Object.keys(colMap);
      const values = keys.map(k => colMap[k]);
      const [r] = await conn.query(
        `INSERT INTO products (tenant_id, ${keys.join(',')}) VALUES (?, ${keys.map(() => '?').join(',')})`,
        [req.user.tenantId, ...values]
      );
      const pid = r.insertId;

      // 4) 库存行（多仓）
      const whs = Array.isArray(b.warehouses) ? b.warehouses : [{ code: colMap.warehouse_code, qty: 0 }];
      for (const w of whs) {
        await conn.query(
          `INSERT INTO inventory (tenant_id, product_id, warehouse, qty_on_hand, qty_reserved) VALUES (?, ?, ?, ?, 0)
           ON DUPLICATE KEY UPDATE qty_on_hand = qty_on_hand`,
          [req.user.tenantId, pid, w.code || 'MAIN', w.qty || 0]
        );
      }
      // 配额 bump 产品使用量
      await conn.query(`UPDATE tenant_quotas SET products_used = products_used + 1 WHERE tenant_id = ?`, [req.user.tenantId]);
      return pid;
    });

    // ====== 变体 / 刊登 / 合规 / 预售（可选，二次事务，失败不影响基础行）======
    const promises = [];
    if (Array.isArray(b.variants) && b.variants.length) promises.push(upsertVariants(req.user.tenantId, productId, b.variants));
    if (Array.isArray(b.listings) && b.listings.length) promises.push(upsertListings(req.user.tenantId, productId, b.listings));
    if (b.compliance)   promises.push(upsertCompliance(req.user.tenantId, productId, b.compliance));
    if (b.promo)        promises.push(upsertPromo(req.user.tenantId, productId, b.promo));
    await Promise.all(promises);
    res.json({ ok: true, product_id: productId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'SKU 已存在' });
    next(e);
  }
});

/* ========== 4. 全量更新商品（PATCH 原子按模块） ========== */
router.patch('/:id', async (req, res, next) => {
  try {
    const pid = req.params.id;
    const [exist] = await query('SELECT id FROM products WHERE tenant_id = ? AND id = ?', [req.user.tenantId, pid]);
    if (!exist) return res.status(404).json({ error: '商品不存在' });
    const b = req.body || {};

    if (b.basic) {
      const colMap = {};
      const directMap = {
        sku:'sku', inner_sku:'inner_sku', name:'name', name_en:'name_en', name_cn:'name_cn',
        category:'category', brand:'brand', origin_country:'origin_country',
        biz_status:'biz_status', product_type:'product_type', source_channel:'source_channel',
        price:'price', cost:'cost',
        warehouse_code:'warehouse_code', safe_stock:'safe_stock', oversell_protect:'oversell_protect',
        in_transit_qty:'in_transit_qty', dead_stock_days:'dead_stock_days',
        fee_template_id:'fee_template_id',
        base_ship_cost_head:'base_ship_cost_head', base_ship_cost_tail:'base_ship_cost_tail',
        min_profit_rate:'min_profit_rate', ai_suggest_price:'ai_suggest_price',
        weight_g:'weight_g', gross_weight_g:'gross_weight_g',
        length_cm:'length_cm', width_cm:'width_cm', height_cm:'height_cm',
        pack_length_cm:'pack_length_cm', pack_width_cm:'pack_width_cm', pack_height_cm:'pack_height_cm',
        ship_fee_mode:'ship_fee_mode', sensitive_attr:'sensitive_attr', ship_days:'ship_days',
        ai_forecast_days:'ai_forecast_days', replenish_priority:'replenish_priority',
        risk_detect_enabled:'risk_detect_enabled', sale_currency:'sale_currency',
        owner_user_id:'owner_user_id', supplier_id:'supplier_id', commission_base:'commission_base'
      };
      for (const [inK, outK] of Object.entries(directMap)) {
        if (b.basic[inK] !== undefined) {
          const v = b.basic[inK];
          const isBool = ['oversell_protect','risk_detect_enabled'].includes(outK);
          colMap[outK] = isBool ? (v ? 1 : 0) : v;
        }
      }
      if (b.basic.seo_tags !== undefined) colMap.seo_tags_json = JSON.stringify(b.basic.seo_tags);
      if (b.basic.allocate_policy !== undefined) colMap.allocate_policy = JSON.stringify(b.basic.allocate_policy);
      if (b.basic.price_tiers !== undefined) colMap.price_tier_json = JSON.stringify(b.basic.price_tiers);
      if (b.basic.price_protect !== undefined) colMap.price_protect_json = JSON.stringify(b.basic.price_protect);
      if (b.basic.ad_cost_rule !== undefined) colMap.ad_cost_rule_json = JSON.stringify(b.basic.ad_cost_rule);
      if (b.basic.ship_whitelist !== undefined) colMap.ship_whitelist_json = JSON.stringify(b.basic.ship_whitelist);
      if (b.basic.ship_blacklist !== undefined) colMap.ship_blacklist_json = JSON.stringify(b.basic.ship_blacklist);
      if (b.basic.special_pack !== undefined) colMap.special_pack_json = JSON.stringify(b.basic.special_pack);
      if (b.basic.ai_tags !== undefined) colMap.ai_tags_json = JSON.stringify(b.basic.ai_tags);
      // 定时上下架
      if (b.promo && b.promo.scheduled_on) colMap.scheduled_on = b.promo.scheduled_on;
      if (b.promo && b.promo.scheduled_off) colMap.scheduled_off = b.promo.scheduled_off;

      if (Object.keys(colMap).length) {
        const sets = Object.keys(colMap).map(k => `${k} = ?`);
        const params = Object.values(colMap);
        params.push(req.user.tenantId, pid);
        await query(`UPDATE products SET ${sets.join(', ')} WHERE tenant_id = ? AND id = ?`, params);
      }
    }

    // 子模块覆盖式 upsert
    if (Array.isArray(b.variants)) await upsertVariants(req.user.tenantId, pid, b.variants, true);
    if (Array.isArray(b.listings)) await upsertListings(req.user.tenantId, pid, b.listings, true);
    if (b.compliance)   await upsertCompliance(req.user.tenantId, pid, b.compliance);
    if (b.promo)        await upsertPromo(req.user.tenantId, pid, b.promo);
    // 库存数量单独调整
    if (Array.isArray(b.inventory)) {
      await withTransaction(async conn => {
        for (const w of b.inventory) {
          if (w.adjust_qty === undefined) continue;
          const before = await conn.query(
            `SELECT qty_on_hand, qty_reserved FROM inventory
             WHERE tenant_id = ? AND product_id = ? AND warehouse = ? FOR UPDATE`,
            [req.user.tenantId, pid, w.warehouse || 'MAIN']
          );
          const qb = before.length ? before[0].qty_on_hand : 0;
          await conn.query(
            `INSERT INTO inventory (tenant_id, product_id, warehouse, qty_on_hand, qty_reserved) VALUES (?, ?, ?, ?, 0)
             ON DUPLICATE KEY UPDATE qty_on_hand = qty_on_hand + ?`,
            [req.user.tenantId, pid, w.warehouse || 'MAIN', w.adjust_qty, w.adjust_qty]
          );
          await require('../inventory-ledger').record(conn, {
            tenantId: req.user.tenantId, productId: Number(pid), warehouse: w.warehouse || 'MAIN',
            changeType: w.adjust_qty >= 0 ? 'stockin' : 'stockout',
            qtyChange: w.adjust_qty, qtyBefore: qb, qtyAfter: qb + Number(w.adjust_qty),
            balanceField: 'on_hand', refType: 'product.adjust', refId: Number(pid),
            operator: req.user.username, remark: w.remark || '手动盘存调整'
          });
        }
      });
    }

    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'SKU/变体SKU已存在' });
    next(e);
  }
});

/* ========== 5. 变体/刊登/合规/预售的独立接口（可选单独用） ========== */
router.get('/:id/variants',  async (req, res) => {
  const rows = await query('SELECT * FROM product_variants WHERE tenant_id = ? AND product_id = ? ORDER BY id', [req.user.tenantId, req.params.id]);
  res.json({ items: rows });
});
router.get('/:id/listings',  async (req, res) => {
  const rows = await query('SELECT l.*, s.name AS shop_name, s.platform FROM product_listings l LEFT JOIN shops s ON s.id=l.shop_id WHERE l.tenant_id = ? AND l.product_id = ?', [req.user.tenantId, req.params.id]);
  res.json({ items: rows });
});
router.get('/:id/compliance',async (req, res) => {
  const [r] = await query('SELECT * FROM product_compliance WHERE tenant_id = ? AND product_id = ?', [req.user.tenantId, req.params.id]);
  res.json({ item: r || null });
});
router.get('/:id/promo',     async (req, res) => {
  const [r] = await query('SELECT * FROM product_promo WHERE tenant_id = ? AND product_id = ?', [req.user.tenantId, req.params.id]);
  res.json({ item: r || null });
});

/* ========== 6. 发布审核流程（飞书文档 10.3）========== */
router.post('/:id/publish', async (req, res, next) => {
  try {
    const { action, reject_reason } = req.body || {}; // submit / approve / reject
    const [p] = await query('SELECT id, publish_status, biz_status FROM products WHERE tenant_id = ? AND id = ?', [req.user.tenantId, req.params.id]);
    if (!p) return res.status(404).json({ error: '商品不存在' });
    if (action === 'submit') {
      // 合规自检（简化版本，商业项目可扩展：违禁词、资质、价格、库存）
      const errors = [];
      if (!p.name_en) errors.push('缺少英文名称(海外刊登必填)');
      if (!p.brand || !p.origin_country) errors.push('缺少品牌/产地(报关必填)');
      // 变体校验
      const [vCount] = await query('SELECT COUNT(*) c FROM product_variants WHERE tenant_id=? AND product_id=?', [req.user.tenantId, p.id]);
      // if (vCount.c === 0) errors.push('缺少有效变体规格');   // 非变体商品可允许
      if (errors.length) return res.status(400).json({ error: '发布前自检失败：' + errors.join('；') });
      await query('UPDATE products SET biz_status = ? WHERE id = ?', ['new_wait', p.id]);
      await withTransaction(async c => {
        await c.query(
          `INSERT INTO product_promo (tenant_id, product_id, publish_status) VALUES (?,?, 'review')
           ON DUPLICATE KEY UPDATE publish_status = 'review'`,
          [req.user.tenantId, p.id]
        );
      });
      res.json({ ok: true, status: 'review' });
    } else if (action === 'approve') {
      await withTransaction(async c => {
        await c.query(`UPDATE products SET biz_status = 'normal' WHERE id = ?`, [p.id]);
        await c.query(
          `INSERT INTO product_promo (tenant_id, product_id, publish_status, publish_approved) VALUES (?,?, 'published', 1)
           ON DUPLICATE KEY UPDATE publish_status = 'published', publish_approved = 1, publish_reject_reason = NULL`,
          [req.user.tenantId, p.id]
        );
      });
      res.json({ ok: true, status: 'published' });
    } else if (action === 'reject') {
      await withTransaction(async c => {
        await c.query(`UPDATE products SET biz_status = 'draft' WHERE id = ?`, [p.id]);
        await c.query(
          `INSERT INTO product_promo (tenant_id, product_id, publish_status, publish_reject_reason) VALUES (?,?, 'rejected', ?)
           ON DUPLICATE KEY UPDATE publish_status = 'rejected', publish_reject_reason = ?`,
          [req.user.tenantId, p.id, reject_reason || null, reject_reason || null]
        );
      });
      res.json({ ok: true, status: 'rejected' });
    } else return res.status(400).json({ error: 'action: submit/approve/reject' });
  } catch (e) { next(e); }
});

/* ========== 7. 批量操作（飞书 10.4）========== */
router.post('/batch', async (req, res, next) => {
  try {
    const { ids, action, payload } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids 必填数组' });
    const placeholders = ids.map(() => '?').join(',');
    let okCount = 0, failCount = 0;
    if (action === 'status' && payload && payload.biz_status) {
      const r = await query(
        `UPDATE products SET biz_status = ? WHERE tenant_id = ? AND id IN (${placeholders})`,
        [payload.biz_status, req.user.tenantId, ...ids]
      );
      okCount = r.affectedRows || 0;
    } else if (action === 'delete') {
      for (const id of ids) {
        try {
          await withTransaction(async conn => {
            await conn.query(`DELETE FROM inventory WHERE tenant_id = ? AND product_id = ?`, [req.user.tenantId, id]);
            await conn.query(`DELETE FROM products WHERE tenant_id = ? AND id = ?`, [req.user.tenantId, id]);
          });
          okCount++;
        } catch { failCount++; }
      }
    } else if (action === 'warehouse' && payload && payload.warehouse && payload.adjust_qty != null) {
      for (const id of ids) {
        try {
          await query(
            `INSERT INTO inventory (tenant_id, product_id, warehouse, qty_on_hand, qty_reserved) VALUES (?,?,?,?,0)
             ON DUPLICATE KEY UPDATE qty_on_hand = qty_on_hand + ?`,
            [req.user.tenantId, id, payload.warehouse, Number(payload.adjust_qty), Number(payload.adjust_qty)]
          );
          okCount++;
        } catch { failCount++; }
      }
    } else {
      return res.status(400).json({ error: '未知批量 action（支持 status / delete / warehouse）' });
    }
    res.json({ ok: true, okCount, failCount });
  } catch (e) { next(e); }
});

/* ========== 内部工具函数：变体/刊登/合规/预售 upsert ========== */
async function upsertVariants(tenantId, productId, variants, replace = false) {
  return withTransaction(async conn => {
    if (replace) await conn.query('DELETE FROM product_variants WHERE tenant_id = ? AND product_id = ?', [tenantId, productId]);
    for (const v of variants) {
      const dims = v.dimensions || v;
      await conn.query(
        `INSERT INTO product_variants
         (tenant_id, product_id, variant_sku, variant_name, dim_color, dim_size, dim_material, dim_model, dim_custom,
          barcode, price, cost, weight_g, is_main, status, extra_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           variant_name = VALUES(variant_name), dim_color=VALUES(dim_color), dim_size=VALUES(dim_size),
           dim_material=VALUES(dim_material), dim_model=VALUES(dim_model), dim_custom=VALUES(dim_custom),
           barcode=VALUES(barcode), price=VALUES(price), cost=VALUES(cost), weight_g=VALUES(weight_g),
           is_main=VALUES(is_main), status=VALUES(status), extra_json=VALUES(extra_json)`,
        [tenantId, productId,
         v.sku || v.variant_sku || `V${productId}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
         v.name || v.variant_name || null,
         dims.color || null, dims.size || null, dims.material || null, dims.model || null,
         v.custom_dim ? JSON.stringify(v.custom_dim) : null,
         v.barcode || null,
         v.price || 0, v.cost || 0, v.weight_g || null,
         v.is_main ? 1 : 0,
         v.status || 'on',
         v.extra ? JSON.stringify(v.extra) : null]
      );
    }
  });
}
async function upsertListings(tenantId, productId, listings, replace = false) {
  return withTransaction(async conn => {
    if (replace) await conn.query('DELETE FROM product_listings WHERE tenant_id = ? AND product_id = ?', [tenantId, productId]);
    for (const l of listings) {
      if (!l.shop_id) continue;
      await conn.query(
        `INSERT INTO product_listings
         (tenant_id, product_id, shop_id, platform_sku, listing_title, sync_inventory, sync_price, auto_publish,
          price_override, discount_rate, platform_status, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?, 'active')
         ON DUPLICATE KEY UPDATE
           platform_sku = VALUES(platform_sku), listing_title=VALUES(listing_title),
           sync_inventory=VALUES(sync_inventory), sync_price=VALUES(sync_price), auto_publish=VALUES(auto_publish),
           price_override=VALUES(price_override), discount_rate=VALUES(discount_rate), platform_status=VALUES(platform_status)`,
        [tenantId, productId, l.shop_id, l.platform_sku || l.platformSku || null, l.title || l.listing_title || null,
         l.sync_inventory != null ? (l.sync_inventory ? 1 : 0) : 1,
         l.sync_price != null    ? (l.sync_price ? 1 : 0)    : 1,
         l.auto_publish != null  ? (l.auto_publish ? 1 : 0)  : 1,
         l.price_override || null, l.discount_rate || null, l.platform_status || null]
      );
    }
  });
}
async function upsertCompliance(tenantId, productId, c) {
  return withTransaction(async conn => {
    await conn.query(
      `INSERT INTO product_compliance
       (tenant_id, product_id, hs_code, material, product_use, origin_country, declare_name,
        vat_rate, cert_ce, cert_fda, cert_fcc, ipr_tag, banned_regions, cert_expire_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         hs_code=VALUES(hs_code), material=VALUES(material), product_use=VALUES(product_use),
         origin_country=VALUES(origin_country), declare_name=VALUES(declare_name), vat_rate=VALUES(vat_rate),
         cert_ce=VALUES(cert_ce), cert_fda=VALUES(cert_fda), cert_fcc=VALUES(cert_fcc),
         ipr_tag=VALUES(ipr_tag), banned_regions=VALUES(banned_regions), cert_expire_at=VALUES(cert_expire_at)`,
      [tenantId, productId,
       c.hs_code || null, c.material || null, c.product_use || null, c.origin_country || null, c.declare_name || null,
       c.vat_rate || null, c.cert_ce || null, c.cert_fda || null, c.cert_fcc || null,
       c.ipr_tag || null,
       Array.isArray(c.banned_regions) ? c.banned_regions.join(',') : (c.banned_regions || null),
       c.cert_expire_at || null]
    );
  });
}
async function upsertPromo(tenantId, productId, p) {
  return withTransaction(async conn => {
    await conn.query(
      `INSERT INTO product_promo
       (tenant_id, product_id, presale_enabled, presale_final_pay_days, presale_latest_ship,
        gift_enabled, gift_bind_rule, gift_product_id, gift_qty_limit,
        publish_status, publish_reject_reason, scheduled_on, scheduled_off)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         presale_enabled=VALUES(presale_enabled),
         presale_final_pay_days=VALUES(presale_final_pay_days),
         presale_latest_ship=VALUES(presale_latest_ship),
         gift_enabled=VALUES(gift_enabled), gift_bind_rule=VALUES(gift_bind_rule),
         gift_product_id=VALUES(gift_product_id), gift_qty_limit=VALUES(gift_qty_limit),
         publish_status=VALUES(publish_status), publish_reject_reason=VALUES(publish_reject_reason),
         scheduled_on=VALUES(scheduled_on), scheduled_off=VALUES(scheduled_off)`,
      [tenantId, productId,
       p.presale_enabled ? 1 : 0, p.presale_final_pay_days || null, p.presale_latest_ship || null,
       p.gift_enabled ? 1 : 0, p.gift_bind_rule || null, p.gift_product_id || null, p.gift_qty_limit || null,
       p.publish_status || 'draft', p.publish_reject_reason || null,
       p.scheduled_on || null, p.scheduled_off || null]
    );
  });
}

module.exports = router;
