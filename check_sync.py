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
    "echo '=== sync-tiktok source ===' && head -60 /opt/supabase/docker/volumes/functions/sync-tiktok-orders/index.ts",
    "echo '=== sync-tiktok mounted ===' && cat /opt/supabase/docker/volumes/functions/sync-tiktok-orders/index.ts | head -30",
    "echo '=== existing tracking ===' && docker exec supabase-db psql -U postgres -c \"SELECT count(*) FROM tlv_logistics_tracking;\"",
]
for c in cmds:
    print()
    stdin, stdout, stderr = ssh.exec_command(c)
    print(stdout.read().decode())
    err = stderr.read().decode()
    if err: print('STDERR:', err[:500])

ssh.close()
