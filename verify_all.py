#!/usr/bin/env python3
"""Thalvior ERP 全链路功能验证脚本 — 无 f-string 版，保证 100% 语法正确"""
import os, sys, time, socket, json
import paramiko

# ======== 配置 ========
HOST = '43.133.232.81'
USER = 'ubuntu'
PASS = 'yuan340364#'
PROXY = ('127.0.0.1', 18080)
BASE = 'https://thalvior.icu'
ANON = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw'

def connect():
    proxy = socket.socket()
    proxy.connect(PROXY)
    proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
    # Read until tunnel ready
    buf = b''
    while b'\r\n\r\n' not in buf:
        chunk = proxy.recv(4096)
        if not chunk: break
        buf += chunk
    time.sleep(0.5)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASS, sock=proxy)
    return ssh

def run(ssh, label, cmd, timeout=60):
    sep = '\n' + '='*60
    print(sep)
    print(' [' + label + ']')
    print('='*60)
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out:
        print(out[:1500])
    if err and 'NOTICE' not in err and 'psql:' not in err:
        print('STDERR:', err[:500])

def curl_json(url, method='GET', body=None, extra_headers=None):
    """在远程服务器上用 curl 请求，返回 (exit_code, stdout, stderr)"""
    header = '-H "apikey: ' + ANON + '" -H "Authorization: Bearer ' + ANON + '"'
    cmd = 'curl -s '
    if method == 'POST':
        cmd += '-X POST '
    cmd += header + ' '
    if extra_headers:
        cmd += extra_headers + ' '
    cmd += '"' + url + '"'
    if body is not None:
        cmd += " -d '" + json.dumps(body).replace("'", "'\\''") + "'"
    return cmd

# ======== 开始验证 ========
print('\n' + '#'*60)
print('  THALVIOR ERP — 完整功能可用性验证')
print('  ' + time.strftime('%Y-%m-%d %H:%M:%S'))
print('#'*60)

ssh = connect()
print('SSH connected: ' + HOST)

# ============================================================
# A. 容器整体健康度
# ============================================================
run(ssh, 'A. Docker 容器健康度',
    "docker ps --format 'table {{.Names}}\t{{.Status}}' | sort")

