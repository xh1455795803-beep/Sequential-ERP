#!/usr/bin/env python3
"""最后一次：IS_BASE64 = false."""
import socket, paramiko, time, json, base64

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

# 1. 改 IS_BASE64 false
print("=== 1. IS_BASE64 = false ===")
o, _ = run("cat /opt/supabase/docker/docker-compose.yml")
c = o
c = c.replace('PGRST_JWT_SECRET_IS_BASE64: "true"', 'PGRST_JWT_SECRET_IS_BASE64: "false"')
b64c = base64.b64encode(c.encode()).decode()
run(f"echo '{b64c}' | base64 -d | sudo tee /opt/supabase/docker/docker-compose.yml > /dev/null")
o, _ = run("grep 'IS_BASE64' /opt/supabase/docker/docker-compose.yml")
print(f"  → {o}")

# 2. Recreate rest
print("\n=== 2. Recreate rest ===")
run(f"{CMP} up -d --force-recreate rest 2>&1")
time.sleep(10)
o, _ = run("docker exec supabase-rest postgrest --dump-config 2>&1 | grep -iE 'jwt'")
print(f"  postgrest: {o}")

# 3. 完整测试
print("\n=== 3. Full test ===")
BODY = json.dumps({"email":"admin@thalvior.icu","password":"3403641888"})
o, _ = run(f"""curl -sS -X POST 'http://localhost:8000/auth/v1/token?grant_type=password' \
  -H 'apikey: {MEOO_ANON}' -H 'Content-Type: application/json' \
  --data '{BODY}'""", timeout=15)
try:
    d = json.loads(o)
    TOKEN = d["access_token"]
    print(f"  ✅ Login OK! token[:60]={TOKEN[:60]}")
except:
    print(f"  ❌ Login fail: {o[:300]}")
    TOKEN = ""

if TOKEN:
    o, _ = run(f"""curl -sS 'http://localhost:8000/rest/v1/wms_orders?limit=5' \
      -H 'apikey: {MEOO_ANON}' -H 'Authorization: Bearer {TOKEN}'""", timeout=15)
    try:
        orders = json.loads(o)
        print(f"  ✅ wms_orders: {len(orders)} rows!")
        for r in orders[:2]:
            print(f"     - {r.get('order_no')} tenant={r.get('tenant_id')}")
    except:
        print(f"  ❌ {o[:300]}")

    o, _ = run(f"""curl -sS -X POST 'http://localhost:8000/rest/v1/rpc/get_current_tenant_id' \
      -H 'apikey: {MEOO_ANON}' -H 'Authorization: Bearer {TOKEN}'""", timeout=15)
    print(f"  ✅ get_current_tenant_id() = {o}")

# 4. 外部最终测试
print("\n=== 4. 外部 ===")
import urllib.request
def t(url, headers=None):
    try:
        req = urllib.request.Request(url, headers=headers or {})
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status
    except urllib.error.HTTPError as ex:
        return f"HTTP {ex.code}"
    except Exception as ex:
        return f"ERR: {ex}"

print(f"  🟢 货小易 portal: {t('https://thalvior.fun/portal/forwarder')}")
print(f"  🟢 WMS /wms/:     {t('https://thalvior.fun/wms/')}")
print(f"  🟢 auth health:   {t('https://thalvior.fun/auth/v1/health', {'apikey': MEOO_ANON})}")
print(f"  🟢 rest anon:     {t('https://thalvior.fun/rest/v1/', {'apikey': MEOO_ANON})}")  # 403 RBAC is OK
