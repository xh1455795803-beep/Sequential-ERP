#!/usr/bin/env python3
"""最终：正确 DROP 178 张旧表 — 用 subprocess 本地拼接 SCP + docker exec -i"""
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

# Step 1: 先查有哪些旧表（用 -t -A 干净格式）
print('📋 查询旧表...')
o, _ = run(c, "docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'tlv_%' AND tablename NOT LIKE 'auth_%' AND tablename NOT LIKE 'storage_%' AND tablename NOT LIKE 'realtime_%' AND tablename NOT LIKE 'cron_%' AND tablename NOT LIKE 'graphql_%' AND tablename NOT LIKE 'pg_%' ORDER BY tablename;\"")
tables = [t.strip() for t in o.strip().split('\n') if t.strip()]
print(f'  找到 {len(tables)} 张旧表')

# Step 2: 生成 DROP SQL 文件（本地）
sql_path = '/tmp/drop_all_tables.sql'
with open(sql_path, 'w') as f:
    for t in tables:
        f.write(f'DROP TABLE IF EXISTS public."{t}" CASCADE;\n')
print(f'  SQL 文件 {sql_path} ({len(tables)} 条 DROP)')

# Step 3: 上传到服务器
print('📤 上传...')
sftp = c.open_sftp()
sftp.put(sql_path, '/tmp/drop_all_tables.sql')
sftp.close()
print('  上传 OK')

# Step 4: 复制到 Docker 容器内然后执行
# docker cp 最稳
print('🔴 docker cp + psql 执行...')
o, e = run(c, f"""
docker cp /tmp/drop_all_tables.sql supabase-db:/tmp/drop_all_tables.sql
docker exec supabase-db psql -U supabase_admin -d postgres -f /tmp/drop_all_tables.sql 2>&1 | grep -E 'DROP TABLE|ERROR|NOTICE' | head -20
echo "--- done ---"
""", timeout=300)
print(f'  执行结果:\n{o[-500:]}')
if e:
    print(f'  stderr: {e[:300]}')

# Step 5: 验证
print('\n🔴 验证:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  SELECT 
    'tlv 表: ' || count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'tlv_%'
  UNION ALL
  SELECT 
    '其余 public 表: ' || count(*) FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'tlv_%'
    AND tablename NOT LIKE 'auth_%' AND tablename NOT LIKE 'storage_%'
    AND tablename NOT LIKE 'realtime_%' AND tablename NOT LIKE 'cron_%'
    AND tablename NOT LIKE 'graphql_%' AND tablename NOT LIKE 'pg_%';
\"""")
print(o)

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
print(f'\n剩余: {o.strip() or "(全部清干净 ✅)"}')

c.close()
