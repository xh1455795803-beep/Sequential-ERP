/* Thalvior · 登录 / 注册页 OSS 风格增强   v5  2026-09-27
 * ---------------------------------------------------------------
 * 纯视觉调性（不宣称开源、不挂假数据）：
 *   1) 左栏 SVG 装饰 → 品牌化「终端卡」（产品 CLI 示例，无虚构数值）
 *   2) 表单卡顶部加 mono 眉标 + 标题（SIGN IN / GET STARTED）
 *      注意类名用 .tv-sechead —— 绝不可含 "card"/"head" 子串，
 *      否则会被 theme.css 的 [class*="card"](白底) 规则误伤。
 *   3) Tab 分段控件打标 .tv-tabs（由 CSS 接管胶囊态）
 *   4) 左栏底部技术标签 + 卡片底部信任微文案
 *   5) 给 <html> 打 tv-auth，OSS 皮肤 CSS 仅作用于认证页
 *
 * ⚠️ 全部 DOM 改写必须「幂等」：靠已存在标记(class)提前 return，
 *    避免 MutationObserver 因写入同值再次触发 → 死循环（v2 教训）。
 *    仅做视觉/文案修正，不触碰任何认证逻辑。
 */
(function () {
  if (window.__tvAuthPanelFix) return;
  window.__tvAuthPanelFix = true;

  function isAuth() {
    return /^\/(login|register|signup|signin|auth|reset-password)/i.test(location.pathname);
  }

  function tvTerm(kind) {
    var body = kind === 'register'
      ? '<span class="c-prompt">$</span> <span class="c-cmd">thalvior register</span>\n'
        + '<span class="c-ok">✓</span> 账号已创建，验证邮件已发送\n'
        + '<span class="c-prompt">$</span> <span class="c-cmd">thalvior connect --guide</span>\n'
        + '<span class="c-sync">↻</span> 5 分钟完成首个店铺授权'
      : '<span class="c-prompt">$</span> <span class="c-cmd">thalvior connect shopify</span>\n'
        + '<span class="c-ok">✓</span> 授权成功 · Shopify US\n'
        + '<span class="c-prompt">$</span> <span class="c-cmd">thalvior sync --all</span>\n'
        + '<span class="c-sync">↻</span> 商品·订单·库存·物流 已同步';
    return '<div class="tv-term" role="img" aria-label="Thalvior 命令行示例">'
      + '<div class="tv-term-bar"><span class="tv-dot r"></span><span class="tv-dot y"></span><span class="tv-dot g"></span>'
      + '<span class="tv-term-title">thalvior — cli</span></div>'
      + '<div class="tv-term-body">' + body + '</div></div>';
  }

  function renderTerminal() {
    var block = document.querySelector('aside div.mt-10.max-w-md');
    if (!block || block.querySelector('.tv-term')) return;
    block.innerHTML = tvTerm(/^\/register/i.test(location.pathname) ? 'register' : 'login');
  }

  function renderCardHead() {
    var card = document.querySelector('div.glass');
    if (!card || card.querySelector('.tv-sechead')) return;
    var reg = /^\/register/i.test(location.pathname);
    var head = document.createElement('div');
    head.className = 'tv-sechead';
    head.innerHTML = '<div class="tv-kicker">' + (reg ? 'GET STARTED' : 'SIGN IN') + '</div>'
      + '<h1>' + (reg ? '创建您的 Thalvior 账户' : '登录到 Thalvior 控制台') + '</h1>';
    card.insertBefore(head, card.firstChild);
  }

  function tagTabs() {
    var t = document.querySelector('div.glass > div.grid.grid-cols-2');
    if (t && !t.classList.contains('tv-tabs')) t.classList.add('tv-tabs');
  }

  function renderTech() {
    var aside = document.querySelector('aside.bg-ink');
    if (!aside || aside.querySelector('.tv-tech')) return;
    var d = document.createElement('div');
    d.className = 'tv-tech';
    d.innerHTML = '<span>REST API</span><span>Webhook</span><span>多租户隔离</span><span>开放文档</span>';
    aside.appendChild(d);
  }

  function renderTrust() {
    var card = document.querySelector('div.glass');
    if (!card || card.querySelector('.tv-trust')) return;
    var d = document.createElement('div');
    d.className = 'tv-trust';
    d.textContent = 'TLS 加密传输 · 多租户数据隔离 · 符合跨境合规';
    card.appendChild(d);
  }

  function styleEyebrow() {
    var e = document.querySelector('aside .manifest-eyebrow');
    if (!e || e.dataset.tvStyled) return;
    e.dataset.tvStyled = '1';
    e.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    e.style.letterSpacing = '.12em';
  }

  /* 注册页右侧副标题去重（幂等） */
  function fixRegisterSub() {
    if (!/^\/register/i.test(location.pathname)) return;
    var els = document.querySelectorAll('p,div,span');
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if (e.children.length || e.closest('aside')) continue;
      if ((e.textContent || '').trim() === '开启您的跨境生意管理') e.textContent = '5 分钟完成注册，立即开通您的经营后台';
    }
  }
  /* 账号字段标签/占位统一（幂等） */
  function unifyAccountField() {
    var els = document.querySelectorAll('label,div,span,p');
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if (e.children.length) continue;
      if ((e.textContent || '').trim().replace(/\s+/g, '') === '手机号/邮箱') e.textContent = '邮箱 / 手机号';
    }
    var ins = document.querySelectorAll('input[placeholder="请输入手机号或邮箱"]');
    for (var k = 0; k < ins.length; k++) ins[k].setAttribute('placeholder', '请输入邮箱或手机号');
  }

  function run() {
    if (!isAuth()) return;
    document.documentElement.classList.add('tv-auth');
    try {
      renderTerminal(); renderCardHead(); tagTabs(); renderTech(); renderTrust();
      styleEyebrow(); fixRegisterSub(); unifyAccountField();
    } catch (e) {}
  }

  var scheduled = false, running = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
    raf(function () { scheduled = false; if (!running) { running = true; try { run(); } finally { running = false; } } });
  }
  function boot() {
    run();
    try { new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
    window.addEventListener('popstate', run);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
