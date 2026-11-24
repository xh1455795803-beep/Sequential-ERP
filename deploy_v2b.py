import socket, time

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

# 读本地 SQL
with open('/workspace/patch_v2_core.sql') as f:
    sql = f.read()

# heredoc pipe
cmd = f"""docker exec -i supabase-db psql -U supabase_admin -d postgres << 'SQLEND'\n{sql}\nSQLEND"""
stdin, stdout, stderr = ssh.exec_command(cmd, timeout=60)
out = stdout.read().decode()
err = stderr.read().decode()
print("=== STDOUT ===")
print(out)
if err.strip():
    print("=== STDERR (last 600) ===")
    print(err[-600:])

# 重启
ssh.exec_command("docker restart supabase-rest supabase-envoy")
time.sleep(2)

# 校验
print("\n=== 校验 ===")
for tbl in ['tlv_label_templates','tlv_pick_lists','tlv_pick_list_items']:
    _, out, _ = ssh.exec_command(f"docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c 'SELECT COUNT(*) FROM {tbl}'")
    cnt = out.read().decode().strip()
    print(f"  {tbl}: {cnt}")

_, out, _ = ssh.exec_command("docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c 'SELECT COUNT(*) FROM tlv_low_stock_alerts'")
print(f"  low_stock_alerts: {out.read().decode().strip()}")

# 触发器测试: 查 outbound_orders 当前状态
_, out, _ = ssh.exec_command("docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c 'SELECT id::text, status, estimated_fee, balance_deducted FROM tlv_outbound_orders ORDER BY created_at DESC LIMIT 5'")
print(f"\n  outbound_orders 最新 5:\n{out.read().decode()}")

ssh.close()
print("\n🎉 Done")
