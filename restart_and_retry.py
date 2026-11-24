#!/usr/bin/env python3
"""重启 Supabase postgrest 刷新 schema cache + 验证"""
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

def run(c, cmd, timeout=60):
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip(), stderr.read().decode('utf-8', errors='replace').strip()

ANON = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw'
H = {'apikey': ANON}

c = connect()

# 1. 重启 postgrest (它管 schema cache)
print('🔄 1. 重启 postgrest')
o, _ = run(c, 'docker restart supabase-rest 2>&1; sleep 3; docker ps --filter name=supabase-rest --format "{{.Status}}"')
print(f'  {o}')

# 2. 也重启 envoy（它是反向代理）
print('🔄 2. 重启 envoy')
o, _ = run(c, 'docker restart supabase-envoy 2>&1; sleep 3; docker ps --filter name=supabase-envoy --format "{{.Status}}"')
print(f'  {o}')

# 3. 验证：POST inbound_items 用正确字段
print('\n📦 3. 验证 schema cache 是否刷新 — POST inbound_items')
# 先拿最新 inbound
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
SELECT id FROM tlv_inbound_orders ORDER BY created_at DESC LIMIT 1;
SELECT m.id FROM tlv_merchants m LIMIT 1;
SELECT w.id FROM tlv_warehouses w LIMIT 1;
SELECT p.id FROM tlv_merchant_products p LIMIT 1;
SELECT p.sku FROM tlv_merchant_products p LIMIT 1;
\"""")
ids = [x.strip() for x in o.strip().split('\n') if x.strip()]
inbound_id, merchant_id, warehouse_id, product_id, sku = ids[0], ids[1], ids[2], ids[3], ids[4]
print(f'  inbound={inbound_id[:8]} merchant={merchant_id[:8]} product={product_id[:8]} sku={sku}')

# signin 拿 token
r = requests.post('https://thalvior.icu/auth/v1/token', params={'grant_type': 'password'},
    json={'email': 'merchant@thalvior.dev', 'password': 'Merchant1234!'},
    headers={'Content-Type': 'application/json', 'apikey': ANON}, timeout=15)
token = r.json()['access_token']

# 用正确字段 expected_qty POST
h = {'apikey': ANON, 'Content-Type': 'application/json', 'Prefer': 'return=representation', 'Authorization': f'Bearer {token}'}
r = requests.post('https://thalvior.icu/rest/v1/tlv_inbound_items', headers=h, json={
    'inbound_id': inbound_id,
    'product_id': product_id,
    'sku': sku,
    'expected_qty': 100,
}, timeout=15)
print(f'  inbound_items(expected_qty=100): {r.status_code} — {r.text[:150]}')

# 也测出站单（先看之前为什么 400）
order_no = f'FINAL{int(time.time())}'
r2 = requests.post('https://thalvior.icu/rest/v1/tlv_outbound_orders', headers=h, json={
    'warehouse_id': warehouse_id,
    'merchant_id': merchant_id,
    'order_no': order_no,
    'source': 'Manual',
    'status': 'pending',
    'receiver_name': 'Test Buyer',
    'receiver_phone': '123456',
    'receiver_country': 'US',
}, timeout=15)
print(f'  outbound_orders: {r2.status_code} — {r2.text[:150]}')

# 4. 查 calc_outbound_charge RPC 实现
print('\n⚖️ 4. 查 calc_outbound_charge RPC 完整实现')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT pg_get_functiondef(p.oid) as def 
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace 
WHERE n.nspname='public' AND proname='calc_outbound_charge';
\"""")
print(o[:3000])

# 5. 查 billing_rules 实际列（RPC 要读它）
print('\n📋 5. tlv_billing_rules 实际列 + 数据')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT column_name, data_type FROM information_schema.columns WHERE table_name='tlv_billing_rules' ORDER BY ordinal_position;
SELECT * FROM tlv_billing_rules LIMIT 5;
\"""")
print(o[:2000])

c.close()
