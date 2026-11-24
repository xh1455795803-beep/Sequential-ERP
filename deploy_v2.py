import socket, time, sys

proxy = socket.socket()
proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
resp = b''
while b'\r\n\r\n' not in resp:
    chunk = proxy.recv(4096)
    if not chunk: break
    resp += chunk
time.sleep(0.5)

import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('43.133.232.81', username='ubuntu', password='yuan340364#', sock=proxy)
print("✅ SSH")

# 上传 SQL
with open('/workspace/patch_v2_core.sql') as f:
    sql_content = f.read()
sftp = ssh.open_sftp()
with sftp.open('/home/ubuntu/patch_v2_core.sql', 'w') as rf:
    rf.write(sql_content)
sftp.close()

# 执行
cmd = f"docker exec supabase-db psql -U supabase_admin -d postgres -f /home/ubuntu/patch_v2_core.sql 2>&1"
stdin, stdout, stderr = ssh.exec_command(cmd, timeout=60)
out = stdout.read().decode()
err = stderr.read().decode()
print("=== STDOUT ===")
print(out)
if err.strip():
    print("=== STDERR (last 600) ===")
    print(err[-600:])

# 重启 REST
stdin, stdout, stderr = ssh.exec_command("docker restart supabase-rest supabase-envoy 2>&1")
print("\n重启:", stdout.read().decode().strip() or "OK")

# 校验
print("\n=== 校验 ===")
for tbl in ['tlv_label_templates','tlv_pick_lists','tlv_pick_list_items']:
    _, out, _ = ssh.exec_command(f"docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c 'SELECT COUNT(*) FROM {tbl}'")
    print(f"  {tbl}: {out.read().decode().strip()}")
_, out, _ = ssh.exec_command(f"docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c 'SELECT COUNT(*) FROM tlv_low_stock_alerts'")
print(f"  low_stock_alerts: {out.read().decode().strip()}")

ssh.close()
print("\n🎉 Done")
