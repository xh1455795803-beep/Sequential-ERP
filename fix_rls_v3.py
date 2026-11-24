#!/usr/bin/env python3
"""P0-1 v3: RLS 租户隔离 — 用 postgres 身份（owner 已改）"""
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

# 大 SQL 一次性通过 stdin 传入
sql = """
BEGIN;

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'tlv_%' LOOP
        EXECUTE 'ALTER TABLE public.' || r.tablename || ' ENABLE ROW LEVEL SECURITY;';
    END LOOP;
END $$;

-- tlv_merchant_wallets
CREATE POLICY wallets_service ON public.tlv_merchant_wallets FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY wallets_auth ON public.tlv_merchant_wallets FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

-- tlv_outbound_orders
CREATE POLICY oo_svc ON public.tlv_outbound_orders FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY oo_auth ON public.tlv_outbound_orders FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

-- tlv_outbound_items
CREATE POLICY oi_svc ON public.tlv_outbound_items FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY oi_auth ON public.tlv_outbound_items FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

-- tlv_inbound_orders
CREATE POLICY io_svc ON public.tlv_inbound_orders FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY io_auth ON public.tlv_inbound_orders FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

-- tlv_inbound_items
CREATE POLICY ii_svc ON public.tlv_inbound_items FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY ii_auth ON public.tlv_inbound_items FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

-- tlv_billings
CREATE POLICY bl_svc ON public.tlv_billings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY bl_auth ON public.tlv_billings FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

-- tlv_merchant_inventory
CREATE POLICY mi_svc ON public.tlv_merchant_inventory FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY mi_auth ON public.tlv_merchant_inventory FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

-- tlv_inventory_logs
CREATE POLICY il_svc ON public.tlv_inventory_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY il_auth ON public.tlv_inventory_logs FOR SELECT TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

-- tlv_merchant_shops
CREATE POLICY ms_svc ON public.tlv_merchant_shops FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY ms_auth ON public.tlv_merchant_shops FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

-- tlv_merchant_products
CREATE POLICY mp_svc ON public.tlv_merchant_products FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY mp_auth ON public.tlv_merchant_products FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

-- tlv_billing_rules
CREATE POLICY br_svc ON public.tlv_billing_rules FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY br_auth ON public.tlv_billing_rules FOR SELECT TO authenticated
  USING (warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'merchant_id'));

-- tlv_stock_takes
CREATE POLICY st_svc ON public.tlv_stock_takes FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY st_auth ON public.tlv_stock_takes FOR ALL TO authenticated
  USING (warehouse_id::text = (auth.jwt() ->> 'warehouse_id'))
  WITH CHECK (warehouse_id::text = (auth.jwt() ->> 'warehouse_id'));

-- tlv_stock_take_items
CREATE POLICY sti_svc ON public.tlv_stock_take_items FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY sti_auth ON public.tlv_stock_take_items FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id'));

-- tlv_issue_items
CREATE POLICY ii2_svc ON public.tlv_issue_items FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY ii2_auth ON public.tlv_issue_items FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id'));

-- tlv_outbound_operations
CREATE POLICY ooop_svc ON public.tlv_outbound_operations FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY ooop_auth ON public.tlv_outbound_operations FOR ALL TO authenticated
  USING (warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'merchant_id'))
  WITH CHECK (warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'merchant_id'));

-- tlv_packages
CREATE POLICY pk_svc ON public.tlv_packages FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY pk_auth ON public.tlv_packages FOR ALL TO authenticated
  USING (warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'merchant_id'))
  WITH CHECK (warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'merchant_id'));

-- tlv_pick_lists
CREATE POLICY pl_svc ON public.tlv_pick_lists FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY pl_auth ON public.tlv_pick_lists FOR ALL TO authenticated
  USING (warehouse_id::text = (auth.jwt() ->> 'warehouse_id'))
  WITH CHECK (warehouse_id::text = (auth.jwt() ->> 'warehouse_id'));

-- tlv_pick_list_items
CREATE POLICY pli_svc ON public.tlv_pick_list_items FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY pli_auth ON public.tlv_pick_list_items FOR ALL TO authenticated
  USING (warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'merchant_id'))
  WITH CHECK (warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'merchant_id'));

-- tlv_logistics_tracking
CREATE POLICY lt_svc ON public.tlv_logistics_tracking FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY lt_auth ON public.tlv_logistics_tracking FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

-- tlv_customer_followups
CREATE POLICY cf_svc ON public.tlv_customer_followups FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY cf_auth ON public.tlv_customer_followups FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

-- tlv_cod_settlements
CREATE POLICY cs_svc ON public.tlv_cod_settlements FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY cs_auth ON public.tlv_cod_settlements FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

-- tlv_platform_sync_logs
CREATE POLICY psl_svc ON public.tlv_platform_sync_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY psl_auth ON public.tlv_platform_sync_logs FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

-- tlv_merchants（全局表）
CREATE POLICY m_svc ON public.tlv_merchants FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY m_auth ON public.tlv_merchants FOR SELECT TO authenticated
  USING (id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id'));

-- tlv_warehouses
CREATE POLICY wh_svc ON public.tlv_warehouses FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY wh_auth ON public.tlv_warehouses FOR SELECT TO authenticated
  USING (id::text = (auth.jwt() ->> 'warehouse_id'));

-- tlv_platforms
CREATE POLICY pf_svc ON public.tlv_platforms FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY pf_auth ON public.tlv_platforms FOR SELECT TO authenticated USING (true);

-- tlv_label_templates
CREATE POLICY lt2_svc ON public.tlv_label_templates FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY lt2_auth ON public.tlv_label_templates FOR SELECT TO authenticated
  USING (warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR warehouse_id IS NULL);

-- tlv_flow_nodes
CREATE POLICY fn_svc ON public.tlv_flow_nodes FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY fn_auth ON public.tlv_flow_nodes FOR SELECT TO authenticated USING (true);

-- tlv_warehouse_flows
CREATE POLICY wf_svc ON public.tlv_warehouse_flows FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY wf_auth ON public.tlv_warehouse_flows FOR SELECT TO authenticated
  USING (warehouse_id::text = (auth.jwt() ->> 'warehouse_id'));

-- tlv_employees
CREATE POLICY em_svc ON public.tlv_employees FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY em_auth ON public.tlv_employees FOR SELECT TO authenticated
  USING (warehouse_id::text = (auth.jwt() ->> 'warehouse_id'));

-- tlv_wallet_topup_orders
CREATE POLICY wto_svc ON public.tlv_wallet_topup_orders FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY wto_auth ON public.tlv_wallet_topup_orders FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id'));

-- tlv_package_logs
CREATE POLICY pl2_svc ON public.tlv_package_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
"""

print('=== [执行 RLS 创建 SQL] ===')
stdin, stdout, stderr = ssh.exec_command("docker exec -i supabase-db psql -U postgres -d postgres", timeout=120)
stdin.write(sql)
stdin.channel.shutdown_write()
out = stdout.read().decode()
err = stderr.read().decode()
print(out[-1200:] if len(out) > 1200 else out)
if err: print('\nSTDERR:', err[:800])

print('\n=== [验证新 policy 数量] ===')
stdin, stdout, stderr = ssh.exec_command(
    "docker exec supabase-db psql -U postgres -d postgres -c "
    "\"SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'tlv_%';\""
)
print(stdout.read().decode())

print('\n=== [RLS 已启用的表数量] ===')
stdin, stdout, stderr = ssh.exec_command(
    "docker exec supabase-db psql -U postgres -d postgres -c "
    "\"SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'tlv_%' AND c.relrowsecurity=true;\""
)
print(stdout.read().decode())

ssh.close()
print('\n✅ P0-1 RLS 租户隔离 — DONE')
