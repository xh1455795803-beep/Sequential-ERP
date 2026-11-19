#!/usr/bin/env python3
"""带 apikey 测 auth + 看 auth sign-in 完整错误."""
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

# 1. Auth health WITH apikey
print("=== 1. Auth health (WITH apikey) ===")
o, e = run(f"curl -sv 'http://localhost:8000/auth/v1/health' -H 'apikey: {MEOO_ANON}' 2>&1 | head -40")
print(o)

# 2. Auth sign-in WITH apikey (detailed)
print("\n=== 2. Auth sign-in (WITH apikey) ===")
o, e = run(f"""curl -sv --max-time 10 -X POST 'http://localhost:8000/auth/v1/token?grant_type=password' \
  -H 'apikey: {MEOO_ANON}' -H 'Content-Type: application/json' \
  -d '{{"email":"admin@thalvior.icu","password":"3403641888"}}' 2>&1""", timeout=30)
print(o[:1000])

# 3. Auth sign-in direct container (bypass envoy)
print("\n=== 3. Auth direct container port 9999 ===")
o, e = run(f"""docker exec supabase-auth sh -c "GOTRUE_API_HOST=0.0.0.0; curl -sS --max-time 5 -X POST 'http://localhost:9999/token?grant_type=password' \
  -H 'Content-Type: application/json' \
  -d '{{\"email\":\"admin@thalvior.icu\",\"password\":\"3403641888\"}}' 2>&1 || echo 'direct fail'" 2>&1""")
print(o[:500])

# 4. Auth users (to confirm admin user exists)
print("\n=== 4. List users (direct) ===")
o, e = run(f"""curl -sS --max-time 5 'http://localhost:8000/auth/v1/admin/users' \
  -H 'apikey: {MEOO_ANON}' \
  -H 'Authorization: Bearer $(grep '^SERVICE_ROLE_KEY=' /opt/supabase/docker/.env | cut -d= -f2)' 2>&1 | head -c 500""")
print(o)

# 5. auth 容器自己 logs
print("\n=== 5. Auth logs ===")
o, e = run("docker logs supabase-auth --since 60s 2>&1 | tail -30")
print(o)
