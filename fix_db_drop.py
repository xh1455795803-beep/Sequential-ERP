#!/usr/bin/env python3
"""直接跑 DROP — 更稳"""
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

# 先备份旧表名到一个文件（万一需要恢复）
print('📋 先备份旧表名列表到本地...')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
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
with open('/workspace/old_tables_backup.txt', 'w') as f:
    f.write(o)
print(f'  ✅ 备份 {len(o.strip().split(chr(10)))} 张旧表到 /workspace/old_tables_backup.txt')

# 直接用 psql -c 逐个 DROP（最稳）
print('\n🔴 开始 DROP TABLE CASCADE (逐批)...')

# 方法：生成完整 SQL 文件，scp 上去，然后 psql -f
tables = [t.strip() for t in o.strip().split('\n') if t.strip()]

# 分批（100 个一批）
batch_size = 50
for i in range(0, len(tables), batch_size):
    batch = tables[i:i+batch_size]
    sql = '\n'.join([f'DROP TABLE IF EXISTS public.{t} CASCADE;' for t in batch])
    sql_file = f'/tmp/drop_batch_{i//batch_size}.sql'
    
    # 写文件到本地
    with open(sql_file, 'w') as f:
        f.write(sql)
    
    # 上传 + 执行
    sftp = c.open_sftp()
    remote_file = f'/tmp/drop_batch_{i//batch_size}.sql'
    sftp.put(sql_file, remote_file)
    sftp.close()
    
    print(f'  Batch {i//batch_size+1}: dropping {len(batch)} tables...')
    o2, e2 = run(c, f"docker exec -i supabase-db psql -U supabase_admin -d postgres -f {remote_file} 2>&1 | tail -5")
    print(f'    {o2[-100:]}')
    if e2:
        print(f'    err: {e2[:200]}')

# 同样清理旧 functions
print('\n🔴 清理旧 functions...')
o3, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
  SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_arguments(p.oid) || ')'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname NOT LIKE 'tlv_%'
    AND p.proname NOT IN ('calc_freight_quote', 'calc_outbound_charge', 'set_user_tenant_metadata')
  ORDER BY p.proname;
\"""")

funcs = [f.strip() for f in o3.strip().split('\n') if f.strip() and '|' not in f]
if funcs:
    for f in funcs:
        run(c, f"docker exec supabase-db psql -U supabase_admin -d postgres -c 'DROP FUNCTION IF EXISTS {f} CASCADE;' 2>/dev/null")
    print(f'  ✅ 清了 {len(funcs)} 个旧函数')

# 验证
print('\n🔴 验证清理结果:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  SELECT 'tlv 表: ' || count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'tlv_%'
  UNION ALL
  SELECT '其余 public 表: ' || count(*) FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'tlv_%'
    AND tablename NOT LIKE 'auth_%' AND tablename NOT LIKE 'storage_%'
    AND tablename NOT LIKE 'realtime_%' AND tablename NOT LIKE 'cron_%'
    AND tablename NOT LIKE 'graphql_%'
    AND tablename NOT LIKE 'pg_%';
\"""")
print(o)

# 看剩下的非 tlv 表是什么
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
print(f'\n剩余 public 表:\n{o}')

c.close()
