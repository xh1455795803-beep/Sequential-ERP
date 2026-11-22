/**
 * ============================================================
 * Thalvior · 店铺授权页板块归类修复层
 * 注入方：nginx sub_filter（部署不丢失）
 * ------------------------------------------------------------
 * 修复的问题：
 *   支持 OAuth 一键授权的平台（TikTok Shop / Lazada / Shopee）
 *   被错误归类到「手动授权」板块，误导卖家以为只能填 API 密钥。
 *
 * 数据源：platform_auth_config 表（Supabase REST）
 *   - auth_type    : 'oauth' | 'manual'  → 决定归入哪个板块
 *   - oauth_ready  : 后端是否真能跳转    → 决定按钮可用性
 *   - 后台改表即生效，前端不写死
 *
 * 实现方式：原生 MutationObserver 监听 SPA 路由渲染，
 *   找到两个板块的 grid 容器，按配置把卡片移动到正确板块。
 * ============================================================
 */
(function () {
  'use strict';

  var TAG = '[auth-split]';
  var LOG = function () { var a = [TAG].concat([].slice.call(arguments)); console.log.apply(console, a); };

  // ---------- 平台 → 已知的 OAuth 属性（兜底映射，配置表不可用时使用） ----------
  var FALLBACK = {
    'Shopify':       { type: 'oauth',  ready: false },
    'TikTok Shop':   { type: 'oauth',  ready: false },
    'Lazada':        { type: 'oauth',  ready: false },
    'Shopee':        { type: 'oauth',  ready: false }
  };

  var CFG = {};        // 运行时配置：平台名 → {type, ready, note}
  var CFG_LOADED = false;

  // ---------- 1) 从 Supabase REST 拉配置 ----------
  // 与前端 bundle 使用同一个 anon key（公开只读，非机密）
  var ANON_KEY = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw';

  function restBase() {
    // 应用通过 /rest/v1 反代访问 Supabase
    return location.origin + '/rest/v1';
  }

  function loadConfig() {
    return fetch(restBase() + '/platform_auth_config?select=platform_key,platform_name,region,auth_type,oauth_ready,note,sort_order&order=sort_order', {
      headers: { 'Accept': 'application/json', 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY }
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (rows) {
      if (!Array.isArray(rows) || !rows.length) throw new Error('空配置');
      CFG = {};
      rows.forEach(function (x) {
        // 以 platform_key 为准（页面卡片用的是 key）
        CFG[x.platform_key] = {
          type: x.auth_type === 'oauth' ? 'oauth' : 'manual',
          ready: !!x.oauth_ready,
          note: x.note || '',
          name: x.platform_name,
          region: x.region
        };
      });
      CFG_LOADED = true;
      LOG('配置已加载，共', rows.length, '条 | OAuth:',
        rows.filter(function (r) { return r.auth_type === 'oauth'; }).map(function (r) { return r.platform_key; }).join(', '));
      return CFG;
    }).catch(function (e) {
      LOG('配置加载失败，使用兜底映射:', e.message);
      CFG = Object.assign({}, FALLBACK);
      CFG_LOADED = true;
      return CFG;
    });
  }

  function cfgOf(key) {
    return CFG[key] || FALLBACK[key] || { type: 'manual', ready: false };
  }

  // ---------- 2) 定位页面结构 ----------
  // 找到「一键 OAuth 授权」和「手动授权」两个板块的 grid 容器
  function findSections() {
    var out = { oauth: null, manual: null, oauthHead: null, manualHead: null };
    var h2s = document.querySelectorAll('h2');
    for (var i = 0; i < h2s.length; i++) {
      var h = h2s[i];
      var txt = (h.textContent || '').trim();
      var isOAuth = /一键\s*OAuth\s*授权/i.test(txt);
      var isManual = /^手动授权$/.test(txt);
      if (!isOAuth && !isManual) continue;

      // h2 的下一个兄弟（或父容器内）就是 grid
      var grid = null, n = h.nextElementSibling;
      while (n) {
        if (n.querySelectorAll && n.querySelectorAll('button, [class*="cursor-pointer"]').length > 0 &&
            n.className && /grid/.test(n.className)) { grid = n; break; }
        if (n.className && /grid/.test(n.className)) { grid = n; break; }
        n = n.nextElementSibling;
      }
      // 找不到就往上找父容器里的 grid
      if (!grid) {
        var p = h.parentElement;
        for (var d = 0; d < 3 && p; d++) {
          var g = p.querySelector('[class*="grid"]');
          if (g) { grid = g; break; }
          p = p.parentElement;
        }
      }
      if (isOAuth) { out.oauth = grid; out.oauthHead = h; }
      else { out.manual = grid; out.manualHead = h; }
    }
    return out;
  }

  // 从卡片 DOM 里读出平台标识
  function platformOfCard(card) {
    var txt = (card.textContent || '').trim();
    // 1) 先用「最长 key 优先」精确前缀匹配（避免 Amazon 抢走 Amazon US）
    var keys = Object.keys(CFG).sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < keys.length; i++) {
      if (txt.indexOf(keys[i]) === 0 || txt.indexOf(keys[i]) > -1) return keys[i];
    }
    // 2) 再按平台名 + 区域二次确认（Amazon 美国站 / 日本站 / 欧洲站）
    var m = txt.match(/^(Amazon|Shopify|eBay|Walmart|Etsy|Temu|Shein|AliExpress|Lazada|Shopee|TikTok)/i);
    if (m) {
      var brand = m[1];
      var regionMap = { '美国站': 'Amazon US', '日本站': 'Amazon JP', '欧洲站': 'Amazon EU' };
      var rk = Object.keys(regionMap);
      for (var j = 0; j < rk.length; j++) {
        if (txt.indexOf(rk[j]) > -1 && CFG[regionMap[rk[j]]]) return regionMap[rk[j]];
      }
      // 回退：取配置表里第一个匹配该品牌的 key
      var cands = Object.keys(CFG).filter(function (k) { return k.toLowerCase().indexOf(brand.toLowerCase()) === 0; });
      if (cands.length) return cands[0];
    }
    return null;
  }

  function isCard(el) {
    if (!el || el.nodeType !== 1) return false;
    var cls = el.className || '';
    if (typeof cls !== 'string') return false;
    // 应用卡片特征：rounded + border/ bg-card
    if (!/rounded/.test(cls)) return false;
    if (!/(border|bg-card|shadow)/.test(cls)) return false;
    // 必须含平台名与授权按钮
    var t = el.textContent || '';
    if (!/(授权|OAuth)/.test(t)) return false;
    if (t.length > 260) return false;   // 排除外层大容器
    return true;
  }

  // ---------- 3) 板块重排 ----------
  var appliedStamp = '';

  function reorder() {
    var secs = findSections();
    if (!secs.oauth || !secs.manual) { return false; }

    var allCards = [];
    [secs.oauth, secs.manual].forEach(function (g) {
      [].slice.call(g.children).forEach(function (c) {
        if (isCard(c)) allCards.push(c);
      });
    });
    if (!allCards.length) return false;

    // 分组
    var toOauth = [], toManual = [], unknown = [];
    allCards.forEach(function (c) {
      var key = platformOfCard(c);
      if (!key) { unknown.push(c); return; }
      var cf = cfgOf(key);
      (cf.type === 'oauth' ? toOauth : toManual).push({ el: c, key: key });
    });

    // 排序：按配置 sort_order（CFG 已按 order 拉取，用 key 顺序近似）
    var orderKeys = Object.keys(CFG);
    var rank = {};
    orderKeys.forEach(function (k, i) { rank[k] = i; });
    toOauth.sort(function (a, b) { return (rank[a.key] || 99) - (rank[b.key] || 99); });
    toManual.sort(function (a, b) { return (rank[a.key] || 99) - (rank[b.key] || 99); });

    // 生成签名，避免重复移动（但即使签名相同也要保证标注存在）
    var sig = toOauth.map(function (x) { return x.key; }).join('|') + '//' +
              toManual.map(function (x) { return x.key; }).join('|');
    var same = (sig === appliedStamp);

    if (!same) {
      // 执行移动
      toOauth.forEach(function (x) { if (x.el.parentElement !== secs.oauth) secs.oauth.appendChild(x.el); });
      toManual.forEach(function (x) { if (x.el.parentElement !== secs.manual) secs.manual.appendChild(x.el); });
      appliedStamp = sig;
      LOG('板块重排完成 → OAuth 区:', toOauth.map(function (x) { return x.key; }).join(', ') || '(空)');
      LOG('                    → 手动区:', toManual.map(function (x) { return x.key; }).join(', ') || '(空)');
      if (unknown.length) LOG('未识别卡片', unknown.length, '个');
    }

    // 标注必须每次执行（页面重渲染会丢失）
    if (!document.querySelector('.tv-auth-note') || !same) markCards(secs);
    return true;
  }

  // ---------- 4) 卡片标注与提示 ----------
  function markCards(secs) {
    // ⚠️ 关键：先清掉所有旧标注，再按「当前实际所在板块」重新标注。
    //    否则卡片被移动后，旧标注会跟着跑到错误板块。
    [].slice.call(document.querySelectorAll('.tv-auth-note')).forEach(function (x) { x.remove(); });
    [].slice.call(document.querySelectorAll('[data-tv-oauth],[data-tv-manual]')).forEach(function (x) {
      x.removeAttribute('data-tv-oauth'); x.removeAttribute('data-tv-manual');
      x.removeAttribute('title');
    });

    if (secs.oauth) {
      [].slice.call(secs.oauth.children).forEach(function (c) {
        if (!isCard(c)) return;
        var key = platformOfCard(c);
        var cf = key ? cfgOf(key) : null;
        c.setAttribute('data-tv-oauth', '1');
        c.setAttribute('title', '跳转平台官方登录页，一键完成授权，无需复制 API 密钥');
        fixButtonText(c, '一键授权', cf && !cf.ready);
        annotate(c, '平台官方 OAuth · 一键跳转授权', cf && !cf.ready);
      });
    }
    if (secs.manual) {
      [].slice.call(secs.manual.children).forEach(function (c) {
        if (!isCard(c)) return;
        c.setAttribute('data-tv-manual', '1');
        c.setAttribute('title', '需准备 API 密钥与卖家账号信息，手动填写完成绑定');
        fixButtonText(c, '手动授权', false);
        annotate(c, '需手动填写 API 密钥与店铺信息', false);
      });
    }
  }

  /**
   * 修正卡片内按钮文字 —— 这是本次修复的核心：
   * 原来的 bug 是 TikTok Shop 等 OAuth 平台被放在「手动授权」板块，
   * 按钮写着"手动授权"，卖家以为只能填 API 密钥。
   * 现在按板块强制改写按钮文字。
   */
  function fixButtonText(card, want, pending) {
    var btn = card.querySelector('button, [role="button"], [class*="cursor-pointer"]');
    if (!btn) return;
    // 找到承载文字的节点（按钮内最后一个纯文本 span 或按钮本身）
    var target = null;
    var spans = btn.querySelectorAll('span');
    for (var i = spans.length - 1; i >= 0; i--) {
      var t = (spans[i].textContent || '').trim();
      if (/^(一键授权|手动授权|立即授权|去授权|授权)$/.test(t) && spans[i].children.length === 0) { target = spans[i]; break; }
    }
    if (!target) {
      var own = Array.prototype.filter.call(btn.childNodes, function (n) { return n.nodeType === 3; });
      if (own.length) own[0].nodeValue = want;
      return;
    }
    if (target.textContent.trim() !== want) {
      target.textContent = want;
      LOG('  按钮文字已修正 →', want, '(' + (platformOfCard(card) || '?') + ')');
    }
  }

  function annotate(card, text, pending) {
    var old = card.querySelector('.tv-auth-note');
    if (old) old.remove();
    var el = document.createElement('div');
    el.className = 'tv-auth-note';
    el.textContent = text;
    el.style.cssText = [
      'margin-top:8px', 'font-size:11px', 'line-height:1.45',
      'color:' + (pending ? '#B45309' : '#64748B'),
      pending ? 'background:#FFFBEB' : 'background:#F8FAFC',
      'border:1px solid ' + (pending ? '#FDE68A' : '#E2E8F0'),
      'border-radius:6px', 'padding:5px 8px', 'font-weight:500'
    ].join(';');
    card.appendChild(el);
  }

  // ---------- 5) 板块小标题说明（改写应用原生 desc，不新增第二个） ----------
  function ensureGroupDesc() {
    var secs = findSections();
    var map = [
      [secs.oauthHead, '跳转平台官方登录页，一键完成店铺授权，自动同步店铺数据，无需手动复制 API 密钥'],
      [secs.manualHead, '平台暂未开放 OAuth 一键登录，需要手动填写 API 密钥、店铺信息完成绑定']
    ];
    map.forEach(function (pair) {
      var h = pair[0];
      if (!h || !h.parentElement) return;
      // 先清掉本脚本上一轮塞进去的
      var mine = h.parentElement.querySelector('.tv-group-desc');
      if (mine) mine.remove();

      // 应用原生 desc 是 h2 的兄弟节点（span），直接改写它的文案
      var sib = h.nextElementSibling;
      while (sib && sib !== h) {
        if (sib.tagName === 'SPAN' || sib.tagName === 'P') break;
        if (sib.tagName === 'DIV' && sib.children.length === 0) break;
        sib = sib.nextElementSibling;
      }
      if (sib && sib !== h) {
        var cur = (sib.textContent || '').trim();
        if (cur) {
          sib.textContent = pair[1];
          sib.setAttribute('data-tv-desc', '1');
          return;
        }
      }
      // 确实没有才补一个
      var s = document.createElement('span');
      s.className = 'tv-group-desc';
      s.setAttribute('data-tv-desc', '1');
      s.textContent = pair[1];
      s.style.cssText = 'margin-left:8px;font-size:12px;font-weight:500;color:#64748B';
      h.parentElement.appendChild(s);
    });
  }

  // ---------- 7) 新增授权弹窗：渠道下拉按授权方式分组 ----------
  function enhanceDialog() {
    var dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return false;
    if (dlg.getAttribute('data-tv-dialog') === '1') return true;

    // 找到「渠道」下拉：选项里含平台名
    var sel = null;
    var sels = dlg.querySelectorAll('select');
    for (var i = 0; i < sels.length; i++) {
      var opts = [].slice.call(sels[i].options).map(function (o) { return o.value; });
      if (opts.indexOf('Shopify') > -1 || opts.indexOf('Amazon US') > -1) { sel = sels[i]; break; }
    }
    if (!sel) return false;

    var cur = sel.value;
    var all = [].slice.call(sel.options).map(function (o) { return { v: o.value, t: o.textContent }; });

    // 按配置分组
    var oauth = [], manual = [], other = [];
    all.forEach(function (o) {
      var cf = CFG[o.v];
      if (!cf) { other.push(o); return; }
      (cf.type === 'oauth' ? oauth : manual).push(o);
    });

    if (!oauth.length && !manual.length) return false;

    // 重建 options（用 optgroup 分组）
    sel.innerHTML = '';
    function mkGroup(label, arr) {
      if (!arr.length) return;
      var og = document.createElement('optgroup');
      og.label = label;
      arr.forEach(function (o) {
        var op = document.createElement('option');
        op.value = o.v;
        var cf = CFG[o.v] || {};
        // 选项文案标注授权方式，避免卖家误选后才发现
        var suffix = cf.type === 'oauth'
          ? (cf.ready ? '（一键 OAuth）' : '（一键 OAuth 待启用）')
          : '（手动填写密钥）';
        op.textContent = o.t + suffix;
        og.appendChild(op);
      });
      sel.appendChild(og);
    }
    mkGroup('✅ 支持一键 OAuth 授权', oauth);
    mkGroup('✍ 需手动填写 API 密钥', manual);
    mkGroup('其他', other);

    // 恢复原选中值
    if (cur) sel.value = cur;

    dlg.setAttribute('data-tv-dialog', '1');

    // 下方加一行提示，随选择变化
    var hint = dlg.querySelector('.tv-dialog-hint');
    if (!hint) {
      hint = document.createElement('div');
      hint.className = 'tv-dialog-hint';
      hint.style.cssText = 'margin-top:6px;font-size:12px;line-height:1.5;border-radius:6px;padding:6px 9px';
      var selBox = sel.parentElement;
      selBox.appendChild(hint);
    }
    function refreshHint() {
      var cf = CFG[sel.value];
      if (!cf) { hint.style.display = 'none'; return; }
      hint.style.display = '';
      if (cf.type === 'oauth') {
        hint.textContent = cf.ready
          ? '该平台支持一键授权：保存后将跳转平台官方登录页完成绑定。'
          : '该平台支持一键 OAuth 授权，但本系统尚未配置密钥，当前请先按手动方式录入信息。';
        hint.style.cssText = 'margin-top:6px;font-size:12px;line-height:1.5;border-radius:6px;padding:6px 9px;background:#FFF7ED;border:1px solid #FED7AA;color:#9A3412';
      } else {
        hint.textContent = '该平台需手动授权：请提前准备 API 密钥与卖家账号信息。';
        hint.style.cssText = 'margin-top:6px;font-size:12px;line-height:1.5;border-radius:6px;padding:6px 9px;background:#F8FAFC;border:1px solid #E2E8F0;color:#475569';
      }
    }
    sel.addEventListener('change', refreshHint);
    refreshHint();
    LOG('弹窗渠道下拉已按授权方式分组');
    return true;
  }

  // ---------- 6) 启动 ----------
  function apply() {
    try {
      ensureGroupDesc();
      reorder();
      enhanceDialog();
    } catch (e) { LOG('apply 异常:', e.message); }
  }

  function boot() {
    // SPA 路由监听 + 弹窗监听
    var mo = new MutationObserver(function () {
      clearTimeout(boot._t);
      boot._t = setTimeout(function () {
        // 弹窗（与路由无关，弹窗打开时当前路由不变）
        var dlg = document.querySelector('[role="dialog"]');
        if (dlg) {
          if (dlg.getAttribute('data-tv-dialog') !== '1') enhanceDialog();
          return;
        }
        // 授权页板块
        if (location.pathname !== '/auth' && location.pathname !== '/shop-auth') return;
        if (!document.querySelector('h1')) return;
        apply();
      }, 220);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    // 首次加载
    loadConfig().then(function () {
      var tries = 0;
      var iv = setInterval(function () {
        tries++;
        if (/店铺授权/.test(document.body.textContent || '') || tries > 40) {
          clearInterval(iv);
          apply();
          setTimeout(apply, 600);
          setTimeout(apply, 1600);
        }
      }, 250);
    });

    // 供调试
    window.__tvAuthSplit = { apply: apply, reload: loadConfig, cfg: function () { return CFG; } };
    LOG('已就绪');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
