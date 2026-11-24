#!/usr/bin/env python3
"""真业务流：merchant → create inbound → warehouse complete → create outbound → warehouse weigh → charge calc"""
import socket, time, paramiko, json, requests

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

def supabase_get(table, token=None, params='select=*'):
    h = {'apikey': ANON}
    if token: h['Authorization'] = f'Bearer {token}'
    h['Prefer'] = 'return=representation'
    r = requests.get(f'{SUPABASE_URL}/{table}?{params}', headers=h, timeout=15)
    return r.status_code, r.json() if r.text else None

def supabase_post(table, data, token=None):
    h = {'apikey': ANON, 'Content-Type': 'application/json', 'Prefer': 'return=representation'}
    if token: h['Authorization'] = f'Bearer {token}'
    r = requests.post(f'{SUPABASE_URL}/{table}', headers=h, json=data, timeout=15)
    return r.status_code, r.json() if r.text else None

def supabase_rpc(rpc_name, params, token=None):
    h = {'apikey': ANON, 'Content-Type': 'application/json'}
    if token: h['Authorization'] = f'Bearer {token}'
    r = requests.post(f'{SUPABASE_URL}/rpc/{rpc_name}', headers=h, json=params, timeout=15)
    return r.status_code, r.json() if r.text else None

def signin(email, pwd):
    r = requests.post('https://thalvior.icu/auth/v1/token', 
        params={'grant_type': 'password'},
        json={'email': email, 'password': pwd},
        headers={'Content-Type': 'application/json'}, timeout=15)
    if r.status_code == 200:
        return r.json()
    return None

# ============================================================
print('='*60)
print('🎯 完整业务流 E2E 测试')
print('='*60)

# Step 0: 先查当前 DB 状态 + tenant_ids
print('\n📋 Step 0: DB 当前状态')
c = connect()
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
SELECT 'tlv 表数: ' || count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'tlv_%';
SELECT id, name, warehouse_id FROM tlv_merchants LIMIT 1;
SELECT id, name FROM tlv_warehouses LIMIT 1;
SELECT id, sku, merchant_id, warehouse_id FROM tlv_merchant_products LIMIT 3;
SELECT count(*) FROM tlv_billing_rules;
\"""")
print(o)

# 拿到 warehouse_id 和 merchant_id 和 product_id
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
SELECT m.id FROM tlv_merchants m LIMIT 1;
SELECT w.id FROM tlv_warehouses w LIMIT 1;
SELECT p.id FROM tlv_merchant_products p LIMIT 1;
SELECT p.sku FROM tlv_merchant_products p LIMIT 1;
\"""")
ids = o.strip().split('\n')
merchant_id, warehouse_id, product_id, sku = ids[0], ids[1], ids[2], ids[3]
print(f'\n  merchant_id={merchant_id}')
print(f'  warehouse_id={warehouse_id}')
print(f'  product_id={product_id}')
print(f'  sku={sku}')
c.close()

# Step 1: 三端登录
print('\n🔐 Step 1: 三端登录')
merchant_token = signin('merchant@thalvior.dev', 'Merchant1234!')
wms_token = signin('wms@thalvior.dev', 'Wms1234!')
admin_token = signin('admin@thalvior.dev', 'Admin1234!')

for name, tok in [('merchant', merchant_token), ('wms', wms_token), ('admin', admin_token)]:
    if tok:
        meta = tok.get('user', {}).get('user_metadata', {})
        print(f'  ✅ {name}: role={meta.get("portal_role")}, tenant_id={meta.get("tenant_id")}')
    else:
        print(f'  ❌ {name}: 登录失败')

merchant_jwt = merchant_token.get('access_token') if merchant_token else None
wms_jwt = wms_token.get('access_token') if wms_token else None

# Step 2: 商家创建入库单
print('\n📦 Step 2: [merchant] 创建入库单')
inbound_no = f'TESTIN{int(time.time())}'
status, result = supabase_post('tlv_inbound_orders', {
    'inbound_no': inbound_no,
    'merchant_id': merchant_id,
    'warehouse_id': warehouse_id,
    'status': 'pending',
    'note': 'E2E 测试入库',
}, token=merchant_jwt)
print(f'  POST inbound: {status}')
if isinstance(result, list) and result:
    inbound_id = result[0].get('id')
    print(f'  ✅ inbound_id={inbound_id}')
else:
    inbound_id = None
    print(f'  ⚠️ 返回: {result}')

