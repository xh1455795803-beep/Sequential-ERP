#!/usr/bin/env python3
"""深查 auth 问题"""
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

# 1. 看 auth.users encrypted_password 到底存的什么
print('🔐 1. auth.users encrypted_password:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT email, left(encrypted_password, 30) as prefix, length(encrypted_password) as len,
       email_confirmed_at, banned_until, deleted_at, is_sso_user, is_anonymous
FROM auth.users WHERE email LIKE '%thalvior.dev%';
\"""")
print(o)

# 2. 看 Supabase auth 容器状态
print('\n🔐 2. 容器状态:')
o, _ = run(c, 'docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | head -20')
print(o)

# 3. 直接 curl auth/v1/health （如果有）
print('\n🔐 3. 测试 auth/v1/health endpoint:')
o, _ = run(c, 'curl -s http://localhost:8080/auth/v1/health 2>/dev/null || echo "no direct port"; curl -s https://thalvior.icu/auth/v1/health 2>/dev/null')
print(f'  {o}')

# 4. 试 admin API 直接用 service_role 调
print('\n🔐 4. 直接用 admin/users API 看用户列表:')
o, _ = run(c, """
ADMIN_KEY=$(sudo cat /opt/supabase/config/admin-jwt-secret 2>/dev/null || sudo docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c "select value from vault.decrypted_secrets where name='auth.admin_key';" 2>/dev/null || echo "none")
echo "admin key: ${ADMIN_KEY:0:10}..."

# 或者用 anon key 加 aal
ANON='eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw'

# 试 email provider 配置
curl -s 'https://thalvior.icu/auth/v1/config' 2>/dev/null | head -200
echo ""
""")
print(f'  {o[:500]}')

# 5. 查 auth.config 表
print('\n🔐 5. auth.config 表:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT config, value FROM auth.config ORDER BY config LIMIT 20;
\"""")
print(o)

# 6. 用 psql 直接跑密码验证
print('\n🔐 6. psql 直接验证密码:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT email, 
       encrypted_password = crypt('Merchant1234!', encrypted_password) as pw_match,
       encrypted_password = crypt('wrong', encrypted_password) as wrong_match
FROM auth.users WHERE email='merchant@thalvior.dev';
\"""")
print(o)

# 7. 如果上面 pw_match 是 false，那我们的 crypt() 调用方式错了
print('\n🔐 7. 生成新 hash 后立即验证:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
-- 生成新 hash
SELECT crypt('Merchant1234!', gen_salt('bf')) as new_hash,
       crypt('Merchant1234!', gen_salt('bf', 10)) as new_hash_10;
\"""")
print(o)

o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
-- 用新 hash 存进去然后立刻验证
UPDATE auth.users SET encrypted_password = crypt('Merchant1234!', gen_salt('bf')) WHERE email='merchant@thalvior.dev';
SELECT email, encrypted_password = crypt('Merchant1234!', encrypted_password) as match
FROM auth.users WHERE email='merchant@thalvior.dev';
\"""")
print(o)

c.close()
