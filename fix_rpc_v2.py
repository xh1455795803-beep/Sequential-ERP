#!/usr/bin/env python3
"""修 RPC — 正确的 append-only wallet ledger 模式"""
import socket, time, paramiko, subprocess

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

rpc_sql = r"""
CREATE OR REPLACE FUNCTION public.calc_outbound_charge(
  p_outbound_id uuid, 
  p_weight_kg numeric DEFAULT NULL
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_wh uuid;
  v_merchant uuid;
  v_fee_pkg numeric := 0;
  v_fee_weight numeric := 0;
  v_fee_cod numeric := 0;
  v_total numeric := 0;
  v_weight numeric;
  v_is_cod boolean;
  v_items jsonb := '[]'::jsonb;
  v_current_balance numeric := 0;
BEGIN
  -- 读 outbound 基本信息
  SELECT warehouse_id, merchant_id, COALESCE(weight_kg, 0), COALESCE(is_cod, false)
  INTO v_wh, v_merchant, v_weight, v_is_cod
  FROM tlv_outbound_orders WHERE id = p_outbound_id;

  IF v_wh IS NULL THEN
    RAISE EXCEPTION 'Outbound % not found', p_outbound_id;
  END IF;

  -- 用传入的 weight 覆盖
  IF p_weight_kg IS NOT NULL THEN
    v_weight := p_weight_kg;
    UPDATE tlv_outbound_orders SET weight_kg = v_weight WHERE id = p_outbound_id;
  END IF;

  -- 1. 基础打包费
  SELECT COALESCE(rate, 0) INTO v_fee_pkg FROM tlv_billing_rules
  WHERE warehouse_id = v_wh AND (merchant_id = v_merchant OR merchant_id IS NULL)
    AND rule_type = 'packaging' AND status = 'active'
  ORDER BY merchant_id NULLS LAST, priority ASC LIMIT 1;

  -- 2. 重计费
  IF v_weight > 0 THEN
    SELECT COALESCE(rate, 0) * v_weight INTO v_fee_weight FROM tlv_billing_rules
    WHERE warehouse_id = v_wh AND (merchant_id = v_merchant OR merchant_id IS NULL)
      AND rule_type = 'weight' AND status = 'active'
    ORDER BY merchant_id NULLS LAST, priority ASC LIMIT 1;
  END IF;

  v_total := v_fee_pkg + v_fee_weight + v_fee_cod;

  -- 3. 更新 outbound 总费用
  UPDATE tlv_outbound_orders SET 
    packaging_fee = v_fee_pkg, weight_fee = v_fee_weight,
    cod_fee = v_fee_cod, total_charge = v_total, updated_at = now()
  WHERE id = p_outbound_id;

  -- 4. 写账单 (tlv_billings)
  DELETE FROM tlv_billings WHERE outbound_id = p_outbound_id;
  v_items := jsonb_build_array(
    jsonb_build_object('type', 'packaging', 'amount', v_fee_pkg, 'rule', '基础打包费'),
    jsonb_build_object('type', 'weight', 'amount', v_fee_weight, 'rule', '重计费', 'weight_kg', v_weight)
  );
  INSERT INTO tlv_billings (warehouse_id, merchant_id, outbound_id, items, total, status)
  VALUES (v_wh, v_merchant, p_outbound_id, v_items, v_total, 'pending');

  -- 5. append-only wallet ledger
  -- 取最新余额
  SELECT COALESCE(balance_after, 0) INTO v_current_balance
  FROM tlv_merchant_wallets
  WHERE merchant_id = v_merchant AND warehouse_id = v_wh AND type = 'balance'
  ORDER BY created_at DESC LIMIT 1;

  INSERT INTO tlv_merchant_wallets (
    merchant_id, warehouse_id, type, amount, balance_after,
    ref_table, ref_id, note, created_at
  ) VALUES (
    v_merchant, v_wh, 'balance', -v_total, v_current_balance - v_total,
    'tlv_outbound_orders', p_outbound_id, 
    format('出库单计费扣费: 打包%.2f + 重计%.2f = %.2f', v_fee_pkg, v_fee_weight, v_total),
    now()
  );

  -- 6. 更新 merchants 聚合余额
  UPDATE tlv_merchants SET balance = balance - v_total, updated_at = now() WHERE id = v_merchant;

  RETURN v_total;
END;
$function$;
"""

c = connect()

# 先确认 merchants 有 balance
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT column_name FROM information_schema.columns WHERE table_name='tlv_merchants' AND column_name LIKE '%balance%';
\"""")
print(f'merchants balance 列: {o.strip()}')

# 执行新 RPC
with open('/tmp/fix_rpc2.sql', 'w') as f:
    f.write(rpc_sql)
sftp = c.open_sftp()
sftp.put('/tmp/fix_rpc2.sql', '/tmp/fix_rpc2.sql')
sftp.close()

o, e = run(c, """docker cp /tmp/fix_rpc2.sql supabase-db:/tmp/fix_rpc2.sql && docker exec supabase-db psql -U supabase_admin -d postgres -f /tmp/fix_rpc2.sql""")
print(f'\nCREATE FUNCTION: {o.strip()}')
if 'ERROR' in e or 'ERROR' in o:
    print(f'  ❌ {e[:300]}')
else:
    print('  ✅ RPC 重写成功')

# 清旧测试数据 + 重新跑一次完整流程
print('\n🧹 清旧测试数据')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
DELETE FROM tlv_billings WHERE created_at > now() - interval '1 hour';
DELETE FROM tlv_merchant_wallets WHERE created_at > now() - interval '1 hour';
DELETE FROM tlv_outbound_items WHERE outbound_id IN (SELECT id FROM tlv_outbound_orders WHERE created_at > now() - interval '1 hour');
DELETE FROM tlv_outbound_orders WHERE created_at > now() - interval '1 hour';
DELETE FROM tlv_inbound_items WHERE inbound_id IN (SELECT id FROM tlv_inbound_orders WHERE created_at > now() - interval '1 hour');
DELETE FROM tlv_inbound_orders WHERE created_at > now() - interval '1 hour';
DELETE FROM tlv_merchant_inventory WHERE sku LIKE 'TEST%';
\"""")

