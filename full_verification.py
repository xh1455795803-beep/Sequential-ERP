import socket, time, paramiko, json

proxy = socket.socket()
proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
resp = b''
while b'\r\n\r\n' not in resp:
    chunk = proxy.recv(4096)
    if not chunk: break
    resp += chunk
time.sleep(0.8)

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('43.133.232.81', username='ubuntu', password='yuan340364#', sock=proxy)

ANON = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw'
BASE = 'https://thalvior.icu'

def run(label, cmd):
    print('\n[' + label + ']')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=60)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out:
        print(out[:1200])
    if err and not err.startswith('NOTICE'):
        print('STDERR:', err[:500])

# ============================================================
# A. 容器整体健康度
# ============================================================
run("A1. 所有容器", 
    "docker ps --format 'table {{.Names}}\t{{.Status}}'")

# ============================================================
# B. DB: 全部 35 张表 × 行数
# ============================================================
run("B1. DB 全部表行数", 
    "docker exec supabase-db psql -U postgres -c \"SELECT 'tlv_merchants' as tbl, count(*) FROM tlv_merchants UNION ALL SELECT 'tlv_warehouses', count(*) FROM tlv_warehouses UNION ALL SELECT 'tlv_merchant_products', count(*) FROM tlv_merchant_products UNION ALL SELECT 'tlv_merchant_inventory', count(*) FROM tlv_merchant_inventory UNION ALL SELECT 'tlv_inbound_orders', count(*) FROM tlv_inbound_orders UNION ALL SELECT 'tlv_inbound_items', count(*) FROM tlv_inbound_items UNION ALL SELECT 'tlv_outbound_orders', count(*) FROM tlv_outbound_orders UNION ALL SELECT 'tlv_outbound_items', count(*) FROM tlv_outbound_items UNION ALL SELECT 'tlv_outbound_operations', count(*) FROM tlv_outbound_operations UNION ALL SELECT 'tlv_merchant_wallets', count(*) FROM tlv_merchant_wallets UNION ALL SELECT 'tlv_merchant_shops', count(*) FROM tlv_merchant_shops UNION ALL SELECT 'tlv_platforms', count(*) FROM tlv_platforms UNION ALL SELECT 'tlv_inventory_logs', count(*) FROM tlv_inventory_logs UNION ALL SELECT 'tlv_billing_rules', count(*) FROM tlv_billing_rules UNION ALL SELECT 'tlv_stock_takes', count(*) FROM tlv_stock_takes UNION ALL SELECT 'tlv_stock_take_items', count(*) FROM tlv_stock_take_items UNION ALL SELECT 'tlv_employees', count(*) FROM tlv_employees UNION ALL SELECT 'tlv_packages', count(*) FROM tlv_packages UNION ALL SELECT 'tlv_package_logs', count(*) FROM tlv_package_logs UNION ALL SELECT 'tlv_pick_lists', count(*) FROM tlv_pick_lists UNION ALL SELECT 'tlv_pick_list_items', count(*) FROM tlv_pick_list_items UNION ALL SELECT 'tlv_flow_nodes', count(*) FROM tlv_flow_nodes UNION ALL SELECT 'tlv_issue_items', count(*) FROM tlv_issue_items UNION ALL SELECT 'tlv_label_templates', count(*) FROM tlv_label_templates UNION ALL SELECT 'tlv_logistics_tracking', count(*) FROM tlv_logistics_tracking UNION ALL SELECT 'tlv_platform_sync_logs', count(*) FROM tlv_platform_sync_logs UNION ALL SELECT 'tlv_warehouse_flows', count(*) FROM tlv_warehouse_flows UNION ALL SELECT 'tlv_cod_settlements', count(*) FROM tlv_cod_settlements UNION ALL SELECT 'tlv_wallet_topup_orders', count(*) FROM tlv_wallet_topup_orders UNION ALL SELECT 'tlv_customer_followups', count(*) FROM tlv_customer_followups;\" 2>&1")

