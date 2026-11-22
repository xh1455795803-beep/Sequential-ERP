/*
 * Thalvior — AI 积分体系前端适配层 v2
 * ------------------------------------------------------------------
 * 背景：后端已从「现金余额 balance」切换为「AI 积分 credits」计费。
 *      线上前端是已编译产物，界面仍直接读 tenant_quotas.balance。
 *
 * 做法：运行时在网络层做「读 credits / 写 credits」重定向。
 *      1) PostgREST 响应：tenant_quotas 的 balance 用 credits 覆盖
 *      2) PostgREST 请求：select=balance → select=balance,credits；写 balance → 写 credits
 *      3) auth/v1/user：同步真实积分到 user_metadata
 *      4) 订阅页路由接管
 *
 * v2 修复（2026-09-26）：
 *      Supabase JS SDK 内部以 Request 对象调用 fetch，旧版只重写字符串 URL，
 *      导致 select=balance 未追加 credits，前端拿不到积分、顶部余额始终为 0。
 *      现对 Request 对象做重建（URL + method + headers + body 全量搬）。
 *
 * 幂等：可重复加载；失败时静默降级，不影响主流程。
 */
(function () {
  'use strict';
  if (window.__thalviorCreditsAdapter) return;
  window.__thalviorCreditsAdapter = true;

  var CREDITS_PER_YUAN = 20;
  var origFetch = window.fetch.bind(window);

  /* ---------------- 工具 ---------------- */
  function isQuotasUrl(u) {
    return typeof u === 'string' && u.indexOf('/rest/v1/tenant_quotas') !== -1;
  }
  function isAuthUserUrl(u) {
    return typeof u === 'string' && u.indexOf('/auth/v1/user') !== -1;
  }
  function num(v, d) {
    var n = Number(v);
    return isFinite(n) ? n : (d === undefined ? 0 : d);
  }
  function creditToBalance(credits) {
    return Number((credits / CREDITS_PER_YUAN).toFixed(2));
  }

  /* ---------------- 1) 改写请求 URL ---------------- */
  function rewriteUrl(u) {
    if (!isQuotasUrl(u)) return u;
    try {
      return u.replace(/select=([^&]*)/, function (m, fields) {
        if (fields.indexOf('*') !== -1) return m;
        if (fields.indexOf('credits') !== -1) return m;
        return 'select=' + fields + ',credits';
      });
    } catch (e) {}
    return u;
  }

  /* ---------------- 2) 改写请求体（写入 balance → credits） ---------------- */
  function rewriteBody(body) {
    if (!body || typeof body !== 'string') return body;
    try {
      var o = JSON.parse(body);
      if (o && typeof o === 'object' && !Array.isArray(o) && 'balance' in o && !('credits' in o)) {
        var target = num(o.balance) * CREDITS_PER_YUAN;
        delete o.balance;
        o.credits = Math.round(target * 100) / 100;
        return JSON.stringify(o);
      }
      if (Array.isArray(o)) {
        var changed = false;
        o = o.map(function (item) {
          if (item && typeof item === 'object' && 'balance' in item && !('credits' in item)) {
            var copy = Object.assign({}, item, {
              credits: Math.round(num(item.balance) * CREDITS_PER_YUAN * 100) / 100
            });
            delete copy.balance;
            changed = true;
            return copy;
          }
          return item;
        });
        if (changed) return JSON.stringify(o);
      }
    } catch (e) {}
    return body;
  }

  /* ---------------- 3) 改写响应 ----------------
   * 关键：前端把 balance 当作「可用额度」直接显示。既有积分体系下，
   * 应让 balance 字段**携带积分数值本身**（而非折算回现金），
   * 这样顶部「余额」文案配合 ai-billing.js 改标签后即为「积分 248.5」。
   */
  function reshapeRow(row) {
    if (!row || typeof row !== 'object') return row;
    if ('credits' in row || 'balance' in row) {
      var credits = num(row.credits, null);
      if (credits !== null) {
        row.balance = credits;   // 直接透出积分，不做 1/20 折算
        row.credit_balance = credits;
        row.__credits = credits;
      } else if (row.balance === null) {
        row.balance = 0;
      }
    }
    return row;
  }
  function reshapePayload(payload) {
    if (Array.isArray(payload)) return payload.map(reshapeRow);
    if (payload && typeof payload === 'object') return reshapeRow(payload);
    return payload;
  }

  /* ---------------- 4) auth/v1/user ---------------- */
  function storeCreditsCache(credits) {
    try { window.__thalviorCredits = credits; } catch (e) {}
  }
  function paintAuthUser(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    var cached = window.__thalviorCredits;
    if (typeof cached === 'number') {
      payload.user_metadata = payload.user_metadata || {};
      payload.user_metadata.credit_balance = cached;
      payload.user_metadata.credits = cached;
      payload.user_metadata.balance = Number((cached / CREDITS_PER_YUAN).toFixed(2));
    }
    return payload;
  }

  /* ---------------- 5) Request 对象重建（v2 核心修复） ----------------
   * SDK 传 Request 对象时，旧版直接放行，URL 未被重写。
   * 这里把 Request 拆开、改写 URL 与 body、再重建。
   */
  function rebuildRequest(req, newUrl, newBody) {
    try {
      var init = {
        method: req.method,
        headers: req.headers,
        credentials: req.credentials,
        mode: req.mode,
        cache: req.cache,
        redirect: req.redirect,
        referrer: req.referrer,
        referrerPolicy: req.referrerPolicy,
        integrity: req.integrity,
        keepalive: req.keepalive,
        signal: req.signal
      };
      // GET/HEAD 不允许带 body
      var m = (req.method || 'GET').toUpperCase();
      if (newBody != null && m !== 'GET' && m !== 'HEAD') {
        init.body = newBody;
        init.duplex = 'half';
      }
      return new Request(newUrl, init);
    } catch (e) {
      return null;
    }
  }

  var patchedFetch = function (input, init) {
    var isReqObj = (typeof Request !== 'undefined') && (input instanceof Request);
    var url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
    var quotaReq = isQuotasUrl(url);
    var authReq = isAuthUserUrl(url);

    if (!quotaReq && !authReq) return origFetch(input, init);

    var nextInit = init || {};
    var nextInput = input;

    if (quotaReq) {
      var newUrl = rewriteUrl(url);

      if (isReqObj) {
        var rawBody = (nextInit && nextInit.body) ? nextInit.body : null;
        var rewritten = rewriteBody(rawBody);
        var built = rebuildRequest(input, newUrl, rewritten);
        if (built) {
          nextInput = built;
          nextInit = null;
        } else {
          nextInput = newUrl;
        }
      } else {
        nextInput = newUrl;
        if (nextInit.body) nextInit.body = rewriteBody(nextInit.body);
      }
    }

    var p = nextInit ? origFetch(nextInput, nextInit) : origFetch(nextInput);

    return p.then(function (res) {
      if (!quotaReq && !authReq) return res;

      return res.clone().text().then(function (text) {
        var payload;
        try { payload = JSON.parse(text); } catch (e) { return res; }

        if (quotaReq) {
          payload = reshapePayload(payload);
          try {
            var rows = Array.isArray(payload) ? payload : [payload];
            for (var i = 0; i < rows.length; i++) {
              if (rows[i] && typeof rows[i].credits === 'number') {
                storeCreditsCache(rows[i].credits);
                break;
              }
            }
          } catch (e) {}
        } else if (authReq) {
          payload = paintAuthUser(payload);
        }

        var headers = new Headers(res.headers);
        headers.delete('content-length');
        return new Response(JSON.stringify(payload), {
          status: res.status,
          statusText: res.statusText,
          headers: headers
        });
      }).catch(function () { return res; });
    });
  };

  /* ---------------- 安装拦截 ----------------
   * 注意：enhance.js 把 window.fetch 定义成「只读 getter」，
   * 直接赋值 window.fetch = fn 在严格模式下会抛 TypeError 并中断本脚本。
   * 因此必须用 defineProperty 重新定义 getter。
   */
  try {
    Object.defineProperty(window, 'fetch', {
      get: function () { return patchedFetch; },
      configurable: true
    });
  } catch (e) {
    try { window.fetch = patchedFetch; } catch (e2) {}
  }

  /* ---------------- 6) 订阅页路由接管 ---------------- */
  (function watchSubscriptionRoute() {
    var SUB_ROUTE = '/subscription';
    var SUPPORTED_PUSHSTATE =
      typeof window.history !== 'undefined' && typeof window.history.pushState === 'function';

    function hardRedirectIfNeeded() {
      var p = window.location.pathname.replace(/\/+$/, '') || '/';
      if (p !== SUB_ROUTE) return false;
      try {
        window.location.reload();
      } catch (e) {
        window.location.href = SUB_ROUTE;
      }
      return true;
    }

    if (SUPPORTED_PUSHSTATE) {
      var rawPush = window.history.pushState;
      var rawReplace = window.history.replaceState;
      window.history.pushState = function () {
        var r = rawPush.apply(this, arguments);
        hardRedirectIfNeeded();
        return r;
      };
      window.history.replaceState = function () {
        var r = rawReplace.apply(this, arguments);
        hardRedirectIfNeeded();
        return r;
      };
    }
    window.addEventListener('popstate', function () { hardRedirectIfNeeded(); });

    var lastPath = window.location.pathname;
    setInterval(function () {
      if (window.location.pathname !== lastPath) {
        lastPath = window.location.pathname;
        hardRedirectIfNeeded();
      }
    }, 500);
  })();
})();
