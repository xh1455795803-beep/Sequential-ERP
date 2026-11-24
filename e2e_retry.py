#!/usr/bin/env python3
"""快速查 inbound_items schema + 重跑剩余业务流"""
import socket, time, paramiko, requests, json, time as t

HOST, PORT, USER, PASS = '43.133.232.81', 22, 'ubuntu', 'yuan340364#'
SUPABASE_URL = 'https://thalvior.icu/rest/v1'
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
            t2 = paramiko.Transport(sock); t2.start_client(); t2.auth_password(USER, PASS)
            c = paramiko.SSHClient(); c._transport = t2; c._sftp_live = False
            return c
        except Exception:
            try: sock.close()
            except: pass
            time.sleep(2)
    raise RuntimeError('connect failed')

def run(c, cmd, timeout=60):
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip(), stderr.read().decode('utf-8', errors='replace').strip()

def signin(email, pwd):
    r = requests.post('https://thalvior.icu/auth/v1/token', params={'grant_type': 'password'},
        json={'email': email, 'password': pwd},
        headers={'Content-Type': 'application/json', 'apikey': ANON}, timeout=15)
    return r.json() if r.status_code == 200 else None

c = connect()

# 1. 查 inbound_items 和 outbound_items 实际列
print('📋 Step 1: 查 items 表实际列')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_schema='public' AND table_name IN ('tlv_inbound_items', 'tlv_outbound_items', 'tlv_billings')
ORDER BY table_name, ordinal_position;
\"""")
print(o)

# 2. 拿 IDs
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
SELECT m.id FROM tlv_merchants m LIMIT 1;
SELECT w.id FROM tlv_warehouses w LIMIT 1;
SELECT p.id FROM tlv_merchant_products p LIMIT 1;
SELECT p.sku FROM tlv_merchant_products p LIMIT 1;
SELECT id FROM tlv_inbound_orders ORDER BY created_at DESC LIMIT 1;
\"""")
ids = [x.strip() for x in o.strip().split('\n') if x.strip()]
merchant_id, warehouse_id, product_id, sku, inbound_id = ids[0], ids[1], ids[2], ids[3], ids[4]
print(f'\nmerchant={merchant_id[:8]} warehouse={warehouse_id[:8]} product={product_id[:8]} sku={sku} inbound={inbound_id[:8]}')

# 3. 登录
mt = signin('merchant@thalvior.dev', 'Merchant1234!')
wt = signin('wms@thalvior.dev', 'Wms1234!')
m_jwt, w_jwt = mt['access_token'], wt['access_token']
print('✅ signin OK')

def sb_post(table, data, token):
    h = {'apikey': ANON, 'Content-Type': 'application/json', 'Prefer': 'return=representation', 'Authorization': f'Bearer {token}'}
    return requests.post(f'{SUPABASE_URL}/{table}', headers=h, json=data, timeout=15)

def sb_rpc(rpc, params, token):
    h = {'apikey': ANON, 'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'}
    return requests.post(f'{SUPABASE_URL}/rpc/{rpc}', headers=h, json=params, timeout=15)

# 4. 用正确字段重试 inbound_items
print('\n📦 Step 2: 重试 inbound_items (用 product_uid 而不是 product_id?)')
# 先看之前 POST inbound 201 返回的 inbound_id 是什么
# 然后查 inbound_items 有没有 FOREIGN KEY 要求 product_id
r = sb_post('tlv_inbound_items', {
    'inbound_id': inbound_id,
    'product_id': product_id,
    'sku': sku,
    'qty': 100,
    'received_qty': 100,
}, m_jwt)
print(f'  inbound_items POST: {r.status_code} — {r.text[:200]}')

# 5. 完成入库 + 库存
print('\n✅ Step 3: 完成入库 + 库存')
o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
INSERT INTO tlv_merchant_inventory (merchant_id, warehouse_id, product_id, sku, qty, location)
VALUES ('{merchant_id}', '{warehouse_id}', '{product_id}', '{sku}', 100, 'A-01-01')
ON CONFLICT (merchant_id, warehouse_id, product_id, location) DO UPDATE SET qty = tlv_merchant_inventory.qty + 100;
UPDATE tlv_inbound_orders SET status='completed', completed_at=now() WHERE id='{inbound_id}';
\"""")
o2, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"SELECT sku, qty, location FROM tlv_merchant_inventory;\"""")
print(f'  ✅ {o2[-100:]}')

# 6. 商家创建出库单
print('\n🚚 Step 4: 创建出库单')
order_no = f'E2E{int(t.time())}'
r = sb_post('tlv_outbound_orders', {
    'warehouse_id': warehouse_id,
    'merchant_id': merchant_id,
    'order_no': order_no,
    'source': 'Manual',
    'status': 'pending',
    'receiver_name': 'Test Buyer',
    'receiver_phone': '123456',
    'receiver_country': 'US',
}, m_jwt)
print(f'  outbound POST: {r.status_code}')
if r.status_code == 201:
    outbound_id = r.json()[0]['id']
    print(f'  ✅ outbound_id={outbound_id[:8]}')
    
    # 插入出库明细
    r = sb_post('tlv_outbound_items', {
        'outbound_id': outbound_id,
        'product_id': product_id,
        'sku': sku,
        'qty': 5,
    }, m_jwt)
    print(f'  outbound_items POST: {r.status_code} — {r.text[:150]}')
    
    # 推进状态
    print('\n🏭 Step 5: picking → packing → weighed')
    o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
    UPDATE tlv_outbound_orders SET status='weighed', weight_kg=0.5, weighed_at=now() WHERE id='{outbound_id}';
    \"""")
    
    # 调 RPC
    print('\n⚖️ Step 6: calc_outbound_charge RPC')
    r = sb_rpc('calc_outbound_charge', {'p_outbound_id': outbound_id, 'p_weight_kg': 0.5}, w_jwt)
    print(f'  RPC: {r.status_code} — {r.text[:200]}')
    
    # 查账单
    o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
    SELECT fee_type, amount FROM tlv_billings WHERE outbound_id='{outbound_id}';
    SELECT total_charge, status FROM tlv_outbound_orders WHERE id='{outbound_id}';
    \"""")
    print(f'  计费结果:\n{o}')

# 7. 汇总
print('\n' + '='*60)
print('🏁 汇总')
print('='*60)
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT '入库单: ' || count(*) FROM tlv_inbound_orders UNION ALL
SELECT '出库单: ' || count(*) FROM tlv_outbound_orders UNION ALL
SELECT '账单: ' || count(*) FROM tlv_billings UNION ALL
SELECT '库存记录: ' || count(*) FROM tlv_merchant_inventory;
\"""")
print(o)

c.close()
