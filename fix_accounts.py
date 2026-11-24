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

# 1. 看 merchant 表的 contact_email
sql1 = """docker exec supabase-db psql -U postgres -c "SELECT id, name, contact_email, balance FROM tlv_merchants;\""""
stdin, stdout, stderr = ssh.exec_command(sql1, timeout=15)
print('=== merchants ===')
print(stdout.read().decode())

# 2. 确保所有账号的 merchant_id/warehouse_id 在 raw_app_meta_data 里
#    merchant@thalvior.dev → merchant2 (c657...)
#    admin@thalvior.dev → admin role + warehouse_id
#    wms@thalvior.dev → warehouse role + warehouse_id
#    还有一个 admin@thalvior.icu 需要 admin role

sql2 = """docker exec supabase-db psql -U postgres -c "
DO \\$\\$
DECLARE
  uid uuid;
BEGIN
  -- 修 admin@thalvior.icu (没有任何 metadata)
  SELECT id INTO uid FROM auth.users WHERE email = 'admin@thalvior.icu';
  IF uid IS NOT NULL THEN
    UPDATE auth.users 
    SET raw_user_meta_data = jsonb_set(COALESCE(raw_user_meta_data, '{}'::jsonb), '{portal_role}', '\\\"admin\\\"'),
        raw_app_meta_data = jsonb_set(COALESCE(raw_app_meta_data, '{}'::jsonb), '{warehouse_id}', '\\\"57ae8979-c77f-4a88-b80a-113f01b5cbee\\\"')
    WHERE id = uid;
  END IF;

  -- 修 wms@thalvior.dev (已有 role 但没 warehouse_id 在 app_meta)
  SELECT id INTO uid FROM auth.users WHERE email = 'wms@thalvior.dev';
  IF uid IS NOT NULL THEN
    UPDATE auth.users 
    SET raw_app_meta_data = jsonb_set(COALESCE(raw_app_meta_data, '{}'::jsonb), '{warehouse_id}', '\\\"57ae8979-c77f-4a88-b80a-113f01b5cbee\\\"')
    WHERE id = uid;
  END IF;

  -- 修 admin@thalvior.dev (已有 role 但没 warehouse_id)
  SELECT id INTO uid FROM auth.users WHERE email = 'admin@thalvior.dev';
  IF uid IS NOT NULL THEN
    UPDATE auth.users 
    SET raw_app_meta_data = jsonb_set(COALESCE(raw_app_meta_data, '{}'::jsonb), '{warehouse_id}', '\\\"57ae8979-c77f-4a88-b80a-113f01b5cbee\\\"')
    WHERE id = uid;
  END IF;
END
\\$\\$;
SELECT email, raw_app_meta_data, raw_user_meta_data->>'portal_role' FROM auth.users;
\""""
stdin, stdout, stderr = ssh.exec_command(sql2, timeout=15)
print('=== fixed users ===')
print(stdout.read().decode())

# 3. 验证 RLS 隔离 — 用 merchant token 登录能看到自己的数据
sql3 = """docker exec supabase-db psql -U postgres -c "
SELECT 
  email,
  raw_app_meta_data->>'merchant_id' as mid,
  raw_app_meta_data->>'warehouse_id' as wid,
  raw_user_meta_data->>'portal_role' as role
FROM auth.users ORDER BY email;
\""""
stdin, stdout, stderr = ssh.exec_command(sql3, timeout=15)
print('=== final state ===')
print(stdout.read().decode())

ssh.close()
