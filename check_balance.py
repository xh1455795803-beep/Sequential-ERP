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

cmds = [
    "echo '=== merchants balance ===' && docker exec supabase-db psql -U postgres -c \"SELECT id, name, balance FROM tlv_merchants LIMIT 5;\"",
    "echo '=== wallets ===' && docker exec supabase-db psql -U postgres -c \"SELECT merchant_id, type, amount, balance_after, note, created_at FROM tlv_merchant_wallets ORDER BY created_at DESC LIMIT 10;\"",
    "echo '=== triggers on wallets ===' && docker exec supabase-db psql -U postgres -c \"SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE tgrelid::regclass::text LIKE '%wallet%';\"",
    "echo '=== tlv_recompute_merchant_balance ===' && docker exec supabase-db psql -U postgres -c \"SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='tlv_recompute_merchant_balance';\"",
]
for c in cmds:
    print()
    stdin, stdout, stderr = ssh.exec_command(c)
    print(stdout.read().decode())
    err = stderr.read().decode()
    if err: print('STDERR:', err[:500])

ssh.close()
