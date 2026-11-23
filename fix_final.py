#!/usr/bin/env python3
"""最后一步: banned_until → NULL, 补 identities"""
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
print('🔧 最后修复 + signin 测试')
print('='*60)

# 1. banned_until → NULL (不是 2099!)
print('\n1️⃣ banned_until → NULL')
o, e = run_stdin(c, 'docker exec -i supabase-db psql -U supabase_admin -d postgres', """
UPDATE auth.users SET 
  banned_until = NULL,
  deleted_at = NULL
WHERE email LIKE '%thalvior%dev%';
""")
print(o or e)

# 2. 直接看 identities 结构和约束
print('\n2️⃣ auth.identities 结构:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  SELECT column_name, data_type, is_nullable FROM information_schema.columns 
  WHERE table_schema='auth' AND table_name='identities' ORDER BY ordinal_position;
\"""")
print(o)

# 2b. 直接 INSERT (不带 ON CONFLICT 先看报错)
print('\n2b. 直接 INSERT identity (dev merchant):')
o, e = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at, email)
SELECT id, id, 'email', 
       jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
       'email', now(), now(), now(), email
FROM auth.users WHERE email='merchant@thalvior.dev';
\"""")
print(o or e)

# 3. signin 测试
print('\n3️⃣ signin 测试 (不需要 identities 也行 — auth users 里有 email 就能 signin):')
for who, pwd in [('merchant@thalvior.dev','Merchant1234!'),('wms@thalvior.dev','Wms1234!'),('admin@thalvior.dev','Admin1234!')]:
    o, _ = run(c, f"""curl -s -X POST 'http://127.0.0.1:8000/auth/v1/token?grant_type=password' \
      -H 'apikey: eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw' \
      -H 'Content-Type: application/json' \
      -d '{{"email":"{who}","password":"{pwd}"}}'""")
    if 'access_token' in o:
        d = json.loads(o)
        print(f'   ✅ {who}: token={d["access_token"][:20]}...')
    else:
        print(f'   ❌ {who}: {o[:200]}')

c.close()
