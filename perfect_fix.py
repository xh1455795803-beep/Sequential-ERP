#!/usr/bin/env python3
"""彻底修复：一行行来，不能再错了."""
import socket, paramiko, time, json, base64, hmac, hashlib

def run(c, timeout=120, retries=8):
    for a in range(retries):
        try:
            s = socket.socket(); s.settimeout(20)
            s.connect(('127.0.0.1', 18080))
            s.sendall(b"CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n")
            tran = paramiko.Transport(s); tran.start_client(timeout=20); tran.auth_password('ubuntu', 'Yuan340364#')
            chan = tran.open_session(); chan.settimeout(timeout); chan.exec_command(c)
            out = chan.recv(524288).decode(errors='replace')
            err = chan.recv_stderr(131072).decode(errors='replace')
            tran.close(); s.close()
            return out.strip(), err.strip()
        except Exception as ex:
            time.sleep(2); continue
    raise RuntimeError("SSH failed after 8 retries")

CORRECT_SECRET = "BRnoce2N0ZWRx+NZBWYEWnTlHVBI5jiE9DTyH/jie9A="
CMP = "docker compose -f /opt/supabase/docker/docker-compose.yml --env-file /opt/supabase/docker/.env"

# ==========================================
# 1. 写正确的 .env
# ==========================================
print("=== 1. Fix .env (JWT_SECRET with full padding) ===")
o, _ = run("grep '^JWT_SECRET=' /opt/supabase/docker/.env | cut -d= -f2")
cur = o.strip()
print(f"  cur: [{cur}] ({len(cur)} chars)")
print(f"  fix: [{CORRECT_SECRET}] ({len(CORRECT_SECRET)} chars)")
assert CORRECT_SECRET.endswith('='), "Must have base64 padding!"
run(f"sudo sed -i 's|^JWT_SECRET=.*|JWT_SECRET={CORRECT_SECRET}|' /opt/supabase/docker/.env")

# 2. 用"base64字符串直接当raw"（与meoo一致）重新签
def make_jwt_raw(secret_b64_str, role):
    header = base64.urlsafe_b64encode(json.dumps({"alg":"HS256","typ":"JWT"}).encode()).rstrip(b'=').decode()
    payload = json.dumps({"role": role, "iss": "supabase", "iat": 1790268016, "exp": 2105628016}).encode()
    payload_b = base64.urlsafe_b64encode(payload).rstrip(b'=').decode()
    # 关键：把 base64 字符串直接当 raw bytes（跟 meoo 一致）
    sig = hmac.new(secret_b64_str.encode(), f"{header}.{payload_b}".encode(), hashlib.sha256).digest()
    sig_b = base64.urlsafe_b64encode(sig).rstrip(b'=').decode()
    return f"{header}.{payload_b}.{sig_b}"

MEOO_ANON = "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw"
new_anon = make_jwt_raw(CORRECT_SECRET, "anon")
new_svc = make_jwt_raw(CORRECT_SECRET, "service_role")
print(f"\n  new ANON  sig: ...{new_anon[-30:]}")
print(f"  meoo ANON sig: ...{MEOO_ANON[-30:]}")
assert new_anon == MEOO_ANON, "ANON KEY MUST MATCH meoo!"
print("  ✅ 签名完全匹配 meoo!")

run(f"sudo sed -i 's|^ANON_KEY=.*|ANON_KEY={new_anon}|' /opt/supabase/docker/.env")
run(f"sudo sed -i 's|^SERVICE_ROLE_KEY=.*|SERVICE_ROLE_KEY={new_svc}|' /opt/supabase/docker/.env")

# 3. 确认
o, _ = run("grep -E '^(JWT_SECRET|ANON_KEY|SERVICE_ROLE_KEY)=' /opt/supabase/docker/.env")
print(f"\n  .env 最终值:\n  {o.replace(CORRECT_SECRET, '[SECRET]').replace(new_anon[:30], '[ANON]').replace(new_svc[:30], '[SVC]')}")

# ==========================================
# 2. 写正确的 docker-compose.yml
# ==========================================
print("\n=== 2. Fix docker-compose.yml PGRST ===")
o, _ = run("cat /opt/supabase/docker/docker-compose.yml")
c = o

