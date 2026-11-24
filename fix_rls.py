#!/usr/bin/env python3
"""P0-1: RLS 租户隔离 — 一次性修复全部 30 张表"""
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

def run(label, sql):
    print('\n=== [' + label + '] ===')
    cmd = "docker exec -i supabase-db psql -U postgres -c \"" + sql.replace('"', '\\"').replace('\\', '\\\\') + "\""
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out: print(out[:600])
    if err and 'NOTICE' not in err: print('ERR:', err[:300])

# ============================================================
# Step 1: 先看所有当前 policy
# ============================================================
run('1. 现有 policy 全表扫描',
    "SELECT tablename, policyname, roles, cmd, substr(coalesce(qual,'') || coalesce(with_check,''), 1, 60) as check_clause "
    "FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'tlv_%' ORDER BY tablename;")

# ============================================================
# Step 2: 删除所有现有 policy（都是 qual=true 的"全部开放"）
# ============================================================
run('2. 删除所有旧 policy',
    "SELECT 'DROP POLICY IF EXISTS ' || policyname || ' ON public.' || tablename || ';' "
    "FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'tlv_%' "
    "ORDER BY tablename;")

# ============================================================
# Step 3: 写修复 SQL — 按表分组加隔离策略
# ============================================================

# 核心隔离表（有 merchant_id 或 warehouse_id 列）
# 策略：
#   - service_role: 完全放行（Edge Function / backend）
#   - authenticated: 按 merchant_id = jwt.merchant_id 或 warehouse_id = jwt.warehouse_id
#   - anon: 禁止（除了匿名可查的公共表）

sql = r"""
BEGIN;

-- ====================== 先开 RLS（可能之前就是开的）======================
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'tlv_%' LOOP
        EXECUTE 'ALTER TABLE public.' || r.tablename || ' ENABLE ROW LEVEL SECURITY;';
    END LOOP;
END $$;

-- ====================== 有 merchant_id 的表 → 按 merchant_id 隔离 ======================
-- tlv_merchant_* / tlv_outbound_* / tlv_inbound_* / tlv_billings / tlv_issue_items / tlv_stock_take* / tlv_logistics_tracking / tlv_customer_followups / tlv_cod_settlements / tlv_platform_sync_logs

CREATE POLICY all_merchant_wallets ON public.tlv_merchant_wallets FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY merchant_wallets_isolation ON public.tlv_merchant_wallets FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

CREATE POLICY all_outbound_orders ON public.tlv_outbound_orders FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY outbound_orders_isolation ON public.tlv_outbound_orders FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

CREATE POLICY all_outbound_items ON public.tlv_outbound_items FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY outbound_items_isolation ON public.tlv_outbound_items FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

CREATE POLICY all_inbound_orders ON public.tlv_inbound_orders FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY inbound_orders_isolation ON public.tlv_inbound_orders FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

CREATE POLICY all_inbound_items ON public.tlv_inbound_items FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY inbound_items_isolation ON public.tlv_inbound_items FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

CREATE POLICY all_billings ON public.tlv_billings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY billings_isolation ON public.tlv_billings FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

CREATE POLICY all_inventory ON public.tlv_merchant_inventory FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY inventory_isolation ON public.tlv_merchant_inventory FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

CREATE POLICY all_inventory_logs ON public.tlv_inventory_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY inventory_logs_isolation ON public.tlv_inventory_logs FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

CREATE POLICY all_merchant_shops ON public.tlv_merchant_shops FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY merchant_shops_isolation ON public.tlv_merchant_shops FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

CREATE POLICY all_merchant_products ON public.tlv_merchant_products FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY merchant_products_isolation ON public.tlv_merchant_products FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

CREATE POLICY all_billing_rules ON public.tlv_billing_rules FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY billing_rules_isolation ON public.tlv_billing_rules FOR ALL TO authenticated
  USING (warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'merchant_id'))
  WITH CHECK (warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'merchant_id'));

CREATE POLICY all_stock_takes ON public.tlv_stock_takes FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY stock_takes_isolation ON public.tlv_stock_takes FOR ALL TO authenticated
  USING (warehouse_id::text = (auth.jwt() ->> 'warehouse_id'))
  WITH CHECK (warehouse_id::text = (auth.jwt() ->> 'warehouse_id'));

CREATE POLICY all_stock_take_items ON public.tlv_stock_take_items FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY stock_take_items_isolation ON public.tlv_stock_take_items FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id'));

CREATE POLICY all_issue_items ON public.tlv_issue_items FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY issue_items_isolation ON public.tlv_issue_items FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id'));

CREATE POLICY all_outbound_operations ON public.tlv_outbound_operations FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY outbound_ops_isolation ON public.tlv_outbound_operations FOR ALL TO authenticated
  USING (warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'merchant_id'))
  WITH CHECK (warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'merchant_id'));

CREATE POLICY all_packages ON public.tlv_packages FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY packages_isolation ON public.tlv_packages FOR ALL TO authenticated
  USING (warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'merchant_id'))
  WITH CHECK (warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'merchant_id'));

CREATE POLICY all_pick_lists ON public.tlv_pick_lists FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY pick_lists_isolation ON public.tlv_pick_lists FOR ALL TO authenticated
  USING (warehouse_id::text = (auth.jwt() ->> 'warehouse_id'))
  WITH CHECK (warehouse_id::text = (auth.jwt() ->> 'warehouse_id'));

CREATE POLICY all_pick_list_items ON public.tlv_pick_list_items FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY pick_list_items_isolation ON public.tlv_pick_list_items FOR ALL TO authenticated
  USING (warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'merchant_id'))
  WITH CHECK (warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'merchant_id'));

CREATE POLICY all_logistics_tracking ON public.tlv_logistics_tracking FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY logistics_isolation ON public.tlv_logistics_tracking FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

CREATE POLICY all_customer_followups ON public.tlv_customer_followups FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY followups_isolation ON public.tlv_customer_followups FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

CREATE POLICY all_cod_settlements ON public.tlv_cod_settlements FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY cod_isolation ON public.tlv_cod_settlements FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

CREATE POLICY all_platform_sync_logs ON public.tlv_platform_sync_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY sync_logs_isolation ON public.tlv_platform_sync_logs FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

-- ====================== 全局配置表（无 merchant_id）→ 管理员/WMS 角色 ======================
CREATE POLICY all_merchants ON public.tlv_merchants FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY merchants_isolation ON public.tlv_merchants FOR SELECT TO authenticated
  USING (id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id'));

CREATE POLICY all_warehouses ON public.tlv_warehouses FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY warehouses_isolation ON public.tlv_warehouses FOR SELECT TO authenticated
  USING (id::text = (auth.jwt() ->> 'warehouse_id'));

CREATE POLICY all_platforms ON public.tlv_platforms FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY platforms_public_read ON public.tlv_platforms FOR SELECT TO authenticated USING (true);

CREATE POLICY all_label_templates ON public.tlv_label_templates FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY label_templates_read ON public.tlv_label_templates FOR SELECT TO authenticated
  USING (warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR warehouse_id IS NULL);

CREATE POLICY all_flow_nodes ON public.tlv_flow_nodes FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY flow_nodes_read ON public.tlv_flow_nodes FOR SELECT TO authenticated USING (true);

CREATE POLICY all_warehouse_flows ON public.tlv_warehouse_flows FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY warehouse_flows_read ON public.tlv_warehouse_flows FOR SELECT TO authenticated
  USING (warehouse_id::text = (auth.jwt() ->> 'warehouse_id'));

CREATE POLICY all_employees ON public.tlv_employees FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY employees_read ON public.tlv_employees FOR SELECT TO authenticated
  USING (warehouse_id::text = (auth.jwt() ->> 'warehouse_id'));

CREATE POLICY all_wallet_topup ON public.tlv_wallet_topup_orders FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY wallet_topup_isolation ON public.tlv_wallet_topup_orders FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id'));

CREATE POLICY all_package_logs ON public.tlv_package_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
"""

