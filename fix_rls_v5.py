#!/usr/bin/env python3
"""P0-1 v5: 分步执行，先定位哪个表/列有问题"""
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

# 先只做 svc policy，不 transaction
print('=== [Step 1: 先全部 ENABLE RLS] ===')
sql = "DO $$ DECLARE r RECORD; BEGIN FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'tlv_%' LOOP EXECUTE 'ALTER TABLE public.' || r.tablename || ' ENABLE ROW LEVEL SECURITY;'; END LOOP; END $$;"
stdin, stdout, stderr = ssh.exec_command("docker exec -i supabase-db psql -U postgres -d postgres", timeout=30)
stdin.write(sql)
stdin.channel.shutdown_write()
out = stdout.read().decode()
err = stderr.read().decode()
print(out, err[:200] if err else '')

print('\n=== [Step 2: 逐表 CREATE svc policy（有问题就停）] ===')
# 获取所有表名
stdin, stdout, stderr = ssh.exec_command(
    "docker exec supabase-db psql -U postgres -d postgres -At -c "
    "\"SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'tlv_%' ORDER BY tablename;\""
)
tables = stdout.read().decode().strip().split('\n')
print('表数量:', len(tables))

failed = []
for t in tables:
    if not t.strip(): continue
    safe_name = t.replace('tlv_', 'svc_')
    # 注意：DROP POLICY IF EXISTS + CREATE
    p = "DROP POLICY IF EXISTS " + safe_name + " ON public." + t + "; "
    p += "CREATE POLICY " + safe_name + " ON public." + t + " FOR ALL TO service_role USING (true) WITH CHECK (true);"
    stdin, stdout, stderr = ssh.exec_command(
        "docker exec -i supabase-db psql -U postgres -d postgres -c \"" + p.replace('"', '\\"') + "\"",
        timeout=15)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if err.strip() and 'NOTICE' not in err:
        print('  FAIL ' + t + ': ' + err.strip()[:150])
        failed.append(t)
    else:
        print('  OK   ' + t)

print('\n失败表:', failed)

print('\n=== [Step 3: 手动加 auth policy — 直接列出来而不是 DO $$] ===')
# 用分号分隔的 SQL 逐个 create，哪个出错就知道了
auth_policies = [
    # (表名, has_mid, has_wid)
    ('tlv_merchant_wallets', True, True),
    ('tlv_outbound_orders', True, True),
    ('tlv_inbound_orders', True, True),
    ('tlv_billings', True, True),
    ('tlv_merchant_inventory', True, True),
    ('tlv_merchant_shops', True, True),
    ('tlv_merchant_products', True, True),
    ('tlv_billing_rules', True, True),
    ('tlv_stock_takes', True, True),
    ('tlv_packages', True, True),
    ('tlv_pick_list_items', True, False),
    ('tlv_pick_lists', True, True),
    ('tlv_stock_take_items', True, False),
    ('tlv_wallet_topup_orders', True, False),
    ('tlv_inventory_logs', True, True),
    ('tlv_issue_items', True, True),
    ('tlv_customer_followups', True, True),
    ('tlv_cod_settlements', True, True),
    ('tlv_customer_profiles', True, True),
    ('tlv_low_stock_alerts', True, True),
    ('tlv_logistics_tracking', True, False),
    ('tlv_outbound_operations', False, True),
    ('tlv_inbound_items', False, True),
    ('tlv_outbound_items', False, True),
    ('tlv_merchants', False, True),
    ('tlv_employees', False, True),
    ('tlv_warehouse_flows', False, True),
    ('tlv_warehouse_settlements', False, True),
]

def build_policy(name, table, has_mid, has_wid):
    # USING clause
    parts = []
    if has_mid:
        parts.append("merchant_id::text = (auth.jwt() ->> 'merchant_id')")
        parts.append("merchant_id::text = (auth.jwt() ->> 'tenant_id')")
    if has_wid:
        parts.append("warehouse_id::text = (auth.jwt() ->> 'warehouse_id')")
    qual = '(' + ' OR '.join(parts) + ')'
    
    safe = 'auth_' + table.replace('tlv_', '')
    p = "DROP POLICY IF EXISTS " + safe + " ON public." + table + "; "
    p += "CREATE POLICY " + safe + " ON public." + table + " FOR ALL TO authenticated "
    p += "USING " + qual + " WITH CHECK " + qual + ";"
    return p

for t, mid, wid in auth_policies:
    sql_stmt = build_policy('auth', t, mid, wid)
    stdin, stdout, stderr = ssh.exec_command(
        "docker exec -i supabase-db psql -U postgres -d postgres -c \"" + sql_stmt.replace('"', '\\"') + "\"",
        timeout=15)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if err.strip() and 'NOTICE' not in err:
        print('  FAIL ' + t + ': ' + err.strip()[:150])
    else:
        print('  OK   ' + t + ' → ' + safe)

ssh.close()
print('\n✅ 逐步执行完毕')
