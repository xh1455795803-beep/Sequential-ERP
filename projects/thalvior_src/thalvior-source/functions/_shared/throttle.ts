// _shared/throttle.ts — Wave A / T9 : edge-function side of the throttle primitive
// ================================================================================
// Pairs with migrations/zz_20261117_wA02_throttle.sql (public.throttle_consume).
//
// WHY THE COUNTER IS NOT IN HERE
//   Deno workers are many, short-lived and (measured by Wave A on 2026-11-17) can even
//   serve a stale module after the file on disk changed, so any in-process Map counter is
//   both bypassable and unreliable. The single atomic INSERT..ON CONFLICT..WHERE inside
//   throttle_consume() is the authority; this module only shapes the call and the answer.
//
// PRIVACY
//   bucket keys are SHA-256 hashed here, so phone numbers / emails / client IPs never land
//   in throttle_log in the clear (Wave A T11 is about erasing PII; a rate limiter that
//   copies it into a new table would work against that).
//
// FAIL CLOSED
//   If the RPC cannot be reached this module returns allowed=false. An unthrottled OTP
//   sender is precisely the incident this work removes; a brief 503 on a "send code"
//   button is recoverable, an unbounded Aliyun SMS bill is not. Callers that would rather
//   fail open must say so explicitly via the `failOpen` option.
//
// RUNTIME: Deno (edge) — also loadable under Node >= 18 for testing (fetch, crypto.subtle,
// Response are global in both). No TypeScript-only syntax, so the exact bytes can be unit
// tested by stripping the trailing `export {…}` line.

const RPC_NAME = "throttle_consume";

function envOf(name) {
  try {
    if (typeof Deno !== "undefined" && Deno.env) return Deno.env.get(name) || "";
  } catch (_) { /* env access denied */ }
  if (typeof process !== "undefined" && process.env) return process.env[name] || "";
  return "";
}

async function sha256hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * identity -> stable, non-reversible bucket key.
 * Emails are lower-cased (and Gmail dots/plus-tags are NOT folded: that would let a
 * plus-addressing spammer escape the bucket).
 * Phones: only E.164 values (leading "+") get their separators folded, so "+86 138-0013-8000"
 * and "+8613800138000" share a bucket.
 * Everything else (IPv4/IPv6, uuids, opaque keys) is case-folded only - the previous version
 * folded "anything that looks like a phone", which stripped the dots from an IP and merged
 * 198.51.100.77 with 198.51.100.770 / 1985.1.100.77 into one bucket (Wave A T8 review 2026-11-17:
 * an IP limiter that collides is a limiter you can queue behind, and one that over-collides
 * locks out whole /8s).
 */
async function bucketKey(scope, identity) {
  const raw = String(identity == null ? "" : identity).trim();
  let norm;
  if (/@/.test(raw)) norm = raw.toLowerCase();
  else if (/^\+[0-9 ()\-.]{7,}$/.test(raw)) norm = raw.replace(/[^+0-9]/g, "");
  else norm = raw.toLowerCase();
  return scope.slice(0, 24) + ":" + (await sha256hex(norm)).slice(0, 48);
}

/**
 * @returns {Promise<{allowed:boolean, remaining:number, retryAfter:number, error?:string}>}
 */
async function consume(scope, identity, limit, windowSeconds, opts) {
  const o = opts || {};
  const cost = o.cost || 1;
  const failOpen = o.failOpen === true;
  const url = (envOf("SUPABASE_URL") || "http://api-gw:8000").replace(/\/+$/, "") + "/rest/v1/rpc/" + RPC_NAME;
  const key = envOf("SUPABASE_SERVICE_ROLE_KEY") || envOf("SERVICE_ROLE_KEY");
  const fn = o.functionName || "throttle";

  if (!key) {
    console.error(`[${fn}] throttle unavailable: no service key in env (fail${failOpen ? " open" : " closed"})`);
    return failOpen
      ? { allowed: true, remaining: limit, retryAfter: 0, error: "no_service_key" }
      : { allowed: false, remaining: 0, retryAfter: windowSeconds, error: "no_service_key" };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs || 1500);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Prefer": "count=none",
      },
      body: JSON.stringify({
        p_scope: scope,
        p_bucket_key: await bucketKey(scope, identity),
        p_limit: limit,
        p_window_seconds: windowSeconds,
        p_cost: cost,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 200);
      console.error(`[${fn}] throttle rpc http=${res.status} body=${body} (fail${failOpen ? " open" : " closed"})`);
      return failOpen
        ? { allowed: true, remaining: limit, retryAfter: 0, error: "rpc_http_" + res.status }
        : { allowed: false, remaining: 0, retryAfter: windowSeconds, error: "rpc_http_" + res.status };
    }
    const rows = await res.json();
    const r = Array.isArray(rows) ? rows[0] : rows;
    if (!r || typeof r.allowed !== "boolean") {
      console.error(`[${fn}] throttle rpc shape unexpected (fail${failOpen ? " open" : " closed"})`);
      return failOpen
        ? { allowed: true, remaining: limit, retryAfter: 0, error: "rpc_shape" }
        : { allowed: false, remaining: 0, retryAfter: windowSeconds, error: "rpc_shape" };
    }
    if (!r.allowed) {
      console.warn(`[${fn}] throttled scope=${scope} limit=${limit}/${windowSeconds}s retry=${r.retry_after_seconds}s`);
    }
    return {
      allowed: r.allowed,
      remaining: Number(r.remaining) || 0,
      retryAfter: Number(r.retry_after_seconds) || 0,
    };
  } catch (e) {
    console.error(`[${fn}] throttle rpc threw: ${e && e.name ? e.name : e} (fail${failOpen ? " open" : " closed"})`);
    return failOpen
      ? { allowed: true, remaining: limit, retryAfter: 0, error: "rpc_threw" }
      : { allowed: false, remaining: 0, retryAfter: windowSeconds, error: "rpc_threw" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Convenience wrapper for a Deno.serve handler: returns null to continue, or a ready
 * 429 (or 503 when the limiter itself is broken) Response to return immediately.
 */
async function enforceLimit(scope, identity, limit, windowSeconds, opts) {
  const o = opts || {};
  const r = await consume(scope, identity, limit, windowSeconds, o);
  if (r.allowed) return null;
  const unavailable = !!r.error;
  return new Response(
    JSON.stringify({
      error: unavailable ? "rate_limiter_unavailable" : "too_many_requests",
      message: o.message || "请求过于频繁，请稍后再试",
      retry_after_seconds: r.retryAfter,
      code: r.error || "throttled",
    }),
    {
      status: unavailable ? 503 : 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(Math.max(1, r.retryAfter)),
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}

export { consume, enforceLimit, bucketKey };
