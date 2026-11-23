#!/usr/bin/env python3
"""彻底修 auth.users 所有 NULL 列 — varchar 和 timestamp"""
import socket, time, paramiko, json

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

def run_stdin(c, cmd, data):
    stdin, stdout, stderr = c.exec_command(cmd, timeout=30)
    stdin.write(data.encode())
    stdin.channel.shutdown_write()
    return stdout.read().decode('utf-8', errors='replace').strip(), stderr.read().decode('utf-8', errors='replace').strip()

def run(c, cmd):
    stdin, stdout, stderr = c.exec_command(cmd, timeout=30)
    return stdout.read().decode('utf-8', errors='replace').strip(), stderr.read().decode('utf-8', errors='replace').strip()

c = connect()

print('='*60)
print('🔧 彻底修 auth.users NULL 列')
print('='*60)

# 1. 先看 auth.users 所有 NULL 值列
print('\n1️⃣ auth.users 所有 NULL 值列检查:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  SELECT column_name, data_type 
  FROM information_schema.columns 
  WHERE table_schema='auth' AND table_name='users' AND is_nullable='YES'
  ORDER BY ordinal_position;
\"""")
print(o)

# 2. 全面修复：所有 varchar → ''，所有 timestamp → now()
fix_all = """
UPDATE auth.users SET
  -- VARCHAR/TEXT → ''
  confirmation_token            = COALESCE(confirmation_token, ''),
  email_change_token_new        = COALESCE(email_change_token_new, ''),
  email_change_token_current    = COALESCE(email_change_token_current, ''),
  email_change                  = COALESCE(email_change, ''),
  recovery_token                = COALESCE(recovery_token, ''),
  reauthentication_token       = COALESCE(reauthentication_token, ''),
  phone_change_token            = COALESCE(phone_change_token, ''),
  phone_change                  = COALESCE(phone_change, ''),
  phone                         = COALESCE(phone, ''),
  -- TIMESTAMP → now()
  updated_at                    = COALESCE(updated_at, created_at, now()),
  last_sign_in_at               = COALESCE(last_sign_in_at, email_confirmed_at, now()),
  invited_at                    = COALESCE(invited_at, created_at),
  confirmation_sent_at          = COALESCE(confirmation_sent_at, created_at),
  recovery_sent_at              = COALESCE(recovery_sent_at, created_at),
  email_change_sent_at          = COALESCE(email_change_sent_at, created_at),
  email_change_token_current   = COALESCE(email_change_token_current, ''),
  phone_change_sent_at          = COALESCE(phone_change_sent_at, created_at),
  deleted_at                    = COALESCE(deleted_at, '2099-12-31 23:59:59+00'::timestamptz),
  banned_until                  = COALESCE(banned_until, '2099-12-31 23:59:59+00'::timestamptz),
  -- INTEGER/BOOLEAN
  email_change_confirm_status   = COALESCE(email_change_confirm_status, 0),
  is_super_admin                = COALESCE(is_super_admin, false),
  is_sso_user                   = COALESCE(is_sso_user, false),
  is_anonymous                  = COALESCE(is_anonymous, false);
"""
o, e = run_stdin(c, 'docker exec -i supabase-db psql -U supabase_admin -d postgres', fix_all)
print(f'\n2️⃣ UPDATE:\n{o}\n{e}')

# 3. 验证 updated_at 不是 NULL
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  SELECT email, updated_at, last_sign_in_at, deleted_at FROM auth.users;
\"""")
print(f'\n3️⃣ 验证 updated_at 等:\n{o}')

# 4. 也修 auth.instances — 空的话插入一个默认实例
print('\n4️⃣ auth.instances 补数据:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"SELECT count(*) FROM auth.instances;\"""")
print(f'   当前行数: {o.strip()}')
if o.strip() == '0':
    run_stdin(c, 'docker exec -i supabase-db psql -U supabase_admin -d postgres', """
INSERT INTO auth.instances (id, raw_base_config, created_at, updated_at)
VALUES (gen_random_uuid(), '{}'::jsonb, now(), now());
""")

# 5. 也确保 auth.users 有 identity（可能之前没插入成功）
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at, email)
  SELECT id, id, 'email', 
         jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
         'email',
         now(), now(), now(), email
  FROM auth.users u
  WHERE u.email LIKE '%thalvior%dev%' 
    AND NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id)
  ON CONFLICT (id) DO NOTHING;
  
SELECT id, user_id, provider FROM auth.identities;
\"""")
print(f'\n5️⃣ identities:\n{o}')

# 6. 重启 auth + signin
print('\n6️⃣ 重启 auth + signin:')
run(c, 'docker restart supabase-auth 2>&1')
time.sleep(4)

for who, pwd in [('merchant@thalvior.dev','Merchant1234!'),('wms@thalvior.dev','Wms1234!'),('admin@thalvior.dev','Admin1234!')]:
    o, _ = run(c, f"""curl -s -X POST 'http://127.0.0.1:8000/auth/v1/token?grant_type=password' \
      -H 'apikey: eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw' \
      -H 'Content-Type: application/json' \
      -d '{{"email":"{who}","password":"{pwd}"}}'""")
    if 'access_token' in o:
        data = json.loads(o)
        print(f'   ✅ {who}: token_len={len(data["access_token"])}, refresh_len={len(data["refresh_token"])}')
    else:
        print(f'   ❌ {who}: {o[:150]}')

c.close()
