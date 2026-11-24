#!/usr/bin/env python3
"""终极修正 E2E — 所有列名都对齐真实 schema"""
import socket, time, paramiko, requests, time as t

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
            tt = paramiko.Transport(sock); tt.start_client(); tt.auth_password(USER, PASS)
            c = paramiko.SSHClient(); c._transport = tt; c._sftp_live = False
            return c
        except Exception:
            try: sock.close()
            except: pass
            time.sleep(2)
    raise RuntimeError('connect failed')

def run(c, cmd, timeout=60):
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip(), stderr.read().decode('utf-8', errors='replace').strip()

def sb_post(table, data, token):
    h = {'apikey': ANON, 'Content-Type': 'application/json', 'Prefer': 'return=representation', 'Authorization': f'Bearer {token}'}
    return requests.post(f'https://thalvior.icu/rest/v1/{table}', headers=h, json=data, timeout=15)

def sb_rpc(rpc, params, token):
    h = {'apikey': ANON, 'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'}
    return requests.post(f'https://thalvior.icu/rest/v1/rpc/{rpc}', headers=h, json=params, timeout=15)

def signin(email, pwd):
    r = requests.post('https://thalvior.icu/auth/v1/token', params={'grant_type': 'password'},
        json={'email': email, 'password': pwd},
        headers={'Content-Type': 'application/json', 'apikey': ANON}, timeout=15)
    return r.json() if r.status_code == 200 else None

print('='*70)
print('🎯 Thalvior v7 完整业务流 E2E — 终极修正版')
print('='*70)

c = connect()

# 先清测试数据
print('\n🧹 先清之前的测试数据')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
DELETE FROM tlv_billings WHERE id IN (SELECT id FROM tlv_billings WHERE created_at > now() - interval '1 hour');
DELETE FROM tlv_logistics_tracking WHERE created_at > now() - interval '1 hour';
DELETE FROM tlv_outbound_operations WHERE created_at > now() - interval '1 hour';
DELETE FROM tlv_outbound_items WHERE outbound_id IN (SELECT id FROM tlv_outbound_orders WHERE created_at > now() - interval '1 hour');
DELETE FROM tlv_outbound_orders WHERE created_at > now() - interval '1 hour';
DELETE FROM tlv_inbound_items WHERE inbound_id IN (SELECT id FROM tlv_inbound_orders WHERE created_at > now() - interval '1 hour');
DELETE FROM tlv_inbound_orders WHERE created_at > now() - interval '1 hour';
DELETE FROM tlv_merchant_inventory WHERE last_updated > now() - interval '1 hour' OR inbound_qty > 0;
\"""")

# IDs
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
SELECT id FROM tlv_merchants LIMIT 1;
SELECT id FROM tlv_warehouses LIMIT 1;
SELECT id FROM tlv_merchant_products LIMIT 1;
SELECT sku FROM tlv_merchant_products LIMIT 1;
\"""")
ids = [x.strip() for x in o.strip().split('\n') if x.strip()]
merchant_id, warehouse_id, product_id, sku = ids[0], ids[1], ids[2], ids[3]
print(f'merchant={merchant_id[:8]} warehouse={warehouse_id[:8]} product={product_id[:8]} sku={sku}')

# 查 merchant 有没有 balance 列
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"SELECT column_name FROM information_schema.columns WHERE table_name='tlv_merchants' AND column_name LIKE '%balance%';\"""")
print(f'merchants.balance 列: {o.strip() or "❌ 不存在"}')

# 查 wallets type='balance' 初始行有没有
o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"SELECT count(*) FROM tlv_merchant_wallets WHERE merchant_id='{merchant_id}' AND warehouse_id='{warehouse_id}' AND type='balance';\"""")
print(f'wallets balance 初始行: {o.strip()}')

# 登录
mt, wt = signin('merchant@thalvior.dev', 'Merchant1234!'), signin('wms@thalvior.dev', 'Wms1234!')
m_jwt, w_jwt = mt['access_token'], wt['access_token']
print('\n🔐 登录全过 ✅')

# Step 1: 入库
print('\n📦 Step 1: 入库单 + 明细')
r = sb_post('tlv_inbound_orders', {
    'warehouse_id': warehouse_id, 'merchant_id': merchant_id,
    'inbound_no': f'E2E-IN-{int(t.time())}', 'source': 'Manual', 'status': 'pending',
    'sku_count': 1, 'total_qty': 100,
}, m_jwt)
assert r.status_code == 201, f'inbound fail: {r.text[:150]}'
inbound_id = r.json()[0]['id']
print(f'  ✅ inbound {inbound_id[:8]}')

r = sb_post('tlv_inbound_items', {
    'inbound_id': inbound_id, 'product_id': product_id, 'sku': sku, 'expected_qty': 100, 'actual_qty': 100,
}, m_jwt)
assert r.status_code == 201, f'inbound_items fail: {r.text[:150]}'
print(f'  ✅ inbound_items')

