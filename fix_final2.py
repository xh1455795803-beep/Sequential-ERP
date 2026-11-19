#!/usr/bin/env python3
"""修复 JWT_SECRET padding — 精简版."""
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
            print(f"  retry {a+1}: {ex}"); time.sleep(2)
    raise RuntimeError("SSH failed")

CORRECT_SECRET = "BRnoce2N0ZWRx+NZBWYEWnTlHVBI5jiE9DTyH/jie9A="
CMP = "docker compose -f /opt/supabase/docker/docker-compose.yml --env-file /opt/supabase/docker/.env"

# 1. 修 .env JWT_SECRET
print("=== 1. Fix JWT_SECRET ===")
o, _ = run("grep '^JWT_SECRET=' /opt/supabase/docker/.env | cut -d= -f2")
cur = o.strip()
print(f"  cur=[{cur}] ({len(cur)} chars)")
print(f"  fix=[{CORRECT_SECRET}] ({len(CORRECT_SECRET)} chars)")
run(f"sudo sed -i 's|^JWT_SECRET=.*|JWT_SECRET={CORRECT_SECRET}|' /opt/supabase/docker/.env")

# 2. 用正确 secret 签 ANON_KEY
def make_jwt(secret_b64, role, sub=None, email=None, aud=None):
    header = base64.urlsafe_b64encode(json.dumps({"alg":"HS256","typ":"JWT"}).encode()).rstrip(b'=').decode()
    payload = {"role": role, "iss": "supabase", "iat": 1790268016, "exp": 2105628016}
    if sub: payload["sub"] = sub
    if email: payload["email"] = email
    if aud: payload["aud"] = aud
    payload_b = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b'=').decode()
    sec_bytes = base64.urlsafe_b64decode(secret_b64)
    sig = hmac.new(sec_bytes, f"{header}.{payload_b}".encode(), hashlib.sha256).digest()
    sig_b = base64.urlsafe_b64encode(sig).rstrip(b'=').decode()
    return f"{header}.{payload_b}.{sig_b}"

MEOO_ANON = "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw"

new_anon = make_jwt(CORRECT_SECRET, "anon")
new_svc = make_jwt(CORRECT_SECRET, "service_role")
print(f"\n=== 2. 重新签 ANON/SVC ===")
print(f"  new ANON  sig: ...{new_anon[-20:]}")
print(f"  meoo ANON sig: ...{MEOO_ANON[-20:]}")
print(f"  匹配: {new_anon == MEOO_ANON}")

run(f"sudo sed -i 's|^ANON_KEY=.*|ANON_KEY={new_anon}|' /opt/supabase/docker/.env")
run(f"sudo sed -i 's|^SERVICE_ROLE_KEY=.*|SERVICE_ROLE_KEY={new_svc}|' /opt/supabase/docker/.env")

o, _ = run("grep -E '^(JWT_SECRET|ANON_KEY|SERVICE_ROLE_KEY)=' /opt/supabase/docker/.env | sed 's/=.*$/=***/'")
print(f"  .env mask: {o}")

# 3. 重启所有容器（auth, rest）
print("\n=== 3. 重启 auth + rest ===")
run(f"{CMP} up -d --force-recreate auth rest 2>&1")
time.sleep(10)
o, _ = run("docker ps --filter name=supabase-auth --filter name=supabase-rest --format '{{.Names}} {{.Status}}'")
print(o)

# 4. auth sign-in 测试
print("\n=== 4. Auth sign-in ===")
o, e = run(f"""curl -sS -X POST 'http://localhost:8000/auth/v1/token?grant_type=password' \
  -H 'apikey: {new_anon}' -H 'Content-Type: application/json' \
  -d '{{"email":"admin@thalvior.icu","password":"3403641888"}}' 2>&1""")
try:
    d = json.loads(o)
    token = d.get("access_token", "")
    print(f"  ✅ 登录成功! token={token[:50]}...")
except:
    print(f"  ❌ {o[:300]}")
    token = ""

# 5. rest api 测试
print("\n=== 5. REST API ===")
o, e = run(f"""echo '-- wms_orders --'
curl -sS 'http://localhost:8000/rest/v1/wms_orders?limit=3' \
  -H 'apikey: {new_anon}' \
  -H 'Authorization: Bearer {token}' 2>&1 | head -c 400
echo ''
echo '-- get_current_tenant_id --'
curl -sS -X POST 'http://localhost:8000/rest/v1/rpc/get_current_tenant_id' \
  -H 'apikey: {new_anon}' \
  -H 'Authorization: Bearer {token}' 2>&1""")
print(o)

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

print(f"  portal/forwarder: {test('https://thalvior.fun/portal/forwarder')}")
print(f"  rest/v1 (meoo anon): {test('https://thalvior.fun/rest/v1/', {'apikey': MEOO_ANON})}")
print(f"  wms/: {test('https://thalvior.fun/wms/')}")
