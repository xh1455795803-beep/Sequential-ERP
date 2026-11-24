import socket, time
proxy = socket.socket(); proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
while b'\r\n\r\n' not in (b''.join([proxy.recv(4096) for _ in range(5)]) if False else b''): 
    pass
time.sleep(0.5)
import paramiko
ssh = paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('43.133.232.81', username='ubuntu', password='yuan340364#', sock=proxy)

# 看 issue_items 列
stdin, stdout, _ = ssh.exec_command("docker exec supabase-db psql -U supabase_admin -d postgres -c '\\d tlv_issue_items'")
print(stdout.read().decode())

# 用实际列插
sql2 = """
INSERT INTO tlv_issue_items 
  (warehouse_id, merchant_id, sku, location, issue_type, severity, description, status, assigned_name) VALUES
  ('57ae8979-c77f-4a88-b80a-113f01b5cbee', '7e3bf09f-3937-4891-a6f6-75941f39d1b2', 'SKU-001', 'A-01-01', 'wrong_qty', 'high', '实际清点少 2 件需补寄', 'open', NULL),
  ('57ae8979-c77f-4a88-b80a-113f01b5cbee', 'c657a6a3-0b47-4a01-bbf2-5a0ce40a08d5', 'SKU-002', 'B-02-02', 'damaged', 'critical', '外箱破损商品可能受损需全检', 'assigned', '张三'),
  ('57ae8979-c77f-4a88-b80a-113f01b5cbee', '7e3bf09f-3937-4891-a6f6-75941f39d1b2', 'SKU-003', 'C-03-01', 'qc_failed', 'medium', '抽检发现 3 件外观划痕', 'processing', '李四');
"""
stdin, stdout, stderr = ssh.exec_command(f"docker exec -i supabase-db psql -U supabase_admin -d postgres << 'SQLD'\n{sql2}\nSQLD")
print(stdout.read().decode())
e = stderr.read().decode()
if e: print("ERR:", e[:500])

# 验证
stdin, stdout, _ = ssh.exec_command("docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c 'SELECT COUNT(*) FROM tlv_issue_items'")
print(f"issue_items count: {stdout.read().decode().strip()}")

ssh.close()