# ============================================================
# B. DB 30 张表 × 行数
# ============================================================
tables = [
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
count_parts = [" SELECT '" + t + "' as tbl, count(*) FROM " + t for t in tables]
count_sql = ' UNION ALL '.join(count_parts) + ' ORDER BY tbl'
run(ssh, 'B. DB 30 张表行数',
    'docker exec supabase-db psql -U postgres -c "' + count_sql + '"')

# ============================================================
# C. Triggers + RPCs
# ============================================================
run(ssh, 'C1. 自定义 Triggers',
    "docker exec supabase-db psql -U postgres -c \"" +
    "SELECT tgname, tgrelid::regclass FROM pg_trigger " +
    "WHERE tgname NOT LIKE 'RI_%' AND tgrelid::regclass::text LIKE 'tlv_%' " +
    "ORDER BY tgrelid;\"")

run(ssh, 'C2. 自定义 RPCs',
    "docker exec supabase-db psql -U postgres -c \"" +
    "SELECT proname FROM pg_proc " +
    "WHERE proname LIKE 'tlv_%' OR proname IN ('calc_outbound_charge','charge','bpcharge') " +
    "ORDER BY proname;\"")

# ============================================================
# D. REST API 批量探测（每张表 GET limit=1）
# ============================================================
rest_probe = ['echo "--- REST API 批量探测 ---"']
for t in tables:
    url = BASE + '/rest/v1/' + t + '?select=*&limit=1'
    hdr = '-H "apikey: ' + ANON + '" -H "Authorization: Bearer ' + ANON + '"'
    rest_probe.append("echo -n '" + t + ": '")
    rest_probe.append("curl -s " + hdr + " '" + url + "' | python3 -c 'import sys,json; d=json.load(sys.stdin); print(len(d), \"rows\")' 2>&1 | tail -1")
run(ssh, 'D. REST API 每张表能否读到数据', '\n'.join(rest_probe))

# ============================================================
# E. Edge Functions 逐个真实调用
# ============================================================

# E1. generate-label-pdf
run(ssh, 'E1. generate-label-pdf (真实订单)',
    "OID=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT id FROM tlv_outbound_orders LIMIT 1;') && " +
    "echo \"OID=$OID\" && " +
    "curl -s -X POST " + BASE + "/functions/v1/generate-label-pdf " +
    "-H 'Content-Type: application/json' -H 'Authorization: Bearer " + ANON + "' " +
    "-d '{\"outbound_id\": \"'\"$OID\"'\"}' " +
    "| python3 -c 'import sys,json; d=json.load(sys.stdin); r=d.get(\"results\",[{}])[0]; print(\"ok=\"+str(d.get(\"ok\")), \"svg=\"+str(len(r.get(\"svg_base64\",\"\"))), \"order=\"+str(r.get(\"order_no\")))'")

# E2. recharge-wallet
run(ssh, 'E2. recharge-wallet (+10 到 merchant1)',
    "BEFORE=$(docker exec supabase-db psql -U postgres -t -A -c \"SELECT balance FROM tlv_merchants WHERE id='7e3bf09f-3937-4891-a6f6-75941f39d1b2';\") && " +
    "echo \"merchant1 balance before=$BEFORE\" && " +
    "curl -s -X POST " + BASE + "/functions/v1/recharge-wallet " +
    "-H 'Content-Type: application/json' -H 'Authorization: Bearer " + ANON + "' " +
    "-d '{\"merchant_id\": \"7e3bf09f-3937-4891-a6f6-75941f39d1b2\", \"amount\": 10}' && echo '' && " +
    "sleep 1 && " +
    "AFTER=$(docker exec supabase-db psql -U postgres -t -A -c \"SELECT balance FROM tlv_merchants WHERE id='7e3bf09f-3937-4891-a6f6-75941f39d1b2';\") && " +
    "echo \"merchant1 balance after=$AFTER (should = $BEFORE + 10)\"")

# E3-E7. sync-* orders
sync_funcs = [
    ('sync-tiktok-orders', 'c657a6a3-0b47-4a01-bbf2-5a0ce40a08d5'),
    ('sync-shopee-orders', '7e3bf09f-3937-4891-a6f6-75941f39d1b2'),
    ('sync-lazada-orders', 'c657a6a3-0b47-4a01-bbf2-5a0ce40a08d5'),
    ('sync-ozon-orders', '7e3bf09f-3937-4891-a6f6-75941f39d1b2'),
    ('sync-mercado-orders', 'c657a6a3-0b47-4a01-bbf2-5a0ce40a08d5'),
]
for fname, mid in sync_funcs:
    run(ssh, 'E. ' + fname,
        "BEFORE=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT count(*) FROM tlv_outbound_orders;') && " +
        "curl -s -X POST " + BASE + "/functions/v1/" + fname + " " +
        "-H 'Content-Type: application/json' -H 'Authorization: Bearer " + ANON + "' " +
        "-d '{\"merchant_id\": \"" + mid + "\"}' && echo '' && " +
        "AFTER=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT count(*) FROM tlv_outbound_orders;') && " +
        "echo \"orders: before=$BEFORE after=$AFTER delta=$((AFTER-BEFORE))\"")

# E8. sync-logistics-tracking
run(ssh, 'E8. sync-logistics-tracking',
    "OID=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT id FROM tlv_outbound_orders ORDER BY created_at DESC LIMIT 1;') && " +
    "curl -s -X POST " + BASE + "/functions/v1/sync-logistics-tracking " +
    "-H 'Content-Type: application/json' -H 'Authorization: Bearer " + ANON + "' " +
    "-d '{\"outbound_id\": \"'\"$OID\"'\"}'")

# E9. calc_outbound_charge RPC (通过 REST)
run(ssh, 'E9. calc_outbound_charge RPC',
    "OID=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT id FROM tlv_outbound_orders LIMIT 1;') && " +
    "docker exec supabase-db psql -U postgres -c \"SELECT calc_outbound_charge('$OID'::uuid, 1.8) as fee_1_8kg;\"")

# ============================================================
# F. DB Trigger 端到端
# ============================================================

# F1. balance trigger —— 插入订单自动算费
run(ssh, 'F1. Trigger: 创建订单自动算费 + 余额检查',
    "docker exec -i supabase-db psql -U postgres << 'SQLEOF'\n" +
    "INSERT INTO tlv_outbound_orders (warehouse_id, merchant_id, order_no, source, receiver_name, receiver_address, receiver_city, receiver_country, receiver_state, receiver_postal_code, merchant_name, is_cod, weight_kg)\n" +
    "VALUES ('57ae8979-c77f-4a88-b80a-113f01b5cbee', '7e3bf09f-3937-4891-a6f6-75941f39d1b2', 'TRIGGER-VERIFY-V3', 'api', 'Test Buyer', '123 Main St', 'LA', 'US', 'CA', '90001', 'Demo Merchant', false, 1.2)\n" +
    "RETURNING id, status, estimated_fee, balance_deducted, merchant_note;\n" +
    "SQLEOF")

# F2. 清理
run(ssh, 'F2. 清理测试数据',
    "docker exec supabase-db psql -U postgres -c \"DELETE FROM tlv_outbound_orders WHERE order_no LIKE 'TRIGGER-VERIFY%';\"")

# F3. wallet sync trigger
run(ssh, 'F3. Trigger: 钱包 INSERT → merchants.balance 自动同步',
    "docker exec supabase-db psql -U postgres -c \"SELECT (SELECT balance_after FROM tlv_merchant_wallets WHERE merchant_id='7e3bf09f-3937-4891-a6f6-75941f39d1b2' ORDER BY created_at DESC LIMIT 1) as wallets_latest, (SELECT balance FROM tlv_merchants WHERE id='7e3bf09f-3937-4891-a6f6-75941f39d1b2') as merchants_balance;\"")

# F4. inventory_log trigger
run(ssh, 'F4. Trigger: inventory 变化自动写日志',
    "docker exec supabase-db psql -U postgres -c \"SELECT count(*) as inventory_log_count FROM tlv_inventory_logs;\"")

# ============================================================
# G. 订单状态分布
# ============================================================
run(ssh, 'G. 订单状态分布（全量）',
    "docker exec supabase-db psql -U postgres -c \"SELECT status, source, count(*) FROM tlv_outbound_orders GROUP BY status, source ORDER BY count(*) DESC;\"")

# 最新 6 条详细
run(ssh, 'G2. 最新 6 条订单详情',
    "docker exec supabase-db psql -U postgres -c \"SELECT order_no, source, platform, status, estimated_fee, balance_deducted FROM tlv_outbound_orders ORDER BY created_at DESC LIMIT 6;\"")

# ============================================================
# H. 前端可访问性
# ============================================================
run(ssh, 'H. Nginx 前端',
    "curl -sI http://localhost/ | head -3 && echo '---' && curl -s http://localhost/ | head -5")

# ============================================================
# 总结
# ============================================================
ssh.close()
print('\n' + '#'*60)
print('  ✅ 验证脚本执行完毕 — 无 f-string 语法错误')
print('  检查上方输出中各 [X] 章节状态')
print('#'*60)
