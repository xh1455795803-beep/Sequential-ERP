#!/usr/bin/env python3
"""看 auth 日志 + 重试 signin"""
import socket, time, paramiko, requests

HOST, PORT, USER, PASS = '43.133.232.81', 22, 'ubuntu', 'yuan340364#'

def connect():
    sock = socket.socket(); sock.settimeout(20); sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    for attempt in range(20):
        try:
            sock.connect(('127.0.0.1', 18080))
            sock.sendall(f'CONNECT {HOST}:{PORT} HTTP/1.1\r\nHost: {HOST}:{PORT}\r\n\r\n'.encode())
            buf = b''
            while b'\r\n\r\n' not in buf:
                d = sock.recv(4096)
                if not d: break
                buf += d
            time.sleep(1)
            t = paramiko.Transport(sock); t.start_client(); t.auth_password(USER, PASS)
            c = paramiko.SSHClient(); c._transport = t; c._sftp_live = False
            return c
        except Exception:
            try: sock.close()
            except: pass
            time.sleep(2)
    raise RuntimeError('connect failed')

def run(c, cmd, timeout=60):
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip(), stderr.read().decode('utf-8', errors='replace').strip()

c = connect()

# 1. 先试最新 signin
print('🔐 1. 立即 signin:')
r = requests.post('https://thalvior.icu/auth/v1/token', 
    params={'grant_type': 'password'},
    json={'email': 'merchant@thalvior.dev', 'password': 'Merchant1234!'},
    headers={'Content-Type': 'application/json', 'apikey': 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw'}, 
    timeout=15)
print(f'  {r.status_code} — {r.text[:200]}')

# 2. 看 auth 日志
print('\n🔐 2. auth 日志 (last 50):')
o, _ = run(c, 'docker logs supabase-auth --tail 50 2>&1')
print(o[-2000:])

# 3. 看 envoy auth 请求转发情况
print('\n🔐 3. 直接 localhost:8080 试 auth:')
o, _ = run(c, """curl -s -X POST 'http://localhost:8080/auth/v1/token?grant_type=password' \
  -H 'Content-Type: application/json' \
  -H 'apikey: eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw' \
  -d '{"email":"merchant@thalvior.dev","password":"Merchant1234!"}' \
  -w 'HTTP %{http_code}\n' 2>&1""")
print(f'  {o[:300]}')

# 4. 看 auth 容器内部直接请求
print('\n🔐 4. auth 容器内部 curl:')
o, _ = run(c, """docker exec supabase-auth sh -c "curl -s -X POST 'http://localhost/auth/v1/token?grant_type=password' \
  -H 'Content-Type: application/json' \
  -d '{\\\"email\\\":\\\"merchant@thalvior.dev\\\",\\\"password\\\":\\\"Merchant1234!\\\"}' \
  -w '\\nHTTP %{http_code}\\n'" 2>&1""")
print(f'  {o[:300]}')

# 5. 看 auth config / email provider
print('\n🔐 5. auth.config 关键项:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
SELECT config || ' = ' || coalesce(value, 'NULL') FROM auth.config WHERE config IN ('disable_signup','email_confirm','phone_confirm','default_confirmation_method','default_password_recovery_method');
\"""")
print(f'  {o}')

# 6. 看 auth.audit_log_entries 最近 10 条
print('\n🔐 6. auth.audit_log_entries (最近 10):')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT created_at, action, actor_username, message FROM auth.audit_log_entries ORDER BY created_at DESC LIMIT 10;
\"""")
print(o)

# 7. 如果有 session 表
print('\n🔐 7. auth.sessions (最近):')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT id, user_id, created_at, expires_at FROM auth.sessions ORDER BY created_at DESC LIMIT 5;
\"""")
print(o)

c.close()
