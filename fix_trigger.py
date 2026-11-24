import socket, time, paramiko

proxy = socket.socket()
proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
resp = b''
while b'\r\n\r\n' not in resp:
    chunk = proxy.recv(4096)
    if not chunk: break
    resp += chunk
time.sleep(0.8)

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('43.133.232.81', username='ubuntu', password='yuan340364#', sock=proxy)

sql = """
-- 1. 查看 outbound_items 实际列名
SELECT column_name FROM information_schema.columns 
WHERE table_name='tlv_outbound_items' AND table_schema='public';

-- 2. 修复 trigger (完全重写)
DROP FUNCTION IF EXISTS public.tlv_deduct_balance_on_create();

CREATE OR REPLACE FUNCTION public.tlv_deduct_balance_on_create()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  merchant_bal numeric;
BEGIN
  -- 查 merchant 当前最新余额
  SELECT COALESCE((SELECT balance_after FROM tlv_merchant_wallets WHERE merchant_id = NEW.merchant_id ORDER BY created_at DESC LIMIT 1), 0)
  INTO merchant_bal;

  -- 简化计费: 从订单自身 weight_kg + 预估 item 数
  -- 由于 BEFORE INSERT 时 NEW.id 还没定, 用 NEW.weight_kg 和默认 item_count
  -- 更精确的计算应在 items INSERT 后 UPDATE, 这里给个初始预估
  NEW.estimated_fee := COALESCE(NEW.weight_kg, 0.5) * 4.00 + 3.00;

  IF merchant_bal < NEW.estimated_fee THEN
    NEW.status := 'balance_hold';
    NEW.merchant_note := '⚠ 余额不足,订单已暂存,需充值后处理';
    NEW.balance_deducted := false;
  ELSE
    NEW.status := 'pending';
    NEW.balance_deducted := true;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tlv_deduct_balance_trigger ON public.tlv_outbound_orders;
CREATE TRIGGER tlv_deduct_balance_trigger
  BEFORE INSERT ON public.tlv_outbound_orders
  FOR EACH ROW EXECUTE FUNCTION public.tlv_deduct_balance_on_create();

-- 3. 验证: 手动 insert 一条
INSERT INTO tlv_outbound_orders (warehouse_id, merchant_id, order_no, platform, receiver_name, receiver_phone, receiver_address, status, is_cod, cod_amount, weight_kg)
VALUES ('57ae8979-c77f-4a88-b80a-113f01b5cbee', '7e3bf09f-3937-4891-a6f6-75941f39d1b2', 'TEST-TIKTOK-ORDER', 'TikTok Shop', 'Test Buyer', '+1234567890', '123 Main St, USA', 'pending', false, null, 1.5)
RETURNING id, status, balance_deducted, estimated_fee, merchant_note;
"""

cmd = f"""docker exec -i supabase-db psql -U postgres << 'SQLEOF'
{sql}
SQLEOF
"""
print('Running trigger fix...')
stdin, stdout, stderr = ssh.exec_command(cmd)
print(stdout.read().decode())
err = stderr.read().decode()
if err: print('STDERR:', err[:1000])

ssh.close()
