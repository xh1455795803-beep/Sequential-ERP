import socket, time, paramiko

HOST = '43.133.232.81'
USER = 'ubuntu'
PASS = 'yuan340364#'

proxy = socket.socket()
proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
buf = b''
while b'\r\n\r\n' not in buf:
    chunk = proxy.recv(4096)
    if not chunk: break
    buf += chunk
time.sleep(0.6)
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, sock=proxy)

sql = """docker exec supabase-db psql -U postgres -c "
SELECT 
  email,
  raw_app_meta_data->>'merchant_id' AS merchant_id,
  raw_app_meta_data->>'warehouse_id' AS warehouse_id,
  raw_user_meta_data->>'portal_role' AS portal_role,
  raw_user_meta_data->>'display_name' AS display_name
FROM auth.users 
ORDER BY created_at;
\""""

stdin, stdout, stderr = ssh.exec_command(sql, timeout=15)
print(stdout.read().decode())
err = stderr.read().decode()
if err: print('STDERR:', err)

ssh.close()
