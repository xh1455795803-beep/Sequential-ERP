#!/usr/bin/env python3
"""修复 JWT_SECRET padding 丢失 — 一行搞定."""
import socket, paramiko, time, json, base64, hmac, hashlib

def run(c, timeout=120, retries=5):
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
            print(f"  retry {a+1}: {ex}"); time.sleep(3)
    raise RuntimeError("SSH failed")

CORRECT_SECRET = "BRnoce2N0ZWRx+NZBWYEWnTlHVBI5jiE9DTyH/jie9A="
CMP = "docker compose -f /opt/supabase/docker/docker-compose.yml --env-file /opt/supabase/docker/.env"

# 1. 修 .env 里的 JWT_SECRET — 补回 =
print("=== 1. 修复 .env JWT_SECRET padding ===")
o, _ = run("grep '^JWT_SECRET=' /opt/supabase/docker/.env | cut -d= -f2")
cur = o.strip()
print(f"  当前: [{cur}]  len={len(cur)}")
print(f"  正确: [{CORRECT_SECRET}]  len={len(CORRECT_SECRET)}")
print(f"  差: {set(CORRECT_SECRET) - set(cur)}")

if cur != CORRECT_SECRET:
    run(f"sudo sed -i 's|^JWT_SECRET=.*|JWT_SECRET={CORRECT_SECRET}|' /opt/supabase/docker/.env")
    o2, _ = run("grep '^JWT_SECRET=' /opt/supabase/docker/.env")
    print(f"  ✅ 修复后: {o2}")
else:
    print("  已是正确值")

# 2. 重新用正确 secret 签 ANON_KEY 和 SERVICE_ROLE_KEY
# meoo 里硬编码的 anon key 已经是用正确 secret 签的 → 验证下能不能恢复
print("\n=== 2. 验证 meoo 硬编码 anon key 现在能不能用 ===")
MEOO_ANON = "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw"

# 先重启 auth + rest 让它们加载新 secret
run(f"{CMP} up -d --force-recreate auth rest 2>&1")
time.sleep(8)

o, e = run(f"""curl -sS 'http://localhost:8000/rest/v1/' -H 'apikey: {MEOO_ANON}' 2>&1 | head -c 200
echo ''
echo '---'
curl -sS -X POST 'http://localhost:8000/auth/v1/token?grant_type=password' \
  -H 'apikey: {MEOO_ANON}' \
  -H 'Content-Type: application/json' \
  -d '{{"email":"admin@thalvior.icu","password":"3403641888"}}' 2>&1 | head -c 400""")
print(f"meoo anon key: {o}")

# 3. 也恢复 .env 里的 ANON_KEY 和 SERVICE_ROLE_KEY 成 meoo 用的版本
# 这样 .env 里的值就跟 meoo 前端硬编码的一致
print("\n=== 3. 用正确 secret 重新签 ANON_KEY 和 SERVICE_ROLE_KEY ===")
def make_static_jwt(secret_b64, role, exp=None):
    header = base64.urlsafe_b64encode(json.dumps({"alg":"HS256","typ":"JWT"}).encode()).rstrip(b'=').decode()
    payload = {"role": role, "iss": "supabase", "iat": 1790268016, "exp": exp or 2105628016}
    payload_b = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b'=').decode()
    sec_bytes = base64.urlsafe_b64decode(secret_b64)
    sig = hmac.new(sec_bytes, f"{header}.{payload_b}".encode(), hashlib.sha256).digest()
    sig_b = base64.urlsafe_b64encode(sig).rstrip(b'=').decode()
    return f"{header}.{payload_b}.{sig_b}"

new_anon = make_static_jwt(CORRECT_SECRET, "anon")
new_svc = make_static_jwt(CORRECT_SECRET, "service_role")

print(f"  新 ANON_KEY 签名: ...{new_anon[-20:]}")
print(f"  meoo 硬编码签名:  ...{MEOO_ANON[-20:]}")
print(f"  匹配: {new_anon == MEOO_ANON}")

# 用 sed 替换 .env 里的值
run(f"sudo sed -i 's|^ANON_KEY=.*|ANON_KEY={new_anon}|' /opt/supabase/docker/.env")
run(f"sudo sed -i 's|^SERVICE_ROLE_KEY=.*|SERVICE_ROLE_KEY={new_svc}|' /opt/supabase/docker/.env")

o, _ = run("grep -E '^(JWT_SECRET|ANON_KEY|SERVICE_ROLE_KEY)=' /opt/supabase/docker/.env | sed 's/=.*/=***/'")
print(f"\n  .env 值确认 (masked):\n{o}")

# 4. 再次重启
print("\n=== 4. 重启 auth + rest ===")
run(f"{CMP} up -d --force-recreate auth rest 2>&1")
time.sleep(8)

o, _ = run("docker ps --filter name=supabase-auth --filter name=supabase-rest --format '{{.Names}} {{.Status}}'")
print(o)

# 5. 全面测试
print("\n=== 5. 全面测试 ===")

# auth
o, e = run(f"""echo 'auth sign-in:'
curl -sS -X POST 'http://localhost:8000/auth/v1/token?grant_type=password' \
  -H 'apikey: {new_anon}' -H 'Content-Type: application/json' \
  -d '{{"email":"admin@thalvior.icu","password":"3403641888"}}' 2>&1 | python3 -c 'import sys,json; d=json.load(sys.stdin); print(f"  ✅ access_token={d[\"access_token\"][:40]}...") if \"access_token\" in d else print(f\"  ❌ {d}\")'""")
print(o)

# rest api — 先用 anon（应该无数据）
o, e = run(f"""echo 'rest anon:'
curl -sS 'http://localhost:8000/rest/v1/wms_orders?limit=3' -H 'apikey: {new_anon}' 2>&1 | head -c 200""")
print(o)

# 用 auth 签的 token — 应该有数据
o, e = run(f"""TOKEN=$(curl -sS -X POST 'http://localhost:8000/auth/v1/token?grant_type=password' \
  -H 'apikey: {new_anon}' -H 'Content-Type: application/json' \
  -d '{{"email":"admin@thalvior.icu","password":"3403641888"}}' | python3 -c 'import sys,json;print(json.load(sys.stdin)[\"access_token\"])')
echo "token: ${{TOKEN:0:40}}..."
curl -sS 'http://localhost:8000/rest/v1/wms_orders?limit=3' -H 'apikey: {new_anon}' -H "Authorization: Bearer $TOKEN" 2>&1 | head -c 400""")
print(o)

# get_current_tenant_id
o, e = run(f"""TOKEN=$(curl -sS -X POST 'http://localhost:8000/auth/v1/token?grant_type=password' \
  -H 'apikey: {new_anon}' -H 'Content-Type: application/json' \
  -d '{{"email":"admin@thalvior.icu","password":"3403641888"}}' | python3 -c 'import sys,json;print(json.load(sys.stdin)[\"access_token\"])')
curl -sS -X POST 'http://localhost:8000/rest/v1/rpc/get_current_tenant_id' \
  -H 'apikey: {new_anon}' -H "Authorization: Bearer $TOKEN" 2>&1""")
print(f"\nget_current_tenant_id(): {o}")

# 6. 外部测试
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

print(f"  thalvior.fun/portal/forwarder: {test('https://thalvior.fun/portal/forwarder')}")
print(f"  thalvior.fun/rest/v1/ (meoo anon): {test('https://thalvior.fun/rest/v1/', {'apikey': MEOO_ANON})}")
print(f"  thalvior.fun/wms/: {test('https://thalvior.fun/wms/')}")
