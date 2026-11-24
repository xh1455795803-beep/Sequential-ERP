#!/usr/bin/env python3
"""直接 psql 调 RPC 看详细错误"""
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

def run(c, cmd, timeout=60):
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip(), stderr.read().decode('utf-8', errors='replace').strip()

c = connect()

# 拿最新 outbound id
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"SELECT id FROM tlv_outbound_orders ORDER BY created_at DESC LIMIT 1;\"""")
oid = o.strip()
print(f'outbound_id = {oid}')

# 直接 psql 调 RPC 看完整错误
print('\n直接 psql 调 calc_outbound_charge:')
o, e = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"SELECT public.calc_outbound_charge('{oid}'::uuid, 0.5);\" 2>&1""")
print(f'  stdout: {o}')
print(f'  stderr: {e}')

# 看 wallets 表
print('\ntlv_merchant_wallets 列:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='tlv_merchant_wallets' ORDER BY ordinal_position;
\"""")
print(o)

# 看 merchant 有没有 balance
print('\ntlv_merchants balance:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT id[:8], business_name, balance, frozen_balance FROM tlv_merchants;
\"""")
print(o)

c.close()
