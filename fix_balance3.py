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
DROP FUNCTION IF EXISTS public.tlv_recompute_merchant_balance(uuid);
CREATE OR REPLACE FUNCTION public.tlv_recompute_merchant_balance(p_merchant_id uuid)
RETURNS numeric
LANGUAGE sql
AS $$
  UPDATE tlv_merchants
  SET balance = COALESCE(
    (SELECT balance_after FROM tlv_merchant_wallets WHERE merchant_id = p_merchant_id ORDER BY created_at DESC LIMIT 1),
    0
  ),
      updated_at = now()
  WHERE id = p_merchant_id
  RETURNING balance;
$$;

SELECT public.tlv_recompute_merchant_balance(id) FROM public.tlv_merchants;

SELECT m.id, m.balance, w.balance_after as latest_wallet
FROM tlv_merchants m, LATERAL (SELECT balance_after FROM tlv_merchant_wallets WHERE merchant_id = m.id ORDER BY created_at DESC LIMIT 1) w;
"""

cmd = f"""docker exec -i supabase-db psql -U postgres << 'SQLEOF'
{sql}
SQLEOF
"""
print('Running fix v3...')
stdin, stdout, stderr = ssh.exec_command(cmd)
print(stdout.read().decode())
err = stderr.read().decode()
if err: print('STDERR:', err[:500])

ssh.close()
