#!/usr/bin/env python3
"""P0-1 v4: 基于真实列结构加 RLS — 不再撞墙"""
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

# 先全量开 RLS
sql = """
BEGIN;

-- ============== ENABLE RLS on all tlv_* ==============
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'tlv_%' LOOP
        EXECUTE 'ALTER TABLE public.' || r.tablename || ' ENABLE ROW LEVEL SECURITY;';
    END LOOP;
END $$;

-- ============== 所有表先给 service_role 全放行（Edge Functions 用这个身份）==============
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'tlv_%' LOOP
        EXECUTE format('CREATE POLICY %s_svc ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);',
            'svc_' || replace(r.tablename, 'tlv_', ''), r.tablename);
    END LOOP;
END $$;

-- ============== 有 merchant_id + warehouse_id 的表 (22 张) → 按其中一个匹配 ==============
CREATE POLICY auth_merchant_wallets ON public.tlv_merchant_wallets FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

CREATE POLICY auth_outbound_orders ON public.tlv_outbound_orders FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

CREATE POLICY auth_inbound_orders ON public.tlv_inbound_orders FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id'));

CREATE POLICY auth_billings ON public.tlv_billings FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id'));

CREATE POLICY auth_merchant_inventory ON public.tlv_merchant_inventory FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

CREATE POLICY auth_merchant_shops ON public.tlv_merchant_shops FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

CREATE POLICY auth_merchant_products ON public.tlv_merchant_products FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

CREATE POLICY auth_billing_rules ON public.tlv_billing_rules FOR SELECT TO authenticated
  USING (warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'merchant_id'));

CREATE POLICY auth_stock_takes ON public.tlv_stock_takes FOR ALL TO authenticated
  USING (warehouse_id::text = (auth.jwt() ->> 'warehouse_id'))
  WITH CHECK (warehouse_id::text = (auth.jwt() ->> 'warehouse_id'));

CREATE POLICY auth_packages ON public.tlv_packages FOR ALL TO authenticated
  USING (warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'merchant_id'))
  WITH CHECK (warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'merchant_id'));

CREATE POLICY auth_pick_list_items ON public.tlv_pick_list_items FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id'));

CREATE POLICY auth_pick_lists ON public.tlv_pick_lists FOR ALL TO authenticated
  USING (warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'merchant_id'))
  WITH CHECK (warehouse_id::text = (auth.jwt() ->> 'warehouse_id') OR merchant_id::text = (auth.jwt() ->> 'merchant_id'));

CREATE POLICY auth_stock_take_items ON public.tlv_stock_take_items FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id'));

CREATE POLICY auth_wallet_topup_orders ON public.tlv_wallet_topup_orders FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id'));

CREATE POLICY auth_inventory_logs ON public.tlv_inventory_logs FOR SELECT TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id'));

CREATE POLICY auth_issue_items ON public.tlv_issue_items FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id'));

CREATE POLICY auth_customer_followups ON public.tlv_customer_followups FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id'));

CREATE POLICY auth_cod_settlements ON public.tlv_cod_settlements FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id'));

CREATE POLICY auth_customer_profiles ON public.tlv_customer_profiles FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id'));

CREATE POLICY auth_low_stock_alerts ON public.tlv_low_stock_alerts FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR warehouse_id::text = (auth.jwt() ->> 'warehouse_id'));

-- ============== 只有 merchant_id 的表 ==============
CREATE POLICY auth_logistics_tracking ON public.tlv_logistics_tracking FOR ALL TO authenticated
  USING (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'))
  WITH CHECK (merchant_id::text = (auth.jwt() ->> 'merchant_id') OR merchant_id::text = (auth.jwt() ->> 'tenant_id'));

-- ============== 只有 warehouse_id 的表 ==============
CREATE POLICY auth_outbound_operations ON public.tlv_outbound_operations FOR ALL TO authenticated
  USING (warehouse_id::text = (auth.jwt() ->> 'warehouse_id'))
  WITH CHECK (warehouse_id::text = (auth.jwt() ->> 'warehouse_id'));

CREATE POLICY auth_inbound_items ON public.tlv_inbound_items FOR ALL TO authenticated
  USING (warehouse_id::text = (auth.jwt() ->> 'warehouse_id'))
  WITH CHECK (warehouse_id::text = (auth.jwt() ->> 'warehouse_id'));

CREATE POLICY auth_outbound_items ON public.tlv_outbound_items FOR ALL TO authenticated
  USING (warehouse_id::text = (auth.jwt() ->> 'warehouse_id'))
  WITH CHECK (warehouse_id::text = (auth.jwt() ->> 'warehouse_id'));

CREATE POLICY auth_merchants ON public.tlv_merchants FOR SELECT TO authenticated
  USING (warehouse_id::text = (auth.jwt() ->> 'warehouse_id'));

CREATE POLICY auth_employees ON public.tlv_employees FOR SELECT TO authenticated
  USING (warehouse_id::text = (auth.jwt() ->> 'warehouse_id'));

CREATE POLICY auth_warehouse_flows ON public.tlv_warehouse_flows FOR SELECT TO authenticated
  USING (warehouse_id::text = (auth.jwt() ->> 'warehouse_id'));

CREATE POLICY auth_warehouse_settlements ON public.tlv_warehouse_settlements FOR SELECT TO authenticated
  USING (warehouse_id::text = (auth.jwt() ->> 'warehouse_id'));

-- ============== 无 merchant_id 无 warehouse_id 的配置表 → 按 warehouse 或公开读 ==============
CREATE POLICY auth_warehouses ON public.tlv_warehouses FOR SELECT TO authenticated USING (true);
CREATE POLICY auth_platforms ON public.tlv_platforms FOR SELECT TO authenticated USING (true);
CREATE POLICY auth_flow_nodes ON public.tlv_flow_nodes FOR SELECT TO authenticated USING (true);
CREATE POLICY auth_label_templates ON public.tlv_label_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY auth_logistics_providers ON public.tlv_logistics_providers FOR SELECT TO authenticated USING (true);
CREATE POLICY auth_package_logs ON public.tlv_package_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY auth_platform_sync_logs ON public.tlv_platform_sync_logs FOR SELECT TO authenticated USING (true);

COMMIT;
"""

print('=== [执行精准 RLS SQL] ===')
stdin, stdout, stderr = ssh.exec_command("docker exec -i supabase-db psql -U postgres -d postgres", timeout=120)
stdin.write(sql)
stdin.channel.shutdown_write()
out = stdout.read().decode()
err = stderr.read().decode()
# 统计 CREATE POLICY 成功数
ok = out.count('CREATE POLICY')
rollback = 'ROLLBACK' in out
print('  CREATE POLICY x' + str(ok) + '  ROLLBACK=' + str(rollback))
if rollback:
    # 打印 ROLLBACK 前的最后一个 ERROR
    idx = err.rfind('ERROR:')
    if idx >= 0:
        print('  首个 ERROR:', err[idx:idx+200].replace('\n', ' '))
else:
    print('  ✅ 全部成功')

# 验证数量
stdin, stdout, stderr = ssh.exec_command(
    "docker exec supabase-db psql -U postgres -d postgres -c "
    "\"SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'tlv_%' ORDER BY tablename, policyname;\""
)
print('\n=== [最终 policy 清单] ===')
print(stdout.read().decode()[:3000])

ssh.close()
print('\n✅ P0-1 RLS 租户隔离 — DONE')
