#!/usr/bin/env python3
"""直接看 auth sign-in 的具体错误."""
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

# 1. Auth sign-in verbose
print("=== 1. Auth sign-in verbose ===")
o, e = run(f"""curl -sv -X POST 'http://localhost:8000/auth/v1/token?grant_type=password' \
  -H 'apikey: {MEOO_ANON}' -H 'Content-Type: application/json' \
  -d '{{"email":"admin@thalvior.icu","password":"3403641888"}}' 2>&1""")
print(o[:800])

# 2. Auth health
print("\n=== 2. Auth health ===")
o, e = run(f"curl -sv 'http://localhost:8000/auth/v1/health' 2>&1 | head -30")
print(o)

# 3. Auth logs
print("\n=== 3. Auth logs ===")
o, e = run("docker logs supabase-auth --since 30s 2>&1 | tail -20")
print(o)

# 4. Auth container 的 JWT secret 原始值（检查末尾 = 是否存在）
print("\n=== 4. Check GOTRUE_JWT_SECRET exact value ===")
o, e = run("docker exec supabase-auth env 2>/dev/null | grep 'GOTRUE_JWT_SECRET=' | cat -A")
print(f"  GOTRUE_JWT_SECRET: [{o}]")

o, e = run("grep '^JWT_SECRET=' /opt/supabase/docker/.env | cat -A")
print(f"  .env JWT_SECRET:   [{o}]")

# 5. Check auth config — 有没有 IS_BASE64 相关？
print("\n=== 5. Auth IS_BASE64 env ===")
o, e = run("docker exec supabase-auth env 2>/dev/null | grep -iE 'BASE64|SECRET'")
print(o)

# 6. 直接用 auth 的 admin API 注册一个新 user 测试
print("\n=== 6. Direct auth health (no apikey) ===")
o, e = run("curl -sv 'http://localhost:8000/auth/v1/health' 2>&1 | head -30")
print(o)
