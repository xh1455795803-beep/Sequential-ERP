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
    # Check INSERT part
    "sed -n '75,95p' /opt/supabase/docker/volumes/functions/sync-tiktok-orders/index.ts",
    # Check tlv_outbound_orders schema for NOT NULL constraints
    "docker exec supabase-db psql -U postgres -c \"SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='tlv_outbound_orders' AND table_schema='public' ORDER BY ordinal_position;\"",
    # Add source column default if needed
]
for c in cmds:
    print()
    stdin, stdout, stderr = ssh.exec_command(c)
    print(stdout.read().decode())
    err = stderr.read().decode()
    if err: print('STDERR:', err[:500])

ssh.close()
