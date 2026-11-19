#!/usr/bin/env python3
"""诊断 auth 到底怎么用 secret 的."""
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

MEOO_ANON = "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw"
CORRECT_SECRET = "BRnoce2N0ZWRx+NZBWYEWnTlHVBI5jiE9DTyH/jie9A="

# 1. auth 容器的 GOTRUE 环境变量
print("=== 1. auth env ===")
o, _ = run("docker exec supabase-auth env 2>/dev/null | grep GOTRUE_JWT")
print(o)

# 2. auth sign-in 拿一个 token
print("\n=== 2. Get fresh auth token ===")
o, _ = run(f"""curl -sS -X POST 'http://localhost:8000/auth/v1/token?grant_type=password' \
  -H 'apikey: {MEOO_ANON}' -H 'Content-Type: application/json' \
  -d '{{"email":"admin@thalvior.icu","password":"3403641888"}}' 2>&1 | python3 -c 'import sys,json; d=json.load(sys.stdin); print(\"TOKEN=\" + d[\"access_token\"])'""")
print(o[:200])
auth_token = o.replace("TOKEN=", "").strip()

if auth_token and auth_token != "":
    # 3. 解码 auth token payload
    header, payload, sig = auth_token.split('.')
    payload_json = json.loads(base64.urlsafe_b64decode(payload + '=='))
    print(f"\n=== 3. Auth token payload ===")
    print(json.dumps(payload_json, indent=2)[:500])
    
    sig_input = f"{header}.{payload}"
    
    # 4. 尝试不同方式验签
    print(f"\n=== 4. 尝试验签 auth token ===")
    tests = [
        ("raw string (44 chars)", CORRECT_SECRET.encode()),
        ("base64 decode (32 bytes)", base64.b64decode(CORRECT_SECRET)),
    ]
    for name, sec in tests:
        sig_computed = hmac.new(sec, sig_input.encode(), hashlib.sha256).digest()
        sig_computed_b64 = base64.urlsafe_b64encode(sig_computed).rstrip(b'=').decode()
        match = "✅ MATCH auth" if sig_computed_b64 == sig else "❌ NO"
        print(f"  {name}: {match}")
        if match.startswith("✅"):
            print(f"    → auth 用的是 {name} 来签名！")
            break
    else:
        print("  都不匹配...")

# 5. postgrest 那边试什么配置能验证通过？
# postgrest 当前 jwt-secret-is-base64 = false → 当 raw string
# 如果 auth 是 base64 decode 后签的 → postgrest 也要 base64 decode → IS_BASE64=true
# 但 meoo 的 anon key 是 raw string 签的（case 3 验证过）
# 如果 auth 改了 secret 处理方式... 

# 关键线索：meoo 的 anon key 是旧 auth 签的，之前能用
# 现在 auth 也是用同一个 secret，也应该能用
# 但我重启了 auth，它是不是换了 secret 处理方式？

# 让我看看 auth 版本和它的 secret 处理
print("\n=== 5. auth 容器版本 ===")
o, _ = run("docker exec supabase-auth auth --version 2>/dev/null || docker exec supabase-auth cat /auth_version 2>/dev/null || echo 'unknown'; docker exec supabase-auth env 2>/dev/null | grep -iE 'version|secret|jwt'")
print(o[:1000])

# 6. 试试 PGRST_JWT_SECRET_IS_BASE64=true
# 如果 auth 做了 base64 decode，那 postgrest 也要做
print("\n=== 6. 如果 auth 做了 base64 decode → postgrest 也需要 IS_BASE64=true ===")
o, _ = run("cat /opt/supabase/docker/docker-compose.yml")
c = o
c = c.replace('PGRST_JWT_SECRET_IS_BASE64: "false"', 'PGRST_JWT_SECRET_IS_BASE64: "true"')
import base64 as b64
b64c = b64.b64encode(c.encode()).decode()
run(f"echo '{b64c}' | base64 -d | sudo tee /opt/supabase/docker/docker-compose.yml > /dev/null")
run(f"docker compose -f /opt/supabase/docker/docker-compose.yml --env-file /opt/supabase/docker/.env up -d --force-recreate rest 2>&1")
time.sleep(8)

o, _ = run("docker exec supabase-rest postgrest --dump-config 2>&1 | grep 'jwt-secret'")
print(f"  postgrest config: {o}")

# 测试
o, e = run(f"""TOKEN=$(curl -sS -X POST 'http://localhost:8000/auth/v1/token?grant_type=password' \
  -H 'apikey: {MEOO_ANON}' -H 'Content-Type: application/json' \
  -d '{{"email":"admin@thalvior.icu","password":"3403641888"}}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])' 2>/dev/null)
echo "token len: ${{#TOKEN}}"
curl -sS 'http://localhost:8000/rest/v1/wms_orders?limit=3' -H 'apikey: {MEOO_ANON}' -H "Authorization: Bearer $TOKEN" 2>&1 | head -c 400""")
print(f"\n  wms_orders: {o}")
