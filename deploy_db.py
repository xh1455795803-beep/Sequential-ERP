"""
SSH → SCP SQL → docker exec psql
paramiko + HTTP CONNECT tunnel via 127.0.0.1:18080
"""
import socket, time, sys

# 1. HTTP CONNECT tunnel
proxy = socket.socket()
proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
resp = b''
while b'\r\n\r\n' not in resp:
    chunk = proxy.recv(4096)
    if not chunk: break
    resp += chunk
if b'200' not in resp.split(b'\r\n')[0]:
    print(f"❌ Proxy failed: {resp[:200]}")
    sys.exit(1)
time.sleep(0.5)

# 2. paramiko SSH
import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('43.133.232.81', username='ubuntu', password='yuan340364#', sock=proxy)
print("✅ SSH connected")

# 3. 读本地 SQL 并上传
sql_path = '/workspace/patch_gap_p0.sql'
with open(sql_path) as f:
    sql_content = f.read()

sftp = ssh.open_sftp()
remote_path = '/home/ubuntu/patch_gap_p0.sql'
with sftp.open(remote_path, 'w') as rf:
    rf.write(sql_content)
sftp.close()
print(f"✅ SQL uploaded ({len(sql_content)} chars)")

# 4. 在远端 docker exec 执行
cmd = f"docker cp {remote_path} supabase-db:/tmp/patch_gap_p0.sql && docker exec supabase-db psql -U supabase_admin -d postgres -f /tmp/patch_gap_p0.sql"
stdin, stdout, stderr = ssh.exec_command(cmd, timeout=60)
out = stdout.read().decode()
err = stderr.read().decode()

print("=== STDOUT ===")
print(out)
if err.strip():
    print("=== STDERR ===")
    print(err)

# 5. 简单校验新表
print("\n=== 校验 ===")
for tbl in ['tlv_warehouse_flows','tlv_flow_nodes','tlv_packages','tlv_package_logs','tlv_issue_items','tlv_customer_followups']:
    c = f"docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"SELECT COUNT(*) FROM {tbl};\""
    stdin, stdout, stderr = ssh.exec_command(c)
    cnt = stdout.read().decode().strip()
    print(f"  {tbl}: {cnt} rows")

# 6. 重启 rest/envoy 让 schema cache 更新
print("\n重启 supabase-rest supabase-envoy ...")
stdin, stdout, stderr = ssh.exec_command("docker restart supabase-rest supabase-envoy")
print(stdout.read().decode().strip())

ssh.close()
print("\n🎉 DB 迁移完成!")
