#!/usr/bin/env python3
"""分步跑 E2E psql，每步看结果"""
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

def step(name, sql):
    o, e = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"{sql}\" 2>&1""")
    status = '✅' if ('INSERT' in o or 'UPDATE' in o or 'SELECT' in o) else '❌'
    print(f'{status} {name}')
    print(f'   {o[-150:]}')
    if e:
        print(f'   err: {e[:150]}')

# ===== 每步分开跑 =====
step('清旧数据', """
DELETE FROM tlv_billings WHERE created_at > now() - interval '1 hour';
DELETE FROM tlv_merchant_wallets WHERE created_at > now() - interval '1 hour';
DELETE FROM tlv_outbound_items WHERE outbound_id IN (SELECT id FROM tlv_outbound_orders WHERE created_at > now() - interval '1 hour');
DELETE FROM tlv_outbound_orders WHERE created_at > now() - interval '1 hour';
DELETE FROM tlv_inbound_items WHERE inbound_id IN (SELECT id FROM tlv_inbound_orders WHERE created_at > now() - interval '1 hour');
DELETE FROM tlv_inbound_orders WHERE created_at > now() - interval '1 hour';
""")

step('merchant balance=1000', """
UPDATE tlv_merchants SET balance = GREATEST(balance, 1000) WHERE balance IS NULL OR balance < 1000;
SELECT count(*) FROM tlv_merchants WHERE balance >= 1000;
""")

step('📦 入库单', """
INSERT INTO tlv_inbound_orders (warehouse_id, merchant_id, inbound_no, source, status, sku_count, total_qty)
SELECT w.id, m.id, 'E2E-FINAL-IN', 'Manual', 'pending', 1, 100
FROM tlv_warehouses w CROSS JOIN tlv_merchants m LIMIT 1;
SELECT id[:8], inbound_no, status FROM tlv_inbound_orders ORDER BY created_at DESC LIMIT 1;
""")

step('📦 入库明细', """
INSERT INTO tlv_inbound_items (inbound_id, product_id, sku, expected_qty, actual_qty)
SELECT o.id, p.id, p.sku, 100, 100
FROM tlv_inbound_orders o JOIN tlv_merchant_products p ON p.merchant_id = o.merchant_id
WHERE o.inbound_no = 'E2E-FINAL-IN' LIMIT 1;
SELECT count(*) FROM tlv_inbound_items WHERE expected_qty = 100;
""")

step('✅ 完成入库 + 库存', """
UPDATE tlv_inbound_orders SET status='completed', completed_at=now() WHERE inbound_no='E2E-FINAL-IN';
INSERT INTO tlv_merchant_inventory (warehouse_id, merchant_id, sku, location, qty_on_hand, inbound_qty, product_id)
SELECT warehouse_id, merchant_id, 'SKU-001', 'A-01-01', 100, 100, (SELECT id FROM tlv_merchant_products LIMIT 1)
FROM tlv_inbound_orders WHERE inbound_no='E2E-FINAL-IN'
ON CONFLICT (warehouse_id, merchant_id, sku, location) 
DO UPDATE SET qty_on_hand = tlv_merchant_inventory.qty_on_hand + 100;
SELECT sku, qty_on_hand FROM tlv_merchant_inventory WHERE location='A-01-01';
""")

step('🚚 出库单', """
INSERT INTO tlv_outbound_orders (warehouse_id, merchant_id, order_no, source, status,
  receiver_name, receiver_phone, receiver_address, receiver_city, receiver_state, receiver_postal_code, receiver_country, is_cod)
SELECT warehouse_id, merchant_id, 'E2E-FINAL-OUT', 'Manual', 'weighed',
  'Test', '123456', '123 St', 'NYC', 'NY', '10001', 'US', false
FROM tlv_inbound_orders WHERE inbound_no='E2E-FINAL-IN';
SELECT id[:8], order_no, status FROM tlv_outbound_orders WHERE order_no='E2E-FINAL-OUT';
""")

step('🚚 出库明细', """
INSERT INTO tlv_outbound_items (outbound_id, product_id, sku, qty)
SELECT id, (SELECT id FROM tlv_merchant_products LIMIT 1), 'SKU-001', 5
FROM tlv_outbound_orders WHERE order_no='E2E-FINAL-OUT';
SELECT count(*) FROM tlv_outbound_items WHERE qty=5;
""")

step('⚖️ 称重 + calc RPC', """
UPDATE tlv_outbound_orders SET weight_kg=0.5, weighed_at=now() WHERE order_no='E2E-FINAL-OUT';
SELECT public.calc_outbound_charge(id, 0.5) as fee FROM tlv_outbound_orders WHERE order_no='E2E-FINAL-OUT';
""")

# 最终查看
print('\n' + '='*60)
print('🏁 最终数据')
print('='*60)

queries = [
    ("outbound 详情", "SELECT order_no, status, weight_kg, packaging_fee, weight_fee, total_charge FROM tlv_outbound_orders WHERE order_no='E2E-FINAL-OUT';"),
    ("billing", "SELECT total, status, items FROM tlv_billings ORDER BY created_at DESC LIMIT 1;"),
    ("wallet", "SELECT type, amount, balance_after, note FROM tlv_merchant_wallets ORDER BY created_at DESC LIMIT 3;"),
    ("merchant balance", "SELECT business_name, balance FROM tlv_merchants LIMIT 1;"),
    ("inventory", "SELECT sku, qty_on_hand FROM tlv_merchant_inventory LIMIT 3;"),
]
for name, q in queries:
    print(f'\n📋 {name}:')
    o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"{q}\" 2>&1""")
    print(f'  {o}')

c.close()
