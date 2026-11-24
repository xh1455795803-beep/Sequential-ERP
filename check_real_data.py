#!/usr/bin/env python3
"""查真实数据 — RPC 返回 + 账单 + 库存"""
import socket, time, paramiko, requests

HOST, PORT, USER, PASS = '43.133.232.81', 22, 'ubuntu', 'yuan340364#'
ANON = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw'

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

# 1. 查所有表最新数据
print('📋 所有表最新数据:')
tables = ['tlv_inbound_orders', 'tlv_inbound_items', 'tlv_outbound_orders', 'tlv_outbound_items', 'tlv_billings', 'tlv_merchant_inventory', 'tlv_logistics_tracking']
for t in tables:
    o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"SELECT count(*) FROM {t};\"""")
    print(f'  {t}: {o.strip()}')

# 2. 查最新 outbound 的全部列（看 total_charge）
print('\n📦 最新 outbound 详情:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT id[:8] as id, order_no, status, weight_kg, total_charge, created_at 
FROM tlv_outbound_orders ORDER BY created_at DESC LIMIT 3;
\"""")
print(o)

# 3. 查最新 inbound
print('\n📦 最新 inbound:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT id[:8] as id, inbound_no, status, sku_count, total_qty, created_at 
FROM tlv_inbound_orders ORDER BY created_at DESC LIMIT 3;
\"""")
print(o)

# 4. 直接 DB 里跑 calc_outbound_charge 看它返回什么
print('\n⚖️ 直接在 DB 跑 calc_outbound_charge:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT id FROM tlv_outbound_orders ORDER BY created_at DESC LIMIT 1;
\"""")
oid = [x for x in o.split(chr(10)) if x.strip() and 'id' not in x.lower() and '-' in x][0].strip()
print(f'  outbound_id = {oid}')

o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT public.calc_outbound_charge('{oid}'::uuid, 0.5);
\"""")
print(f'  RPC 返回: {o}')

# 5. 跑完 RPC 再查 bills
print('\n💰 跑完 RPC 后的账单 + outbound total_charge:')
o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT * FROM tlv_billings WHERE outbound_id='{oid}' ORDER BY created_at DESC;
\"""")
print(f'  bills: {o[:1000]}')

o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT id[:8], total_charge, status, weight_kg FROM tlv_outbound_orders WHERE id='{oid}';
\"""")
print(f'  outbound total: {o}')

# 6. 查 inventory
print('\n📦 inventory:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"SELECT * FROM tlv_merchant_inventory;\"""")
print(f'  {o}')

c.close()
