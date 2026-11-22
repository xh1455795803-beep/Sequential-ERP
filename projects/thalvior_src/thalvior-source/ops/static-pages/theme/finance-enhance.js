/* =====================================================
   Thalvior ERP · 财务中心增强 v1
   1) 侧边栏「财务中心」追加「发票管理」入口
   2) 补齐 /finance/fee（费用管理）与 /finance/reconcile（对账核销）
      两个编译产物中缺失的独立子模块
   数据源：Supabase REST（fees / reconciliations）
   ===================================================== */
(function () {
  'use strict';

  /* ---------- 基础工具 ---------- */
  var ANON_KEY = '';

  function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  function findAnonKey() {
    // 1) window 上探测
    var cands = ['__SUPABASE_ANON_KEY__', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY'];
    for (var i = 0; i < cands.length; i++) {
      var v = window[cands[i]];
      if (typeof v === 'string' && v.split('.').length === 3) return v;
      if (v && typeof v.anonKey === 'string') return v.anonKey;
    }
    // 2) localStorage 里 role=anon 的 JWT
    try {
      for (var j = 0; j < localStorage.length; j++) {
        var k = localStorage.key(j);
        var raw = localStorage.getItem(k);
        if (!raw || raw.indexOf('eyJ') < 0) continue;
        var m = raw.match(/eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g);
        if (!m) continue;
        for (var n = 0; n < m.length; n++) {
          try {
            var payload = JSON.parse(atob(m[n].split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
            if (payload && payload.role === 'anon') return m[n];
          } catch (e) {}
        }
      }
    } catch (e) {}
    // 3) 兜底
    return 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw';
  }

  function getSession() {
    try {
      var raw = ls('sb-thalvior-auth-token') || ls('sb-thalvior-auth-token-auth');
      if (!raw) {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (/^sb-.*-auth-token/.test(k)) { raw = localStorage.getItem(k); break; }
        }
      }
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (s && s.access_token) return s;
      if (s && s.currentSession && s.currentSession.access_token) return s.currentSession;
    } catch (e) {}
    return null;
  }

  function api(path, opts) {
    opts = opts || {};
    var s = getSession();
    var h = { 'Content-Type': 'application/json', 'apikey': ANON_KEY, 'Prefer': 'return=representation' };
    if (s && s.access_token) h['Authorization'] = 'Bearer ' + s.access_token;
    var init = { method: opts.method || 'GET', headers: h };
    if (opts.body) init.body = JSON.stringify(opts.body);
    return fetch(path, init).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 160)); });
      return r.status === 204 ? null : r.json();
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function money(n) {
    var v = Number(n || 0);
    return '¥' + v.toFixed(2);
  }

  function uid() { var s = getSession(); return s && s.user ? s.user.id : null; }

  /* ---------- 通用样式（补充，不改动站点主题） ---------- */
  function injectStyle() {
    if (document.getElementById('tvFinStyle')) return;
    var css = [
      '#tvFinRoot{padding:2px}',
      '#tvFinRoot .tvf-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}',
      '#tvFinRoot .tvf-title{font-size:22px;font-weight:700;color:#0f172a;letter-spacing:.2px;margin:0;line-height:1.35}',
      '#tvFinRoot .tvf-sub{font-size:13px;color:#64748b;margin-top:5px}',
      '#tvFinRoot .tvf-actions{display:flex;gap:10px;flex-shrink:0}',
      '#tvFinRoot .tvf-btn{height:36px;padding:0 16px;border-radius:8px;border:1px solid #d7dee8;background:#fff;color:#334155;font-size:13px;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:.15s}',
      '#tvFinRoot .tvf-btn:hover{border-color:#2563EB;color:#2563EB}',
      '#tvFinRoot .tvf-btn.primary{background:#2563EB;border-color:#2563EB;color:#fff}',
      '#tvFinRoot .tvf-btn.primary:hover{background:#1D4ED8;border-color:#1D4ED8;color:#fff}',
      '#tvFinRoot .tvf-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:16px}',
      '@media(max-width:1200px){#tvFinRoot .tvf-stats{grid-template-columns:repeat(2,1fr)}}',
      '#tvFinRoot .tvf-card{background:#fff;border:1px solid #e8edf4;border-radius:12px;padding:16px 18px;position:relative;overflow:hidden}',
      '#tvFinRoot .tvf-card::before{content:"";position:absolute;left:0;top:0;width:3px;height:100%;background:#2563EB}',
      '#tvFinRoot .tvf-card.g::before{background:#64748B}',
      '#tvFinRoot .tvf-card.o::before{background:#94A3B8}',
      '#tvFinRoot .tvf-card.p::before{background:#1D4ED8}',
      '#tvFinRoot .tvf-clabel{font-size:12px;color:#64748b;margin-bottom:8px}',
      '#tvFinRoot .tvf-cval{font-size:24px;font-weight:700;color:#0f172a;font-variant-numeric:tabular-nums}',
      '#tvFinRoot .tvf-bar{display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap}',
      '#tvFinRoot .tvf-search{flex:1;min-width:200px;max-width:320px;height:36px;padding:0 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;outline:none;background:#fff}',
      '#tvFinRoot .tvf-search:focus{border-color:#2563EB}',
      '#tvFinRoot .tvf-total{margin-left:auto;font-size:13px;color:#64748b}',
      '#tvFinRoot .tvf-tablewrap{background:#fff;border:1px solid #e8edf4;border-radius:12px;overflow:hidden}',
      '#tvFinRoot table{width:100%;border-collapse:collapse}',
      '#tvFinRoot thead th{background:#f8fafc;font-size:12px;font-weight:600;color:#475569;text-align:left;padding:12px 16px;border-bottom:1px solid #e8edf4;white-space:nowrap}',
      '#tvFinRoot tbody td{padding:13px 16px;font-size:13px;color:#1e293b;border-bottom:1px solid #f1f5f9}',
      '#tvFinRoot tbody tr:last-child td{border-bottom:0}',
      '#tvFinRoot tbody tr:hover{background:#fafcff}',
      '#tvFinRoot .tvf-empty{padding:56px 20px;text-align:center;color:#94a3b8;font-size:14px}',
      '#tvFinRoot .tvf-empty .em{display:flex;align-items:center;justify-content:center;margin-bottom:14px;color:#cbd5e1}',
      '#tvFinRoot .tvf-tag{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:500}',
      '#tvFinRoot .tvf-tag.w{background:#fff7ed;color:#c2410c}',
      '#tvFinRoot .tvf-tag.d{background:#f1f5f9;color:#475569}',
      '#tvFinRoot .tvf-link{color:#2563EB;cursor:pointer;font-size:13px;margin-right:12px;background:none;border:0;padding:0}',
      '#tvFinRoot .tvf-link:hover{text-decoration:underline}',
      '#tvFinRoot .tvf-link.danger{color:#dc2626}',
      '.tvf-mask{position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:99999}',
      '.tvf-modal{background:#fff;border-radius:14px;width:520px;max-width:92vw;max-height:88vh;overflow:auto;box-shadow:0 24px 64px rgba(15,23,42,.28)}',
      '.tvf-modal .mh{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #eef2f7}',
      '.tvf-modal .mh h3{font-size:16px;font-weight:600;color:#0f172a;margin:0}',
      '.tvf-modal .mx{border:0;background:none;font-size:22px;line-height:1;color:#94a3b8;cursor:pointer;padding:0 2px}',
      '.tvf-modal .mb{padding:20px 22px}',
      '.tvf-modal .mf{padding:0 22px 20px;display:flex;justify-content:flex-end;gap:10px}',
      '.tvf-field{margin-bottom:15px}',
      '.tvf-field label{display:block;font-size:13px;color:#334155;margin-bottom:7px;font-weight:500}',
      '.tvf-field label i{color:#dc2626;font-style:normal;margin-left:3px}',
      '.tvf-field input,.tvf-field select,.tvf-field textarea{width:100%;box-sizing:border-box;height:38px;padding:0 12px;border:1px solid #dbe3ec;border-radius:8px;font-size:13px;outline:none;font-family:inherit;background:#fff}',
      '.tvf-field textarea{height:74px;padding:9px 12px;resize:vertical}',
      '.tvf-field input:focus,.tvf-field select:focus,.tvf-field textarea:focus{border-color:#2563EB}',
      '.tvf-toast{position:fixed;left:50%;top:82px;transform:translateX(-50%) translateY(-16px);background:#0f172a;color:#fff;padding:11px 22px;border-radius:9px;font-size:13px;z-index:100000;opacity:0;transition:.25s;box-shadow:0 10px 32px rgba(15,23,42,.3)}',
      '.tvf-toast.on{opacity:1;transform:translateX(-50%) translateY(0)}',
      '.tvf-toast.err{background:#b91c1c}',
      '.tvf-nav-new{display:flex;align-items:center;gap:8px}',
      '.tvf-nav-dot{width:5px;height:5px;border-radius:50%;background:#2563EB;margin-left:auto;flex-shrink:0}'
    ].join('\n');
    var st = document.createElement('style');
    st.id = 'tvFinStyle';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function toast(msg, isErr) {
    var t = document.createElement('div');
    t.className = 'tvf-toast' + (isErr ? ' err' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('on'); });
    setTimeout(function () {
      t.classList.remove('on');
      setTimeout(function () { t.remove(); }, 300);
    }, 2600);
  }

  /* ---------- 1) 侧边栏注入「发票管理」 ---------- */
  /* 财务中心的结构：
     div.mb-0.5
       ├─ a[href=/finance]                        ← 「财务中心」父项
       └─ div.ml-[26px].border-l                   ← 子菜单容器（唯一）
            ├─ a[href=/finance]            账单明细
            ├─ a[href=/finance/fee]        费用管理
            └─ a[href=/finance/reconcile]  对账核销
     做法：克隆最后一个子项 <a>，改成「发票管理」，追加进同一个子菜单容器。
     关键：必须克隆 <a> 本身而非容器，否则会把整个子菜单复制一份。 */
  function submenuContainer() {
    var links = document.querySelectorAll('a[href="/finance/reconcile"]');
    for (var i = 0; i < links.length; i++) {
      var r = links[i].getBoundingClientRect();
      if (r.width > 60 && r.left > 30 && r.left < 170) {
        var c = links[i].parentElement;
        if (c && r.left > 40) return c;   // 缩进过的才算子菜单容器
      }
    }
    return null;
  }

  /* 清掉历史版本可能遗留的重复子菜单容器（它们内部必然含「发票管理」） */
  function cleanupStaleNav() {
    var conts = document.querySelectorAll('div[class*="ml-[26px]"][class*="border-l"]');
    var seenMine = false;
    [].slice.call(conts).forEach(function (c) {
      var hasMine = !!c.querySelector('a[href="/finance/invoice"]');
      if (!hasMine) return;
      if (!seenMine) { seenMine = true; return; }  // 保留第一个（真正注入的那个）
      c.remove();                                  // 之后的都是残留
    });
    // 同时清掉上个版本误克隆出的、含多个子项且 id=tvNavInvoice 的容器
    var old = document.getElementById('tvNavInvoice');
    if (old && old.tagName === 'DIV') {
      var a = old.querySelector('a[href="/finance/invoice"]');
      if (a) {
        // 把它里面的发票管理 <a> 挪到真正的子菜单容器里，再删除该容器
        var real = submenuContainer();
        if (real && real !== old) real.appendChild(a);
        if (!old.children.length) old.remove();
      }
    }
  }

  /* 修正 SPA 子路由高亮：/finance/fee 与 /finance/reconcile 时，
     React 会把「账单明细」(/finance) 一起标成 active，导致两项同时高亮。
     这里按当前真实路径重新裁定，只保留当前项的激活态。 */
  function fixActive() {
    var path = location.pathname;
    if (path !== '/finance/fee' && path !== '/finance/reconcile' && path !== '/finance/invoice') return;
    var cont = submenuContainer();
    if (!cont) return;
    var items = [].slice.call(cont.querySelectorAll('a[href]'));
    items.forEach(function (a) {
      var href = a.getAttribute('href');
      var on = (href === path);
      var cls = String(a.className || '');
      if (!on) {
        // 取消高亮
        a.classList.remove('active');
        a.removeAttribute('data-status');
        a.removeAttribute('aria-current');
        a.setAttribute('class', cls
          .split(/\s+/)
          .filter(function (c) {
            if (!c) return false;
            if (c === 'active') return false;
            if (/^text-(primary|accent-foreground|sidebar-accent-foreground)$/.test(c)) return false;
            if (/^bg-(primary|accent|sidebar-accent)$/.test(c)) return false;
            return true;
          })
          .join(' '));
        if (!/text-white\/50/.test(a.className)) a.classList.add('text-white/50');
      } else {
        if (!/\bactive\b/.test(a.className)) a.classList.add('active');
        a.setAttribute('data-status', 'active');
        a.setAttribute('aria-current', 'page');
        a.classList.remove('text-white/50');
      }
    });
    // 父项「财务中心」保持展开态即可，不强制高亮
  }

  function injectSidebar() {
    var cont = submenuContainer();
    if (!cont) return false;

    // 已存在则只做清理
    if (cont.querySelector('a[href="/finance/invoice"]')) { cleanupStaleNav(); return true; }

    // 克隆「对账核销」这个 <a> 本身
    var anchorA = cont.querySelector('a[href="/finance/reconcile"]');
    if (!anchorA) return false;

    var a2 = anchorA.cloneNode(true);
    a2.setAttribute('href', '/finance/invoice');
    a2.removeAttribute('aria-current');
    a2.removeAttribute('data-status');
    a2.removeAttribute('id');

    // 去掉激活态样式，保留 layout 类
    a2.setAttribute('class', String(anchorA.className || '')
      .split(/\s+/)
      .filter(function (c) {
        if (!c) return false;
        if (c === 'active') return false;
        if (/^(bg|ring|shadow)-(primary|accent|sidebar-accent)/.test(c)) return false;
        if (/^text-(primary|accent-foreground)$/.test(c)) return false;
        return true;
      })
      .join(' '));

    // 改文案
    [].slice.call(a2.childNodes).forEach(function (n) {
      if (n.nodeType === 3) a2.removeChild(n);
    });
    var sp = a2.querySelector('span');
    if (sp) { sp.textContent = '发票管理'; sp.removeAttribute('style'); sp.className = 'tvf-nav-new'; }
    else {
      var ns = document.createElement('span');
      ns.textContent = '发票管理';
      ns.className = 'tvf-nav-new';
      a2.appendChild(ns);
    }

    // 加个小图标，与纯文字子项区分
    var ic = document.createElement('span');
    ic.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;margin-right:6px;vertical-align:-2px;flex-shrink:0';
    ic.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15h6"/></svg>';
    a2.insertBefore(ic, a2.firstChild);

    cont.appendChild(a2);
    return true;
  }

  /* ---------- 2) 子模块渲染 ---------- */
  /* 内容区根节点：<main class="flex-1 overflow-y-auto">
     内部唯一子节点为 div.mx-auto.max-w-[1400px].p-4.sm:p-6
     整体替换内部容器即可彻底清掉 SPA 残留内容 */
  function host() {
    // 首选：main 里的 max-w 容器
    var m = document.querySelector('main');
    if (m && m.getBoundingClientRect().width > 600) {
      var inner = m.firstElementChild;
      if (inner && inner.getBoundingClientRect().width > 600) return inner;
      return m;
    }
    // 兜底：按 class 找
    var c = document.querySelector('main > div[class*="mx-auto"][class*="max-w-"]');
    if (c) return c;
    // 再兜底：按 h1 上溯到宽度>1000 的容器
    var h1s = document.querySelectorAll('h1');
    for (var i = 0; i < h1s.length; i++) {
      var r = h1s[i].getBoundingClientRect();
      if (r.left < 200) continue;
      var el = h1s[i];
      for (var d = 0; d < 8 && el.parentElement; d++) {
        if (el.getBoundingClientRect().width > 1000) return el;
        el = el.parentElement;
      }
    }
    return null;
  }

  function renderFee() {
    var root = host();
    if (!root || document.getElementById('tvFinRoot')) return;
    var wrap = document.createElement('div');
    wrap.id = 'tvFinRoot';
    wrap.innerHTML = ''
      + '<div class="tvf-head">'
      + '  <div><h1 class="tvf-title">费用管理</h1>'
      + '  <div class="tvf-sub">集中登记跨境经营各项费用，自动汇总成本结构</div></div>'
      + '  <div class="tvf-actions">'
      + '    <button class="tvf-btn primary" id="tvfAddFee">+ 新增费用</button>'
      + '  </div>'
      + '</div>'
      + '<div class="tvf-stats">'
      + '  <div class="tvf-card"><div class="tvf-clabel">费用总额</div><div class="tvf-cval" id="tvfFeeTotal">¥0.00</div></div>'
      + '  <div class="tvf-card g"><div class="tvf-clabel">费用笔数</div><div class="tvf-cval" id="tvfFeeCount">0</div></div>'
      + '  <div class="tvf-card o"><div class="tvf-clabel">费用类别</div><div class="tvf-cval" id="tvfFeeCats">0</div></div>'
      + '  <div class="tvf-card p"><div class="tvf-clabel">本月新增</div><div class="tvf-cval" id="tvfFeeMonth">¥0.00</div></div>'
      + '</div>'
      + '<div class="tvf-bar">'
      + '  <input class="tvf-search" id="tvfFeeSearch" placeholder="搜索费用名称 / 类别...">'
      + '  <select class="tvf-search" id="tvfFeeFilter" style="max-width:180px"><option value="">全部类别</option></select>'
      + '  <div class="tvf-total" id="tvfFeeHint">共 0 条记录</div>'
      + '</div>'
      + '<div class="tvf-tablewrap">'
      + '  <table><thead><tr>'
      + '    <th style="width:80px">序号</th><th>费用名称</th><th>类别</th>'
      + '    <th style="text-align:right">金额</th><th>登记时间</th><th style="width:120px">操作</th>'
      + '  </tr></thead><tbody id="tvfFeeBody"></tbody></table>'
      + '</div>';
    root.innerHTML = '';
    root.appendChild(wrap);

    var cache = [];
    function paint() {
      var kw = (document.getElementById('tvfFeeSearch').value || '').trim().toLowerCase();
      var cat = document.getElementById('tvfFeeFilter').value;
      var rows = cache.filter(function (r) {
        if (cat && (r.category || '') !== cat) return false;
        if (!kw) return true;
        return ((r.name || '') + ' ' + (r.category || '')).toLowerCase().indexOf(kw) >= 0;
      });
      var tb = document.getElementById('tvfFeeBody');
      if (!rows.length) {
        tb.innerHTML = '<tr><td colspan="6"><div class="tvf-empty"><span class="em"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 8h8"/><path d="M8 12h8"/><path d="M8 16h4"/></svg></span>'
          + (cache.length ? '没有匹配的费用记录' : '还没有费用记录，点击右上角「新增费用」开始登记') + '</div></td></tr>';
      } else {
        tb.innerHTML = rows.map(function (r, i) {
          return '<tr>'
            + '<td>' + (i + 1) + '</td>'
            + '<td style="font-weight:500">' + esc(r.name) + '</td>'
            + '<td><span class="tvf-tag d">' + esc(r.category || '未分类') + '</span></td>'
            + '<td style="text-align:right;font-variant-numeric:tabular-nums;font-weight:600">' + money(r.amount) + '</td>'
            + '<td style="color:#64748b">' + esc((r.created_at || '').replace('T', ' ').slice(0, 16)) + '</td>'
            + '<td><button class="tvf-link danger" data-del="' + r.id + '">删除</button></td>'
            + '</tr>';
        }).join('');
      }
      document.getElementById('tvfFeeHint').textContent = '共 ' + rows.length + ' 条记录';
    }

    function summary() {
      var total = cache.reduce(function (s, r) { return s + Number(r.amount || 0); }, 0);
      var cats = {};
      cache.forEach(function (r) { cats[r.category || '未分类'] = 1; });
      var m = new Date().toISOString().slice(0, 7);
      var monthSum = cache.filter(function (r) { return (r.created_at || '').slice(0, 7) === m; })
        .reduce(function (s, r) { return s + Number(r.amount || 0); }, 0);
      document.getElementById('tvfFeeTotal').textContent = money(total);
      document.getElementById('tvfFeeCount').textContent = cache.length;
      document.getElementById('tvfFeeCats').textContent = Object.keys(cats).length;
      document.getElementById('tvfFeeMonth').textContent = money(monthSum);
      var sel = document.getElementById('tvfFeeFilter');
      var cur = sel.value;
      sel.innerHTML = '<option value="">全部类别</option>' + Object.keys(cats).map(function (c) {
        return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
      }).join('');
      sel.value = cur;
    }

    function load() {
      var uidv = uid();
      if (!uidv) { toast('登录状态失效，请重新登录', true); return; }
      api('/rest/v1/fees?select=id,name,category,amount,created_at&user_id=eq.' + uidv + '&order=created_at.desc')
        .then(function (rows) { cache = rows || []; summary(); paint(); })
        .catch(function (e) { toast('加载失败：' + e.message, true); });
    }

    document.getElementById('tvfFeeSearch').oninput = paint;
    document.getElementById('tvfFeeFilter').onchange = paint;
    document.getElementById('tvfFeeBody').onclick = function (ev) {
      var b = ev.target.closest('[data-del]');
      if (!b) return;
      var id = b.getAttribute('data-del');
      if (!confirm('确认删除这条费用记录？')) return;
      api('/rest/v1/fees?id=eq.' + id, { method: 'DELETE' })
        .then(function () { toast('已删除'); cache = cache.filter(function (r) { return r.id !== id; }); summary(); paint(); })
        .catch(function (e) { toast('删除失败：' + e.message, true); });
    };
    document.getElementById('tvfAddFee').onclick = function () {
      openModal('新增费用', [
        { k: 'name', label: '费用名称', ph: '如：亚马逊佣金 / 头程运费', req: 1 },
        { k: 'category', label: '费用类别', type: 'select', opts: ['平台佣金', '物流运费', '广告推广', '仓储费用', '关税税费', '人工成本', '软件服务', '其他'] },
        { k: 'amount', label: '金额（元）', type: 'number', ph: '0.00', req: 1 }
      ], function (v) {
        var amt = Number(v.amount);
        if (!v.name || !v.name.trim()) { toast('请填写费用名称', true); return false; }
        if (isNaN(amt) || amt <= 0) { toast('请填写正确的金额', true); return false; }
        api('/rest/v1/fees', {
          method: 'POST',
          body: { user_id: uid(), name: v.name.trim(), category: v.category, amount: amt, created_at: new Date().toISOString() }
        }).then(function () { toast('费用已登记'); load(); }).catch(function (e) { toast('保存失败：' + e.message, true); });
        return true;
      });
    };

    load();
  }

  function renderReconcile() {
    var root = host();
    if (!root || document.getElementById('tvFinRoot')) return;
    var wrap = document.createElement('div');
    wrap.id = 'tvFinRoot';
    wrap.innerHTML = ''
      + '<div class="tvf-head">'
      + '  <div><h1 class="tvf-title">对账核销</h1>'
      + '  <div class="tvf-sub">按账单号核对收款金额，完成资金核销闭环</div></div>'
      + '  <div class="tvf-actions">'
      + '    <button class="tvf-btn" id="tvfRecScan">一键核对</button>'
      + '    <button class="tvf-btn primary" id="tvfAddRec">+ 新增核销单</button>'
      + '  </div>'
      + '</div>'
      + '<div class="tvf-stats">'
      + '  <div class="tvf-card o"><div class="tvf-clabel">待核销</div><div class="tvf-cval" id="tvfRecWait">0</div></div>'
      + '  <div class="tvf-card p"><div class="tvf-clabel">待核销金额</div><div class="tvf-cval" id="tvfRecWaitAmt">¥0.00</div></div>'
      + '  <div class="tvf-card g"><div class="tvf-clabel">已核销</div><div class="tvf-cval" id="tvfRecDone">0</div></div>'
      + '  <div class="tvf-card"><div class="tvf-clabel">已核销金额</div><div class="tvf-cval" id="tvfRecDoneAmt">¥0.00</div></div>'
      + '</div>'
      + '<div class="tvf-bar">'
      + '  <input class="tvf-search" id="tvfRecSearch" placeholder="搜索账单号...">'
      + '  <select class="tvf-search" id="tvfRecFilter" style="max-width:180px">'
      + '    <option value="">全部状态</option><option value="待核销">待核销</option><option value="已核销">已核销</option>'
      + '  </select>'
      + '  <div class="tvf-total" id="tvfRecHint">共 0 条记录</div>'
      + '</div>'
      + '<div class="tvf-tablewrap">'
      + '  <table><thead><tr>'
      + '    <th style="width:80px">序号</th><th>账单号</th>'
      + '    <th style="text-align:right">金额</th><th>状态</th><th>登记时间</th><th style="width:160px">操作</th>'
      + '  </tr></thead><tbody id="tvfRecBody"></tbody></table>'
      + '</div>';
    root.innerHTML = '';
    root.appendChild(wrap);

    var cache = [];
    function paint() {
      var kw = (document.getElementById('tvfRecSearch').value || '').trim().toLowerCase();
      var st = document.getElementById('tvfRecFilter').value;
      var rows = cache.filter(function (r) {
        if (st && (r.status || '') !== st) return false;
        if (!kw) return true;
        return String(r.bill_no || '').toLowerCase().indexOf(kw) >= 0;
      });
      var tb = document.getElementById('tvfRecBody');
      if (!rows.length) {
        tb.innerHTML = '<tr><td colspan="6"><div class="tvf-empty"><span class="em"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></span>'
          + (cache.length ? '没有匹配的核销记录' : '还没有核销单，点击右上角「新增核销单」开始对账') + '</div></td></tr>';
      } else {
        tb.innerHTML = rows.map(function (r, i) {
          var done = r.status === '已核销';
          return '<tr>'
            + '<td>' + (i + 1) + '</td>'
            + '<td style="font-weight:500;font-family:ui-monospace,monospace">' + esc(r.bill_no) + '</td>'
            + '<td style="text-align:right;font-variant-numeric:tabular-nums;font-weight:600">' + money(r.amount) + '</td>'
            + '<td><span class="tvf-tag ' + (done ? 'd' : 'w') + '">' + esc(r.status || '待核销') + '</span></td>'
            + '<td style="color:#64748b">' + esc((r.created_at || '').replace('T', ' ').slice(0, 16)) + '</td>'
            + '<td>'
            + (done ? '<span style="color:#94a3b8;font-size:13px">已核销</span>'
                : '<button class="tvf-link" data-do="' + r.id + '">核销</button>')
            + '<button class="tvf-link danger" data-del="' + r.id + '">删除</button>'
            + '</td></tr>';
        }).join('');
      }
      document.getElementById('tvfRecHint').textContent = '共 ' + rows.length + ' 条记录';
    }

    function summary() {
      var wait = cache.filter(function (r) { return r.status !== '已核销'; });
      var done = cache.filter(function (r) { return r.status === '已核销'; });
      var sum = function (a) { return a.reduce(function (s, r) { return s + Number(r.amount || 0); }, 0); };
      document.getElementById('tvfRecWait').textContent = wait.length;
      document.getElementById('tvfRecWaitAmt').textContent = money(sum(wait));
      document.getElementById('tvfRecDone').textContent = done.length;
      document.getElementById('tvfRecDoneAmt').textContent = money(sum(done));
    }

    function load() {
      var uidv = uid();
      if (!uidv) { toast('登录状态失效，请重新登录', true); return; }
      api('/rest/v1/reconciliations?select=id,bill_no,amount,status,created_at&user_id=eq.' + uidv + '&order=created_at.desc')
        .then(function (rows) { cache = rows || []; summary(); paint(); })
        .catch(function (e) { toast('加载失败：' + e.message, true); });
    }

    document.getElementById('tvfRecSearch').oninput = paint;
    document.getElementById('tvfRecFilter').onchange = paint;
    document.getElementById('tvfRecBody').onclick = function (ev) {
      var bd = ev.target.closest('[data-del]');
      var bo = ev.target.closest('[data-do]');
      if (bd) {
        var id = bd.getAttribute('data-del');
        if (!confirm('确认删除这条核销记录？')) return;
        api('/rest/v1/reconciliations?id=eq.' + id, { method: 'DELETE' })
          .then(function () { toast('已删除'); cache = cache.filter(function (r) { return r.id !== id; }); summary(); paint(); })
          .catch(function (e) { toast('删除失败：' + e.message, true); });
        return;
      }
      if (bo) {
        var rid = bo.getAttribute('data-do');
        api('/rest/v1/reconciliations?id=eq.' + rid, { method: 'PATCH', body: { status: '已核销' } })
          .then(function () {
            toast('已核销');
            cache.forEach(function (r) { if (r.id === rid) r.status = '已核销'; });
            summary(); paint();
          })
          .catch(function (e) { toast('核销失败：' + e.message, true); });
      }
    };
    document.getElementById('tvfAddRec').onclick = function () {
      openModal('新增核销单', [
        { k: 'bill_no', label: '账单号', ph: '如：BILL20260926001', req: 1 },
        { k: 'amount', label: '金额（元）', type: 'number', ph: '0.00', req: 1 }
      ], function (v) {
        if (!v.bill_no || !v.bill_no.trim()) { toast('请填写账单号', true); return false; }
        var amt = Number(v.amount);
        if (isNaN(amt) || amt <= 0) { toast('请填写正确的金额', true); return false; }
        api('/rest/v1/reconciliations', {
          method: 'POST',
          body: { user_id: uid(), bill_no: v.bill_no.trim(), amount: amt, status: '待核销', created_at: new Date().toISOString() }
        }).then(function () { toast('核销单已创建'); load(); }).catch(function (e) { toast('保存失败：' + e.message, true); });
        return true;
      });
    };
    document.getElementById('tvfRecScan').onclick = function () {
      var wait = cache.filter(function (r) { return r.status !== '已核销'; });
      if (!wait.length) { toast('当前没有待核销的账单'); return; }
      toast('发现 ' + wait.length + ' 笔待核销账单，可逐笔点击「核销」完成');
    };

    load();
  }

  /* ---------- 通用弹窗 ---------- */
  function openModal(title, fields, onSubmit) {
    var mask = document.createElement('div');
    mask.className = 'tvf-mask';
    var html = '<div class="tvf-modal"><div class="mh"><h3>' + esc(title) + '</h3><button class="mx" data-close>&times;</button></div><div class="mb">';
    fields.forEach(function (f) {
      html += '<div class="tvf-field"><label>' + esc(f.label) + (f.req ? '<i>*</i>' : '') + '</label>';
      if (f.type === 'select') {
        html += '<select data-k="' + f.k + '">' + f.opts.map(function (o) {
          return '<option value="' + esc(o) + '">' + esc(o) + '</option>';
        }).join('') + '</select>';
      } else {
        html += '<input data-k="' + f.k + '" type="' + (f.type || 'text') + '" placeholder="' + esc(f.ph || '') + '"'
          + (f.type === 'number' ? ' step="0.01" min="0"' : '') + '>';
      }
      html += '</div>';
    });
    html += '</div><div class="mf"><button class="tvf-btn" data-close>取消</button><button class="tvf-btn primary" data-ok>确定</button></div></div>';
    mask.innerHTML = html;
    document.body.appendChild(mask);
    function close() { mask.remove(); }
    mask.querySelector('.mx').onclick = close;
    [].slice.call(mask.querySelectorAll('[data-close]')).forEach(function (b) { b.onclick = close; });
    mask.onclick = function (e) { if (e.target === mask) close(); };
    mask.querySelector('[data-ok]').onclick = function () {
      var v = {};
      [].slice.call(mask.querySelectorAll('[data-k]')).forEach(function (el) { v[el.getAttribute('data-k')] = el.value; });
      if (onSubmit(v) !== false) close();
    };
    var first = mask.querySelector('[data-k]');
    if (first) setTimeout(function () { first.focus(); }, 60);
  }

  /* ---------- 路由调度 ---------- */
  var lastPath = '';
  function tick() {
    var path = location.pathname;
    injectSidebar();
    fixActive();
    if (path === lastPath && document.getElementById('tvFinRoot')) return;

    if (path === '/finance/fee' || path === '/finance/reconcile') {
      if (!ANON_KEY) ANON_KEY = findAnonKey();
      injectStyle();
      // 等 SPA 渲染完再覆盖
      setTimeout(function () {
        if (location.pathname !== path) return;
        if (path === '/finance/fee') renderFee();
        else renderReconcile();
        if (!document.getElementById('tvFinRoot')) {
          setTimeout(function () {
            if (location.pathname === path) {
              if (path === '/finance/fee') renderFee(); else renderReconcile();
            }
          }, 700);
        }
      }, 260);
    } else if (path === '/finance' || path.indexOf('/finance') === 0) {
      injectSidebar();
    }
    lastPath = path;
  }

  function boot() {
    injectStyle();
    tick();
    var mo = new MutationObserver(function () { injectSidebar(); fixActive(); });
    mo.observe(document.body, { childList: true, subtree: true });
    // SPA 路由变化
    ['pushState', 'replaceState'].forEach(function (m) {
      var orig = history[m];
      history[m] = function () {
        var r = orig.apply(this, arguments);
        setTimeout(tick, 120);
        return r;
      };
    });
    window.addEventListener('popstate', function () { setTimeout(tick, 120); });
    setInterval(tick, 1200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