# 关键：IS_BASE64 = "false" ！因为 auth/postgrest 都把 .env 的 base64 字符串直接当 raw bytes
# 先把所有旧值去掉
c = c.replace('PGRST_JWT_SECRET_IS_BASE64: "true"', '')
c = c.replace('PGRST_JWT_SECRET_IS_BASE64: "false"', '')

# 在 PGRST_JWT_SECRET 后面加正确配置
c = c.replace(
    'PGRST_JWT_SECRET: ${JWT_JWKS:-${JWT_SECRET}}\n      PGRST_JWT_AUD: "authenticated"',
    'PGRST_JWT_SECRET: ${JWT_JWKS:-${JWT_SECRET}}\n      PGRST_JWT_SECRET_IS_BASE64: "false"\n      PGRST_JWT_AUD: "authenticated"\n      PGRST_JWT_ROLE_CLAIM_KEY: ".role"'
)

# 确保没有 PRE_REQUEST
c = c.replace('\n      PGRST_DB_PRE_REQUEST: "public.pgrst_pre_request_debug"', '')

import base64 as b64
b64_c = b64.b64encode(c.encode()).decode()
run(f"echo '{b64_c}' | base64 -d | sudo tee /opt/supabase/docker/docker-compose.yml > /dev/null")

o, _ = run("grep -E 'PGRST_JWT|PGRST_DB_USE_LEGACY' /opt/supabase/docker/docker-compose.yml")
print(f"  PGRST 配置:\n  {o}")
assert 'PGRST_JWT_SECRET_IS_BASE64: "false"' in o, "IS_BASE64 must be false!"
assert 'PGRST_JWT_ROLE_CLAIM_KEY: ".role"' in o, "ROLE_CLAIM_KEY must be .role!"

# ==========================================
# 3. 重启所有相关容器
# ==========================================
print("\n=== 3. Restart all ===")
run(f"{CMP} up -d --force-recreate auth rest api-gw 2>&1")
time.sleep(12)

o, _ = run("docker ps --filter name=supabase-auth --filter name=supabase-rest --format '{{.Names}} {{.Status}}'")
print(f"  状态: {o}")

# ==========================================
# 4. 全面测试
# ==========================================
print("\n=== 4. 测试 auth sign-in (meoo anon key) ===")
o, e = run(f"""curl -sS -X POST 'http://localhost:8000/auth/v1/token?grant_type=password' \
  -H 'apikey: {MEOO_ANON}' -H 'Content-Type: application/json' \
  -d '{{"email":"admin@thalvior.icu","password":"3403641888"}}' 2>&1""")
try:
    d = json.loads(o)
    token = d.get("access_token", "")
    print(f"  ✅ 登录成功! token[:50]={token[:50]}...")
except:
    print(f"  ❌ {o[:300]}")
    token = ""

print("\n=== 5. 测试 REST API ===")
o, e = run(f"""echo '-- wms_orders (auth) --'
curl -sS 'http://localhost:8000/rest/v1/wms_orders?limit=3' \
  -H 'apikey: {MEOO_ANON}' -H 'Authorization: Bearer {token}' 2>&1 | head -c 400
echo ''
echo '-- tenant_id --'
curl -sS -X POST 'http://localhost:8000/rest/v1/rpc/get_current_tenant_id' \
  -H 'apikey: {MEOO_ANON}' -H 'Authorization: Bearer {token}' 2>&1""")
print(o)

print("\n=== 6. 外部 thalvior.fun 测试 ===")
import urllib.request
def test(url, headers=None):
    try:
        req = urllib.request.Request(url, headers=headers or {})
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status
    except urllib.error.HTTPError as ex:
        return f"HTTP {ex.code}"
    except Exception as ex:
        return f"ERR: {ex}"

print(f"  portal/forwarder (货小易): {test('https://thalvior.fun/portal/forwarder')}")
print(f"  rest/v1 (meoo anon):      {test('https://thalvior.fun/rest/v1/', {'apikey': MEOO_ANON})}")
print(f"  wms/ (WMS 仓库系统):      {test('https://thalvior.fun/wms/')}")
