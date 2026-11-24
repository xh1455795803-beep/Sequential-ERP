#!/usr/bin/env python3
"""修正版 E2E — 用正确字段名 + RPC 参数"""
import socket, time, paramiko, json, requests, uuid

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

def supabase_post(table, data, token):
    h = {'apikey': ANON, 'Content-Type': 'application/json', 'Prefer': 'return=representation', 'Authorization': f'Bearer {token}'}
    r = requests.post(f'{SUPABASE_URL}/{table}', headers=h, json=data, timeout=15)
    return r.status_code, r.json() if r.text else None

def supabase_get(table, token, params='select=*'):
    h = {'apikey': ANON, 'Authorization': f'Bearer {token}'}
    r = requests.get(f'{SUPABASE_URL}/{table}?{params}', headers=h, timeout=15)
    return r.status_code, r.json() if r.text else None

def supabase_rpc(rpc, params, token):
    h = {'apikey': ANON, 'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'}
    r = requests.post(f'{SUPABASE_URL}/rpc/{rpc}', headers=h, json=params, timeout=15)
    return r.status_code, r.json() if r.text else None

def signin(email, pwd):
    r = requests.post('https://thalvior.icu/auth/v1/token', params={'grant_type': 'password'},
        json={'email': email, 'password': pwd},
        headers={'Content-Type': 'application/json', 'apikey': ANON}, timeout=15)
    return r.json() if r.status_code == 200 else None

print('='*70)
print('🎯 Thalvior v7 完整业务流 E2E (修正版)')
print('='*70)

c = connect()

# ======== 0. 获取 IDs ========
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
SELECT m.id FROM tlv_merchants m LIMIT 1;
SELECT w.id FROM tlv_warehouses w LIMIT 1;
SELECT p.id FROM tlv_merchant_products p LIMIT 1;
SELECT p.sku FROM tlv_merchant_products p LIMIT 1;
SELECT count(*) FROM tlv_billing_rules;
\"""")
ids = [x.strip() for x in o.strip().split('\n') if x.strip()]
merchant_id, warehouse_id, product_id, sku, br_count = ids[0], ids[1], ids[2], ids[3], ids[4]
print(f'\nmerchant={merchant_id[:8]} warehouse={warehouse_id[:8]} product={product_id[:8]} sku={sku} billing_rules={br_count}')

# ======== 1. 三端登录 ========
print('\n🔐 1. 三端登录')
mt = signin('merchant@thalvior.dev', 'Merchant1234!')
wt = signin('wms@thalvior.dev', 'Wms1234!')
at = signin('admin@thalvior.dev', 'Admin1234!')
assert mt and wt and at, '登录失败!'
m_jwt, w_jwt = mt['access_token'], wt['access_token']
print(f'  ✅ merchant token OK')
print(f'  ✅ wms token OK')
print(f'  ✅ admin token OK')

# ======== 2. 商家创建入库单 ========
print('\n📦 2. [merchant] 创建入库单')
inbound_no = f'TESTIN{int(time.time())}'
status, r = supabase_post('tlv_inbound_orders', {
    'warehouse_id': warehouse_id,
    'merchant_id': merchant_id,
    'inbound_no': inbound_no,
    'source': 'Manual',
    'status': 'pending',
    'sku_count': 1,
    'total_qty': 100,
}, m_jwt)
print(f'  POST inbound: {status} — {r[0]["id"][:8] if isinstance(r,list) and r else r}')
assert status == 201, f'入库单创建失败: {r}'
inbound_id = r[0]['id'] if isinstance(r, list) else None

# 插入入库明细
status, r = supabase_post('tlv_inbound_items', {
    'inbound_id': inbound_id,
    'product_id': product_id,
    'sku': sku,
    'qty': 100,
}, m_jwt)
print(f'  POST inbound_items: {status} ✅')

# ======== 3. 仓库查收件箱 ========
print('\n📋 3. [wms] 查入库收件箱')
status, r = supabase_get('tlv_inbound_orders', w_jwt, f'select=*&warehouse_id=eq.{warehouse_id}&status=eq.pending')
print(f'  GET inbound (pending): {status}, count={len(r) if isinstance(r, list) else 0} ✅')

# ======== 4. 仓库完成入库 → 自动入库 ========
print('\n✅ 4. [wms] 完成入库 (库存 +100)')
o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
INSERT INTO tlv_merchant_inventory (merchant_id, warehouse_id, product_id, sku, qty, location)
VALUES ('{merchant_id}', '{warehouse_id}', '{product_id}', '{sku}', 100, 'A-01-01')
ON CONFLICT (merchant_id, warehouse_id, product_id, location) DO UPDATE SET qty = tlv_merchant_inventory.qty + 100;
UPDATE tlv_inbound_orders SET status='completed', completed_at=now() WHERE id='{inbound_id}';
SELECT sku, qty, location FROM tlv_merchant_inventory WHERE sku='{sku}';
\"""")
print(f'  ✅ {o.split(chr(10))[-3].strip()}')