# 再插入入库明细
if inbound_id and product_id:
    status, result = supabase_post('tlv_inbound_items', {
        'inbound_id': inbound_id,
        'product_id': product_id,
        'sku': sku,
        'qty': 100,
    }, token=merchant_jwt)
    print(f'  POST inbound_items: {status} — {result}')

# Step 3: 仓库查入库
print('\n📋 Step 3: [wms] 查入库收件箱')
status, result = supabase_get('tlv_inbound_orders', token=wms_jwt, 
    params=f'select=*&warehouse_id=eq.{warehouse_id}&status=eq.pending')
print(f'  GET inbound: {status}, count={len(result) if isinstance(result, list) else 0}')

# Step 4: 仓库完成入库 → 库存 +100
print('\n✅ Step 4: [wms] 完成入库')
c = connect()
o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
INSERT INTO tlv_merchant_inventory (merchant_id, warehouse_id, product_id, sku, qty, location)
VALUES ('{merchant_id}', '{warehouse_id}', '{product_id}', '{sku}', 100, 'A-01-01')
ON CONFLICT (merchant_id, warehouse_id, product_id, location) DO UPDATE SET qty = tlv_merchant_inventory.qty + 100;

UPDATE tlv_inbound_orders SET status='completed', completed_at=now() WHERE id='{inbound_id}';
\"""")
print(f'  DB update: {o[-200:]}')

# 验证库存
o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"SELECT sku, qty, location FROM tlv_merchant_inventory WHERE sku='{sku}';\"""")
print(f'  ✅ 库存: {o[-200:]}')
c.close()

# Step 5: 商家创建出库单
print('\n🚚 Step 5: [merchant] 创建出库单')
outbound_no = f'TESTSO{int(time.time())}'
status, result = supabase_post('tlv_outbound_orders', {
    'outbound_no': outbound_no,
    'merchant_id': merchant_id,
    'warehouse_id': warehouse_id,
    'status': 'pending',
    'shipping_address': json.dumps({"name": "Test", "phone": "123", "address": "Test St"}),
    'note': 'E2E 出库测试',
}, token=merchant_jwt)
print(f'  POST outbound: {status}')
outbound_id = None
if isinstance(result, list) and result:
    outbound_id = result[0].get('id')
    print(f'  ✅ outbound_id={outbound_id}')
else:
    print(f'  ⚠️ result: {result}')

# 插入出库明细
if outbound_id and product_id:
    status, result = supabase_post('tlv_outbound_items', {
        'outbound_id': outbound_id,
        'product_id': product_id,
        'sku': sku,
        'qty': 5,
    }, token=merchant_jwt)
    print(f'  POST outbound_items: {status}')

# Step 6: 仓库称重 + 计费
print('\n⚖️ Step 6: [wms] 称重 + calc charge RPC')
c = connect()
o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
UPDATE tlv_outbound_orders SET weight=0.5, status='weighed' WHERE id='{outbound_id}';
\"""")
print(f'  weigh update: {o[-100:]}')
c.close()

# 调 RPC calc_outbound_charge
status, result = supabase_rpc('calc_outbound_charge', {
    'p_outbound_id': outbound_id,
    'p_weight': 0.5,
}, token=wms_jwt)
print(f'  RPC calc_outbound_charge: {status} — {result}')

# 验证账单 + 钱包
c = connect()
o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT id, fee_type, amount FROM tlv_billings WHERE outbound_id='{outbound_id}';
SELECT balance FROM tlv_merchant_wallets WHERE merchant_id='{merchant_id}' LIMIT 1;
SELECT total_charge, status FROM tlv_outbound_orders WHERE id='{outbound_id}';
\"""")
print(f'  计费结果:\n{o}')
c.close()

# Step 7: 汇总
print('\n' + '='*60)
print('📊 完整业务流结果')
print('='*60)

c = connect()
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT '入库单: ' || count(*) FROM tlv_inbound_orders;
SELECT '入库明细: ' || count(*) FROM tlv_inbound_items;
SELECT '出库单: ' || count(*) FROM tlv_outbound_orders;
SELECT '出库明细: ' || count(*) FROM tlv_outbound_items;
SELECT '出库操作: ' || count(*) FROM tlv_outbound_operations;
SELECT '账单: ' || count(*) FROM tlv_billings;
SELECT '库存记录: ' || count(*) FROM tlv_merchant_inventory;
\"""")
print(o)
c.close()
