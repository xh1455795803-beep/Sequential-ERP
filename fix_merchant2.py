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

# 查 merchant1 contact_email
sql1 = "docker exec supabase-db psql -U postgres -c \"SELECT id, name, contact_email, balance FROM tlv_merchants;\""
stdin, stdout, stderr = ssh.exec_command(sql1, timeout=15)
print('=== merchants ===')
print(stdout.read().decode())

# 给 xh145572917706537@qq.com 绑定 merchant1 (创宇)
# 给 2917706537@qq.com 也绑 merchant1 或者 merchant2
# 先看哪个 merchant 没被绑
sql2 = """docker exec supabase-db psql -U postgres -c "
DO \\$\\$
BEGIN
  -- xh145572917706537@qq.com 绑 merchant1 (创宇, 7e3bf09f...)
  UPDATE auth.users SET
    raw_app_meta_data = jsonb_set(COALESCE(raw_app_meta_data, '{}'::jsonb), '{merchant_id}', '\\\"7e3bf09f-3937-4891-a6f6-75941f39d1b2\\\"'),
    raw_user_meta_data = jsonb_set(COALESCE(raw_user_meta_data, '{}'::jsonb), '{merchant_id}', '\\\"7e3bf09f-3937-4891-a6f6-75941f39d1b2\\\"'),
    raw_user_meta_data = jsonb_set(COALESCE(raw_user_meta_data, '{}'::jsonb), '{portal_role}', '\\\"merchant\\\"'),
    raw_user_meta_data = jsonb_set(COALESCE(raw_user_meta_data, '{}'::jsonb), '{display_name}', '\\\"创宇 (测试商家1)\\\"')
  WHERE email = 'xh145572917706537@qq.com';
  RAISE NOTICE 'xh145572917706537 updated';

  -- 2917706537@qq.com 绑 merchant2 (测试商家)
  UPDATE auth.users SET
    raw_app_meta_data = jsonb_set(COALESCE(raw_app_meta_data, '{}'::jsonb), '{merchant_id}', '\\\"c657a6a3-0b47-4a01-bbf2-5a0ce40a08d5\\\"'),
    raw_user_meta_data = jsonb_set(COALESCE(raw_user_meta_data, '{}'::jsonb), '{portal_role}', '\\\"merchant\\\"'),
    raw_user_meta_data = jsonb_set(COALESCE(raw_user_meta_data, '{}'::jsonb), '{display_name}', '\\\"测试商家2\\\"')
  WHERE email = '2917706537@qq.com';
  RAISE NOTICE '2917706537 updated';
END
\\$\\$;

SELECT email, raw_app_meta_data->>'merchant_id' AS mid,
       raw_user_meta_data->>'portal_role' AS role,
       raw_user_meta_data->>'display_name' AS name
FROM auth.users ORDER BY email;
\""""
stdin, stdout, stderr = ssh.exec_command(sql2, timeout=15)
print(stdout.read().decode())
err = stderr.read().decode()
if err: print('STDERR:', err)

ssh.close()
