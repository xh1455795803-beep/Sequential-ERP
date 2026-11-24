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
-- 1. 给 tlv_merchant_wallets 加 AFTER INSERT trigger，自动同步 merchants.balance
CREATE OR REPLACE FUNCTION public.tlv_wallet_sync_merchant_balance()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM public.tlv_recompute_merchant_balance(NEW.merchant_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tlv_wallet_sync_trigger ON public.tlv_merchant_wallets;
CREATE TRIGGER tlv_wallet_sync_trigger
  AFTER INSERT ON public.tlv_merchant_wallets
  FOR EACH ROW EXECUTE FUNCTION public.tlv_wallet_sync_merchant_balance();

-- 2. 立即同步所有 merchant 余额
SELECT public.tlv_recompute_merchant_balance(id) FROM public.tlv_merchants;

-- 3. 验证
SELECT m.id, m.company_name, m.balance AS merchant_balance,
       (SELECT balance_after FROM tlv_merchant_wallets WHERE merchant_id = m.id ORDER BY created_at DESC LIMIT 1) AS wallet_latest
FROM tlv_merchants m;
"""

cmd = f"docker exec supabase-db psql -U postgres -c \"{sql.replace(chr(34), chr(39)).replace(chr(10), ' ')}\" 2>&1 | head -30"

# Actually better: use heredoc
cmd2 = f"""docker exec -i supabase-db psql -U postgres << 'SQLEOF'
{sql}
SQLEOF
"""
print('Running SQL...')
stdin, stdout, stderr = ssh.exec_command(cmd2)
print(stdout.read().decode())
err = stderr.read().decode()
if err: print('STDERR:', err[:1000])

ssh.close()