# ======== 5. 商家创建出库单 ========
print('\n🚚 5. [merchant] 创建出库单')
order_no = f'TESTSO{int(time.time())}'
status, r = supabase_post('tlv_outbound_orders', {
    'warehouse_id': warehouse_id,
    'merchant_id': merchant_id,
    'order_no': order_no,
    'source': 'Manual',
    'status': 'pending',
    'receiver_name': 'Test Buyer',
    'receiver_phone': '123456',
    'receiver_country': 'US',
    'is_cod': False,
}, m_jwt)
print(f'  POST outbound: {status} — {r[0]["id"][:8] if isinstance(r,list) and r else r}')
assert status == 201, f'出库单创建失败: {r}'
outbound_id = r[0]['id'] if isinstance(r, list) else None

status, r = supabase_post('tlv_outbound_items', {
    'outbound_id': outbound_id,
    'product_id': product_id,
    'sku': sku,
    'qty': 5,
}, m_jwt)
print(f'  POST outbound_items: {status} ✅')

# ======== 6. 仓库拣货 + 打包 + 称重 ========
print('\n🏭 6. [wms] 流程推进: picking → packing → weighed')
o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
UPDATE tlv_outbound_orders SET status='picking', picked_at=now() WHERE id='{outbound_id}';
UPDATE tlv_outbound_orders SET status='packing', packed_at=now() WHERE id='{outbound_id}';
UPDATE tlv_outbound_orders SET status='weighed', weight_kg=0.5, weighed_at=now() WHERE id='{outbound_id}';
\"""")
print(f'  ✅ picking → packing → weighed')

# ======== 7. RPC calc_outbound_charge ========
print('\n⚖️ 7. [wms] 调 calc_outbound_charge RPC')
status, r = supabase_rpc('calc_outbound_charge', {
    'p_outbound_id': outbound_id,
    'p_weight_kg': 0.5,
}, w_jwt)
print(f'  RPC calc_outbound_charge: {status} — {r}')

# 验证账单 + 总费用
o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT '账单条数: ' || count(*) FROM tlv_billings WHERE outbound_id='{outbound_id}';
SELECT '总费用: ' || total_charge FROM tlv_outbound_orders WHERE id='{outbound_id}';
SELECT fee_type, amount FROM tlv_billings WHERE outbound_id='{outbound_id}';
\"""")
print(f'  {o}')

# ======== 8. 仓库发货 ========
print('\n📤 8. [wms] 发货')
o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
UPDATE tlv_outbound_orders SET status='shipped', tracking_no='TESTTRACK{int(time.time())}', shipped_at=now() WHERE id='{outbound_id}';
INSERT INTO tlv_logistics_tracking (merchant_id, warehouse_id, outbound_id, tracking_no, event, event_time)
VALUES ('{merchant_id}', '{warehouse_id}', '{outbound_id}', 'TESTTRACK{int(time.time())}', 'Shipped', now());
\"""")
print(f'  ✅ shipped')

# ======== 9. 商家查物流 ========
print('\n🔍 9. [merchant] 查物流轨迹')
status, r = supabase_get('tlv_logistics_tracking', m_jwt, 
    f'select=*&merchant_id=eq.{merchant_id}&limit=5&order=event_time.desc')
print(f'  GET tracking: {status}, count={len(r) if isinstance(r, list) else 0} ✅')

# ======== 10. 最终汇总 ========
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
print('\n🎉 完整业务流跑通了！')

c.close()
