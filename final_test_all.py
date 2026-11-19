#!/usr/bin/env python3
"""修 auth secret + 完整测试."""
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
        except: time.sleep(2); continue
    raise RuntimeError("SSH failed")

CMP = "docker compose -f /opt/supabase/docker/docker-compose.yml --env-file /opt/supabase/docker/.env"
MEOO_ANON = "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw"
CORRECT_SECRET = "BRnoce2N0ZWRx+NZBWYEWnTlHVBI5jiE9DTyH/jie9A="

# 1. 看看 docker-compose.yml 里 auth 怎么引用 JWT_SECRET 的
print("=== 1. auth JWT env in compose ===")
o, _ = run("grep -B2 -A5 'GOTRUE_JWT_SECRET' /opt/supabase/docker/docker-compose.yml")
print(o)

# 2. 直接从 .env 文件 source 看
print("\n=== 2. .env raw ===")
o, _ = run("grep '^JWT_SECRET=' /opt/supabase/docker/.env | cat -A")
print(f"  .env: {o}")

# 3. 等等：GOTRUE_JWT_SECRET 从 .env 读的时候，末尾的 $ 会不会被 shell 解释？
# docker-compose 读 .env 应该是逐行读，不会 shell eval
# 让我直接 docker-compose config 看最终值
print("\n=== 3. docker-compose config 最终值 ===")
o, _ = run(f"{CMP} config 2>/dev/null | grep -A2 'GOTRUE_JWT_SECRET' | head -5")
print(o)

# 4. 修复：在 JWT_SECRET 末尾加引号或用双等号 escape
# 先看 .env 当前值
o, _ = run("grep '^JWT_SECRET=' /opt/supabase/docker/.env")
print(f"\n  当前 .env: [{o}]")
# 可能是 docker 的 envfile 解析器把末尾 = 当赋值了？
# 试试末尾加引号？或者用 $ 转义？

# 其实等等... 让我先完整测一遍看看 auth sign-in 的 token 能不能被 postgrest 验证
# 也许 postgrest IS_BASE64=true 加上 auth 的 "丢了 padding" 的 secret 反而能碰巧工作？

# 5. 完整 API 测试
print("\n=== 5. 完整 API 测试 ===")
o, e = run(f"""echo '== sign-in =='
TOKEN=$(curl -sS -X POST 'http://localhost:8000/auth/v1/token?grant_type=password' \
  -H 'apikey: {MEOO_ANON}' -H 'Content-Type: application/json' \
  -d '{{"email":"admin@thalvior.icu","password":"3403641888"}}' | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))' 2>/dev/null)
echo "token len: ${{#TOKEN}}"
echo "token: $TOKEN"
echo ''
echo '== wms_orders (auth) =='
curl -sS 'http://localhost:8000/rest/v1/wms_orders?limit=5' \
  -H 'apikey: {MEOO_ANON}' -H "Authorization: Bearer $TOKEN" 2>&1 | head -c 500
echo ''
echo '== tenant_id =='
curl -sS -X POST 'http://localhost:8000/rest/v1/rpc/get_current_tenant_id' \
  -H 'apikey: {MEOO_ANON}' -H "Authorization: Bearer $TOKEN" 2>&1
echo ''
echo '== anon =='
curl -sS 'http://localhost:8000/rest/v1/wms_orders?limit=5' \
  -H 'apikey: {MEOO_ANON}' 2>&1 | head -c 500""", timeout=30)
print(o)

# 6. 外部测试
print("\n=== 6. 外部测试 ===")
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
print(f"  /rest/v1/ (meoo anon): {test('https://thalvior.fun/rest/v1/', {'apikey': MEOO_ANON})}")
print(f"  /wms/: {test('https://thalvior.fun/wms/')}")
