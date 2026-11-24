#!/usr/bin/env python3
"""真实库存盘点全链路 — 创建盘点单 → 录入差异 → 完成 → 验证结果"""
import socket, time, paramiko

def exec_psql(c, sql):
    cmd = f"""docker exec supabase-db psql -U supabase_admin -d postgres -t -A -F '|' -c "{sql.replace('"', '\\"')}" 2>&1"""
    stdin, stdout, _ = c.exec_command(cmd)
    return stdout.read().decode().strip()

def exec_psql_no_t(c, sql):
    cmd = f"""docker exec supabase-db psql -U supabase_admin -d postgres -c "{sql.replace('"', '\\"')}" 2>&1"""
    stdin, stdout, _ = c.exec_command(cmd)
    return stdout.read().decode().strip()

# --- connect ---
sock = socket.socket(); sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.connect(('127.0.0.1', 18080))
sock.sendall(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
buf = b''
while b'\r\n\r\n' not in buf:
    d = sock.recv(4096)
    if not d: break
    buf += d
time.sleep(0.5)
t = paramiko.Transport(sock); t.start_client(); t.auth_password('ubuntu', 'yuan340364#')
c = paramiko.SSHClient(); c._transport = t

# =========================================================
# 0. 快照
# =========================================================
print("═══ 0. 盘点前快照 ═══")
inv_before = exec_psql(c, "SELECT sku, location, qty_on_hand, qty_reserved, merchant_id FROM tlv_merchant_inventory ORDER BY sku")
print(f"inventory rows:\n{inv_before}")

items_before = exec_psql(c, "SELECT count(*) FROM tlv_stock_take_items")
logs_before = exec_psql(c, "SELECT count(*) FROM tlv_inventory_logs")
print(f"stock_take_items before: {items_before}")
print(f"inventory_logs before: {logs_before}")

# =========================================================
# 1. 全量盘点表 — 24 张 tlv_* 表 row count
# =========================================================
print("\n═══ 1. 24 张 tlv_* 表盘点 ═══")
all_tables = exec_psql(c, """
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND table_name LIKE 'tlv_%' ORDER BY table_name
""").split('\n')

total_rows = 0
for tbl in all_tables:
    if not tbl.strip(): continue
    cnt = exec_psql(c, f"SELECT count(*) FROM {tbl}")
    cnt = int(cnt) if cnt.isdigit() else 0
    total_rows += cnt
    print(f"  {tbl:32s}  {cnt:>6} rows")
print(f"  {'─'*42}")
print(f"  {'TOTAL':32s}  {total_rows:>6} rows")

# =========================================================
# 2. 创建库存盘点单（动态）+ 从当前 inventory 快照自动生成 items
# =========================================================
print("\n═══ 2. 创建动态盘点单 ═══")
wid = exec_psql(c, "SELECT id FROM tlv_warehouses LIMIT 1")
ctx = exec_psql(c, "SELECT merchant_id, sku, location, qty_on_hand FROM tlv_merchant_inventory WHERE qty_on_hand > 0")
print(f"warehouse_id: {wid}")
print(f"inventory to snapshot:\n{ctx}")

# 创建盘点单
sql_create = f"""
INSERT INTO tlv_stock_takes (warehouse_id, type, status, operator_name, note, total_rows)
VALUES ('{wid}', 'dynamic', 'in_progress', 'admin@thalvior.dev', '实时全仓盘点（带差异模拟）',
  (SELECT count(*) FROM tlv_merchant_inventory WHERE qty_on_hand > 0))
RETURNING id;
"""
take_id = exec_psql(c, sql_create)
print(f"盘点单 id: {take_id}")

# 从 inventory 自动生成 items
sql_items = f"""
INSERT INTO tlv_stock_take_items (stock_take_id, merchant_id, sku, location, system_qty, counted_qty, row_no, product_id)
SELECT
  '{take_id}'::uuid,
  merchant_id,
  sku,
  location,
  qty_on_hand,
  qty_on_hand,  -- 先假设实盘=系统
  row_number() over (order by sku, location),
  product_id
FROM tlv_merchant_inventory
WHERE warehouse_id = '{wid}' AND qty_on_hand > 0;
"""
r = exec_psql_no_t(c, sql_items)
print(f"自动生成 items: {r.split('INSERT')[0]}")

# =========================================================
# 3. 制造差异 — 模拟盘点人录入实盘数与系统不同
#    SKU-001 location A-01-01: 系统 100 → 实盘 98（丢了 2 件）
#    SKU-001 location A-01-02: 系统 100 → 实盘 105（多了 5 件）
#    目的：测试 adjust 流程是否正确调回 inventory
# =========================================================
print("\n═══ 3. 录入差异（模拟盘点） ═══")
sql_diff = f"""
UPDATE tlv_stock_take_items SET counted_qty = system_qty - 2, adjusted = true
WHERE stock_take_id = '{take_id}' AND location = 'A-01-01';

UPDATE tlv_stock_take_items SET counted_qty = system_qty + 5, adjusted = true
WHERE stock_take_id = '{take_id}' AND location = 'A-01-02';

UPDATE tlv_stock_take_items SET adjusted = true
WHERE stock_take_id = '{take_id}' AND location NOT IN ('A-01-01', 'A-01-02');
"""
r = exec_psql_no_t(c, sql_diff)

print("盘点 items（带 diff）：")
diff_show = exec_psql(c, f"""
SELECT sku, location, system_qty, counted_qty, counted_qty - system_qty AS diff, adjusted
FROM tlv_stock_take_items WHERE stock_take_id = '{take_id}' ORDER BY row_no
""")
print(diff_show)

# =========================================================
# 4. 完成盘点 — adjust=true 的行自动调回 inventory + 写 inventory_logs
# =========================================================
print("\n═══ 4. 完成盘点（自动调回 inventory） ═══")

# 4a. 对 adjusted=true 的行 → UPDATE inventory
sql_adjust = f"""
DO $$ DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM tlv_stock_take_items WHERE stock_take_id = '{take_id}' AND adjusted LOOP
    UPDATE tlv_merchant_inventory mi
    SET qty_on_hand = r.counted_qty,
        last_updated = now()
    WHERE mi.warehouse_id = '{wid}'
      AND mi.merchant_id = r.merchant_id
      AND mi.sku = r.sku
      AND mi.location = r.location;
  END LOOP;
END $$;
"""
exec_psql_no_t(c, sql_adjust)

# 4b. 更新盘点单状态
sql_final = f"""
UPDATE tlv_stock_takes t
SET status = 'completed',
    matched_rows = (SELECT count(*) FROM tlv_stock_take_items i WHERE i.stock_take_id = t.id AND i.system_qty = i.counted_qty),
    diff_rows = (SELECT count(*) FROM tlv_stock_take_items i WHERE i.stock_take_id = t.id AND i.system_qty <> i.counted_qty),
    adjusted_qty = (SELECT sum(abs(counted_qty - system_qty)) FROM tlv_stock_take_items i WHERE i.stock_take_id = t.id),
    completed_at = now()
WHERE t.id = '{take_id}';
"""
exec_psql_no_t(c, sql_final)

# =========================================================
# 5. 验证
# =========================================================
print("\n═══ 5. 验证结果 ═══")

print("盘点单完成状态：")
print(exec_psql(c, f"""SELECT id::text, status, total_rows, matched_rows, diff_rows, adjusted_qty, completed_at
FROM tlv_stock_takes WHERE id = '{take_id}'"""))

print("\ninventory（调整后，对比前快照）：")
print("BEFORE:  " + inv_before.replace('\n', '\nAFTER:  '))
print("AFTER:  " + exec_psql(c, "SELECT sku, location, qty_on_hand, qty_reserved FROM tlv_merchant_inventory ORDER BY sku"))

print("\ninventory_logs（trigger 自动生成的变动记录）：")
print(exec_psql(c, f"""SELECT change_type, sku, location, qty_change, qty_before, qty_after, operator_note, created_at
FROM tlv_inventory_logs WHERE created_at > now() - interval '2 minutes' ORDER BY created_at"""))

print(f"\ninventory_logs before={logs_before}  after={exec_psql(c, 'SELECT count(*) FROM tlv_inventory_logs')}  (+{int(exec_psql(c, 'SELECT count(*) FROM tlv_inventory_logs')) - int(logs_before)})")

# =========================================================
# 6. COD 结算流程演示
# =========================================================
print("\n═══ 6. COD 结算流程验证 ═══")

# 找 1 笔 COD 订单
cod_order = exec_psql(c, "SELECT id FROM tlv_outbound_orders WHERE is_cod = true LIMIT 1")
if cod_order:
    exec_psql_no_t(c, f"""
INSERT INTO tlv_cod_settlements (merchant_id, warehouse_id, outbound_ids, order_count, cod_total, fee_amount, net_amount, fee_pct, status)
SELECT merchant_id, warehouse_id, ARRAY[id], 1, cod_amount, ROUND(cod_amount * 0.03, 2), ROUND(cod_amount * 0.97, 2), 3.00, 'pending_warehouse'
FROM tlv_outbound_orders WHERE id = '{cod_order}';
""")
    settle_id = exec_psql(c, f"SELECT id FROM tlv_cod_settlements WHERE outbound_ids = ARRAY['{cod_order}'::uuid] ORDER BY created_at DESC LIMIT 1")
    print(f"COD 结算单: {settle_id}")

    # 仓库审批
    exec_psql_no_t(c, f"UPDATE tlv_cod_settlements SET status='pending_admin', warehouse_approved_at=now() WHERE id='{settle_id}'")
    # 平台审批
    exec_psql_no_t(c, f"UPDATE tlv_cod_settlements SET status='pending_pay', admin_approved_at=now() WHERE id='{settle_id}'")
    # 打款：recharge net_amount + adjustment -fee
    exec_psql_no_t(c, f"""
INSERT INTO tlv_merchant_wallets (merchant_id, type, amount, transaction_id, note)
SELECT merchant_id, 'recharge', net_amount, 'COD-SETTLE-' || left(id::text, 8), 'COD 代收结算'
FROM tlv_cod_settlements WHERE id = '{settle_id}';

INSERT INTO tlv_merchant_wallets (merchant_id, type, amount, transaction_id, note)
SELECT merchant_id, 'adjustment', -fee_amount, 'COD-FEE-' || left(id::text, 8), 'COD 代收手续费 3%'
FROM tlv_cod_settlements WHERE id = '{settle_id}';

UPDATE tlv_cod_settlements SET status='paid', paid_at=now() WHERE id='{settle_id}';
""")
    print("COD 结算单状态: " + exec_psql(c, f"SELECT id::text, status, cod_total, fee_amount, net_amount, paid_at FROM tlv_cod_settlements WHERE id = '{settle_id}'"))
    print("钱包新增流水:")
    print(exec_psql(c, f"SELECT type, amount, transaction_id, note, created_at FROM tlv_merchant_wallets WHERE transaction_id LIKE 'COD-%'"))
else:
    print("无 COD 订单，跳过 COD 结算演示")

c.close()
print("\n✅ 盘点全链路完成")
