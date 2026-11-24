#!/usr/bin/env python3
"""1. 清 178 张旧表 — 最严重的问题"""
import socket, time, paramiko

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

print('🔴 STEP 1: 先列出要删的旧表 (确认一下)')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  SELECT tablename FROM pg_tables 
  WHERE schemaname='public' 
    AND tablename NOT LIKE 'tlv_%' 
    AND tablename NOT LIKE 'auth_%' 
    AND tablename NOT LIKE 'storage_%' 
    AND tablename NOT LIKE 'realtime_%' 
    AND tablename NOT LIKE 'cron_%' 
    AND tablename NOT LIKE 'graphql_%' 
    AND tablename NOT LIKE 'pg_%'
  ORDER BY tablename;
\"""")
print(o)

# 生成 DROP 语句
print('\n🔴 STEP 2: 生成 DROP CASCADE 语句')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
  SELECT string_agg('DROP TABLE IF EXISTS public.' || tablename || ' CASCADE;', chr(10))
  FROM pg_tables 
  WHERE schemaname='public' 
    AND tablename NOT LIKE 'tlv_%' 
    AND tablename NOT LIKE 'auth_%' 
    AND tablename NOT LIKE 'storage_%' 
    AND tablename NOT LIKE 'realtime_%' 
    AND tablename NOT LIKE 'cron_%' 
    AND tablename NOT LIKE 'graphql_%' 
    AND tablename NOT LIKE 'pg_%'
  ORDER BY tablename;
\"""")

# 也找 public 里的旧 function 一起清
print('\n🔴 STEP 3: 找 public 里不是 Supabase 自带的 function')
o2, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
  SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_arguments(p.oid) || ')'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname NOT LIKE 'tlv_%'
    AND p.proname NOT IN ('calc_freight_quote', 'calc_outbound_charge', 'set_user_tenant_metadata')
  ORDER BY p.proname;
\"""")

print('Functions to DROP:')
print(o2[:500])

# 执行 DROP TABLE
print('\n🔴 STEP 4: 执行 DROP TABLE CASCADE')
sql = o.strip()
if sql:
    run(c, f"""docker exec -i supabase-db psql -U supabase_admin -d postgres <<'SQL'
{sql}
SQL""", timeout=300)

# 执行 DROP FUNCTION
if o2.strip():
    funcs = o2.strip().split('\n')
    func_sql = ''
    for f in funcs:
        func_sql += f'DROP FUNCTION IF EXISTS {f} CASCADE;\n'
    run(c, f"""docker exec -i supabase-db psql -U supabase_admin -d postgres <<'SQL'
{func_sql}
SQL""", timeout=300)

# 验证
print('\n🔴 STEP 5: 验证清理结果')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  SELECT 'tlv 表: ' || count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'tlv_%'
  UNION ALL
  SELECT '其余 public 表: ' || count(*) FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'tlv_%'
    AND tablename NOT LIKE 'auth_%' AND tablename NOT LIKE 'storage_%'
    AND tablename NOT LIKE 'realtime_%' AND tablename NOT LIKE 'cron_%'
    AND tablename NOT LIKE 'graphql_%';
\"""")
print(o)

c.close()
