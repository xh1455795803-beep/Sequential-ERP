#!/usr/bin/env python3
"""RPC 终极修复 — 添加 NOT FOUND 检查"""
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

rpc_sql = """
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
  -- 读 outbound
  SELECT warehouse_id, merchant_id, COALESCE(weight_kg, 0), COALESCE(is_cod, false)
  INTO v_wh, v_merchant, v_weight, v_is_cod
  FROM tlv_outbound_orders WHERE id = p_outbound_id;

  IF v_wh IS NULL THEN
    RAISE EXCEPTION 'Outbound % not found', p_outbound_id;
  END IF;

  IF p_weight_kg IS NOT NULL THEN
    v_weight := p_weight_kg;
    UPDATE tlv_outbound_orders SET weight_kg = v_weight WHERE id = p_outbound_id;
  END IF;

  -- 1. 打包费
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

  -- 4. 写账单
  DELETE FROM tlv_billings WHERE outbound_id = p_outbound_id;
  v_items := jsonb_build_array(
    jsonb_build_object('type', 'packaging', 'amount', v_fee_pkg, 'rule', '基础打包费'),
    jsonb_build_object('type', 'weight', 'amount', v_fee_weight, 'rule', '重计费', 'weight_kg', v_weight)
  );
  INSERT INTO tlv_billings (warehouse_id, merchant_id, outbound_id, items, total, status)
  VALUES (v_wh, v_merchant, p_outbound_id, v_items, v_total, 'pending');

  -- 5. append-only wallet ledger
  -- 先取当前余额（如果没有历史就从 merchant.balance 读）
  SELECT balance_after INTO v_current_balance
  FROM tlv_merchant_wallets
  WHERE merchant_id = v_merchant AND warehouse_id = v_wh AND type = 'balance'
  ORDER BY created_at DESC LIMIT 1;

  IF v_current_balance IS NULL THEN
    -- 没有钱包历史，从 merchant.balance 初始化
    SELECT balance INTO v_current_balance FROM tlv_merchants WHERE id = v_merchant;
    IF v_current_balance IS NULL THEN v_current_balance := 0; END IF;
  END IF;

  INSERT INTO tlv_merchant_wallets (
    merchant_id, warehouse_id, type, amount, balance_after,
    ref_table, ref_id, note, created_at
  ) VALUES (
    v_merchant, v_wh, 'balance', -v_total, v_current_balance - v_total,
    'tlv_outbound_orders', p_outbound_id, 
    '出库计费: 打包' || v_fee_pkg || ' + 重计' || v_fee_weight || 'kg=' || v_weight || ' = ' || v_total,
    now()
  );

  -- 6. merchant balance
  UPDATE tlv_merchants SET balance = balance - v_total, updated_at = now() WHERE id = v_merchant;

  RETURN v_total;
END;
$function$;
"""

c = connect()
sftp = c.open_sftp()
with open('/tmp/rpc_final.sql', 'w') as f: f.write(rpc_sql)
sftp.put('/tmp/rpc_final.sql', '/tmp/rpc_final.sql')
sftp.close()

o, e = run(c, """docker cp /tmp/rpc_final.sql supabase-db:/tmp/rpc_final.sql && docker exec supabase-db psql -U supabase_admin -d postgres -f /tmp/rpc_final.sql""")
print(f'CREATE: {o.strip() or "❌ " + e[:200]}')

# 直接调！
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"SELECT id FROM tlv_outbound_orders ORDER BY created_at DESC LIMIT 1;\"""")
oid = o.strip()
print(f'\noutbound = {oid}')

o, e = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"SELECT public.calc_outbound_charge('{oid}'::uuid, 0.5) as fee;\"""")
print(f'fee = {o.strip()}')
if 'ERROR' in (o or '') or 'ERROR' in (e or ''):
    print(f'  ❌ {e[:200] if e else o[:200]}')
    c.close(); exit(1)

# 看最终数据
print('\n🏁 最终数据:')
o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT 'outbound: pkg=' || packaging_fee || ' weight=' || weight_fee || ' total=' || total_charge FROM tlv_outbound_orders WHERE id='{oid}';
SELECT 'billing: total=' || total || ' status=' || status FROM tlv_billings WHERE outbound_id='{oid}';
SELECT 'wallet: amount=' || amount || ' after=' || balance_after || ' note=' || note FROM tlv_merchant_wallets WHERE ref_id='{oid}';
SELECT 'merchant balance: ' || balance FROM tlv_merchants LIMIT 1;
\"""")
print(o)

c.close()
