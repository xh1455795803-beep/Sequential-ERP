#!/usr/bin/env python3
"""盘点链路 — 修复版"""
import socket, time, paramiko, re

def run(c, sql):
    cmd = f"""docker exec supabase-db psql -U supabase_admin -d postgres -c "{sql.replace('"', '\\"')}" 2>&1"""
    stdin, stdout, _ = c.exec_command(cmd)
    return stdout.read().decode().strip()

def run_tA(c, sql):
    cmd = f"""docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c "{sql.replace('"', '\\"')}" 2>&1"""
    stdin, stdout, _ = c.exec_command(cmd)
    return stdout.read().decode().strip()

def get_take_id(c, sql):
    """从 INSERT ... RETURNING id 里干净地提取 UUID"""
    out = run_tA(c, sql)
    uuids = re.findall(r'[0-9a-f]{8}-[0-9a-f-]{27}', out, re.I)
    return uuids[0] if uuids else None

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

wid = run_tA(c, "SELECT id FROM tlv_warehouses LIMIT 1")
print(f"warehouse: {wid}")

# =========================================================
# 1. 全量盘点 24 张表
# =========================================================
print("\n═══ 24 张 tlv_* 表盘点 ═══")
all_tables = run_tA(c, """
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND table_name LIKE 'tlv_%' ORDER BY table_name
""").split('\n')

total_rows = 0
for tbl in all_tables:
    if not tbl.strip(): continue
    cnt = run_tA(c, f"SELECT count(*) FROM {tbl}")
    cnt = int(cnt) if cnt.isdigit() else 0
    total_rows += cnt
    print(f"  {tbl:32s}  {cnt:>6} rows")
print(f"  {'─'*42}")
print(f"  {'TOTAL':32s}  {total_rows:>6} rows")

# =========================================================
# 2. 库龄分析 + inventory 状态
# =========================================================
print("\n═══ INVENTORY 当前状态 ═══")
inv = run(c, f"SELECT sku, location, qty_on_hand, qty_reserved, merchant_id, first_in_at::date FROM tlv_merchant_inventory WHERE warehouse_id = '{wid}'")
print(inv)

# =========================================================
# 3. 创建动态盘点 + 生成 items + 录入差异 + 完成
# =========================================================
print("\n═══ 3. 动态盘点 ═══")

# 清理之前失败的 take（如果有）
run(c, f"DELETE FROM tlv_stock_take_items WHERE stock_take_id IN (SELECT id FROM tlv_stock_takes WHERE warehouse_id = '{wid}')")
run(c, f"DELETE FROM tlv_stock_takes WHERE warehouse_id = '{wid}'")

take_id = get_take_id(c, f"""
INSERT INTO tlv_stock_takes (warehouse_id, type, status, operator_name, note, total_rows)
VALUES ('{wid}', 'dynamic', 'in_progress', 'admin@thalvior.dev', '真实全仓盘点+差异模拟',
  (SELECT count(*) FROM tlv_merchant_inventory WHERE warehouse_id = '{wid}' AND qty_on_hand > 0))
RETURNING id;
""")
print(f"盘点单 id: {take_id}")

# 自动生成 items
print("→ 生成盘点 items ...")
r = run(c, f"""
INSERT INTO tlv_stock_take_items (stock_take_id, merchant_id, sku, location, system_qty, counted_qty, row_no, product_id)
SELECT
  '{take_id}'::uuid, merchant_id, sku, location, qty_on_hand, qty_on_hand,
  row_number() over (order by merchant_id, sku, location), product_id
FROM tlv_merchant_inventory WHERE warehouse_id = '{wid}' AND qty_on_hand > 0;
""")
print(f"  {r.split('INSERT')[0].strip()}")

# 模拟盘点差异：两个商家各 A-01-01/100 → 一个少 2，一个多 5
print("→ 录入盘点差异 ...")
# merchant 1 (7e3bf...) 丢了 2 件
run(c, f"""
UPDATE tlv_stock_take_items SET counted_qty = system_qty - 2, adjusted = true
WHERE stock_take_id = '{take_id}' AND merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
""")
# merchant 2 (c657...) 多了 5 件
run(c, f"""
UPDATE tlv_stock_take_items SET counted_qty = system_qty + 5, adjusted = true
WHERE stock_take_id = '{take_id}' AND merchant_id = 'c657a6a3-0b47-4a01-bbf2-5a0ce40a08d5';
""")

print("盘点 items（带 diff）：")
print(run(c, f"""SELECT sku, merchant_id::text, location, system_qty, counted_qty,
  counted_qty-system_qty AS diff, adjusted
FROM tlv_stock_take_items WHERE stock_take_id = '{take_id}'"""))

