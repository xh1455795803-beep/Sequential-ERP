#!/usr/bin/env python3
"""深入诊断 auth"""
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

print('='*60)
print('🔍 auth 深入诊断')
print('='*60)

# 1. 触发一次 signin，然后立刻看 auth 日志里的完整 stack trace
print('\n1️⃣ 清除 auth 日志，触发 signin，看新日志:')
run(c, 'docker logs supabase-auth > /tmp/auth_before.log 2>&1; echo cleared')
# 触发 signin
o, e = run(c, """curl -s -X POST 'http://127.0.0.1:8000/auth/v1/token?grant_type=password' \
  -H 'apikey: eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw' \
  -H 'Content-Type: application/json' \
  -d '{"email":"merchant@thalvior.dev","password":"Merchant1234!"}'""")
print(f'   signin response: {o[:300]}')

# 看新产生的 auth 日志（最后 20 行）
o, _ = run(c, 'docker logs supabase-auth --tail 20 2>&1')
print(f'\n   auth 最新日志:\n{o[:1000]}')

# 2. 直接在数据库里测试 auth 的查询
print('\n\n2️⃣ 直接测试 auth.users 的 auth 风格查询:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  SELECT id, email, encrypted_password, email_confirmed_at, instance_id, role 
  FROM auth.users WHERE email='merchant@thalvior.dev';
\"""")
print(o)

# 3. 检查 is_sso_user 和 is_anonymous NOT NULL 约束
print('\n3️⃣ NOT NULL 约束检查 (我们的账号):')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  SELECT email, is_sso_user, is_anonymous, COALESCE(phone,'(null)') as phone, COALESCE(last_sign_in_at, now()) as last_sign_in_at,
         email_change_confirm_status, is_super_admin
  FROM auth.users WHERE email LIKE '%thalvior%dev%';
\"""")
print(o)

# 4. 用 Supabase auth 注册一个全新的账号试试（看是我们的种子问题还是 auth 整体坏了）
print('\n\n4️⃣ 用 auth API 注册新账号测试:')
o, _ = run(c, """curl -s -X POST 'http://127.0.0.1:8000/auth/v1/signup' \
  -H 'apikey: eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw' \
  -H 'Content-Type: application/json' \
  -d '{"email":"debug_test_'$(date +%s)'@test.com","password":"Test1234!"}'""")
print(o[:500])

# 5. 看有没有 trigger 或 policy 拦着
print('\n\n5️⃣ auth schema triggers:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
  SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE tgrelid::regclass::text LIKE 'auth.%';
\"""")
print(o[:500])

# 6. 关键：auth.users 的列类型我们手动 INSERT 时对了吗？
print('\n6️⃣ 我们 INSERT 时提供的列类型 vs 期望:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  SELECT column_name, data_type, is_nullable, 
         character_maximum_length as max_len
  FROM information_schema.columns 
  WHERE table_schema='auth' AND table_name='users' 
  AND is_nullable='NO'
  ORDER BY ordinal_position;
\"""")
print('NOT NULL 列:')
print(o)

# 7. 直接 INSERT 一个全新账号测试
print('\n\n7️⃣ 直接 SQL INSERT 新账号测试 (显式填所有 NOT NULL):')
run(c, """docker exec supabase-db psql -U supabase_admin -d postgres <<'SQL'
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, confirmation_token, email_change_token_new,
  email_change, recovery_token, email_change_token_current,
  email_change_confirm_status, raw_user_meta_data, raw_app_meta_data,
  created_at, updated_at, is_sso_user, reauthentication_token,
  is_anonymous
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated', 'authenticated',
  'sql_direct_' || extract(epoch from now())::bigint || '@test.com',
  crypt('Test1234!', gen_salt('bf')),
  now(), '', '', '', '', '', 0,
  '{"portal_role":"test"}'::jsonb,
  '{"provider":"email","providers":["email"]}'::jsonb,
  now(), now(), false, '', false
) RETURNING id, email;
SQL""")

# 新账号 signin
import re
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
  SELECT email FROM auth.users WHERE email LIKE 'sql_direct_%' ORDER BY created_at DESC LIMIT 1;
\"""")
new_email = o.strip()
if new_email:
    print(f'\n新账号: {new_email}')
    o2, _ = run(c, f"""curl -s -X POST 'http://127.0.0.1:8000/auth/v1/token?grant_type=password' \
      -H 'apikey: eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw' \
      -H 'Content-Type: application/json' \
      -d '{{\"email\":\"{new_email}\",\"password\":\"Test1234!\"}}'""")
    print(f'新账号 signin: {o2[:300]}')

c.close()
