#!/usr/bin/env python3
"""最简测试 — 不用 shell 嵌套."""
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

MEOO_ANON = "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw"

# 1. Sign-in 拿 token
print("=== 1. Sign-in ===")
o, e = run('''curl -sS -X POST "http://localhost:8000/auth/v1/token?grant_type=password" \
  -H "apikey: eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@thalvior.icu\",\"password\":\"3403641888\"}"''', timeout=15)
print(o[:500])
try:
    TOKEN = json.loads(o)["access_token"]
    print(f"  ✅ token[:60]={TOKEN[:60]}...")
except:
    print(f"  ❌ 拿不到 token")
    TOKEN = ""

# 2. wms_orders with auth
if TOKEN:
    print("\n=== 2. wms_orders (with auth token) ===")
    o, e = run(f'''curl -sS "http://localhost:8000/rest/v1/wms_orders?limit=5" \
      -H "apikey: {MEOO_ANON}" \
      -H "Authorization: Bearer {TOKEN}"''', timeout=15)
    print(f"  {o[:600]}")

    print("\n=== 3. get_current_tenant_id ===")
    o, e = run(f'''curl -sS -X POST "http://localhost:8000/rest/v1/rpc/get_current_tenant_id" \
      -H "apikey: {MEOO_ANON}" \
      -H "Authorization: Bearer {TOKEN}"''', timeout=15)
    print(f"  tenant_id = {o}")

# 4. postgrest config 最终确认
print("\n=== 4. Postgrest final config ===")
o, _ = run("docker exec supabase-rest postgrest --dump-config 2>&1 | grep -iE 'jwt|secret|base64'")
print(o)

# 5. auth 最终 secret
print("\n=== 5. Auth GOTRUE_JWT_SECRET ===")
o, _ = run("docker exec supabase-auth env 2>/dev/null | grep 'GOTRUE_JWT_SECRET=' | cut -d= -f2-")
print(f"  [{o}]")
