/**
 * V2.0 多币种汇率可视化系统（飞书文档 V2.2 旗舰功能）
 * 覆盖6大跨境核心区域：北美NA/欧洲EU/东南亚SEA/中东ME/拉美LA/日韩JPKR/大洋洲Oceania/南亚SA
 * 能力：实时基准汇率 / 今日涨跌 / 30天趋势曲线 / 按区域&国家筛选 / 每6小时自动同步
 * 汇率表：exchange_rates（实时） + exchange_rate_history（30天趋势）
 */
const express = require('express');
const { query } = require('../db');

const router = express.Router();

// 飞书文档 六大跨境区域 + 国家 + 币种映射（商用完整版）
const CURRENCY_MAP = {
  NA: {
    label: '北美', color: '#2563eb',
    countries: [
      { code: 'US', name: '美国', currency: 'USD', currencyName: '美元', flag: '🇺🇸' },
      { code: 'CA', name: '加拿大', currency: 'CAD', currencyName: '加元', flag: '🇨🇦' },
      { code: 'MX', name: '墨西哥', currency: 'MXN', currencyName: '墨西哥比索', flag: '🇲🇽' }
    ]
  },
  EU: {
    label: '欧洲', color: '#0891b2',
    countries: [
      { code: 'UK', name: '英国', currency: 'GBP', currencyName: '英镑', flag: '🇬🇧' },
      { code: 'DE', name: '德国', currency: 'EUR', currencyName: '欧元', flag: '🇩🇪' },
      { code: 'FR', name: '法国', currency: 'EUR', currencyName: '欧元', flag: '🇫🇷' },
      { code: 'IT', name: '意大利', currency: 'EUR', currencyName: '欧元', flag: '🇮🇹' },
      { code: 'ES', name: '西班牙', currency: 'EUR', currencyName: '欧元', flag: '🇪🇸' },
      { code: 'PL', name: '波兰', currency: 'PLN', currencyName: '兹罗提', flag: '🇵🇱' },
      { code: 'CZ', name: '捷克', currency: 'CZK', currencyName: '克朗', flag: '🇨🇿' },
      { code: 'SE', name: '瑞典', currency: 'SEK', currencyName: '克朗', flag: '🇸🇪' },
      { code: 'CH', name: '瑞士', currency: 'CHF', currencyName: '瑞士法郎', flag: '🇨🇭' }
    ]
  },
  SEA: {
    label: '东南亚', color: '#059669',
    countries: [
      { code: 'TH', name: '泰国', currency: 'THB', currencyName: '泰铢', flag: '🇹🇭' },
      { code: 'VN', name: '越南', currency: 'VND', currencyName: '越南盾', flag: '🇻🇳' },
      { code: 'MY', name: '马来西亚', currency: 'MYR', currencyName: '林吉特', flag: '🇲🇾' },
      { code: 'SG', name: '新加坡', currency: 'SGD', currencyName: '新加坡元', flag: '🇸🇬' },
      { code: 'PH', name: '菲律宾', currency: 'PHP', currencyName: '比索', flag: '🇵🇭' },
      { code: 'ID', name: '印尼', currency: 'IDR', currencyName: '印尼盾', flag: '🇮🇩' }
    ]
  },
  JPKR: {
    label: '日韩', color: '#dc2626',
    countries: [
      { code: 'JP', name: '日本', currency: 'JPY', currencyName: '日元', flag: '🇯🇵' },
      { code: 'KR', name: '韩国', currency: 'KRW', currencyName: '韩元', flag: '🇰🇷' }
    ]
  },
  ME: {
    label: '中东', color: '#d97706',
    countries: [
      { code: 'AE', name: '阿联酋', currency: 'AED', currencyName: '迪拉姆', flag: '🇦🇪' },
      { code: 'SA', name: '沙特', currency: 'SAR', currencyName: '里亚尔', flag: '🇸🇦' },
      { code: 'MA', name: '摩洛哥', currency: 'MAD', currencyName: '迪拉姆', flag: '🇲🇦' },
      { code: 'TR', name: '土耳其', currency: 'TRY', currencyName: '里拉', flag: '🇹🇷' }
    ]
  },
  SA: {
    label: '南亚', color: '#7c3aed',
    countries: [
      { code: 'IN', name: '印度', currency: 'INR', currencyName: '卢比', flag: '🇮🇳' },
      { code: 'PK', name: '巴基斯坦', currency: 'PKR', currencyName: '卢比', flag: '🇵🇰' }
    ]
  },
  LA: {
    label: '拉美', color: '#ea580c',
    countries: [
      { code: 'BR', name: '巴西', currency: 'BRL', currencyName: '雷亚尔', flag: '🇧🇷' },
      { code: 'AR', name: '阿根廷', currency: 'ARS', currencyName: '比索', flag: '🇦🇷' },
      { code: 'CL', name: '智利', currency: 'CLP', currencyName: '比索', flag: '🇨🇱' },
      { code: 'CO', name: '哥伦比亚', currency: 'COP', currencyName: '比索', flag: '🇨🇴' }
    ]
  },
  Oceania: {
    label: '大洋洲', color: '#4f46e5',
    countries: [
      { code: 'AU', name: '澳大利亚', currency: 'AUD', currencyName: '澳元', flag: '🇦🇺' },
      { code: 'NZ', name: '新西兰', currency: 'NZD', currencyName: '新西兰元', flag: '🇳🇿' }
    ]
  }
};

// 1. 地区-国家-币种 全量映射（前端下拉/筛选）
router.get('/regions', (_req, res) => {
  res.json({ regions: CURRENCY_MAP });
});

