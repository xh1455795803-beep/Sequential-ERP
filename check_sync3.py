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
    "sed -n '60,100p' /opt/supabase/docker/volumes/functions/sync-tiktok-orders/index.ts",
    "echo '--- inventory ---' && docker exec supabase-db psql -U postgres -c \"SELECT merchant_id, sku, qty_on_hand FROM tlv_merchant_inventory LIMIT 10;\"",
    "echo '--- merchant_shops ---' && docker exec supabase-db psql -U postgres -c \"SELECT * FROM tlv_merchant_shops LIMIT 5;\"",
]
for c in cmds:
    print()
    stdin, stdout, stderr = ssh.exec_command(c)
    print(stdout.read().decode())
    err = stderr.read().decode()
    if err: print('STDERR:', err[:500])

ssh.close()
