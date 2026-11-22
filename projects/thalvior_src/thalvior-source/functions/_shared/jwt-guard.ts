// _shared/jwt-guard.ts — Wave A / T7 : application-level JWT enforcement for Edge Functions
// ==========================================================================================
// WHY THIS EXISTS (all measured on 43.133.232.81, 2026-11-17)
//   * the api-gw container is Envoy, not Kong. Its Lua gate only inspects `apikey` for
//     routes named in PROTECTED_ROUTES (volumes/api/envoy/lds.template.yaml:714-722):
//       auth-v1-protected, rest-v1-openapi-protected, rest-v1-protected, graphql-v1-protected,
//       realtime-v1-api-protected, realtime-v1-ws-protected, pg-protected
//     -> there is NO `functions-v1-protected` entry, so /functions/v1/* is reachable with
//        no apikey at all.
//   * FUNCTIONS_VERIFY_JWT=false in /opt/supabase/docker/.env -> the edge runtime does not
//     verify the bearer token either.
//   => every Edge Function was an unauthenticated proxy for its upstream API key/quota.
//
// WHAT IT DOES
//   Verifies the caller's Supabase JWT *locally* (HS256 over JWT_SECRET, which the edge
//   container already has: printenv JWT_SECRET len=43, docker-compose.yml:310) instead of
//   round-tripping to auth.getUser(). That is both cheaper and honest: a signature check is
//   the only thing that cannot be spoofed by the caller.
//     - pins alg === "HS256"          ("none"/RS256/HS512 are rejected)
//     - constant-time signature compare
//     - exp / nbf with 30s clock leeway
//     - iss must equal JWT_ISSUER (default "supabase"; both API keys carry iss=supabase)
//     - role allow-list per enforcement level
//   Fails CLOSED: if JWT_SECRET is absent the request is refused with 503 rather than
//   allowed through.
//
// LEVELS
//   'principal'  anon | authenticated | service_role   — public entry points that must at
//                                                        least look like this app's own
//                                                        client (OTP send/verify).
//   'end-user'   authenticated | service_role          — features that cost money or read
//                                                        another tenant's data. `apikey`
//                                                        alone is NOT enough at this level.
//   'service'    service_role                          — internal (cron / EF-to-EF) actions.
//
// OPTIONS requests are passed straight through (return null) so each function keeps the
// CORS behaviour it already has; this change adds no new preflight semantics.
//
// Written deliberately in annotation-free JavaScript so the exact same bytes can be unit
// tested under Node (>=18) by stripping the `export ` keywords — see the T7 test harness.

const CLOCK_LEEWAY_SEC = 30;

const ROLE_LEVELS = {
  principal: ["anon", "authenticated", "service_role"],
  "end-user": ["authenticated", "service_role"],
  service: ["service_role"],
};

function getEnv(name) {
  try {
    if (typeof Deno !== "undefined" && Deno.env) return Deno.env.get(name) || "";
  } catch (_) { /* allow flag missing -> treat as unset */ }
  if (typeof process !== "undefined" && process.env) return process.env[name] || "";
  return "";
}

function b64urlToBytes(s) {
  const norm = String(s).replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm + "=".repeat((4 - (norm.length % 4)) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSha256(secret, msg) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
}

function constTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Token source: `Authorization: Bearer x` first, then `apikey` (supabase-js sends both). */
function extractToken(req) {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m && m[1].trim()) return { token: m[1].trim(), from: "authorization" };
  const ak = (req.headers.get("apikey") || "").trim();
  if (ak) return { token: ak, from: "apikey" };
  return { token: "", from: "none" };
}

/**
 * @returns {Promise<{ok:true, role:string, sub:string|null} | {ok:false, reason:string}>}
 */
async function verifyJwt(token) {
  const secret = getEnv("JWT_SECRET").trim();
  if (!secret) return { ok: false, reason: "server_misconfigured" };
  if (!token || typeof token !== "string") return { ok: false, reason: "missing_token" };

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed_token" };

  let header, payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch (_) {
    return { ok: false, reason: "malformed_token" };
  }
  if (!header || header.alg !== "HS256") return { ok: false, reason: "alg_not_allowed" };

  const expect = await hmacSha256(secret, parts[0] + "." + parts[1]);
  let given;
  try { given = b64urlToBytes(parts[2]); } catch (_) { return { ok: false, reason: "malformed_token" }; }
  if (!constTimeEqual(expect, given)) return { ok: false, reason: "bad_signature" };

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && now > payload.exp + CLOCK_LEEWAY_SEC) return { ok: false, reason: "token_expired" };
  if (typeof payload.nbf === "number" && now + CLOCK_LEEWAY_SEC < payload.nbf) return { ok: false, reason: "token_not_yet_valid" };

  const issuer = getEnv("JWT_ISSUER").trim() || "supabase";
  if (payload.iss !== issuer) return { ok: false, reason: "bad_issuer" };

  return { ok: true, role: String(payload.role || ""), sub: payload.sub ? String(payload.sub) : null };
}

function deny(reason, status) {
  return new Response(
    JSON.stringify({ error: "unauthorized", code: reason, message: "A valid Supabase JWT is required for this function." }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, oneday-app-id",
      },
    },
  );
}

/**
 * Returns null when the request may proceed, or a ready-to-return Response when it must not.
 * @param {Request} req
 * @param {'principal'|'end-user'|'service'} level
 */
async function enforce(req, level) {
  if (req.method === "OPTIONS") return null;
  const v = await enforceWithPrincipal(req, level);
  return v.deny;
}

/** Same as enforce() but hands the decoded principal back for handlers that need `sub`. */
async function enforceWithPrincipal(req, level) {
  if (req.method === "OPTIONS") return { deny: null, principal: null };
  const allowed = ROLE_LEVELS[level] || ROLE_LEVELS["end-user"];
  const { token, from } = extractToken(req);
  if (!token) return { deny: deny("missing_token", 401), principal: null };
  const v = await verifyJwt(token);
  if (!v.ok) {
    const status = v.reason === "server_misconfigured" ? 503 : 401;
    return { deny: deny(v.reason, status), principal: null };
  }
  // `apikey` carries the anon key by design; it is never sufficient for a paid/tenant route.
  if (from === "apikey" && allowed.indexOf("anon") === -1) {
    return { deny: deny("anon_key_not_accepted", 401), principal: null };
  }
  if (allowed.indexOf(v.role) === -1) return { deny: deny("role_not_allowed", 403), principal: null };
  return { deny: null, principal: v };
}

export { enforce, enforceWithPrincipal, verifyJwt, extractToken, ROLE_LEVELS };
