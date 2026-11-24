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
DROP FUNCTION IF EXISTS public.tlv_deduct_balance_on_create() CASCADE;

CREATE OR REPLACE FUNCTION public.tlv_deduct_balance_on_create()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  merchant_bal numeric;
BEGIN
  SELECT COALESCE((SELECT balance_after FROM tlv_merchant_wallets WHERE merchant_id = NEW.merchant_id ORDER BY created_at DESC LIMIT 1), 0)
  INTO merchant_bal;

  -- 简化计费: 从 weight_kg 计算 (item count 稍后在 item INSERT 后 UPDATE)
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

CREATE TRIGGER tlv_outbound_balance_trigger
  BEFORE INSERT ON public.tlv_outbound_orders
  FOR EACH ROW EXECUTE FUNCTION public.tlv_deduct_balance_on_create();

-- Test
INSERT INTO tlv_outbound_orders (warehouse_id, merchant_id, order_no, platform, receiver_name, receiver_phone, receiver_address, status, is_cod, cod_amount, weight_kg)
VALUES ('57ae8979-c77f-4a88-b80a-113f01b5cbee', '7e3bf09f-3937-4891-a6f6-75941f39d1b2', 'TEST-TRIGGER-FIX', 'TikTok Shop', 'Test Buyer', '+1234567890', '123 Main St, USA', 'pending', false, null, 1.5)
RETURNING id, status, balance_deducted, estimated_fee, merchant_note;
"""

cmd = f"""docker exec -i supabase-db psql -U postgres << 'SQLEOF'
{sql}
SQLEOF
"""
print('Running trigger fix v2...')
stdin, stdout, stderr = ssh.exec_command(cmd)
print(stdout.read().decode())
err = stderr.read().decode()
if err: print('STDERR:', err[:500])

# Cleanup test order
ssh.exec_command("docker exec supabase-db psql -U postgres -c \"DELETE FROM tlv_outbound_orders WHERE order_no='TEST-TRIGGER-FIX';\"")

ssh.close()
