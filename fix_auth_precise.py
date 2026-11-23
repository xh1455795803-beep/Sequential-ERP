#!/usr/bin/env python3
"""精确修 auth — 跳过 generated 列, phone 唯一, identities 给 dev 账号"""
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
print('🔧 精确修 auth')
print('='*60)

# 1. 修 timestamp 列 — 跳过 confirmed_at (GENERATED)
print('\n1️⃣ 修 TIMESTAMP (跳过 generated)')
ts = """
UPDATE auth.users SET
  updated_at              = COALESCE(updated_at, created_at, now()),
  last_sign_in_at         = COALESCE(last_sign_in_at, email_confirmed_at, created_at, now()),
  invited_at              = COALESCE(invited_at, created_at),
  confirmation_sent_at    = COALESCE(confirmation_sent_at, created_at),
  recovery_sent_at        = COALESCE(recovery_sent_at, created_at),
  email_change_sent_at    = COALESCE(email_change_sent_at, created_at),
  phone_confirmed_at      = COALESCE(phone_confirmed_at, created_at),
  phone_change_sent_at    = COALESCE(phone_change_sent_at, created_at),
  banned_until            = COALESCE(banned_until, '2099-12-31 23:59:59+00'::timestamptz),
  deleted_at              = COALESCE(deleted_at, '2099-12-31 23:59:59+00'::timestamptz),
  reauthentication_sent_at = COALESCE(reauthentication_sent_at, created_at)
WHERE email LIKE '%thalvior%dev%';
"""
o, e = run_stdin(c, 'docker exec -i supabase-db psql -U supabase_admin -d postgres', ts)
print(o or e)

# 2. 修 varchar — phone 用唯一值 (避免 unique constraint 冲突)
print('\n2️⃣ 修 VARCHAR')
vc = """
UPDATE auth.users SET
  confirmation_token          = COALESCE(confirmation_token, ''),
  email_change_token_new      = COALESCE(email_change_token_new, ''),
  email_change_token_current  = COALESCE(email_change_token_current, ''),
  email_change                = COALESCE(email_change, ''),
  recovery_token              = COALESCE(recovery_token, ''),
  reauthentication_token     = COALESCE(reauthentication_token, ''),
  phone_change_token          = COALESCE(phone_change_token, ''),
  phone_change                = COALESCE(phone_change, '')
WHERE email LIKE '%thalvior%dev%';
"""
o, e = run_stdin(c, 'docker exec -i supabase-db psql -U supabase_admin -d postgres', vc)
print(o or e)

# phone 单独处理 — 每个 dev 账号生成唯一 phone
print('\n3️⃣ phone 唯一值')
run_stdin(c, 'docker exec -i supabase-db psql -U supabase_admin -d postgres', """
UPDATE auth.users SET phone = 'NO-PHONE-' || substr(id::text, 1, 8)
WHERE email LIKE '%thalvior%dev%' AND (phone IS NULL OR phone = '');
""")

# 3. 验证所有 NULL 清除
print('\n4️⃣ 验证:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  SELECT email, updated_at, deleted_at, 
         phone, email_change 
  FROM auth.users WHERE email LIKE '%thalvior%dev%';
\"""")
print(o)

# 4. 给 dev 账号补 identity
print('\n5️⃣ 补 auth.identities (dev 账号)')
o, _ = run_stdin(c, 'docker exec -i supabase-db psql -U supabase_admin -d postgres', """
INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at, email)
SELECT u.id, u.id, 'email', 
       jsonb_build_object(
         'sub', u.id::text, 
         'email', u.email, 
         'email_verified', COALESCE(u.email_confirmed_at IS NOT NULL, false),
         'phone_verified', false
       ),
       'email',
       COALESCE(u.last_sign_in_at, u.email_confirmed_at, u.created_at, now()),
       COALESCE(u.created_at, now()),
       COALESCE(u.updated_at, now()),
       u.email
FROM auth.users u
WHERE u.email LIKE '%thalvior%dev%'
  AND NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id)
ON CONFLICT (id) DO NOTHING;

SELECT i.user_id, i.provider, i.email FROM auth.identities i
JOIN auth.users u ON u.id = i.user_id WHERE u.email LIKE '%thalvior%dev%';
""")
print(o)

# 5. 重启 + signin
print('\n6️⃣ 重启 auth + signin:')
run(c, 'docker restart supabase-auth 2>&1')
time.sleep(4)

for who, pwd in [('merchant@thalvior.dev','Merchant1234!'),('wms@thalvior.dev','Wms1234!'),('admin@thalvior.dev','Admin1234!')]:
    o, _ = run(c, f"""curl -s -X POST 'http://127.0.0.1:8000/auth/v1/token?grant_type=password' \
      -H 'apikey: eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw' \
      -H 'Content-Type: application/json' \
      -d '{{"email":"{who}","password":"{pwd}"}}'""")
    if 'access_token' in o:
        d = json.loads(o)
        print(f'   ✅ {who}: token_len={len(d["access_token"])}, refresh_len={len(d["refresh_token"])}')
    else:
        print(f'   ❌ {who}: {o[:200]}')

c.close()
