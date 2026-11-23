#!/usr/bin/env python3
"""把 auth.users 里所有 NULL varchar 列改成 ''"""
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

def run_stdin(c, cmd, data):
    stdin, stdout, stderr = c.exec_command(cmd, timeout=30)
    stdin.write(data.encode())
    stdin.channel.shutdown_write()
    return stdout.read().decode('utf-8', errors='replace').strip(), stderr.read().decode('utf-8', errors='replace').strip()

c = connect()

print('='*60)
print('🔧 auth.users NULL varchar → 空字符串')
print('='*60)

# 1. 先看哪些列可能是 NULL
print('\n1️⃣ 检查所有 auth.users 的 varchar/text 列:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns 
  WHERE table_schema='auth' AND table_name='users'
  AND data_type IN ('character varying','text','varchar')
  ORDER BY ordinal_position;
\"""")
print(o)

# 2. 批量 UPDATE 所有可能为 NULL 的 varchar/text 列
# Supabase auth 要求 NOT NULL 的 varchar 列（根据错误日志）
fix_sql = """
UPDATE auth.users SET
  confirmation_token        = COALESCE(confirmation_token, ''),
  email_change_token_new    = COALESCE(email_change_token_new, ''),
  email_change_token_current= COALESCE(email_change_token_current, ''),
  email_change              = COALESCE(email_change, ''),
  recovery_token            = COALESCE(recovery_token, ''),
  reauthentication_token   = COALESCE(reauthentication_token, ''),
  phone_change_token        = COALESCE(phone_change_token, ''),
  phone_change              = COALESCE(phone_change, ''),
  email_change_confirm_status = COALESCE(email_change_confirm_status, 0),
  is_super_admin            = COALESCE(is_super_admin, false),
  is_sso_user               = COALESCE(is_sso_user, false),
  is_anonymous              = COALESCE(is_anonymous, false);
"""
o, e = run_stdin(c, 'docker exec -i supabase-db psql -U supabase_admin -d postgres', fix_sql)
print(f'\n2️⃣ UPDATE auth.users:\n{o}\n{e}')

# 3. 验证一下 email_change 现在不是 NULL
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  SELECT email, 
         COALESCE(email_change, 'NULL-STILL!') as email_change,
         COALESCE(email_change_token_new, 'NULL-STILL!') as email_tok_new,
         COALESCE(confirmation_token, 'NULL-STILL!') as confirm_tok
  FROM auth.users;
\"""")
print(f'\n3️⃣ 验证修复:\n{o}')

# 4. 测试 signin!
print('\n\n4️⃣ 测试 signin (merchant):')
o, _ = run(c, """curl -s -X POST 'http://127.0.0.1:8000/auth/v1/token?grant_type=password' \
  -H 'apikey: eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw' \
  -H 'Content-Type: application/json' \
  -d '{"email":"merchant@thalvior.dev","password":"Merchant1234!"}'""")
if 'access_token' in o:
    idx = o.index('access_token')
    print('   ✅ 成功! token=' + o[idx:idx+30] + '...')
    import json
    token = json.loads(o)['access_token']
    refresh = json.loads(o)['refresh_token']
    print(f'   ✅ refresh_token 也有')
else:
    print(f'   ❌ 还是失败: {o[:300]}')

# 5. 也测 wms 和 admin
for who, pwd in [('wms','Wms1234!'),('admin','Admin1234!')]:
    email = f'{who}@thalvior.dev'
    o, _ = run(c, f"""curl -s -X POST 'http://127.0.0.1:8000/auth/v1/token?grant_type=password' \
      -H 'apikey: eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw' \
      -H 'Content-Type: application/json' \
      -d '{{"email":"{email}","password":"{pwd}"}}'""")
    ok = '✅' if 'access_token' in o else '❌'
    print(f'   {ok} {who}: {o[:80]}')

c.close()
