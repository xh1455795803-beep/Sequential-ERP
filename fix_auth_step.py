#!/usr/bin/env python3
"""分两步修 auth.users NULL"""
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
print('🔧 auth.users NULL → 分两步修')
print('='*60)

# Step 1: timestamp NULL → now()
print('\nStep 1: 修 TIMESTAMP 列')
ts_fix = """
UPDATE auth.users SET
  updated_at              = COALESCE(updated_at, created_at, now()),
  last_sign_in_at         = COALESCE(last_sign_in_at, email_confirmed_at, created_at, now()),
  invited_at              = COALESCE(invited_at, created_at),
  confirmation_sent_at    = COALESCE(confirmation_sent_at, created_at),
  recovery_sent_at        = COALESCE(recovery_sent_at, created_at),
  email_change_sent_at    = COALESCE(email_change_sent_at, created_at),
  phone_confirmed_at      = COALESCE(phone_confirmed_at, '2099-12-31 23:59:59+00'::timestamptz),
  phone_change_sent_at    = COALESCE(phone_change_sent_at, created_at),
  confirmed_at            = COALESCE(confirmed_at, email_confirmed_at, created_at, now()),
  banned_until            = COALESCE(banned_until, '2099-12-31 23:59:59+00'::timestamptz),
  deleted_at              = COALESCE(deleted_at, '2099-12-31 23:59:59+00'::timestamptz),
  reauthentication_sent_at = COALESCE(reauthentication_sent_at, created_at);
"""
o, e = run_stdin(c, 'docker exec -i supabase-db psql -U supabase_admin -d postgres', ts_fix)
print(o[:300] or e[:300])

# Step 2: varchar NULL → ''
print('\nStep 2: 修 VARCHAR/TEXT 列')
vc_fix = """
UPDATE auth.users SET
  confirmation_token          = COALESCE(confirmation_token, ''),
  email_change_token_new      = COALESCE(email_change_token_new, ''),
  email_change_token_current  = COALESCE(email_change_token_current, ''),
  email_change                = COALESCE(email_change, ''),
  recovery_token              = COALESCE(recovery_token, ''),
  reauthentication_token     = COALESCE(reauthentication_token, ''),
  phone_change_token          = COALESCE(phone_change_token, ''),
  phone_change                = COALESCE(phone_change, ''),
  phone                       = COALESCE(phone, '');
"""
o, e = run_stdin(c, 'docker exec -i supabase-db psql -U supabase_admin -d postgres', vc_fix)
print(o[:300] or e[:300])

# Step 3: 验证
print('\nStep 3: 验证 NULL 清除')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  SELECT email, updated_at IS NULL as upd_null, last_sign_in_at IS NULL as sign_null,
         email_change IS NULL as eco_null, confirmation_token IS NULL as tok_null,
         deleted_at IS NULL as del_null
  FROM auth.users;
\"""")
print(o)

# Step 4: 补 auth.instances
print('\nStep 4: auth.instances')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"SELECT count(*) FROM auth.instances;\"""")
if o.strip() == '0':
    run_stdin(c, 'docker exec -i supabase-db psql -U supabase_admin -d postgres', """
INSERT INTO auth.instances (id, raw_base_config, created_at, updated_at)
VALUES (gen_random_uuid(), '{}'::jsonb, now(), now());
""")
    print('   ✅ 插入默认 instance')
else:
    print(f'   已有 {o.strip()} 行')

# Step 5: 补 auth.identities（dev 账号）
print('\nStep 5: auth.identities')
run_stdin(c, 'docker exec -i supabase-db psql -U supabase_admin -d postgres', """
INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at, email)
SELECT id, id, 'email', 
       jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true, 'phone_verified', false),
       'email', now(), now(), now(), email
FROM auth.users u
WHERE u.email LIKE '%thalvior%dev%'
  AND NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id)
ON CONFLICT (id) DO NOTHING;
""")
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"SELECT user_id, provider FROM auth.identities;\"""")
print(o[:300])

# Step 6: 重启 + signin
print('\nStep 6: 重启 auth + signin')
run(c, 'docker restart supabase-auth 2>&1')
time.sleep(4)

for who, pwd in [('merchant@thalvior.dev','Merchant1234!'),('wms@thalvior.dev','Wms1234!'),('admin@thalvior.dev','Admin1234!')]:
    o, _ = run(c, f"""curl -s -X POST 'http://127.0.0.1:8000/auth/v1/token?grant_type=password' \
      -H 'apikey: eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw' \
      -H 'Content-Type: application/json' \
      -d '{{"email":"{who}","password":"{pwd}"}}'""")
    if 'access_token' in o:
        d = json.loads(o)
        print(f'   ✅ {who}: {len(d["access_token"])} chars')
    else:
        print(f'   ❌ {who}: {o[:150]}')

c.close()
