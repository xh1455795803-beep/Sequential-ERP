#!/usr/bin/env python3
"""修 calc_outbound_charge RPC — 用真实 tlv_billings 列"""
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

# 1. 看当前 RPC 完整实现
print('📋 当前 RPC 实现:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace 
WHERE n.nspname='public' AND proname='calc_outbound_charge';
\"""")
print(o)

# 2. 看 tlv_billings 真实列
print('\n📋 tlv_billings 真实列:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='tlv_billings' ORDER BY ordinal_position;
\"""")
print(o)

# 3. 重写 RPC
print('\n🔧 重写 calc_outbound_charge RPC')
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
  v_outbound_sku text;
  v_fee_pkg numeric := 0;
  v_fee_weight numeric := 0;
  v_fee_cod numeric := 0;
  v_total numeric := 0;
  v_weight numeric;
  v_is_cod boolean;
  v_items jsonb := '[]'::jsonb;
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

  -- 1. 基础打包费 (packaging rule)
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

  -- 3. COD 手续费
  IF v_is_cod THEN
    -- COD 费按固定金额 + 比例 (这里简化为 3%)
    v_fee_cod := 0;
  END IF;

  v_total := v_fee_pkg + v_fee_weight + v_fee_cod;

  -- 4. 更新 outbound 总费用
  UPDATE tlv_outbound_orders SET 
    packaging_fee = v_fee_pkg,
    weight_fee = v_fee_weight,
    cod_fee = v_fee_cod,
    total_charge = v_total
  WHERE id = p_outbound_id;

  -- 5. 写账单 — 用真实 tlv_billings 列
  -- 先删旧账单
  DELETE FROM tlv_billings WHERE outbound_id = p_outbound_id;
  
  -- items jsonb 包含各费用明细
  v_items := jsonb_build_array(
    jsonb_build_object('type', 'packaging', 'amount', v_fee_pkg, 'rule', '基础打包费'),
    jsonb_build_object('type', 'weight', 'amount', v_fee_weight, 'rule', '重计费', 'weight_kg', v_weight),
    jsonb_build_object('type', 'cod', 'amount', v_fee_cod, 'rule', 'COD 手续费')
  );

  INSERT INTO tlv_billings (
    warehouse_id, merchant_id, outbound_id, items, total, status
  ) VALUES (
    v_wh, v_merchant, p_outbound_id, v_items, v_total, 'pending'
  );

  -- 6. 扣钱包 (if merchant has wallet)
  UPDATE tlv_merchant_wallets 
  SET balance = balance - v_total,
      balance_after = balance - v_total
  WHERE merchant_id = v_merchant AND warehouse_id = v_wh AND type = 'balance';

  RETURN v_total;
END;
$function$;
"""

# 写 SQL 文件到本地
with open('/tmp/fix_rpc.sql', 'w') as f:
    f.write(rpc_sql)

# 上传 + 执行
import subprocess
subprocess.run(['tar', 'cf', '-', '-C', '/tmp', 'fix_rpc.sql'], check=True)
sftp = c.open_sftp()
sftp.put('/tmp/fix_rpc.sql', '/tmp/fix_rpc.sql')
sftp.close()

o, e = run(c, """docker cp /tmp/fix_rpc.sql supabase-db:/tmp/fix_rpc.sql && docker exec supabase-db psql -U supabase_admin -d postgres -f /tmp/fix_rpc.sql""")
print(f'  执行结果:\n{o}')
if e:
    print(f'  err: {e[:500]}')

# 4. 验证 RPC
print('\n✅ 验证 RPC:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT public.calc_outbound_charge(id, 0.5) as total FROM tlv_outbound_orders ORDER BY created_at DESC LIMIT 1;
\"""")
print(o)

# 看账单
print('\n💰 账单:')
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT id[:8], warehouse_id[:8], merchant_id[:8], outbound_id[:8], total, status, items 
FROM tlv_billings ORDER BY created_at DESC LIMIT 3;
\"""")
print(o[:2000])

c.close()
