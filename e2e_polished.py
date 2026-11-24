#!/usr/bin/env python3
"""极简 E2E — 不依赖中间状态查询"""
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

print('='*60)
print('🎯 极简 E2E — 完整业务流')
print('='*60)

# 1. 入库
print('\n📦 1. 入库单')
sql = """
WITH wh AS (SELECT id FROM tlv_warehouses LIMIT 1),
m  AS (SELECT id FROM tlv_merchants LIMIT 1),
inv AS (
  INSERT INTO tlv_inbound_orders (warehouse_id, merchant_id, inbound_no, source, status, sku_count, total_qty)
  SELECT wh.id, m.id, 'FINAL-E2E-IN', 'Manual', 'completed', 1, 100 FROM wh CROSS JOIN m
  RETURNING id, merchant_id, warehouse_id
),
itm AS (
  INSERT INTO tlv_inbound_items (inbound_id, product_id, sku, expected_qty, actual_qty)
  SELECT inv.id, p.id, p.sku, 100, 100 FROM inv JOIN tlv_merchant_products p ON p.merchant_id = inv.merchant_id
),
inv2 AS (
  INSERT INTO tlv_merchant_inventory (warehouse_id, merchant_id, sku, location, qty_on_hand, inbound_qty, product_id)
  SELECT inv.warehouse_id, inv.merchant_id, 'SKU-001', 'A-01-01', 100, 100, (SELECT id FROM tlv_merchant_products LIMIT 1)
  FROM inv
  ON CONFLICT (warehouse_id, merchant_id, sku, location) 
  DO UPDATE SET qty_on_hand = tlv_merchant_inventory.qty_on_hand + 100,
                inbound_qty = tlv_merchant_inventory.inbound_qty + 100
)
SELECT count(*) as inbound_done FROM inv;
"""
o, e = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"{sql}\" 2>&1""")
print(f'  {o}')
if e and 'ERROR' in e: print(f'  ❌ {e[:200]}')

# 2. 出库
print('\n🚚 2. 出库单')
sql = """
WITH inv AS (SELECT warehouse_id, merchant_id FROM tlv_inbound_orders WHERE inbound_no='FINAL-E2E-IN' LIMIT 1),
out AS (
  INSERT INTO tlv_outbound_orders (warehouse_id, merchant_id, order_no, source, status,
    receiver_name, receiver_phone, receiver_address, receiver_city, receiver_state, receiver_postal_code, receiver_country,
    is_cod, weight_kg, weighed_at)
  SELECT warehouse_id, merchant_id, 'FINAL-E2E-OUT', 'Manual', 'weighed',
    'Test Buyer', '123456', '123 Test St', 'New York', 'NY', '10001', 'US',
    false, 0.5, now()
  FROM inv
  RETURNING id
),
oitm AS (
  INSERT INTO tlv_outbound_items (outbound_id, product_id, sku, qty)
  SELECT out.id, (SELECT id FROM tlv_merchant_products LIMIT 1), 'SKU-001', 5 FROM out
)
SELECT count(*) as outbound_done FROM out;
"""
o, e = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"{sql}\" 2>&1""")
print(f'  {o}')
if e and 'ERROR' in e: print(f'  ❌ {e[:200]}')

# 3. 调 RPC
print('\n⚖️ 3. calc_outbound_charge RPC')
o, e = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT public.calc_outbound_charge(id, 0.5) as fee_total
FROM tlv_outbound_orders WHERE order_no='FINAL-E2E-OUT';
\"""")
print(f'  RPC result: {o}')
if e and 'ERROR' in e: print(f'  ❌ {e[:200]}')

# 4. 发货
print('\n📤 4. 发货 + 物流轨迹')
sql = """
UPDATE tlv_outbound_orders SET status='shipped', tracking_no='TRACK-FINAL-E2E', shipped_at=now()
WHERE order_no='FINAL-E2E-OUT';
INSERT INTO tlv_logistics_tracking (outbound_id, merchant_id, tracking_no, event_time, event_status, event_description)
SELECT id, merchant_id, 'TRACK-FINAL-E2E', now(), 'INFO', 'Shipped from warehouse'
FROM tlv_outbound_orders WHERE order_no='FINAL-E2E-OUT';
"""
o, e = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"{sql}\" 2>&1""")
print(f'  {o.strip() or "✅"}')

# ===== 最终汇总 =====
print('\n' + '='*60)
print('🏁 完整业务流最终结果')
print('='*60)

queries = [
    ("📦 inbound", "SELECT order_no, status FROM tlv_outbound_orders WHERE order_no='FINAL-E2E-OUT';"),
    ("🚚 outbound 详情", "SELECT order_no, status, weight_kg, packaging_fee, weight_fee, total_charge FROM tlv_outbound_orders WHERE order_no='FINAL-E2E-OUT';"),
    ("💰 billing", "SELECT total, status, items FROM tlv_billings WHERE outbound_id = (SELECT id FROM tlv_outbound_orders WHERE order_no='FINAL-E2E-OUT');"),
    ("💳 wallet", "SELECT type, amount, balance_after, note FROM tlv_merchant_wallets ORDER BY created_at DESC LIMIT 3;"),
    ("🏪 merchant balance", "SELECT business_name, balance FROM tlv_merchants LIMIT 1;"),
    ("📋 inventory", "SELECT sku, qty_on_hand FROM tlv_merchant_inventory;"),
    ("📦 logistics", "SELECT tracking_no, event_status, event_description FROM tlv_logistics_tracking ORDER BY event_time DESC LIMIT 3;"),
]
for name, q in queries:
    print(f'\n{name}:')
    o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"{q}\" 2>&1""")
    print(f'{o}')

c.close()
