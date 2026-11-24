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
UPDATE auth.users SET
  raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('merchant_id', '7e3bf09f-3937-4891-a6f6-75941f39d1b2'),
  raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('portal_role', 'merchant', 'merchant_id', '7e3bf09f-3937-4891-a6f6-75941f39d1b2', 'display_name', '创宇 (测试商家1)')
WHERE email = 'xh145572917706537@qq.com';

UPDATE auth.users SET
  raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('merchant_id', 'c657a6a3-0b47-4a01-bbf2-5a0ce40a08d5'),
  raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('portal_role', 'merchant', 'merchant_id', 'c657a6a3-0b47-4a01-bbf2-5a0ce40a08d5', 'display_name', '测试商家2')
WHERE email = '2917706537@qq.com';

SELECT email, raw_app_meta_data->>'merchant_id' AS mid, raw_user_meta_data->>'portal_role' AS role, raw_user_meta_data->>'display_name' AS name
FROM auth.users ORDER BY email;
\""""
stdin, stdout, stderr = ssh.exec_command(sql, timeout=15)
print(stdout.read().decode())
err = stderr.read().decode()
if err: print('STDERR:', err)

# 再查 tlv_merchants 确认 merchant1 的 contact_email
sql2 = "docker exec supabase-db psql -U postgres -c \"SELECT id, name, contact_email, balance FROM tlv_merchants;\""
stdin, stdout, stderr = ssh.exec_command(sql2, timeout=15)
print('=== merchants ===')
print(stdout.read().decode())

ssh.close()
