#!/usr/bin/env python3
"""直接用最新 outbound id 调 calc"""
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

# 直接拿最新 id + 调 calc
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"SELECT id FROM tlv_outbound_orders ORDER BY created_at DESC LIMIT 1;\"""")
oid = o.strip()
print(f'outbound_id = {oid}')

# 先清之前可能的账单
o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"DELETE FROM tlv_billings WHERE outbound_id = '{oid}'; DELETE FROM tlv_merchant_wallets WHERE ref_id = '{oid}';\"""")
print('清旧账单 + wallet')

# 直接调 calc！
o, e = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT public.calc_outbound_charge('{oid}'::uuid, 0.5) as fee_total;
\"""")
print(f'\nRPC 结果:\n{o}')
if e: print(f'err: {e[:300]}')

# 看账单
print('\n🏁 账单:')
o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT warehouse_id[:8], merchant_id[:8], outbound_id[:8], total, status, items FROM tlv_billings WHERE outbound_id = '{oid}';
\"""")
print(o)

# wallet
print('\n💳 wallet:')
o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT type, amount, balance_after, note FROM tlv_merchant_wallets WHERE ref_id = '{oid}';
\"""")
print(o)

# outbound
print('\n📦 outbound:')
o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT total_charge, packaging_fee, weight_fee, weight_kg FROM tlv_outbound_orders WHERE id = '{oid}';
\"""")
print(o)

# merchant balance
print('\n🏪 merchant:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"SELECT business_name, balance FROM tlv_merchants LIMIT 1;\"""")
print(o)

c.close()