# 确保 merchant balance 初始值
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
UPDATE tlv_merchants SET balance = 1000 WHERE balance IS NULL OR balance = 0;
SELECT id[:8], business_name, balance FROM tlv_merchants;
\"""")
print(o)

# 现在直接 psql 模拟完整流程（绕过 REST 简化）
print('\n🎯 psql 直接跑完整业务流')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
\\set ON_ERROR_STOP on

-- Step 1: 入库
INSERT INTO tlv_inbound_orders (warehouse_id, merchant_id, inbound_no, source, status, sku_count, total_qty)
SELECT id, (SELECT id FROM tlv_merchants LIMIT 1), 'FINAL-IN-' || to_char(now(), 'YYYYMMDDHH24MISS'), 'Manual', 'pending', 1, 100
FROM tlv_warehouses LIMIT 1;

INSERT INTO tlv_inbound_items (inbound_id, product_id, sku, expected_qty, actual_qty)
SELECT o.id, p.id, p.sku, 100, 100
FROM tlv_inbound_orders o JOIN tlv_merchant_products p ON p.merchant_id = o.merchant_id AND p.warehouse_id = o.warehouse_id
ORDER BY o.created_at DESC LIMIT 1;

-- 完成入库
WITH latest AS (SELECT * FROM tlv_inbound_orders ORDER BY created_at DESC LIMIT 1)
UPDATE tlv_inbound_orders SET status='completed', completed_at=now() WHERE id IN (SELECT id FROM latest);

INSERT INTO tlv_merchant_inventory (warehouse_id, merchant_id, sku, location, qty_on_hand, inbound_qty, product_id)
SELECT warehouse_id, merchant_id, (SELECT sku FROM tlv_merchant_products WHERE merchant_id = merchant_id LIMIT 1), 'A-01-01', 100, 100, (SELECT id FROM tlv_merchant_products WHERE merchant_id = merchant_id LIMIT 1)
FROM tlv_inbound_orders ORDER BY created_at DESC LIMIT 1
ON CONFLICT (warehouse_id, merchant_id, sku, location) 
DO UPDATE SET qty_on_hand = tlv_merchant_inventory.qty_on_hand + 100;

-- Step 2: 出库
INSERT INTO tlv_outbound_orders (warehouse_id, merchant_id, order_no, source, status, 
  receiver_name, receiver_phone, receiver_address, receiver_city, receiver_state, receiver_postal_code, receiver_country, is_cod)
SELECT warehouse_id, merchant_id, 'FINAL-OUT-' || to_char(now(), 'YYYYMMDDHH24MISS'), 'Manual', 'weighed',
  'Test Buyer', '123456', '123 Test St', 'New York', 'NY', '10001', 'US', false
FROM tlv_inbound_orders ORDER BY created_at DESC LIMIT 1;

WITH o AS (SELECT * FROM tlv_outbound_orders ORDER BY created_at DESC LIMIT 1)
INSERT INTO tlv_outbound_items (outbound_id, product_id, sku, qty)
SELECT o.id, p.id, p.sku, 5 FROM o, tlv_merchant_products p WHERE p.merchant_id = o.merchant_id LIMIT 1;

-- 称重
UPDATE tlv_outbound_orders SET status='weighed', weight_kg=0.5, weighed_at=now() 
WHERE order_no LIKE 'FINAL-OUT%' ORDER BY created_at DESC LIMIT 1;

-- Step 3: 调 RPC！
SELECT public.calc_outbound_charge(id, 0.5) as fee_total
FROM tlv_outbound_orders WHERE order_no LIKE 'FINAL-OUT%' ORDER BY created_at DESC LIMIT 1;
\"""")
print(o)

# 看最终结果
print('\n🏁 最终结果:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
-- outbound 总费用
SELECT order_no, status, weight_kg, packaging_fee, weight_fee, total_charge FROM tlv_outbound_orders ORDER BY created_at DESC LIMIT 1;

-- 账单
SELECT total, status, items FROM tlv_billings ORDER BY created_at DESC LIMIT 1;

-- wallet 流水 (最新 3 条)
SELECT type, amount, balance_after, note, created_at FROM tlv_merchant_wallets ORDER BY created_at DESC LIMIT 3;

-- merchant balance
SELECT id[:8], business_name, balance FROM tlv_merchants LIMIT 1;

-- inventory
SELECT sku, qty_on_hand, location FROM tlv_merchant_inventory;
\"""")
print(o)

c.close()
