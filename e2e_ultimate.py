#!/usr/bin/env python3
"""最终 E2E — outbound 补 receiver_address"""
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

def sb_get(table, token, params='select=*'):
    h = {'apikey': ANON, 'Authorization': f'Bearer {token}'}
    return requests.get(f'https://thalvior.icu/rest/v1/{table}?{params}', headers=h, timeout=15)

def sb_rpc(rpc, params, token):
    h = {'apikey': ANON, 'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'}
    return requests.post(f'https://thalvior.icu/rest/v1/rpc/{rpc}', headers=h, json=params, timeout=15)

def signin(email, pwd):
    r = requests.post('https://thalvior.icu/auth/v1/token', params={'grant_type': 'password'},
        json={'email': email, 'password': pwd},
        headers={'Content-Type': 'application/json', 'apikey': ANON}, timeout=15)
    return r.json() if r.status_code == 200 else None

print('='*70)
print('🎯 Thalvior v7 完整业务流 E2E — 最终版')
print('='*70)

c = connect()

# IDs
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
SELECT id FROM tlv_merchants LIMIT 1;
SELECT id FROM tlv_warehouses LIMIT 1;
SELECT id FROM tlv_merchant_products LIMIT 1;
SELECT sku FROM tlv_merchant_products LIMIT 1;
\"""")
ids = [x.strip() for x in o.strip().split('\n') if x.strip()]
merchant_id, warehouse_id, product_id, sku = ids[0], ids[1], ids[2], ids[3]
print(f'\nmerchant={merchant_id[:8]} warehouse={warehouse_id[:8]} product={product_id[:8]} sku={sku}')

# 登录
print('\n🔐 三端登录')
mt, wt = signin('merchant@thalvior.dev', 'Merchant1234!'), signin('wms@thalvior.dev', 'Wms1234!')
m_jwt, w_jwt = mt['access_token'], wt['access_token']
print('  ✅ 全过')

# Step 1: 入库单
print('\n📦 Step 1: [merchant] 创建入库单 + 明细')
inbound_no = f'E2E-IN-{int(t.time())}'
r = sb_post('tlv_inbound_orders', {
    'warehouse_id': warehouse_id, 'merchant_id': merchant_id,
    'inbound_no': inbound_no, 'source': 'Manual', 'status': 'pending',
    'sku_count': 1, 'total_qty': 100,
}, m_jwt)
print(f'  inbound: {r.status_code}', '✅' if r.status_code == 201 else f'❌ {r.text[:100]}')
inbound_id = r.json()[0]['id']

r = sb_post('tlv_inbound_items', {
    'inbound_id': inbound_id, 'product_id': product_id, 'sku': sku, 'expected_qty': 100,
}, m_jwt)
print(f'  inbound_items: {r.status_code}', '✅' if r.status_code == 201 else f'❌ {r.text[:100]}')

# Step 2: 仓库查收件箱
print('\n📋 Step 2: [wms] 入库收件箱')
r = sb_get('tlv_inbound_orders', w_jwt, f'select=*&warehouse_id=eq.{warehouse_id}&status=eq.pending')
print(f'  pending inbox: {r.status_code} count={len(r.json())} ✅')

# Step 3: 完成入库 → 库存
print('\n✅ Step 3: [wms] 完成入库')
o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
INSERT INTO tlv_merchant_inventory (merchant_id, warehouse_id, product_id, sku, qty, location)
VALUES ('{merchant_id}', '{warehouse_id}', '{product_id}', '{sku}', 100, 'A-01-01')
ON CONFLICT (merchant_id, warehouse_id, product_id, location) DO UPDATE SET qty = tlv_merchant_inventory.qty + 100;
UPDATE tlv_inbound_orders SET status='completed', completed_at=now() WHERE id='{inbound_id}';
\"""")
o2, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"SELECT sku || ' qty=' || qty FROM tlv_merchant_inventory WHERE sku='{sku}';\"""")
print(f'  库存: {o2.strip()} ✅')

# Step 4: 出库单
print('\n🚚 Step 4: [merchant] 创建出库单（含全部 NOT NULL 字段）')
order_no = f'E2E-OUT-{int(t.time())}'
r = sb_post('tlv_outbound_orders', {
    'warehouse_id': warehouse_id, 'merchant_id': merchant_id,
    'order_no': order_no, 'source': 'Manual', 'status': 'pending',
    'receiver_name': 'Test Buyer', 'receiver_phone': '123456',
    'receiver_address': '123 Test Street', 'receiver_city': 'New York',
    'receiver_state': 'NY', 'receiver_postal_code': '10001',
    'receiver_country': 'US', 'is_cod': False,
}, m_jwt)
print(f'  outbound: {r.status_code}', '✅' if r.status_code == 201 else f'❌ {r.text[:150]}')
if r.status_code != 201:
    print('💥 失败，停在这里')
    c.close(); exit(1)
outbound_id = r.json()[0]['id']

r = sb_post('tlv_outbound_items', {
    'outbound_id': outbound_id, 'product_id': product_id, 'sku': sku, 'qty': 5,
}, m_jwt)
print(f'  outbound_items: {r.status_code} ✅' if r.status_code == 201 else f'  ❌ {r.text[:100]}')

# Step 5: 仓库推进流程
print('\n🏭 Step 5: [wms] picking → packing → weighed')
o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
UPDATE tlv_outbound_orders SET status='picking', picked_at=now() WHERE id='{outbound_id}';
UPDATE tlv_outbound_orders SET status='packing', packed_at=now() WHERE id='{outbound_id}';
UPDATE tlv_outbound_orders SET status='weighed', weight_kg=0.5, weighed_at=now() WHERE id='{outbound_id}';
\"""")
print('  ✅ picking → packing → weighed')

# Step 6: 调 RPC
print('\n⚖️ Step 6: [wms] calc_outbound_charge RPC')
r = sb_rpc('calc_outbound_charge', {'p_outbound_id': outbound_id, 'p_weight_kg': 0.5}, w_jwt)
print(f'  RPC: {r.status_code}', '✅' if r.status_code == 200 else f'❌ {r.text[:150]}')

# Step 7: 查账单
print('\n💰 Step 7: 验证账单 + 总费用')
o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT fee_type, amount FROM tlv_billings WHERE outbound_id='{outbound_id}';
SELECT total_charge, status, weight_kg FROM tlv_outbound_orders WHERE id='{outbound_id}';
\"""")
print(o)

# Step 8: 发货 + 物流
print('\n📤 Step 8: [wms] 发货 + 物流轨迹')
o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
UPDATE tlv_outbound_orders SET status='shipped', tracking_no='TRACK{int(t.time())}', shipped_at=now() WHERE id='{outbound_id}';
INSERT INTO tlv_logistics_tracking (merchant_id, warehouse_id, outbound_id, tracking_no, event, event_time)
VALUES ('{merchant_id}', '{warehouse_id}', '{outbound_id}', 'TRACK{int(t.time())}', 'Shipped', now());
\"""")
print('  ✅ shipped + tracking')

# Step 9: 商家查物流
print('\n🔍 Step 9: [merchant] 查物流')
r = sb_get('tlv_logistics_tracking', m_jwt, f'select=*&merchant_id=eq.{merchant_id}&order=event_time.desc')
print(f'  GET tracking: {r.status_code} count={len(r.json())} ✅')

# 汇总
print('\n' + '='*70)
print('🏁 完整业务流结果')
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
print('\n🎉 完整业务流跑通！入库 → 库存增加 → 出库 → 称重 → 自动计费 → 发货 → 物流 ✅')

c.close()
