import socket, time, paramiko

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
    if err and 'NOTICE' not in err and 'psql:' not in err:
        print('STDERR:', err[:500])

# ============================================================
# A. 容器健康度
# ============================================================
run("A. 容器整体",
    "docker ps --format 'table {{.Names}}\t{{.Status}}'")

# ============================================================
# B. DB 表行数统计
# ============================================================
tables_to_count = [
    'tlv_merchants', 'tlv_warehouses', 'tlv_merchant_products',
    'tlv_merchant_inventory', 'tlv_inbound_orders', 'tlv_inbound_items',
    'tlv_outbound_orders', 'tlv_outbound_items', 'tlv_outbound_operations',
    'tlv_merchant_wallets', 'tlv_merchant_shops', 'tlv_platforms',
    'tlv_inventory_logs', 'tlv_billing_rules', 'tlv_stock_takes',
    'tlv_stock_take_items', 'tlv_employees', 'tlv_packages',
    'tlv_package_logs', 'tlv_pick_lists', 'tlv_pick_list_items',
    'tlv_flow_nodes', 'tlv_issue_items', 'tlv_label_templates',
    'tlv_logistics_tracking', 'tlv_platform_sync_logs', 'tlv_warehouse_flows',
    'tlv_cod_settlements', 'tlv_wallet_topup_orders', 'tlv_customer_followups',
]
count_sql = " SELECT '" + tables_to_count[0] + "' as tbl, count(*) FROM " + tables_to_count[0]
for t in tables_to_count[1:]:
    count_sql += " UNION ALL SELECT '" + t + "', count(*) FROM " + t
run("B. DB 30 张表行数", "docker exec supabase-db psql -U postgres -c \"" + count_sql + "\"")

# ============================================================
# C. Triggers + RPCs
# ============================================================
run("C1. 自定义 Triggers",
    "docker exec supabase-db psql -U postgres -c \"SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE tgname NOT LIKE 'RI_%' AND tgrelid::regclass::text LIKE 'tlv_%' ORDER BY tgrelid;\"")
run("C2. 自定义 RPCs",
    "docker exec supabase-db psql -U postgres -c \"SELECT proname FROM pg_proc WHERE proname LIKE 'tlv_%' OR proname IN ('calc_outbound_charge','charge','bpcharge');\"")

# ============================================================
# D. REST API 批量
# ============================================================
rest_cmds = []
for t in tables_to_count:
    rest_cmds.append("curl -s -H 'apikey: " + ANON + "' -H 'Authorization: Bearer " + ANON + "' '" + BASE + "/rest/v1/" + t + "?select=*&limit=1' | python3 -c 'import sys,json; d=json.load(sys.stdin); print(len(d), \"rows\")' 2>&1 | tail -1")
run("D. REST API 批量测试", "\n".join(["echo '--- REST API ---'"] + rest_cmds))

# ============================================================
# E. Edge Functions 逐个调用
# ============================================================
run("E1. generate-label-pdf",
    "OID=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT id FROM tlv_outbound_orders LIMIT 1;') && " +
    "curl -s -X POST " + BASE + "/functions/v1/generate-label-pdf " +
    "-H 'Content-Type: application/json' -H 'Authorization: Bearer " + ANON + "' " +
    "-d \"{\\\"outbound_id\\\": \\\"$OID\\\"}\" | " +
    "python3 -c 'import sys,json; d=json.load(sys.stdin); r=d.get(\"results\",[{}])[0]; print(\"ok=\",d.get(\"ok\"),\"svg=\",len(r.get(\"svg_base64\",\"\")),\"order=\",r.get(\"order_no\"))'")

run("E2. recharge-wallet +10",
    "curl -s -X POST " + BASE + "/functions/v1/recharge-wallet " +
    "-H 'Content-Type: application/json' -H 'Authorization: Bearer " + ANON + "' " +
    "-d '{\"merchant_id\": \"7e3bf09f-3937-4891-a6f6-75941f39d1b2\", \"amount\": 10}' && echo '' && " +
    "sleep 1 && docker exec supabase-db psql -U postgres -c \"SELECT balance FROM tlv_merchants WHERE id='7e3bf09f-3937-4891-a6f6-75941f39d1b2';\"")