# 完成盘点：items.adjusted = true 的行 → UPDATE inventory
print("→ 自动调回 inventory + 写 trigger 日志 ...")
run(c, f"""
DO $$ DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM tlv_stock_take_items WHERE stock_take_id = '{take_id}' AND adjusted LOOP
    UPDATE tlv_merchant_inventory mi
    SET qty_on_hand = r.counted_qty, last_updated = now()
    WHERE mi.warehouse_id = '{wid}'
      AND mi.merchant_id = r.merchant_id
      AND mi.sku = r.sku
      AND mi.location = r.location;
  END LOOP;
END $$;
""")

# 完成盘点单
run(c, f"""
UPDATE tlv_stock_takes t SET
  status = 'completed',
  matched_rows = (SELECT count(*) FROM tlv_stock_take_items i WHERE i.stock_take_id = t.id AND i.system_qty = i.counted_qty),
  diff_rows   = (SELECT count(*) FROM tlv_stock_take_items i WHERE i.stock_take_id = t.id AND i.system_qty <> i.counted_qty),
  adjusted_qty= (SELECT sum(abs(counted_qty - system_qty)) FROM tlv_stock_take_items i WHERE i.stock_take_id = t.id),
  completed_at = now()
WHERE t.id = '{take_id}';
""")

# =========================================================
# 4. 验证
# =========================================================
print("\n═══ 4. 验证 ═══")
print("盘点单状态:")
print(run(c, f"SELECT id::text, status, type, matched_rows, diff_rows, adjusted_qty, completed_at FROM tlv_stock_takes WHERE id = '{take_id}'"))

print("\ninventory（调整后）:")
print(run(c, f"SELECT sku, merchant_id::text, location, qty_on_hand FROM tlv_merchant_inventory WHERE warehouse_id = '{wid}' ORDER BY merchant_id"))

print("\ninventory_logs（trigger 自动写）:")
print(run(c, f"""SELECT change_type, sku, qty_change, qty_before, qty_after,
  operator_note, created_at
FROM tlv_inventory_logs WHERE created_at > now() - interval '5 minutes' ORDER BY created_at"""))

# =========================================================
# 5. COD 结算（真实数据）
# =========================================================
print("\n═══ 5. COD 结算流程 ═══")
cod_order = run_tA(c, "SELECT id FROM tlv_outbound_orders WHERE is_cod = true LIMIT 1")
if cod_order:
    settle_id = get_take_id(c, f"""
INSERT INTO tlv_cod_settlements (merchant_id, warehouse_id, outbound_ids, order_count, cod_total, fee_amount, net_amount, fee_pct, status)
SELECT merchant_id, warehouse_id, ARRAY[id], 1, cod_amount, ROUND(cod_amount * 0.03, 2), ROUND(cod_amount * 0.97, 2), 3.00, 'pending_warehouse'
FROM tlv_outbound_orders WHERE id = '{cod_order}'
RETURNING id;
""")
    print(f"COD 结算单: {settle_id}")
    run(c, f"UPDATE tlv_cod_settlements SET status='pending_admin', warehouse_approved_at=now() WHERE id='{settle_id}'")
    run(c, f"UPDATE tlv_cod_settlements SET status='pending_pay', admin_approved_at=now() WHERE id='{settle_id}'")
    run(c, f"""
INSERT INTO tlv_merchant_wallets (merchant_id, type, amount, transaction_id, note)
SELECT merchant_id, 'recharge', net_amount, 'COD-SETTLE-' || left(id::text, 8), 'COD 代收结算'
FROM tlv_cod_settlements WHERE id = '{settle_id}';
INSERT INTO tlv_merchant_wallets (merchant_id, type, amount, transaction_id, note)
SELECT merchant_id, 'adjustment', -fee_amount, 'COD-FEE-' || left(id::text, 8), 'COD 代收手续费 3%'
FROM tlv_cod_settlements WHERE id = '{settle_id}';
UPDATE tlv_cod_settlements SET status='paid', paid_at=now() WHERE id='{settle_id}';
""")
    print(run(c, f"SELECT id::text, status, cod_total, fee_amount, net_amount, paid_at FROM tlv_cod_settlements WHERE id = '{settle_id}'"))
    print(run(c, f"SELECT type, amount, transaction_id, note FROM tlv_merchant_wallets WHERE transaction_id LIKE 'COD-%'"))
else:
    print("  无 COD 订单")

# =========================================================
# 6. Edge Functions 存活检查
# =========================================================
print("\n═══ 6. Edge Functions ═══")
print(run(c, f"""docker exec supabase-edge-functions ls /home/deno/functions/ 2>&1"""))
print("  sync-tiktok-orders? ", end="")
print(run(c, f"""curl -s -o /dev/null -w "%{{http_code}}" -X POST http://localhost:54321/functions/v1/sync-tiktok-orders -H "Content-Type: application/json" -d '{{}}' 2>&1"""))

c.close()
print("\n✅ 完成")
