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

# Check owner then change
cmds = [
    "docker exec supabase-db psql -U postgres -c \"SELECT tablename, tableowner FROM pg_tables WHERE tablename='tlv_outbound_orders';\"",
    "docker exec supabase-db psql -U postgres -c \"ALTER TABLE tlv_outbound_orders OWNER TO postgres; ALTER TABLE tlv_outbound_orders ALTER COLUMN source SET DEFAULT 'api'; ALTER TABLE tlv_outbound_orders ALTER COLUMN receiver_city SET DEFAULT 'Unknown'; ALTER TABLE tlv_outbound_orders ALTER COLUMN receiver_country SET DEFAULT 'US';\"",
    "docker exec supabase-db psql -U postgres -c \"SELECT column_name, column_default FROM information_schema.columns WHERE table_name='tlv_outbound_orders' AND (column_name IN ('source','receiver_city','receiver_country'));\"",
]
for c in cmds:
    print()
    stdin, stdout, stderr = ssh.exec_command(c)
    print(stdout.read().decode())
    err = stderr.read().decode()
    if err: print('STDERR:', err[:500])

ssh.close()