run("E3. sync-tiktok-orders",
    "BEFORE=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT count(*) FROM tlv_outbound_orders;') && " +
    "curl -s -X POST " + BASE + "/functions/v1/sync-tiktok-orders " +
    "-H 'Content-Type: application/json' -H 'Authorization: Bearer " + ANON + "' " +
    "-d '{\"merchant_id\": \"7e3bf09f-3937-4891-a6f6-75941f39d1b2\"}' && echo '' && " +
    "AFTER=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT count(*) FROM tlv_outbound_orders;') && " +
    "echo \"before=$BEFORE after=$AFTER delta=$((AFTER-BEFORE))\"")

run("E4. sync-shopee-orders",
    "BEFORE=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT count(*) FROM tlv_outbound_orders;') && " +
    "curl -s -X POST " + BASE + "/functions/v1/sync-shopee-orders " +
    "-H 'Content-Type: application/json' -H 'Authorization: Bearer " + ANON + "' " +
    "-d '{\"merchant_id\": \"c657a6a3-0b47-4a01-bbf2-5a0ce40a08d5\"}' && echo '' && " +
    "AFTER=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT count(*) FROM tlv_outbound_orders;') && " +
    "echo \"before=$BEFORE after=$AFTER delta=$((AFTER-BEFORE))\"")

run("E5. sync-logistics-tracking",
    "OID=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT id FROM tlv_outbound_orders ORDER BY created_at DESC LIMIT 1;') && " +
    "BEFORE=$(docker exec supabase-db psql -U postgres -t -A -c \"SELECT count(*) FROM tlv_logistics_tracking WHERE outbound_id='\\$OID';\") && " +
    "curl -s -X POST " + BASE + "/functions/v1/sync-logistics-tracking " +
    "-H 'Content-Type: application/json' -H 'Authorization: Bearer " + ANON + "' " +
    "-d \"{\\\"outbound_id\\\": \\\"$OID\\\"}\" && echo '' && " +
    "AFTER=$(docker exec supabase-db psql -U postgres -t -A -c \"SELECT count(*) FROM tlv_logistics_tracking WHERE outbound_id='\\$OID';\") && " +
    "echo \"tracking: before=$BEFORE after=$AFTER\"")

run("E6. calc_outbound_charge RPC",
    "OID=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT id FROM tlv_outbound_orders LIMIT 1;') && " +
    "docker exec supabase-db psql -U postgres -c \"SELECT calc_outbound_charge('\\$OID'::uuid, 1.8) as fee_1_8kg;\"")

# ============================================================
# F. Trigger 端到端
# ============================================================
run("F1. Trigger: 订单创建自动算费",
    "docker exec -i supabase-db psql -U postgres << 'SQLEOF'\nINSERT INTO tlv_outbound_orders (warehouse_id, merchant_id, order_no, source, receiver_name, receiver_address, receiver_city, receiver_country, receiver_state, receiver_postal_code, merchant_name, is_cod, weight_kg)\nVALUES ('57ae8979-c77f-4a88-b80a-113f01b5cbee', '7e3bf09f-3937-4891-a6f6-75941f39d1b2', 'TRIGGER-VERIFY', 'api', 'Test Buyer', '123 Main St', 'LA', 'US', 'CA', '90001', 'Demo Merchant', false, 1.2)\nRETURNING id, status, estimated_fee, balance_deducted;\nSQLEOF")
run("F2. 清理测试订单",
    "docker exec supabase-db psql -U postgres -c \"DELETE FROM tlv_outbound_orders WHERE order_no='TRIGGER-VERIFY';\"")
run("F3. Trigger: 钱包→merchant 余额同步",
    "docker exec supabase-db psql -U postgres -c \"SELECT 'wallets_latest' as ref, balance_after FROM tlv_merchant_wallets WHERE merchant_id='7e3bf09f-3937-4891-a6f6-75941f39d1b2' ORDER BY created_at DESC LIMIT 1;\" && " +
    "docker exec supabase-db psql -U postgres -c \"SELECT 'merchants_balance' as ref, balance FROM tlv_merchants WHERE id='7e3bf09f-3937-4891-a6f6-75941f39d1b2';\"")

# ============================================================
# G. 订单状态分布
# ============================================================
run("G. 订单状态分布",
    "docker exec supabase-db psql -U postgres -c \"SELECT status, count(*) FROM tlv_outbound_orders GROUP BY status ORDER BY count(*) DESC;\"")

# ============================================================
# H. 前端 nginx
# ============================================================
run("H. 前端可访问",
    "curl -sI http://localhost/ 2>&1 | head -3")

ssh.close()
print("\n" + "=" * 60)
print("  完整验证结束")
print("=" * 60)
