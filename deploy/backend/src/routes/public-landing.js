/**
 * 官网落地页开放路由（不需要登录，前端首页直接拉取）
 * - GET  /api/v1/public/landing/config   动态官网配置
 * - POST /api/v1/public/landing/apply    体验申请入库
 * - GET  /api/v1/public/landing/health   公开健康
 */
const express = require('express');
const { query } = require('../db');

const router = express.Router();

function safeParse(s, fallback) {
  try { return s == null ? fallback : JSON.parse(s); }
  catch { return fallback; }
}

// 仅暴露给前端的字段名改为纯业务命名，避免泄露数据库列名
router.get('/config', async (req, res, next) => {
  try {
    let rows = await query('SELECT * FROM landing_configs ORDER BY id DESC LIMIT 1');
    if (!rows.length) {
      // 退化兜底：保证官网打开不白屏
      return res.json({ ready: false, banner: [], advantage: [], features: [], plans: [], cases: [], compare: [], apply: {}, footer: {}, seo: {} });
    }
    const r = rows[0];
    const data = {
      ready: true,
      siteName: r.site_name,
      banner:     safeParse(r.banner_json,     []),
      advantage:  safeParse(r.advantage_json,  []),
      features:   safeParse(r.features_json,   []),
      plans:      safeParse(r.plans_json,      []),
      cases:      safeParse(r.cases_json,      []),
      compare:    safeParse(r.compare_json,    []),
      apply:      safeParse(r.apply_json,      {}),
      footer:     safeParse(r.footer_json,     {}),
      seo:        safeParse(r.seo_json,        {}),
    };
    res.json(data);
  } catch (e) { next(e); }
});

// 体验申请（手机号+店铺类型）
router.post('/apply', async (req, res, next) => {
  try {
    const body = req.body || {};
    const mobile = String(body.mobile || '').trim();
    const shopPlatform = String(body.shopPlatform || body.shop_platform || '').slice(0, 120);
    if (!/^1[3-9]\d{9}$/.test(mobile)) {
      return res.status(400).json({ error: '请输入正确的11位手机号' });
    }
    const dup = await query('SELECT COUNT(*) c FROM site_applications WHERE mobile = ?', [mobile]);
    if (dup && dup[0] && dup[0].c > 3) {
      return res.status(429).json({ error: '该手机号已多次提交，销售将尽快联系您' });
    }
    await query(
      `INSERT INTO site_applications
       (contact_name, mobile, company, shop_platform, shop_url, monthly_volume, region, source_utm, ip, user_agent)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        String(body.contactName || body.contact_name || '').slice(0, 80) || null,
        mobile,
        String(body.company || '').slice(0, 180) || null,
        shopPlatform || null,
        String(body.shopUrl || body.shop_url || '').slice(0, 300) || null,
        String(body.monthlyVolume || body.monthly_volume || '').slice(0, 40) || null,
        String(body.region || '').slice(0, 60) || null,
        String(body.utm || body.utmSource || body.source_utm || '').slice(0, 200) || null,
        (req.headers['x-real-ip'] || (req.headers['x-forwarded-for']||'').split(',')[0].trim() || req.socket.remoteAddress || '').slice(0, 64),
        (req.headers['user-agent'] || '').slice(0, 300),
      ]
    );
    res.json({ ok: true, msg: '申请已提交，销售将在1个工作日内联系您' });
  } catch (e) { next(e); }
});

router.get('/health', (req, res) => res.json({ ok: true, service: 'shuxu-landing', ts: Date.now() }));

module.exports = router;