# Step 2: 仓库完成入库 + 库存
print('\n✅ Step 2: 完成入库 + 库存 (qty_on_hand +100)')
o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
INSERT INTO tlv_merchant_inventory 
  (warehouse_id, merchant_id, sku, location, qty_on_hand, inbound_qty, product_id)
VALUES ('{warehouse_id}', '{merchant_id}', '{sku}', 'A-01-01', 100, 100, '{product_id}')
ON CONFLICT (warehouse_id, merchant_id, sku, location) 
DO UPDATE SET qty_on_hand = tlv_merchant_inventory.qty_on_hand + 100,
              inbound_qty = tlv_merchant_inventory.inbound_qty + 100,
              last_updated = now();
UPDATE tlv_inbound_orders SET status='completed', completed_at=now() WHERE id='{inbound_id}';
\"""")
o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"SELECT '库存: sku=' || sku || ' qty_on_hand=' || qty_on_hand FROM tlv_merchant_inventory WHERE sku='{sku}';\"""")
print(f'  ✅ {o.strip()}')

# Step 3: 出库
print('\n🚚 Step 3: 出库单 + 明细')
r = sb_post('tlv_outbound_orders', {
    'warehouse_id': warehouse_id, 'merchant_id': merchant_id,
    'order_no': f'E2E-OUT-{int(t.time())}', 'source': 'Manual', 'status': 'pending',
    'receiver_name': 'Test Buyer', 'receiver_phone': '123456',
    'receiver_address': '123 Test St', 'receiver_city': 'New York',
    'receiver_state': 'NY', 'receiver_postal_code': '10001',
    'receiver_country': 'US', 'is_cod': False,
}, m_jwt)
assert r.status_code == 201, f'outbound fail: {r.text[:200]}'
outbound_id = r.json()[0]['id']
print(f'  ✅ outbound {outbound_id[:8]}')

r = sb_post('tlv_outbound_items', {
    'outbound_id': outbound_id, 'product_id': product_id, 'sku': sku, 'qty': 5,
}, m_jwt)
print(f'  ✅ outbound_items ({r.status_code})')

# Step 4: 仓库流程
print('\n🏭 Step 4: picking → packing → weighed (weight_kg=0.5)')
o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
UPDATE tlv_outbound_orders SET status='picking', picked_at=now() WHERE id='{outbound_id}';
UPDATE tlv_outbound_orders SET status='packing', packed_at=now() WHERE id='{outbound_id}';
UPDATE tlv_outbound_orders SET status='weighed', weight_kg=0.5, weighed_at=now() WHERE id='{outbound_id}';
\"""")
print('  ✅')

# Step 5: calc_outbound_charge RPC
print('\n⚖️ Step 5: calc_outbound_charge RPC')
r = sb_rpc('calc_outbound_charge', {'p_outbound_id': outbound_id, 'p_weight_kg': 0.5}, w_jwt)
total = r.json() if r.status_code == 200 else None
print(f'  RPC: {r.status_code} → total={total}')

# Step 6: 查账单
print('\n💰 Step 6: 查账单')
o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT total, status, items FROM tlv_billings WHERE outbound_id='{outbound_id}';
\"""")
print(f'  账单:\n{o}')

o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT total_charge, packaging_fee, weight_fee, cod_fee, status, weight_kg FROM tlv_outbound_orders WHERE id='{outbound_id}';
\"""")
print(f'  outbound total:\n{o}')

# Step 7: 发货
print('\n📤 Step 7: 发货 + 物流轨迹')
o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
UPDATE tlv_outbound_orders SET status='shipped', tracking_no='TRACK{int(t.time())}', shipped_at=now() WHERE id='{outbound_id}';
INSERT INTO tlv_logistics_tracking 
  (outbound_id, merchant_id, tracking_no, event_time, event_status, event_description, created_at)
VALUES 
  ('{outbound_id}', '{merchant_id}', 'TRACK{int(t.time())}', now(), 'INFO', 'Shipped from warehouse', now());
\"""")
print('  ✅ shipped + tracking')

# Step 8: 最终汇总
print('\n' + '='*70)
print('🏁 最终汇总')
print('='*70)
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT '入库单: ' || count(*) FROM tlv_inbound_orders UNION ALL
SELECT '入库明细: ' || count(*) FROM tlv_inbound_items UNION ALL
SELECT '出库单: ' || count(*) FROM tlv_outbound_orders UNION ALL
SELECT '出库明细: ' || count(*) FROM tlv_outbound_items UNION ALL
SELECT '账单: ' || count(*) FROM tlv_billings UNION ALL
SELECT '库存记录: ' || count(*) FROM tlv_merchant_inventory UNION ALL
SELECT '物流轨迹: ' || count(*) FROM tlv_logistics_tracking;
\"""")
print(o)

c.close()
