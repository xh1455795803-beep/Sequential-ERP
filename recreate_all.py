#!/usr/bin/env python3
"""FORCE RECREATE ALL containers — 让每个容器加载新 .env!"""
import socket, paramiko, time, json

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
        except: time.sleep(2); continue
    raise RuntimeError("SSH failed")

CMP = "docker compose -f /opt/supabase/docker/docker-compose.yml --env-file /opt/supabase/docker/.env"

MEOO_ANON = "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw"

# 1. 确认当前 .env 里的 ANON_KEY 签名
print("=== 1. 当前 .env ANON_KEY 签名 ===")
o, _ = run("grep '^ANON_KEY=' /opt/supabase/docker/.env | cut -d= -f2")
print(f"  .env ANON_KEY 后缀: ...{o.strip()[-40:]}")
print(f"  meoo ANON_KEY 后缀: ...{MEOO_ANON[-40:]}")
print(f"  匹配: {o.strip() == MEOO_ANON}")

# 2. Force recreate envoy + auth + rest
print("\n=== 2. Force recreate ALL ===")
o, e = run(f"{CMP} up -d --force-recreate api-gw auth rest 2>&1")
print(o[:800])
time.sleep(15)

# 3. Verify envoy env 已更新
print("\n=== 3. Envoy ANON_KEY ===")
o, _ = run("docker exec supabase-envoy env 2>/dev/null | grep '^ANON_KEY=' | cut -d= -f2")
print(f"  Envoy ANON_KEY 后缀: ...{o.strip()[-40:]}")
print(f"  匹配 meoo: {o.strip() == MEOO_ANON}")

# 4. 验证 auth env
print("\n=== 4. Auth secret ===")
o, _ = run("docker exec supabase-auth env 2>/dev/null | grep 'GOTRUE_JWT_SECRET=' | cut -d= -f2")
print(f"  Auth GOTRUE_JWT_SECRET: [{o.strip()}]")

# 5. 验证 rest config
print("\n=== 5. Postgrest config ===")
o, _ = run("docker exec supabase-rest postgrest --dump-config 2>&1 | grep -iE 'jwt'")
print(o)

# 6. 全面测试
print("\n=== 6. Auth health with correct apikey ===")
o, e = run(f"curl -sS 'http://localhost:8000/auth/v1/health' -H 'apikey: {MEOO_ANON}' 2>&1")
print(f"  auth health: {o}")

print("\n=== 7. Auth sign-in ===")
o, e = run(f"""curl -sS -X POST 'http://localhost:8000/auth/v1/token?grant_type=password' \
  -H 'apikey: {MEOO_ANON}' -H 'Content-Type: application/json' \
  -d '{{"email":"admin@thalvior.icu","password":"3403641888"}}' 2>&1""")
try:
    d = json.loads(o)
    token = d["access_token"]
    print(f"  ✅ Login OK! token={token[:60]}...")
except:
    print(f"  ❌ {o[:400]}")
    token = ""

print("\n=== 8. REST API ===")
o, e = run(f"""echo '-- wms_orders (auth) --'
curl -sS 'http://localhost:8000/rest/v1/wms_orders?limit=3' \
  -H 'apikey: {MEOO_ANON}' -H 'Authorization: Bearer {token}' 2>&1 | head -c 500
echo ''
echo '-- tenant_id --'
curl -sS -X POST 'http://localhost:8000/rest/v1/rpc/get_current_tenant_id' \
  -H 'apikey: {MEOO_ANON}' -H 'Authorization: Bearer {token}' 2>&1""")
print(o)

print("\n=== 9. 外部 thalvior.fun ===")
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

print(f"  货小易 portal: {test('https://thalvior.fun/portal/forwarder')}")
print(f"  meoo anon API: {test('https://thalvior.fun/rest/v1/', {'apikey': MEOO_ANON})}")
print(f"  WMS /wms/: {test('https://thalvior.fun/wms/')}")