# ============================================================
# C. DB: Triggers + RPCs 完整性
# ============================================================
run("C1. Triggers", 
    "docker exec supabase-db psql -U postgres -c \"SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE tgname NOT LIKE 'RI_%' AND tgname NOT LIKE 'pg_%' AND tgrelid::regclass::text LIKE 'tlv_%' ORDER BY tgrelid;\"")
run("C2. RPCs", 
    "docker exec supabase-db psql -U postgres -c \"SELECT proname FROM pg_proc WHERE proname LIKE 'tlv_%' OR proname IN ('calc_outbound_charge','charge','bpcharge','admin_topup_quota_recharge');\"")

# ============================================================
# D. REST API: 每个页面查的表
# ============================================================
tables = [
    'tlv_merchants', 'tlv_warehouses', 'tlv_billing_rules', 
    'tlv_merchant_inventory', 'tlv_merchant_products',
    'tlv_inbound_orders', 'tlv_inbound_items',
    'tlv_outbound_orders', 'tlv_outbound_items', 'tlv_outbound_operations',
    'tlv_merchant_wallets', 'tlv_merchant_shops',
    'tlv_stock_takes', 'tlv_stock_take_items',
    'tlv_employees',
    'tlv_packages', 'tlv_pick_lists', 'tlv_pick_list_items',
    'tlv_flow_nodes', 'tlv_warehouse_flows',
    'tlv_issue_items', 'tlv_customer_followups',
    'tlv_label_templates',
    'tlv_logistics_tracking', 'tlv_platforms',
]

# Batch REST tests via one curl call with python summary
rest_cmd = "echo '--- REST API 批量测试 ---'\n"
for t in tables:
    rest_cmd += f"echo -n '{t}: ' && curl -s -H 'apikey: {ANON}' -H 'Authorization: Bearer {ANON}' '{BASE}/rest/v1/{t}?select=*&limit=1' | python3 -c 'import sys,json; d=json.load(sys.stdin); print(len(d), \"rows\")' 2>&1 | tail -1\n"
run("D. REST API 每个表能否读到", rest_cmd)

# ============================================================
# E. Edge Functions: 逐个真实调用
# ============================================================
run("E1. generate-label-pdf (真实订单)",
    f"OID=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT id FROM tlv_outbound_orders LIMIT 1;') && curl -s -X POST {BASE}/functions/v1/generate-label-pdf -H 'Content-Type: application/json' -H 'Authorization: Bearer {ANON}' -d \"{{\\\"outbound_id\\\": \\\"$OID\\\"}}\" | python3 -c 'import sys,json; d=json.load(sys.stdin); r=d.get(\"results\",[{}])[0]; print(\"ok=\",d.get(\"ok\"),\"svg_len=\",len(r.get(\"svg_base64\",\"\")),\"order=\",r.get(\"order_no\"))'")

run("E2. recharge-wallet (merchant1 +10)",
    f"curl -s -X POST {BASE}/functions/v1/recharge-wallet -H 'Content-Type: application/json' -H 'Authorization: Bearer {ANON}' -d '{{\"merchant_id\": \"7e3bf09f-3937-4891-a6f6-75941f39d1b2\", \"amount\": 10}}' && echo '' && sleep 1 && docker exec supabase-db psql -U postgres -c \"SELECT balance FROM tlv_merchants WHERE id='7e3bf09f-3937-4891-a6f6-75941f39d1b2';\"")

run("E3. sync-tiktok-orders (真实调用)",
    f"BEFORE=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT count(*) FROM tlv_outbound_orders;') && curl -s -X POST {BASE}/functions/v1/sync-tiktok-orders -H 'Content-Type: application/json' -H 'Authorization: Bearer {ANON}' -d '{{\"merchant_id\": \"7e3bf09f-3937-4891-a6f6-75941f39d1b2\"}}' && echo '' && AFTER=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT count(*) FROM tlv_outbound_orders;') && echo \"orders: before=$BEFORE after=$AFTER delta=$((AFTER-BEFORE))\"")

