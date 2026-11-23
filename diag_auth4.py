#!/usr/bin/env python3
"""搜 auth 完整日志 + auth schema 完整性"""
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
    stdin, stdout, stderr = c.exec_command(cmd, timeout=60)
    o = stdout.read().decode('utf-8', errors='replace').strip()
    e = stderr.read().decode('utf-8', errors='replace').strip()
    return o, e

c = connect()

print('='*60)
print('🔍 auth signin 500 完整诊断')
print('='*60)

# 1. 完整 auth 日志 (不限 tail，grep error_id)
print('\n1️⃣ auth 日志 grep error_id=b28ddde0:')
o, _ = run(c, "docker logs supabase-auth 2>&1 | grep -A5 -B5 'b28ddde0' | tail -30")
print(o[:2000])

# 2. auth schema 里所有表
print('\n2️⃣ auth schema 所有表:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
  SELECT table_name FROM information_schema.tables 
  WHERE table_schema='auth' ORDER BY table_name;
\"""")
print(o)

# 3. auth.views / auth.identities / auth.refresh_tokens — 这些关键表有吗？
print('\n3️⃣ auth 关键表存在性 + 行数:')
for tbl in ['audit_log_entries', 'identities', 'refresh_tokens', 'instances', 'sso_domains', 'flow_state', 'mfa_factors', 'mfa_challenges', 'users']:
    o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
      SELECT count(*) FROM auth.{tbl};\"""")
    print(f'   auth.{tbl}: {o.strip()}')

# 4. 直接 Supabase Auth 测试 email confirm
print('\n4️⃣ 触发一次 signin 并看 auth 日志尾部:')
o, _ = run(c, "docker logs supabase-auth --tail 50 > /tmp/auth_before.txt 2>&1; echo ok")
o, _ = run(c, """curl -s -X POST 'http://127.0.0.1:8000/auth/v1/token?grant_type=password' \
  -H 'apikey: eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw' \
  -H 'Content-Type: application/json' \
  -d '{"email":"merchant@thalvior.dev","password":"Merchant1234!}'""")
print(f'   signin: {o[:200]}')
o, _ = run(c, "docker logs supabase-auth --tail 30 2>&1 | tail -30")
print(f'\n   auth 最新 30 行:\n{o}')

# 5. 搜 "querying schema" 相关错误模板 — 看 Supabase auth 内部代码
print('\n5️⃣ auth DB 连接测试 + schema 查询:')
o, _ = run(c, """docker exec supabase-auth sh -c 'export PGPASSWORD="AZwqsjwWeTwdTUQvBBiOai8_9M0Pm2j2"; psql -h db -U supabase_auth_admin -d postgres -c "SELECT * FROM auth.users WHERE email = '\''merchant@thalvior.dev'\'';"' 2>&1""")
print(f'   auth_admin 直连 DB 查 users: {o[:500]}')

# 6. auth identities — Supabase 新版本 (2024+) 用 auth.identities 表
# signin 时 auth 必须能从 identities 查到用户
print('\n6️⃣ auth.identities 表 (关键! Supabase 新版 signin 依赖它):')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  SELECT column_name, data_type FROM information_schema.columns 
  WHERE table_schema='auth' AND table_name='identities' ORDER BY ordinal_position;
\"""")
print(o)
o2, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"SELECT * FROM auth.identities;\"""")
print(f'   identities 行数: {len(o2.splitlines())-2}')
print(o2[:500])

# 7. 关键！我们的用户在 auth.users 里但 auth.identities 是空的！
# 需要给每个用户补 identity
print('\n7️⃣ 给 dev 账号补 auth.identities:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres <<'SQL'
INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
SELECT id, id, 'email', 
       jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
       'email',
       now(), now(), now()
FROM auth.users WHERE email LIKE '%thalvior%dev%'
ON CONFLICT (id) DO NOTHING;

SELECT id, user_id, provider FROM auth.identities;
SQL""")
print(o[:500])

# 8. 再测 signin
print('\n8️⃣ 补 identities 后 signin:')
o, _ = run(c, """curl -s -X POST 'http://127.0.0.1:8000/auth/v1/token?grant_type=password' \
  -H 'apikey: eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw' \
  -H 'Content-Type: application/json' \
  -d '{"email":"merchant@thalvior.dev","password":"Merchant1234!"}'""")
print(o[:500])

c.close()
