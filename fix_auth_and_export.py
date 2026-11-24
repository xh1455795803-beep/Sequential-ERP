#!/usr/bin/env python3
"""1. 重置 auth 密码  2. 完整比对前端字段 vs DB schema"""
import socket, time, paramiko, hashlib, requests, json, subprocess, os

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

def run(c, cmd, timeout=300):
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip(), stderr.read().decode('utf-8', errors='replace').strip()

c = connect()

# ============================================================
# Step 1: 重置三个账号密码（用 Supabase Auth API 的方式）
# ============================================================
print('🔐 Step 1: 重置密码（用 auth.admin.update_user + bcrypt）')

# 先确认 pgcrypto 存在
o, _ = run(c, "docker exec supabase-db psql -U supabase_admin -d postgres -c \"SELECT extname FROM pg_extension WHERE extname='pgcrypto';\"")
print(f'  pgcrypto: {o}')

# 用 crypt() 生成新密码 hash（和 Supabase Auth 一致的 bf 算法）
NEW_PW = 'Merchant1234!'
o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
SELECT crypt('{NEW_PW}', gen_salt('bf'));
\"""")
bcrypt_hash = o.strip()
print(f'  bcrypt hash (前20): {bcrypt_hash[:20]}...')

# 重置三个账号密码
for email, new_pw in [
    ('merchant@thalvior.dev', 'Merchant1234!'),
    ('wms@thalvior.dev', 'Wms1234!'),
    ('admin@thalvior.dev', 'Admin1234!'),
]:
    o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
    UPDATE auth.users 
    SET encrypted_password = crypt('{new_pw}', gen_salt('bf'))
    WHERE email = '{email}';
    \"""")
    print(f'  重置 {email}: {o[-50:]}')

# 验证 signin
print('\n🔐 Step 1b: 验证 signin')
for email, new_pw in [
    ('merchant@thalvior.dev', 'Merchant1234!'),
    ('wms@thalvior.dev', 'Wms1234!'),
    ('admin@thalvior.dev', 'Admin1234!'),
]:
    r = requests.post('https://thalvior.icu/auth/v1/token', 
        params={'grant_type': 'password'},
        json={'email': email, 'password': new_pw},
        headers={'Content-Type': 'application/json'}, timeout=15)
    ok = r.status_code == 200 and 'access_token' in r.text
    print(f'  {email}: {r.status_code} {"✅" if ok else f"❌ {r.text[:100]}"}')

# ============================================================
# Step 2: 导出所有 tlv_* 表的列定义，保存成本地文件
# ============================================================
print('\n📋 Step 2: 导出 DB schema 到本地')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -F '|' -c \"
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_schema='public' AND table_name LIKE 'tlv_%'
ORDER BY table_name, ordinal_position;
\"""")
with open('/workspace/db_schema_tlv.txt', 'w') as f:
    f.write(o)
print(f'  ✅ /workspace/db_schema_tlv.txt — {len(o.strip().split(chr(10)))} 列')

# ============================================================
# Step 3: 导出 RPC 定义
# ============================================================
print('\n📋 Step 3: 导出 RPC')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT proname, pg_get_functiondef(p.oid) 
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace 
WHERE n.nspname='public' AND proname LIKE 'calc%' OR proname LIKE 'outbound%';
\"""")
with open('/workspace/db_rpc.txt', 'w') as f:
    f.write(o)
print(f'  ✅ /workspace/db_rpc.txt')

c.close()
print('\n✅ 准备工作完成。现在可以开始对比前端代码 vs DB schema 修字段。')
