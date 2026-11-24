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
ssh = paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('43.133.232.81', username='ubuntu', password='yuan340364#', sock=proxy)

# 补 label templates
sql = """INSERT INTO tlv_label_templates (platform_code, name, paper_size, format, is_default) VALUES
  ('tiktok',  'TikTok Shop 标准面单', '100x150mm', 'pdf',    true),
  ('shopee',  'Shopee 标准面单',      '100x150mm', 'pdf',    true),
  ('shopee',  'Shopee A6 热敏单',     '100x100mm', 'thermal',false),
  ('lazada',  'Lazada 标准面单',      '100x150mm', 'pdf',    true),
  ('ozon',    'Ozon 标准面单',        '100x150mm', 'pdf',    true),
  ('mercado', 'Mercado Libre 面单',   '100x150mm', 'pdf',    true);"""
_, out, err = ssh.exec_command(f"docker exec supabase-db psql -U supabase_admin -d postgres -c \"{sql}\"")
print("INSERT labels:", out.read().decode().strip(), "ERR:", err.read().decode().strip()[:200])

# 验证 low_stock_alerts
_, out, _ = ssh.exec_command("docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c 'SELECT COUNT(*) FROM tlv_low_stock_alerts'")
print("low_stock_alerts:", out.read().decode().strip())

# 测试 trigger: 模拟插入一条 outbound_order 看状态
_, out, _ = ssh.exec_command("""docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c "
INSERT INTO tlv_outbound_orders (merchant_id, warehouse_id, order_no, is_cod) VALUES
  ('7e3bf09f-3937-4891-a6f6-75941f39d1b2', '57ae8979-c77f-4a88-b80a-113f01b5cbee', 'TEST-BAL-001', false)
RETURNING status, estimated_fee, balance_deducted, merchant_note;
" """)
print("Trigger test (merchant1 bal=993):", out.read().decode().strip())

# merchant2 (bal=4979)
_, out, _ = ssh.exec_command("""docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c "
INSERT INTO tlv_outbound_orders (merchant_id, warehouse_id, order_no, is_cod) VALUES
  ('c657a6a3-0b47-4a01-bbf2-5a0ce40a08d5', '57ae8979-c77f-4a88-b80a-113f01b5cbee', 'TEST-BAL-002', false)
RETURNING status, estimated_fee, balance_deducted;
" """)
print("Trigger test (merchant2 bal=4979):", out.read().decode().strip())

# merchant1 的 current balance 确认
_, out, _ = ssh.exec_command("""docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c "
SELECT merchant_id, balance_after FROM tlv_merchant_wallets 
WHERE merchant_id IN ('7e3bf09f-3937-4891-a6f6-75941f39d1b2', 'c657a6a3-0b47-4a01-bbf2-5a0ce40a08d5') 
ORDER BY created_at DESC LIMIT 2;
" """)
print("钱包余额:", out.read().decode().strip())

# 清理测试单
_, out, _ = ssh.exec_command("""docker exec supabase-db psql -U supabase_admin -d postgres -c "
DELETE FROM tlv_outbound_items WHERE outbound_order_id IN (SELECT id FROM tlv_outbound_orders WHERE order_no LIKE 'TEST-BAL-%');
DELETE FROM tlv_outbound_orders WHERE order_no LIKE 'TEST-BAL-%';
" """)
print("测试单清理:", out.read().decode().strip())

ssh.close()
