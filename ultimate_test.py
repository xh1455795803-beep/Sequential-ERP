#!/usr/bin/env python3
"""最终最简测试 — 用 python requests 发到本地端口."""
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

# 用 heredoc 避免转义问题
print("=== 1. Sign-in ===")
JSON_BODY = json.dumps({"email":"admin@thalvior.icu","password":"3403641888"})
signin_cmd = f"""curl -sS -X POST 'http://localhost:8000/auth/v1/token?grant_type=password' \
  -H 'apikey: {MEOO_ANON}' \
  -H 'Content-Type: application/json' \
  --data '{JSON_BODY}'"""
o, e = run(signin_cmd, timeout=15)
print(o[:500])
TOKEN = ""
try:
    TOKEN = json.loads(o)["access_token"]
    print(f"  ✅ Login OK! token[:60]={TOKEN[:60]}")
except:
    print(f"  ❌ No token")

if TOKEN:
    print("\n=== 2. wms_orders ===")
    o, e = run(f"""curl -sS 'http://localhost:8000/rest/v1/wms_orders?limit=5' \
      -H 'apikey: {MEOO_ANON}' -H 'Authorization: Bearer {TOKEN}'""", timeout=15)
    try:
        orders = json.loads(o)
        print(f"  ✅ {len(orders)} orders!")
        for r in orders:
            print(f"    - {r.get('order_no')} tenant={r.get('tenant_id')} status={r.get('status')}")
    except:
        print(f"  ❌ {o[:400]}")

    print("\n=== 3. get_current_tenant_id ===")
    o, e = run(f"""curl -sS -X POST 'http://localhost:8000/rest/v1/rpc/get_current_tenant_id' \
      -H 'apikey: {MEOO_ANON}' -H 'Authorization: Bearer {TOKEN}'""", timeout=15)
    print(f"  tenant_id = {o}")

print("\n=== 4. 外部测试 ===")
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

print(f"  🟢 货小易 portal/forwarder: {test('https://thalvior.fun/portal/forwarder')}")
print(f"  🟢 WMS /wms/: {test('https://thalvior.fun/wms/')}")

# 用 meoo anon key 试 rest API（应该 403 因为没 auth 但 API 通不通）
status = test('https://thalvior.fun/rest/v1/', {'apikey': MEOO_ANON})
print(f"  🟢 meoo anon → rest/v1/: {status} (403=RBAC拦截但API通了)")

# 5. 货小易 auth API 测试（带 meoo anon）
print("\n=== 5. 货小易 auth 外部 ===")
try:
    req = urllib.request.Request(
        "https://thalvior.fun/auth/v1/health",
        headers={"apikey": MEOO_ANON}
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        print(f"  ✅ auth health: {resp.status} {resp.read()[:200].decode()}")
except Exception as ex:
    print(f"  auth health: {ex}")
