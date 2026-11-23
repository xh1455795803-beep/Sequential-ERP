#!/usr/bin/env python3
"""看 auth 最新错误 + auth schema 检查"""
import socket, time, paramiko

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
    return stdout.read().decode('utf-8', errors='replace').strip(), stderr.read().decode('utf-8', errors='replace').strip()

c = connect()

# 1. 触发 signin 并立刻看 auth 日志
print('1️⃣ 触发一次 signin...')
o, _ = run(c, """curl -s -X POST 'http://127.0.0.1:8000/auth/v1/token?grant_type=password' \
  -H 'apikey: eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw' \
  -H 'Content-Type: application/json' \
  -d '{"email":"merchant@thalvior.dev","password":"Merchant1234!"}'""")
print(f'   signin resp: {o[:200]}')

# 2. auth 最新 error 日志
print('\n2️⃣ auth 最新 error 日志 (grep error):')
o, _ = run(c, "docker logs supabase-auth --since 3m 2>&1 | grep 'error_' | tail -10")
print(o)

# 3. auth DB 直连测试 — 从 auth admin 视角
print('\n3️⃣ auth schema 完整性 (table columns):')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  SELECT 'auth.users' as tbl, count(*) as cols FROM information_schema.columns WHERE table_schema='auth' AND table_name='users'
  UNION ALL
  SELECT 'auth.identities', count(*) FROM information_schema.columns WHERE table_schema='auth' AND table_name='identities'
  UNION ALL
  SELECT 'auth.refresh_tokens', count(*) FROM information_schema.columns WHERE table_schema='auth' AND table_name='refresh_tokens';
\"""")
print(o)

# 4. auth.users 的 deleted_at 检查 — 是否有被标记为 deleted 的用户？
print('\n4️⃣ auth.users deleted_at / banned_until 检查:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  SELECT email, deleted_at, banned_until, email_change_confirm_status, is_super_admin, is_sso_user, is_anonymous
  FROM auth.users;
\"""")
print(o)

# 5. auth.identities — 我们的账号有 identity 吗？
print('\n5️⃣ auth.identities 完整数据:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"SELECT * FROM auth.identities;\"""")
print(o[:1000])

# 6. auth.instances 是空的？应该至少有一个默认 instance
print('\n6️⃣ auth.instances (关键! 空的可能是问题):')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"SELECT * FROM auth.instances;\"""")
print(f'   行数: {len(o.splitlines())-2}')
print(o)

# 7. auth schema migrations — 跑全了吗？
print('\n7️⃣ auth.schema_migrations 行数:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"SELECT count(*) FROM auth.schema_migrations;\"""")
print(o)

# 8. 重启 auth 容器 (让它重新读 DB schema)
print('\n8️⃣ 重启 supabase-auth 容器...')
run(c, 'docker restart supabase-auth 2>&1')
time.sleep(3)
print('   已重启，等 3s...')

# 9. 重启后 signin
print('\n9️⃣ 重启后 signin:')
o, _ = run(c, """curl -s -X POST 'http://127.0.0.1:8000/auth/v1/token?grant_type=password' \
  -H 'apikey: eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw' \
  -H 'Content-Type: application/json' \
  -d '{"email":"merchant@thalvior.dev","password":"Merchant1234!"}'""")
print(f'   resp: {o[:300]}')

c.close()