run("E4. sync-shopee-orders",
    f"BEFORE=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT count(*) FROM tlv_outbound_orders;') && curl -s -X POST {BASE}/functions/v1/sync-shopee-orders -H 'Content-Type: application/json' -H 'Authorization: Bearer {ANON}' -d '{{\"merchant_id\": \"c657a6a3-0b47-4a01-bbf2-5a0ce40a08d5\"}}' && echo '' && AFTER=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT count(*) FROM tlv_outbound_orders;') && echo \"orders: before=$BEFORE after=$AFTER delta=$((AFTER-BEFORE))\"")

run("E5. sync-logistics-tracking (真实订单)",
    f"OID=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT id FROM tlv_outbound_orders ORDER BY created_at DESC LIMIT 1;') && BEFORE=$(docker exec supabase-db psql -U postgres -t -A -c \"SELECT count(*) FROM tlv_logistics_tracking WHERE outbound_id='$OID';\") && curl -s -X POST {BASE}/functions/v1/sync-logistics-tracking -H 'Content-Type: application/json' -H 'Authorization: Bearer {ANON}' -d \"{{\\\"outbound_id\\\": \\\"$OID\\\"}}\" && echo '' && AFTER=$(docker exec supabase-db psql -U postgres -t -A -c \"SELECT count(*) FROM tlv_logistics_tracking WHERE outbound_id='$OID';\") && echo \"tracking: before=$BEFORE after=$AFTER\"")

# ============================================================
# F. DB Trigger 端到端验证
# ============================================================
run("F1. Trigger: 创建订单 → 自动算费 + 余额检查",
    "docker exec -i supabase-db psql -U postgres << 'SQLEOF'\nINSERT INTO tlv_outbound_orders (warehouse_id, merchant_id, order_no, source, receiver_name, receiver_address, receiver_city, receiver_country, receiver_state, receiver_postal_code, merchant_name, is_cod, weight_kg)\nVALUES ('57ae8979-c77f-4a88-b80a-113f01b5cbee', '7e3bf09f-3937-4891-a6f6-75941f39d1b2', 'TRIGGER-TEST-001', 'api', 'Test Buyer', '123 Main St', 'LA', 'US', 'CA', '90001', 'Demo Merchant', false, 1.2)\nRETURNING id, status, estimated_fee, balance_deducted;\nSQLEOF")
run("F2. 清理测试订单",
    "docker exec supabase-db psql -U postgres -c \"DELETE FROM tlv_outbound_orders WHERE order_no LIKE 'TRIGGER-TEST%';\"")

run("F3. Trigger: 钱包 INSERT → merchants.balance 自动同步",
    "docker exec supabase-db psql -U postgres -c \"SELECT 'wallets_latest' as src, balance_after FROM tlv_merchant_wallets WHERE merchant_id='7e3bf09f-3937-4891-a6f6-75941f39d1b2' ORDER BY created_at DESC LIMIT 1; SELECT 'merchants' as src, balance FROM tlv_merchants WHERE id='7e3bf09f-3937-4891-a6f6-75941f39d1b2';\"")

# ============================================================
# G. 订单状态流转（真实）
# ============================================================
run("G. 订单状态分布",
    "docker exec supabase-db psql -U postgres -c \"SELECT status, count(*) FROM tlv_outbound_orders GROUP BY status ORDER BY count(*) DESC;\"")

# ============================================================
# H. 前端静态资源检查
# ============================================================
run("H. 前端部署 + 可访问",
    "curl -sI http://localhost/ 2>&1 | head -3 && curl -s http://localhost/ 2>&1 | head -5")

ssh.close()
print("\n" + "=" * 60)
print("  END-TO-END 功能可用性验证完成")
print("=" * 60)