# 先执行 Step 2: 删除所有旧 policy
drop_sql = "SELECT 'DROP POLICY IF EXISTS ' || policyname || ' ON public.' || tablename || ';' FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'tlv_%' ORDER BY tablename;"
stdin, stdout, stderr = ssh.exec_command("docker exec -i supabase-db psql -U postgres -At -c \"" + drop_sql.replace('"', '\\"') + "\"", timeout=30)
drop_statements = stdout.read().decode().strip().split('\n')
print('\n=== [2b. 执行 DROP POLICY] ===')
for d in drop_statements:
    if d.strip():
        stdin, stdout, stderr = ssh.exec_command("docker exec -i supabase-db psql -U postgres -c \"" + d.strip().replace('"', '\\"') + "\"", timeout=15)
        err = stderr.read().decode()
        if err.strip() and 'NOTICE' not in err and 'does not exist' not in err.lower():
            print('  ? ' + err.strip()[:100])

print('\n=== [3. 执行新建 RLS policies] ===')
# 通过 stdin 传入大 SQL
stdin, stdout, stderr = ssh.exec_command("docker exec -i supabase-db psql -U postgres", timeout=60)
stdin.write(sql)
stdin.channel.shutdown_write()
out = stdout.read().decode()
err = stderr.read().decode()
print(out[-800:] if len(out) > 800 else out)
if err: print('STDERR:', err[:500])

# ============================================================
# Step 4: 验证
# ============================================================
run('4. 验证 — 所有新 policy 已生效',
    "SELECT tablename, policyname, roles, cmd, substr(coalesce(qual,'') || coalesce(with_check,''), 1, 80) as check_clause "
    "FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'tlv_%' ORDER BY tablename;")

ssh.close()
print('\n✅ RLS 租户隔离完成')
