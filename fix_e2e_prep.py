#!/usr/bin/env python3
"""修 auth + 查 schema + 修 RPC"""
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

def run(c, cmd, timeout=300):
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip(), stderr.read().decode('utf-8', errors='replace').strip()

c = connect()

# 1. 查 auth.users 还在不在
print('🔐 STEP 1: 检查 auth.users')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT count(*) as total FROM auth.users;
SELECT id, email, raw_user_meta_data->>'portal_role' as role, raw_user_meta_data->>'tenant_id' as tid, banned_until, deleted_at 
FROM auth.users WHERE email LIKE '%thalvior.dev%';
\"""")
print(o)

# 2. 测试 signin API
print('\n🔐 STEP 2: 直接测试 signin')
r = requests.post('https://thalvior.icu/auth/v1/token', 
    params={'grant_type': 'password'},
    json={'email': 'merchant@thalvior.dev', 'password': 'Merchant1234!'},
    headers={'Content-Type': 'application/json'}, timeout=15)
print(f'  status={r.status_code} body={r.text[:300]}')

# 3. 查 tlv_inbound_orders 实际列
print('\n📋 STEP 3: 查实际列')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT table_name, column_name, data_type 
FROM information_schema.columns 
WHERE table_schema='public' AND table_name IN ('tlv_inbound_orders', 'tlv_outbound_orders')
ORDER BY table_name, ordinal_position;
\"""")
print(o)

# 4. 查 RPC calc_outbound_charge 签名
print('\n📋 STEP 4: 查 RPC 签名')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT proname, pg_get_function_arguments(p.oid) as args 
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace 
WHERE n.nspname='public' AND proname LIKE 'calc%';
\"""")
print(o)

# 5. 刷新 Supabase schema cache
print('\n🔄 STEP 5: 刷新 PostgREST schema cache')
o, _ = run(c, """
# 重启 postgrest 容器刷新 schema cache
docker restart supabase-realtime 2>/dev/null || true
docker restart supabase-postgres 2>/dev/null || true
sleep 3
echo "done"
""", timeout=60)
print(f'  {o}')

c.close()
