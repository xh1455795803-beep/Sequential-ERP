/*
 * Thalvior — AI 计费文案 · 积分口径覆盖层
 * ==================================================================
 * 背景：后端自 2026-09-26 起，AI 能力计费已从「现金余额」切换为「AI 积分」。
 *      兑换口径：1 元 = 20 积分（后端 CREDITS_PER_YUAN = 20）。
 *      但线上前端是已编译产物，AI 页面仍打印旧文案：
 *         「计费标准：输入 ¥30/百万 tokens、输出 ¥180/百万 tokens（qwen3.x）」
 *         「余额 ¥0.00」
 *      导致用户看到的价格与实际扣费口径完全对不上。
 *
 * 做法：不改编译产物，运行时在 DOM 层做文案重写。
 *  1) 计费标准：把「¥X/百万 tokens」换算成「Y 积分 / 百万 tokens」并去掉 token 单位话术
 *  2) 余额 → 积分：显示真实积分余额（由 credits-adapter 缓存的 window.__thalviorCredits）
 *  3) 图片类：¥0.45/张 → 保持现金口径（编辑页原位 AI 走现金账，见后端 ai-vision）
 *
 * 幂等：可重复加载；失败静默降级，绝不影响主流程。
 */
(function () {
  'use strict';
  if (window.__thalviorAiBilling) return;
  window.__thalviorAiBilling = true;

  var CREDITS_PER_YUAN = 20;

  /* ---------- 换算 ---------- */
  function yuanToCredits(y) {
    var n = Number(y);
    if (!isFinite(n)) return null;
    var c = n * CREDITS_PER_YUAN;
    // 积分取整更友好：>=1 用整数，<1 保留 2 位
    return c >= 1 ? Math.round(c) : Math.round(c * 100) / 100;
  }

  /* ---------- 文案改写核心 ----------
   * 输入示例：
   *   计费标准：输入 ¥30/百万 tokens、输出 ¥180/百万 tokens（qwen3.6-plus）
   *   计费标准：¥0.45/张（qwen3-vl-plus）
   *   计费标准：¥0.2/张
   * 输出：
   *   计费标准：输入 600 积分/百万 tokens、输出 3600 积分/百万 tokens（qwen3.6-plus）
   *   计费标准：¥0.45/张（qwen3-vl-plus）        ← 图片类保持现金
   */
  function rewriteBillingText(text) {
    if (!text || text.indexOf('计费标准') === -1) return null;

    // 图片/按张计费 → 保持现金口径，不做积分换算
    if (text.indexOf('/张') !== -1) return null;

    var changed = false;

    // 替换所有 ¥数字（可带小数）/百万 tokens → 积分
    var out = text.replace(/¥\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*百万\s*tokens/g, function (m, num) {
      var c = yuanToCredits(num);
      if (c === null) return m;
      changed = true;
      return c + ' 积分/百万 tokens';
    });

    // 数字本身为 0 或异常时，不建议误报
    if (!changed) return null;
    return out;
  }

  /* ---------- 单条文本节点处理 ---------- */
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, CODE: 1, PRE: 1 };

  function processTextNode(node) {
    var v = node.nodeValue;
    if (!v || v.length < 4) return;
    if (v.indexOf('计费标准') === -1 && v.indexOf('百万 tokens') === -1) return;

    var next = rewriteBillingText(v);
    if (next && next !== v) {
      node.nodeValue = next;
      return;
    }

    // 兜底：仅出现「¥X/百万 tokens」片段（无「计费标准」前缀）也做替换
    if (v.indexOf('百万 tokens') !== -1) {
      var out = v.replace(/¥\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*百万\s*tokens/g, function (m, num) {
        var c = yuanToCredits(num);
        return c === null ? m : c + ' 积分/百万 tokens';
      });
      if (out !== v) node.nodeValue = out;
    }
  }

  /* ---------- 余额 → 积分 ----------
   * 实际 DOM（编译产物渲染）：
   *   <span class="text-muted-foreground">余额</span>
   *   <span class="font-semibold">¥12.43</span>
   * 两个节点是分开的，所以不能靠单节点正则。
   * 策略：找到文本为「余额」的叶子节点 → 改标签；再找其父容器里的金额节点 → 改数值。
   */
  function creditsNow() {
    var c = window.__thalviorCredits;
    return typeof c === 'number' && isFinite(c) ? c : null;
  }

  function formatCredits(c) {
    if (c === null) return null;
    var r = Math.round(c * 100) / 100;
    return r.toLocaleString('zh-CN');
  }

  var BALANCE_LABEL = /^(余额|当前余额|额度余额|可用余额|AI\s*余额)$/;
  var MONEY_RE = /^¥\s*-?[0-9,]+(\.[0-9]+)?$/;

  function rewriteBalanceNodes() {
    var c = creditsNow();
    if (c === null) return;
    var label = '积分 ' + formatCredits(c);
    var value = formatCredits(c);

    // 找到所有「余额」叶子标签
    var labels = [];
    var all = document.querySelectorAll('span, div, p, label, strong, b');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.children.length !== 0) continue;
      var t = (el.textContent || '').trim();
      if (BALANCE_LABEL.test(t)) labels.push(el);
    }

    for (var j = 0; j < labels.length; j++) {
      var lEl = labels[j];
      var host = lEl.parentElement;
      if (!host) continue;

      // 1) 标签：余额 → 积分
      lEl.textContent = '积分';

      // 2) 主机点内其他叶子：金额 → 积分数
      var kids = host.querySelectorAll('span, div, p, strong, b');
      for (var k = 0; k < kids.length; k++) {
        var kEl = kids[k];
        if (kEl === lEl) continue;
        if (kEl.children.length !== 0) continue;
        var kt = (kEl.textContent || '').trim();
        if (MONEY_RE.test(kt)) {
          kEl.textContent = value;
          kEl.setAttribute('data-thalvior-credits', '1');
        }
      }
    }
  }

  /* ---------- 遍历 ---------- */
  function walk(root) {
    if (!root) return;
    var stack = [root];
    var guard = 0;
    while (stack.length && guard++ < 4000) {
      var el = stack.pop();
      if (!el) continue;

      if (el.nodeType === 3) {
        try { processTextNode(el); } catch (e) {}
        continue;
      }
      if (el.nodeType !== 1) continue;
      if (SKIP_TAGS[el.tagName]) continue;

      var kids = el.childNodes;
      for (var i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
  }

  /* ---------- 定时兜底：React 重渲染后文案会回来 ---------- */
  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    var run = function () {
      scheduled = false;
      try {
        walk(document.body);
        rewriteBalanceNodes();
      } catch (e) {}
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  function start() {
    if (!document.body) return;
    schedule();

    try {
      var mo = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          if (m.type === 'characterData' || (m.addedNodes && m.addedNodes.length)) {
            schedule();
            return;
          }
        }
      });
      mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    } catch (e) {}

    // 低频兜底，防止某些 SPA 场景 MutationObserver 未捕获
    setInterval(function () {
      // 只在 AI 相关路由做全量扫描，降低无谓开销
      var p = location.pathname;
      if (p.indexOf('/ai') === 0 || p.indexOf('/products') === 0 || p === '/dashboard') schedule();
    }, 2500);

    console.log('[Thalvior AI Billing] 积分计费文案覆盖层已加载（1 元 = ' + CREDITS_PER_YUAN + ' 积分）');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
