#!/usr/bin/env python3
"""诊断 auth 500 错误"""
import socket, time, paramiko, requests

HOST, PORT, USER, PASS = '43.133.232.81', 22, 'ubuntu', 'yuan340364#'

def connect():
    sock = socket.socket(); sock.settimeout(15); sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    for _ in range(15):
        try:
            sock.connect(('127.0.0.1', 18080))
            sock.sendall(f'CONNECT {HOST}:{PORT} HTTP/1.1\r\nHost: {HOST}:{PORT}\r\n\r\n'.encode())
            buf = b''
            while b'\r\n\r\n' not in buf:
                d = sock.recv(4096)
                if not d: break
                buf += d
            time.sleep(0.5)
            t = paramiko.Transport(sock); t.start_client(); t.auth_password(USER, PASS)
            c = paramiko.SSHClient(); c._transport = t; c._sftp_live = False
            return c
        except Exception:
            try: sock.close()
            except: pass
            time.sleep(2)
    raise RuntimeError('connect failed')

def run(c, cmd):
    stdin, stdout, stderr = c.exec_command(cmd, timeout=30)
    o = stdout.read().decode('utf-8', errors='replace').strip()
    e = stderr.read().decode('utf-8', errors='replace').strip()
    return o, e

c = connect()

print('='*60)
print('🔍 auth 500 诊断')
print('='*60)

# 1. Supabase auth container 日志
print('\n1️⃣ Supabase auth 日志 (最近 30 行):')
o, e = run(c, 'docker logs supabase-auth --tail 30 2>&1')
print(o[:800])

# 2. 直接测试 auth signin（本地 curl 绕过外网）
print('\n2️⃣ 内部 curl auth/v1/token:')
o, e = run(c, """curl -s -X POST 'http://127.0.0.1:8000/auth/v1/token?grant_type=password' \
  -H 'apikey: eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw' \
  -H 'Content-Type: application/json' \
  -d '{"email":"merchant@thalvior.dev","password":"Merchant1234!"}'""")
print(o[:500])

# 3. auth.users 表结构
print('\n3️⃣ auth.users 列:')
o, e = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
  SELECT column_name, data_type, is_nullable FROM information_schema.columns 
  WHERE table_schema='auth' AND table_name='users' ORDER BY ordinal_position;
\"""")
print(o)

# 4. 我们创建的账号
print('\n4️⃣ 我们创建的 auth.users:')
o, e = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  SELECT id, email, email_confirmed_at, raw_user_meta_data FROM auth.users WHERE email LIKE '%thalvior%dev%';
\"""")
print(o)

# 5. 测试密码匹配
print('\n5️⃣ 测试密码匹配 (crypt):')
o, e = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  SELECT email, crypt('Merchant1234!', encrypted_password) = encrypted_password as pass_ok FROM auth.users WHERE email='merchant@thalvior.dev';
\"""")
print(o)

# 6. auth schema 有没有被破坏
print('\n6️⃣ auth schema 完整性检查 (必须有这几个表):')
for tbl in ['users', 'refresh_tokens', 'instances', 'sso_domains', 'flow_state']:
    o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
      SELECT count(*) FROM information_schema.tables WHERE table_schema='auth' AND table_name='{tbl}';\"""")
    print(f'  auth.{tbl}: {o.strip()}')

c.close()
