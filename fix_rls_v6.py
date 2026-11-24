#!/usr/bin/env python3
"""P0-1 v6: auth policy 部分（svc 已全建好了）"""
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

auth_policies = [
    # (表名, has_mid, has_wid, FOR)
    ('tlv_merchant_wallets', True, True, 'ALL'),
    ('tlv_outbound_orders', True, True, 'ALL'),
    ('tlv_inbound_orders', True, True, 'ALL'),
    ('tlv_billings', True, True, 'ALL'),
    ('tlv_merchant_inventory', True, True, 'ALL'),
    ('tlv_merchant_shops', True, True, 'ALL'),
    ('tlv_merchant_products', True, True, 'ALL'),
    ('tlv_billing_rules', True, True, 'SELECT'),
    ('tlv_stock_takes', True, True, 'ALL'),
    ('tlv_packages', True, True, 'ALL'),
    ('tlv_pick_list_items', True, False, 'ALL'),
    ('tlv_pick_lists', True, True, 'ALL'),
    ('tlv_stock_take_items', True, False, 'ALL'),
    ('tlv_wallet_topup_orders', True, False, 'ALL'),
    ('tlv_inventory_logs', True, True, 'SELECT'),
    ('tlv_issue_items', True, True, 'ALL'),
    ('tlv_customer_followups', True, True, 'ALL'),
    ('tlv_cod_settlements', True, True, 'ALL'),
    ('tlv_customer_profiles', True, True, 'ALL'),
    ('tlv_low_stock_alerts', True, True, 'ALL'),
    ('tlv_logistics_tracking', True, False, 'ALL'),
    ('tlv_outbound_operations', False, True, 'ALL'),
    ('tlv_inbound_items', False, True, 'ALL'),
    ('tlv_outbound_items', False, True, 'ALL'),
    ('tlv_merchants', False, True, 'SELECT'),
    ('tlv_employees', False, True, 'SELECT'),
    ('tlv_warehouse_flows', False, True, 'SELECT'),
    ('tlv_warehouse_settlements', False, True, 'SELECT'),
    # 只有 wid 的全局表
    ('tlv_warehouses', False, False, 'SELECT'),
    ('tlv_platforms', False, False, 'SELECT'),
    ('tlv_flow_nodes', False, False, 'SELECT'),
    ('tlv_label_templates', False, False, 'SELECT'),
    ('tlv_logistics_providers', False, False, 'SELECT'),
    ('tlv_package_logs', False, False, 'SELECT'),
    ('tlv_platform_sync_logs', False, False, 'SELECT'),
]

ok = 0
fail = 0
for t, mid, wid, perm in auth_policies:
    if mid or wid:
        parts = []
        if mid:
            parts.append("merchant_id::text = (auth.jwt() ->> 'merchant_id')")
            parts.append("merchant_id::text = (auth.jwt() ->> 'tenant_id')")
        if wid:
            parts.append("warehouse_id::text = (auth.jwt() ->> 'warehouse_id')")
        qual = '(' + ' OR '.join(parts) + ')'
    else:
        qual = '(true)'  # 无隔离列的公开配置表
    
    safe = 'auth_' + t.replace('tlv_', '')
    p = "DROP POLICY IF EXISTS " + safe + " ON public." + t + "; "
    p += "CREATE POLICY " + safe + " ON public." + t + " FOR " + perm + " TO authenticated "
    p += "USING " + qual
    if perm == 'ALL':
        p += " WITH CHECK " + qual
    p += ";"
    
    stdin, stdout, stderr = ssh.exec_command(
        "docker exec -i supabase-db psql -U postgres -d postgres -c \"" + p.replace('"', '\\"') + "\"",
        timeout=15)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if err.strip() and 'NOTICE' not in err:
        print('  FAIL ' + t + ': ' + err.strip()[:120])
        fail += 1
    else:
        print('  OK   ' + t + ' → ' + safe)
        ok += 1

print('\n=== [最终统计: auth_policy OK=' + str(ok) + ' FAIL=' + str(fail) + '] ===')

# 验证总数
stdin, stdout, stderr = ssh.exec_command(
    "docker exec supabase-db psql -U postgres -d postgres -c "
    "\"SELECT count(*) as total_policies FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'tlv_%';\""
)
print(stdout.read().decode())

ssh.close()
print('✅ RLS 租户隔离 — 完成')
