#!/usr/bin/env python3
"""直接 psql stdin 注入 DROP — 最稳"""
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

def run_stdin(c, cmd, sql, timeout=600):
    """向 cmd 管道注入 SQL"""
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    stdin.write(sql)
    stdin.channel.shutdown_write()
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

c = connect()

# 1. 先查旧表列表
o, _ = run_stdin(c, 
    "docker exec -i supabase-db psql -U supabase_admin -d postgres -t -A -c",
    """
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
    """)

tables = [t.strip() for t in o.strip().split('\n') if t.strip()]
print(f'📋 准备 DROP {len(tables)} 张旧表')

# 2. 分批 DROP（每批 30 张，避免单次 statement 太长）
batch_size = 30
total_dropped = 0

for i in range(0, len(tables), batch_size):
    batch = tables[i:i+batch_size]
    sql_lines = []
    for t in batch:
        # 用双引号避免关键字问题
        sql_lines.append(f'DROP TABLE IF EXISTS public."{t}" CASCADE;')
    sql = '\n'.join(sql_lines) + '\n'
    
    out, err = run_stdin(c, 
        "docker exec -i supabase-db psql -U supabase_admin -d postgres", 
        sql, timeout=120)
    
    # 统计 dropped 数量
    dropped_this_batch = len([l for l in out.split('\n') if 'DROP TABLE' in l])
    total_dropped += len(batch)
    print(f'  Batch {i//batch_size+1}: 尝试 DROP {len(batch)} 张 — OK ({dropped_this_batch})')
    if err and 'DROP' not in err:
        print(f'    warn: {err[:200]}')

print(f'\n✅ DROP 完毕，总共处理 {total_dropped} 张表')

# 3. 验证
print('\n🔴 验证:')
out, _ = run_stdin(c, 
    "docker exec -i supabase-db psql -U supabase_admin -d postgres -c",
    """
    SELECT 
      (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'tlv_%') as tlv_tables,
      (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'tlv_%'
        AND tablename NOT LIKE 'auth_%' AND tablename NOT LIKE 'storage_%'
        AND tablename NOT LIKE 'realtime_%' AND tablename NOT LIKE 'cron_%'
        AND tablename NOT LIKE 'graphql_%' AND tablename NOT LIKE 'pg_%') as remaining_public;
    """)
print(out)

# 4. 剩余表（如果还有）
out, _ = run_stdin(c, 
    "docker exec -i supabase-db psql -U supabase_admin -d postgres -c",
    """
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
    """)
print(f'\n剩余:\n{out}')

c.close()
