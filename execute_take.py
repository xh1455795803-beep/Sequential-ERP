"""
完成第二次盘点单 (26447cb3-7428-4e82-a26d-a2518fef1dfe)
"""
import urllib.request, json, sys

BASE = "https://thalvior.icu/rest/v1"
ANON = "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw"

TAKE_ID = "26447cb3-7428-4e82-a26d-a2518fef1dfe"
WAREHOUSE_ID = "57ae8979-c77f-4a88-b80a-113f01b5cbee"

def req(method, path, body=None, prefer="return=representation"):
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("apikey", ANON)
    r.add_header("Authorization", f"Bearer {ANON}")
    r.add_header("Content-Type", "application/json")
    r.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(r, timeout=15) as resp:
            raw = resp.read().decode()
            if not raw: return None
            return json.loads(raw)
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"  ❌ HTTP {e.code}: {err[:500]}", file=sys.stderr)
        return None

def url_enc(s):
    # Simple UUID/no-space encoder
    return urllib.parse.quote(str(s), safe='')

import urllib.parse

# ── Step 0: 拉当前 inventory ──
print("Step 0: 拉 inventory 快照...")
inv = req("GET", "/tlv_merchant_inventory?select=*&order=merchant_id,sku")
if not inv:
    print("  ❌ inventory 为空")
    sys.exit(1)
# Python 里过滤 warehouse
inv = [r for r in inv if r["warehouse_id"] == WAREHOUSE_ID]
print(f"  ✅ {len(inv)} 条 inventory in this warehouse")
for r in inv:
    print(f"    {r['sku']} @ {r['location']} | qty={r['qty_on_hand']}")

# ── Step 1: 生成并插入 stock_take_items ──
print("\nStep 1: 插入 5 条 stock_take_items...")

counted_map = {
    ("7e3bf09f-3937-4891-a6f6-75941f39d1b2", "SKU-001", "A-01-01"): 95,   # 97 → 95 (diff -2)
    ("7e3bf09f-3937-4891-a6f6-75941f39d1b2", "SKU-002", "B-02-01"): 49,   # 49 → 49 (diff 0)
    ("7e3bf09f-3937-4891-a6f6-75941f39d1b2", "SKU-003", "C-03-01"): 210,  # 205 → 210 (diff +5)
    ("c657a6a3-0b47-4a01-bbf2-5a0ce40a08d5", "SKU-001", "A-01-01"): 108,  # 108 → 108 (diff 0)
    ("c657a6a3-0b47-4a01-bbf2-5a0ce40a08d5", "SKU-002", "B-02-02"): 78,   # 80 → 78 (diff -2)
}

items_to_insert = []
for idx, r in enumerate(inv):
    key = (r["merchant_id"], r["sku"], r["location"])
    system_qty = r["qty_on_hand"]
    counted_qty = counted_map.get(key, system_qty)
    diff_qty = counted_qty - system_qty
    items_to_insert.append({
        "stock_take_id": TAKE_ID,
        "product_id": r["product_id"],
        "merchant_id": r["merchant_id"],
        "sku": r["sku"],
        "location": r["location"],
        "system_qty": system_qty,
        "counted_qty": counted_qty,
        # diff_qty 是 generated column (counted_qty - system_qty) — DB 自动算
        "adjusted": True,
        "row_no": idx + 1,
    })

result = req("POST", "/tlv_stock_take_items", items_to_insert)
if result and isinstance(result, list):
    print(f"  ✅ 插入 {len(result)} 条 items")
    for it in result:
        sign = "+" if it["diff_qty"] > 0 else ""
        print(f"    row{it['row_no']} {it['sku']} {it['location']}: sys={it['system_qty']} → real={it['counted_qty']} diff={sign}{it['diff_qty']}")
else:
    print(f"  ❌ 插入失败: {result}")
    sys.exit(1)

# ── Step 2+3: 逐行 UPDATE inventory 并写 logs ──
print("\nStep 2: 逐行 UPDATE inventory (用 id 精确匹配)...")
updated_items = []

for it in result:
    if it["diff_qty"] == 0:
        print(f"  = {it['sku']} {it['location']}: 匹配，跳过调整")
        continue

    # 用 inventory 的 id 列精确匹配（从快照里找到）
    inv_row = next((x for x in inv 
                    if x["merchant_id"] == it["merchant_id"] 
                    and x["sku"] == it["sku"] 
                    and x["location"] == it["location"]), None)
    if not inv_row:
        print(f"  ❌ 找不到 inventory 行: {it['sku']} {it['location']}")
        continue
    
    inv_id = inv_row["id"]
    path = f"/tlv_merchant_inventory?id=eq.{inv_id}"
    upd = req("PATCH", path, {"qty_on_hand": it["counted_qty"], "last_updated": "now()"})
    
    if upd and isinstance(upd, list) and len(upd) > 0:
        before = it["system_qty"]
        after = it["counted_qty"]
        print(f"  ✔ {it['sku']} {it['location']}: {before} → {after} (diff {it['diff_qty']:+d})")
        updated_items.append(it)
    else:
        print(f"  ❌ UPDATE 无匹配行! path={path}, upd={upd}")

# ── Step 4: 写 inventory_logs ──
print("\nStep 3: 手动写 inventory_logs（stock_take_adjust）...")
logs_count = 0
for it in updated_items:
    log_body = {
        "warehouse_id": WAREHOUSE_ID,
        "merchant_id": it["merchant_id"],
        "product_id": None,
        "sku": it["sku"],
        "location": it["location"],
        "change_type": "stock_take_adjust",
        "qty_change": it["diff_qty"],
        "qty_before": it["system_qty"],
        "qty_after": it["counted_qty"],
        "ref_id": TAKE_ID,
        "ref_no": "STOCK-TAKE",
        "operator_note": f"operator: admin@thalvior.dev",
    }
    lg = req("POST", "/tlv_inventory_logs", log_body)
    if lg:
        print(f"  ✔ log {it['sku']} {it['location']}: change={it['diff_qty']:+d}")
        logs_count += 1
    else:
        print(f"  ❌ log 失败 {it['sku']}")

# ── Step 5: 更新盘点单为 completed ──
print("\nStep 4: 更新盘点单为 completed...")
total = len(result)
diff_rows = len(result) - sum(1 for r in result if r["diff_qty"] == 0)
matched = total - diff_rows
adj_qty = sum(abs(r["diff_qty"]) for r in result)

path = f"/tlv_stock_takes?id=eq.{TAKE_ID}"
upd = req("PATCH", path, {
    "status": "completed",
    "matched_rows": matched,
    "diff_rows": diff_rows,
    "adjusted_qty": adj_qty,
    "completed_at": "now()",
})
if upd:
    print(f"  ✅ 盘点完成! matched={matched}, diff={diff_rows}, adjusted_qty={adj_qty}")
else:
    print(f"  ❌ 更新盘点单失败")
    sys.exit(1)

print("\n🎉 第二次盘点流程执行完毕!")
print(f"   盘点单: {TAKE_ID}")
print(f"   总 SKU: {total}, 匹配: {matched}, 差异: {diff_rows}")
print(f"   调整量: {adj_qty}")
print(f"   本次调整的 inventory 行: {len(updated_items)}")
print(f"   本次写的 inventory_logs: {logs_count}")