// 2. 汇率看板（飞书文档 核心展示字段：实时+今日涨跌+30天趋势）
router.get('/board', async (req, res, next) => {
  try {
    const { region } = req.query;
    // 1) 取实时汇率
    const allRates = await query('SELECT code, rate, updated_at FROM exchange_rates');
    const rateMap = Object.fromEntries(allRates.map(r => [r.code, { rate: Number(r.rate), updatedAt: r.updated_at }]));

    // 2) 取今日涨跌（今天 vs 昨天）
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const todayHist = await query(`SELECT code, rate FROM exchange_rate_history WHERE rate_date = ?`, [today]);
    const yestHist  = await query(`SELECT code, rate FROM exchange_rate_history WHERE rate_date = ?`, [yesterday]);
    const tMap = Object.fromEntries(todayHist.map(x => [x.code, Number(x.rate)]));
    const yMap = Object.fromEntries(yestHist.map(x => [x.code, Number(x.rate)]));

    // 3) 取近30天历史
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const history = await query(
      `SELECT code, rate_date, rate FROM exchange_rate_history WHERE rate_date >= ? ORDER BY code, rate_date`,
      [since]
    );
    const histMap = {};
    for (const h of history) {
      if (!histMap[h.code]) histMap[h.code] = [];
      histMap[h.code].push({ date: h.rate_date, rate: Number(h.rate) });
    }

    // 4) 组装区域 -> 国家 -> 可视化数据
    const result = [];
    for (const [rk, rv] of Object.entries(CURRENCY_MAP)) {
      if (region && region !== rk) continue;
      const countries = [];
      for (const c of rv.countries) {
        const live = rateMap[c.currency] || { rate: 1, updatedAt: null };
        const tR = tMap[c.currency];
        const yR = yMap[c.currency];
        let changePct = 0;
        if (tR != null && yR != null && yR > 0) changePct = Number((((tR - yR) / yR) * 100).toFixed(3));
        const trend = histMap[c.currency] || [];
        // 趋势简单指标
        const rates = trend.map(x => x.rate);
        const peak = rates.length ? Math.max(...rates) : 0;
        const valley = rates.length ? Math.min(...rates) : 0;
        countries.push({
          ...c,
          region: rk, regionLabel: rv.label, regionColor: rv.color,
          liveRate: live.rate,
          updatedAt: live.updatedAt,
          changePct,
          trend,
          peak, valley
        });
      }
      result.push({ code: rk, label: rv.label, color: rv.color, countries });
    }
    res.json({
      updatedAt: new Date(),
      items: result,
      summary: {
        totalCurrencies: Object.values(CURRENCY_MAP).reduce((s, r) => s + r.countries.length, 0),
        up: result.flatMap(r => r.countries).filter(c => c.changePct > 0.001).length,
        down: result.flatMap(r => r.countries).filter(c => c.changePct < -0.001).length,
        flat: result.flatMap(r => r.countries).filter(c => Math.abs(c.changePct) <= 0.001).length
      }
    });
  } catch (e) { next(e); }
});

// 3. 单一币种 30 天趋势图（详情页用）
router.get('/trend/:code', async (req, res, next) => {
  try {
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const rows = await query(
      `SELECT rate_date, rate, source FROM exchange_rate_history WHERE code = ? AND rate_date >= ? ORDER BY rate_date`,
      [req.params.code, since]
    );
    const [cur] = await query(`SELECT code, rate, updated_at FROM exchange_rates WHERE code = ?`, [req.params.code]);
    res.json({ code: req.params.code, current: cur || null, trend: rows.map(r => ({ date: r.rate_date, rate: Number(r.rate), source: r.source })) });
  } catch (e) { next(e); }
});

// 4. 刷新汇率（仅运营+owner，写操作会写入 history 快照）
const CRYPTO_KEYS = [
  ['USD', 7.25], ['EUR', 7.86], ['GBP', 9.18], ['JPY', 0.047], ['KRW', 0.0053],
  ['AUD', 4.75], ['CAD', 5.32], ['SGD', 5.38], ['THB', 0.205], ['VND', 0.00029],
  ['MYR', 1.56], ['IDR', 0.00046], ['PHP', 0.128], ['INR', 0.087], ['PKR', 0.026],
  ['MAD', 0.70], ['AED', 1.97], ['SAR', 1.93], ['TRY', 0.215], ['ZAR', 0.42],
  ['BRL', 1.42], ['MXN', 0.42], ['ARS', 0.0085], ['CLP', 0.0079], ['COP', 0.0018],
  ['PLN', 1.83], ['CZK', 0.31], ['HUF', 0.020], ['RON', 1.58], ['SEK', 0.70],
  ['NOK', 0.69], ['DKK', 1.05], ['CHF', 8.30], ['NZD', 4.38], ['HKD', 0.928],
  ['TWD', 0.23], ['CNY', 1.0]
];
router.post('/refresh', async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    let n = 0;
    for (const [code, baseRate] of CRYPTO_KEYS) {
      const jitter = 1 + (Math.random() - 0.5) * 0.008; // 模拟 +/- 0.4% 波动
      const r = Number((baseRate * jitter).toFixed(6));
      await query(
        `INSERT INTO exchange_rates (code, rate) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE rate = VALUES(rate), updated_at = NOW()`,
        [code, r]
      );
      await query(
        `INSERT IGNORE INTO exchange_rate_history (code, rate_date, rate, source) VALUES (?, ?, ?, 'manual_refresh')`,
        [code, today, r]
      );
      n++;
    }
    res.json({ ok: true, refreshed: n, date: today });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.CURRENCY_MAP = CURRENCY_MAP;
