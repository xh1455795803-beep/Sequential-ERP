#!/usr/bin/env python3
"""恢复原始 .env + 修 postgrest 配置 + 重启所有容器。"""
import socket, paramiko, time, json, base64, hmac, hashlib, subprocess, os

def run(c, timeout=120, retries=5):
    for attempt in range(retries):
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
            print(f"  retry {attempt+1}/5: {ex}"); time.sleep(3)
    raise RuntimeError("SSH failed")

CMP = "docker compose -f /opt/supabase/docker/docker-compose.yml --env-file /opt/supabase/docker/.env"

# 1. 读 .env.bak2 — 这是正确的原始值
print("=" * 70)
print("STEP 1: 从 .env.bak2 恢复原始 JWT_SECRET")
print("=" * 70)
o, _ = run("sudo cat /opt/supabase/docker/.env.bak2")
env_lines = o.split('\n')

# 提取原始值
orig_secret = None
orig_anon = None
orig_svc = None
rest_lines = []
for line in env_lines:
    if line.startswith('JWT_SECRET='):
        orig_secret = line.split('=',1)[1].strip()
        print(f"  JWT_SECRET (orig): {orig_secret[:40]}... (len={len(orig_secret)})")
    elif line.startswith('ANON_KEY='):
        orig_anon = line.split('=',1)[1].strip()
        print(f"  ANON_KEY (orig): {orig_anon[:40]}... (len={len(orig_anon)})")
    elif line.startswith('SERVICE_ROLE_KEY='):
        orig_svc = line.split('=',1)[1].strip()
    else:
        rest_lines.append(line)

if not orig_secret or not orig_anon:
    print("❌ 没找到原始值！")
    exit(1)

# 验证原始 anon key 签名是不是 meoo 里硬编码的那个
# meoo 里是 eyJ...P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw
print(f"\n  meoo 硬编码 anon 签名后缀: P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw")
print(f"  原始 .env.bak2 anon 后缀:  {orig_anon[-50:]}")

# 2. 更新当前 .env — 只改 JWT_SECRET/ANON_KEY/SERVICE_ROLE_KEY
print("\n" + "=" * 70)
print("STEP 2: 更新当前 .env")
print("=" * 70)

o2, _ = run("cat /opt/supabase/docker/.env")
new_lines = []
for line in o2.split('\n'):
    if line.startswith('JWT_SECRET='):
        new_lines.append(f"JWT_SECRET={orig_secret}")
    elif line.startswith('ANON_KEY='):
        new_lines.append(f"ANON_KEY={orig_anon}")
    elif line.startswith('SERVICE_ROLE_KEY='):
        new_lines.append(f"SERVICE_ROLE_KEY={orig_svc}")
    else:
        new_lines.append(line)

new_env = '\n'.join(new_lines)
import base64 as b64
b64_env = b64.b64encode(new_env.encode()).decode()
run(f"echo '{b64_env}' | base64 -d | sudo tee /opt/supabase/docker/.env > /dev/null && sudo chmod 600 /opt/supabase/docker/.env")

# 验证
o, _ = run('grep -E "^(JWT_SECRET|ANON_KEY)=" /opt/supabase/docker/.env | sed "s/JWT_SECRET/JWT_SECRET/;s/ANON_KEY/ANON_KEY/"')
print(f"  新 .env 值确认:\n  {o}")

# 3. 更新 docker-compose.yml — JWT_SECRET_IS_BASE64=true, ROLE_CLAIM_KEY=.role, 去掉 PRE_REQUEST
print("\n" + "=" * 70)
print("STEP 3: 更新 docker-compose.yml PGRST 配置")
print("=" * 70)

o, _ = run("cat /opt/supabase/docker/docker-compose.yml")
c = o

# 修 PGRST_JWT_SECRET_IS_BASE64 — 原始 secret 是 base64！
c = c.replace('PGRST_JWT_SECRET_IS_BASE64: "false"', 'PGRST_JWT_SECRET_IS_BASE64: "true"')

# 确保 ROLE_CLAIM_KEY 是 .role (JSON path)
if 'PGRST_JWT_ROLE_CLAIM_KEY' not in c:
    c = c.replace(
        'PGRST_JWT_AUD: "authenticated"\n      PGRST_DB_USE_LEGACY_GUCS',
        'PGRST_JWT_AUD: "authenticated"\n      PGRST_JWT_ROLE_CLAIM_KEY: ".role"\n      PGRST_DB_USE_LEGACY_GUCS'
    )

