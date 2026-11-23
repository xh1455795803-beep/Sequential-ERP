#!/usr/bin/env python3
"""快速状态检查"""
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
    return stdout.read().decode('utf-8', errors='replace').strip()

c = connect()

print('='*60)
print('🟡 Thalvior v7 状态快照')
print('='*60)

# 1. 表
out = run(c, "docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'tlv_%';\"")
print(f'\n📊 DB tlv_* 表数量: {out}')

# 2. RPC
out = run(c, "docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"SELECT proname FROM pg_proc WHERE proname LIKE '%outbound%' OR proname LIKE '%calc%';\"")
print(f'📊 RPC functions: {out or "(none)"}')

# 3. 种子数据量
for tbl in ['tlv_warehouses','tlv_merchants','tlv_merchant_products','tlv_billing_rules','auth.users']:
    out = run(c, f"docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"SELECT count(*) FROM {tbl};\"")
    print(f'  {tbl}: {out} rows')

# 4. HTTP
for path in ['/merchant/login','/wms/login','/admin/login']:
    out = run(c, f'curl -s -o /dev/null -w "%{{http_code}}" https://thalvior.icu{path}')
    print(f'\n🌐 {path} → HTTP {out}')

# 5. dist 文件
out = run(c, 'ls /var/www/wms/assets/')
print(f'\n📦 dist assets: {out}')

# 6. auth metadata
out = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c "SELECT email, raw_user_meta_data->>'portal_role' as role, raw_user_meta_data->>'tenant_id' as tid FROM auth.users;" """)
print(f'\n👤 auth.users:\n{out}')

c.close()
