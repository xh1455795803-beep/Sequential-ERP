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
print("SSH OK")

sql = """
-- 清旧示例 (可选)
DELETE FROM tlv_packages WHERE warehouse_id = '57ae8979-c77f-4a88-b80a-113f01b5cbee';
DELETE FROM tlv_issue_items WHERE warehouse_id = '57ae8979-c77f-4a88-b80a-113f01b5cbee';

-- 包裹 (3 条)
INSERT INTO tlv_packages (warehouse_id, merchant_id, supplier, weight, status, location, operator_name, notes) VALUES
  ('57ae8979-c77f-4a88-b80a-113f01b5cbee', '7e3bf09f-3937-4891-a6f6-75941f39d1b2', '1688-义乌供应商', 2.3, 'received', '暂存区-A01', 'wms@thalvior.dev', '3箱混装入库'),
  ('57ae8979-c77f-4a88-b80a-113f01b5cbee', 'c657a6a3-0b47-4a01-bbf2-5a0ce40a08d5', '深圳华强北', 1.1, 'packed', NULL, 'wms@thalvior.dev', '出库打包中'),
  ('57ae8979-c77f-4a88-b80a-113f01b5cbee', '7e3bf09f-3937-4891-a6f6-75941f39d1b2', '东莞工厂直供', 5.8, 'shipped', NULL, 'wms@thalvior.dev', 'COD件已出库'),
  ('57ae8979-c77f-4a88-b80a-113f01b5cbee', '7e3bf09f-3937-4891-a6f6-75941f39d1b2', '1688-义乌供应商', 3.5, 'picked', 'B-02-01', 'wms@thalvior.dev', '已拣货待打包'),
  ('57ae8979-c77f-4a88-b80a-113f01b5cbee', 'c657a6a3-0b47-4a01-bbf2-5a0ce40a08d5', '香港供货商', 0.8, 'qc_failed', 'C-03-01', 'wms@thalvior.dev', '标签错误待处理');

-- 问题件 (3 条)
INSERT INTO tlv_issue_items (warehouse_id, merchant_id, sku, location, issue_type, severity, description, status, assigned_name, operator_name) VALUES
  ('57ae8979-c77f-4a88-b80a-113f01b5cbee', '7e3bf09f-3937-4891-a6f6-75941f39d1b2', 'SKU-001', 'A-01-01', 'wrong_qty', 'high', '实际清点少 2 件需补寄', 'open', NULL, 'wms@thalvior.dev'),
  ('57ae8979-c77f-4a88-b80a-113f01b5cbee', 'c657a6a3-0b47-4a01-bbf2-5a0ce40a08d5', 'SKU-002', 'B-02-02', 'damaged', 'critical', '外箱破损商品可能受损需全检', 'assigned', '张三', 'wms@thalvior.dev'),
  ('57ae8979-c77f-4a88-b80a-113f01b5cbee', '7e3bf09f-3937-4891-a6f6-75941f39d1b2', 'SKU-003', 'C-03-01', 'qc_failed', 'medium', '抽检发现 3 件外观划痕', 'processing', '李四', 'wms@thalvior.dev');
"""

cmd = f"docker exec supabase-db psql -U supabase_admin -d postgres -c {sql!r}"
stdin, stdout, stderr = ssh.exec_command(
    f"docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"SELECT tlv_calc_employee_performance('57ae8979-c77f-4a88-b80a-113f01b5cbee', now()::date - 30, now()::date);\"",
    timeout=15
)
func_test = stdout.read().decode()
err = stderr.read().decode()

# 直接把 SQL 写到文件然后 -f 执行
stdin2, stdout2, stderr2 = ssh.exec_command(f"docker exec -i supabase-db psql -U supabase_admin -d postgres << 'SQLDELIM'\n{sql}\nSQLDELIM", timeout=30)
print("=== Packages: ===")
p1 = stdout2.read().decode()
if p1: print(p1)
e1 = stderr2.read().decode()
if e1: print("ERR:", e1[:500])

print("\n=== 验证 counts: ===")
for t in ['tlv_packages', 'tlv_issue_items', 'tlv_customer_followups']:
    stdin3, stdout3, stderr3 = ssh.exec_command(
        f"docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"SELECT COUNT(*) FROM {t};\"")
    print(f"  {t}: {stdout3.read().decode().strip()}")

ssh.close()
print("\n🎉 Data seeded!")