# 去掉我加的 PRE_REQUEST
c = c.replace('\n      PGRST_DB_PRE_REQUEST: "public.pgrst_pre_request_debug"', '')

# 写入
b64_c = b64.b64encode(c.encode()).decode()
run(f"echo '{b64_c}' | base64 -d | sudo tee /opt/supabase/docker/docker-compose.yml > /dev/null")

# 验证
o, _ = run("grep -E 'PGRST_JWT|PGRST_DB_USE_LEGACY|PGRST_DB_PRE_REQUEST' /opt/supabase/docker/docker-compose.yml")
print(f"  PGRST 配置:\n  {o}")

# 4. 重启 auth + rest 容器
print("\n" + "=" * 70)
print("STEP 4: 重启 auth + rest")
print("=" * 70)
o, e = run(f"""{CMP} up -d --force-recreate auth rest 2>&1""")
print(o[:500])
time.sleep(10)

o, _ = run("docker ps --filter name=supabase-auth --filter name=supabase-rest --format '{{.Names}} {{.Status}}'")
print(f"  状态: {o}")

# 5. 验证 postgrest 配置
print("\n" + "=" * 70)
print("STEP 5: 验证 postgrest 配置")
print("=" * 70)
o, _ = run("docker exec supabase-rest postgrest --dump-config 2>&1 | grep -iE 'jwt|secret|base64|role|aud'")
print(f"  postgrest config:\n  {o}")

# 6. 验证 auth 的 secret
print("\n" + "=" * 70)
print("STEP 6: 验证 auth secret")
print("=" * 70)
o, _ = run("docker exec supabase-auth env 2>/dev/null | grep 'GOTRUE_JWT_SECRET'")
print(f"  auth: {o}")

# 7. 测试货小易 API 是否恢复
print("\n" + "=" * 70)
print("STEP 7: 货小易 API 测试")
print("=" * 70)
import urllib.request
def test(url, headers=None):
    try:
        req = urllib.request.Request(url, headers=headers or {})
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, resp.read()[:500].decode(errors='replace')
    except urllib.error.HTTPError as ex:
        return f"HTTP {ex.code}", ex.read()[:300].decode(errors='replace')
    except Exception as ex:
        return f"ERR: {ex}", ""

# 用原始 (meoo 硬编码) anon key 测试 auth
s, b = test("http://localhost:8000/auth/v1/health")
print(f"  auth/v1/health: {s}")

s, b = test("http://localhost:8000/rest/v1/", {"apikey": orig_anon})
print(f"  rest/v1/ (orig anon): {s}")

# meoo 前端页面
s, b = test("https://thalvior.fun/portal/forwarder")
print(f"  thalvior.fun/portal/forwarder: {s}")

# 8. 测试 WMS（带 JSONB 修复的函数）
print("\n" + "=" * 70)
print("STEP 8: WMS 测试")
print("=" * 70)

def make_jwt(secret, sub, email, role):
    h = b64.urlsafe_b64encode(json.dumps({"alg":"HS256","typ":"JWT"}).encode()).rstrip(b'=').decode()
    p = json.dumps({"sub":sub,"email":email,"role":role,"aud":"authenticated","exp":int(time.time())+21600}).encode()
    pb = b64.urlsafe_b64encode(p).rstrip(b'=').decode()
    # secret 是 base64，先用 base64 decode
    secret_bytes = b64.b64decode(secret + '==')
    sig = hmac.new(secret_bytes, f"{h}.{pb}".encode(), hashlib.sha256).digest()
    sb = b64.urlsafe_b64encode(sig).rstrip(b'=').decode()
    return f"{h}.{pb}.{sb}"

auth_jwt = make_jwt(orig_secret, "6f9fc265-7ed8-48a3-a1b1-cdc18f310bae", "admin@thalvior.icu", "authenticated")
print(f"  WMS JWT[:50]: {auth_jwt[:50]}")

o, e = run(f"""curl -sS 'http://localhost:8000/rest/v1/wms_orders?limit=3' \
  -H 'apikey: {orig_anon}' \
  -H 'Authorization: Bearer {auth_jwt}' 2>&1""")
print(f"  wms_orders: {o[:300]}")

o, e = run(f"""curl -sS -X POST 'http://localhost:8000/rest/v1/rpc/get_current_tenant_id' \
  -H 'apikey: {orig_anon}' \
  -H 'Authorization: Bearer {auth_jwt}' 2>&1""")
print(f"  get_current_tenant_id(): {o}")
