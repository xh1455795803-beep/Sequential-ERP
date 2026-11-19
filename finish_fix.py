#!/usr/bin/env python3
"""最后一步：在 compose 里加回 PGRST_JWT_SECRET_IS_BASE64: false + 测试."""
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

# 1. 看 compose 里当前 rest env 段
print("=== 1. Current rest env block ===")
o, _ = run("grep -A20 'container_name: supabase-rest' /opt/supabase/docker/docker-compose.yml | head -25")
print(o)

# 2. 用 python 精确插入 IS_BASE64
print("\n=== 2. Insert IS_BASE64 ===")
o, _ = run("cat /opt/supabase/docker/docker-compose.yml")
lines = o.split('\n')
new_lines = []
for i, line in enumerate(lines):
    new_lines.append(line)
    if 'PGRST_JWT_SECRET:' in line and '${JWT_JWKS' in line:
        # 检查下一行是不是已经有 IS_BASE64
        j = i + 1
        while j < len(lines) and lines[j].strip() == '':
            j += 1
        if 'IS_BASE64' not in lines[i+1] if i+1 < len(lines) else True:
            # 在 JWT_SECRET 后面插入（保持缩进）
            indent = len(line) - len(line.lstrip())
            spaces = ' ' * indent
            new_lines.append(f'{spaces}PGRST_JWT_SECRET_IS_BASE64: "false"')

c = '\n'.join(new_lines)
b64c = base64.b64encode(c.encode()).decode()
run(f"echo '{b64c}' | base64 -d | sudo tee /opt/supabase/docker/docker-compose.yml > /dev/null")

# 验证
o, _ = run("grep -E 'PGRST_JWT|PGRST_DB_USE_LEGACY' /opt/supabase/docker/docker-compose.yml")
print(f"  New PGRST:\n  {o}")
assert 'IS_BASE64: "false"' in o

# 3. 重启
print("\n=== 3. Restart auth + rest ===")
run(f"{CMP} up -d --force-recreate auth rest 2>&1")
time.sleep(12)
o, _ = run("docker ps --filter name=supabase-auth --filter name=supabase-rest --format '{{.Names}} {{.Status}}'")
print(o)

# 4. 验证 postgrest config
print("\n=== 4. Postgrest runtime config ===")
o, _ = run("docker exec supabase-rest postgrest --dump-config 2>&1 | grep -iE 'jwt|secret|base64|role|aud'")
print(o)

# 5. 测试 auth sign-in
MEOO_ANON = "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw"
print("\n=== 5. Auth sign-in ===")
o, e = run(f"""curl -sS -X POST 'http://localhost:8000/auth/v1/token?grant_type=password' \
  -H 'apikey: {MEOO_ANON}' -H 'Content-Type: application/json' \
  -d '{{"email":"admin@thalvior.icu","password":"3403641888"}}' 2>&1""")
try:
    d = json.loads(o)
    token = d.get("access_token", "")
    print(f"  ✅ Login OK! token={token[:50]}...")
except:
    print(f"  ❌ {o[:300]}")
    token = ""

# 6. REST API
print("\n=== 6. REST API ===")
o, e = run(f"""echo '-- wms_orders --'
curl -sS 'http://localhost:8000/rest/v1/wms_orders?limit=3' \
  -H 'apikey: {MEOO_ANON}' -H 'Authorization: Bearer {token}' 2>&1
echo ''
echo '-- tenant_id --'
curl -sS -X POST 'http://localhost:8000/rest/v1/rpc/get_current_tenant_id' \
  -H 'apikey: {MEOO_ANON}' -H 'Authorization: Bearer {token}' 2>&1""")
print(o)

# 7. 外部测试
print("\n=== 7. 外部 thalvior.fun ===")
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
print(f"  WMS /wms/:     {test('https://thalvior.fun/wms/')}")
