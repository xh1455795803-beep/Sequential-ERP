#!/usr/bin/env python3
"""找那个拦截注册的 trigger + auth 500 stack trace"""
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
print('🔍 搜 "no test accounts allowed" + auth triggers')
print('='*60)

# 1. 全库搜这个错误信息
print('\n1️⃣ 全库搜 "no test accounts allowed":')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  SELECT n.nspname as schema, p.proname as func, prosrc 
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace 
  WHERE prosrc ILIKE '%no test accounts%' OR prosrc ILIKE '%test accounts allowed%';
\"""")
print(o[:1000])

# 2. 搜 "thalvior.icu" 或 "thalvior" 相关的 function/trigger
print('\n2️⃣ 搜所有含 "wms"/"thalvior" 的 function/trigger:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  SELECT n.nspname as schema, p.proname as func 
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace 
  WHERE prosrc ILIKE '%wms%' OR prosrc ILIKE '%thalvior%' OR prosrc ILIKE '%production%';
\"""")
print(o[:800])

# 3. 搜 auth schema 里的 trigger
print('\n3️⃣ auth.users 上的 triggers:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  SELECT t.tgname as trigger_name, p.proname as function_name, n.nspname as func_schema
  FROM pg_trigger t 
  JOIN pg_class c ON c.oid = t.tgrelid 
  JOIN pg_namespace cn ON cn.oid = c.relnamespace
  JOIN pg_proc p ON p.oid = t.tgfoid
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE NOT t.tgisinternal;
\"""")
print(o)

# 4. 搜 public schema 里所有 trigger
print('\n4️⃣ public schema 上所有 trigger:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  SELECT t.tgname, c.relname as table, p.proname as func 
  FROM pg_trigger t 
  JOIN pg_class c ON c.oid = t.tgrelid 
  JOIN pg_namespace cn ON cn.oid = c.relnamespace
  JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE NOT t.tgisinternal AND cn.nspname NOT IN ('pg_catalog', 'information_schema')
  ORDER BY cn.nspname;
\"""")
print(o)

# 5. 搜所有含 "Blocked" 或 "WMS policy" 的 function
print('\n5️⃣ 搜 "WMS policy" or "Blocked":')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  SELECT n.nspname as schema, p.proname as func 
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace 
  WHERE prosrc ILIKE '%Blocked%' OR prosrc ILIKE '%WMS policy%';
\"""")
print(o[:500])

# 6. auth signin 内部流程 — 检查 auth.instances 表
print('\n6️⃣ auth.instances 表:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"SELECT * FROM auth.instances;\"""")
print(o[:800])

# 7. GOTRUE_SITE_URL 和 AUTH_EXTERNAL_URL 环境变量
print('\n7️⃣ Supabase auth 环境变量 (关键):')
o, _ = run(c, 'docker exec supabase-auth env | grep -E "GOTRUE|SITE|EXTERNAL|API|JWT|DATABASE" 2>/dev/null')
print(o[:1000])

# 8. JWT secret 检查
print('\n8️⃣ JWT secret 一致性:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
  SELECT key FROM auth.jwks WHERE id='0';
\"""")
print(f'   auth.jwks key: {o[:100]}...')

# 9. 关键：看完整 signin 错误 — 直接在 DB 里调 auth 的内部函数
print('\n9️⃣ 直接用 auth.users 的 email+password 查询:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  SELECT id, email, crypt('Merchant1234!', encrypted_password) = encrypted_password as ok,
         aud, role, instance_id
  FROM auth.users WHERE email='merchant@thalvior.dev' AND deleted_at IS NULL;
\"""")
print(o)

# 10. 看看 auth 的 users 表有没有 email_change 字段约束
print('\n🔟 email_change / email_change_token 非空?')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  SELECT email, COALESCE(email_change, 'NOTHING') as email_change_len,
         COALESCE(email_change_token_new, 'EMPTY') as email_change_token,
         COALESCE(email_change_token_current, 'EMPTY') as email_change_token_cur
  FROM auth.users WHERE email LIKE '%thalvior%dev%';
\"""")
print(o)

c.close()
