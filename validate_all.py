"""
最终验证：盘点流程完成后的数据一致性检查
"""
import urllib.request, json, sys

BASE = "https://thalvior.icu/rest/v1"
ANON = "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw"

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
        print(f"  ❌ HTTP {e.code}: {err[:300]}", file=sys.stderr)
        return None

print("=" * 70)
print("  THALVIOR 盘点流程 — 最终数据一致性验证")
print("=" * 70)

# ── 1. stock_takes ──
print("\n📋 [1/5] tlv_stock_takes")
takes = req("GET", "/tlv_stock_takes?select=*&order=started_at.desc")
for t in takes:
    type_cn = "动态" if t["type"] == "dynamic" else "静态"
    status_cn = "✅ 已完成" if t["status"] == "completed" else "🔄 进行中"
    print(f"  {t['id'][:8]}... | {type_cn}盘点 | {status_cn}")
    print(f"    total={t['total_rows']} matched={t['matched_rows']} diff={t['diff_rows']} adj={t['adjusted_qty']}")
    print(f"    started={t['started_at'][:19].replace('T',' ')} completed={(t.get('completed_at') or '—')[:19]}")
    print(f"    note: {t['note']}")

# ── 2. stock_take_items ──
print("\n📋 [2/5] tlv_stock_take_items")
items = req("GET", "/tlv_stock_take_items?select=*&order=stock_take_id,row_no")
for it in items:
    sign = "+" if it["diff_qty"] and it["diff_qty"] > 0 else ""
    print(f"  {it['stock_take_id'][:8]}... row{it['row_no']} | {it['sku']} {it['location']} | sys={it['system_qty']} real={it['counted_qty']} diff={sign}{it['diff_qty']}")

# ── 3. inventory 最终状态 ──
print("\n📋 [3/5] tlv_merchant_inventory 最终状态")
inv = req("GET", "/tlv_merchant_inventory?select=*&order=merchant_id,sku")
merchants = {}
for r in inv:
    mid = r["merchant_id"][:8]
    if mid not in merchants:
        merchants[mid] = []
    merchants[mid].append(r)
    print(f"  {mid} | {r['sku']} @ {r['location']} | qty={r['qty_on_hand']} | first_in={str(r.get('first_in_at') or '—')[:19]}")

# 汇总
print(f"\n  📊 合计: {len(inv)} 行 inventory")
for mid, rows in merchants.items():
    total = sum(r["qty_on_hand"] for r in rows)
    print(f"    merchant {mid}: {len(rows)} SKUs, total qty = {total}")

# ── 4. inventory_logs（最近的） ──
print("\n📋 [4/5] tlv_inventory_logs 最近 15 条")
logs = req("GET", "/tlv_inventory_logs?select=*&order=created_at.desc&limit=15")
for lg in logs:
    sign = "+" if lg["qty_change"] and lg["qty_change"] > 0 else ""
    print(f"  [{lg['change_type']:20s}] {lg['sku']} {lg['location']} | {lg['qty_before']}→{lg['qty_after']} ({sign}{lg['qty_change']}) | ref={lg.get('ref_no') or '—'}")
    if lg.get('ref_id'):
        print(f"    ref_id={lg['ref_id'][:8]}... note={lg.get('operator_note', '')[:40]}")

# ── 5. wallets ──
print("\n📋 [5/5] tlv_merchant_wallets")
wallets = req("GET", "/tlv_merchant_wallets?select=*&order=created_at.desc")
merchant_wallets = {}
for w in wallets:
    mid = w["merchant_id"][:8]
    if mid not in merchant_wallets:
        merchant_wallets[mid] = {"last_balance": None, "rows": []}
    merchant_wallets[mid]["rows"].append(w)
    merchant_wallets[mid]["last_balance"] = w["balance_after"]
    type_cn = {"recharge":"充值","consume":"扣费","refund":"退款","withdraw":"提现","adjustment":"调整"}.get(w["type"], w["type"])
    amt_sign = "+" if w["amount"] > 0 else ""
    print(f"  {mid} | {type_cn} {amt_sign}{w['amount']:.2f} → bal={w['balance_after']:.2f} | {str(w.get('created_at'))[:19]}")

for mid, info in merchant_wallets.items():
    print(f"  📊 merchant {mid}: {len(info['rows'])} 笔, 当前余额 = {info['last_balance']:.2f}")

# ── 交叉校验 ──
print("\n" + "=" * 70)
print("  🔍 一致性交叉校验")
print("=" * 70)

# Check 1: 所有盘点单 completed 的都有 completed_at
all_ok = True
for t in takes:
    if t["status"] == "completed" and not t.get("completed_at"):
        print(f"  ❌ 盘点单 {t['id'][:8]} completed 但 completed_at 为空")
        all_ok = False
    if t["status"] == "in_progress" and t.get("completed_at"):
        print(f"  ❌ 盘点单 {t['id'][:8]} in_progress 但有 completed_at")
        all_ok = False

# Check 2: 第二次盘点的 inventory 更新 vs counted_qty
print("\n  校验: 第二次盘点 counted_qty == inventory 当前 qty_on_hand (对于 adjusted 的行)")
take2 = next((t for t in takes if "26447cb3" in t["id"]), None)
if take2 and take2["status"] == "completed":
    items2 = [it for it in items if it["stock_take_id"] == take2["id"]]
    for it in items2:
        # 找 inventory 对应行
        inv_match = [r for r in inv 
                     if r["merchant_id"] == it["merchant_id"] 
                     and r["sku"] == it["sku"] 
                     and r["location"] == it["location"]]
        if inv_match:
            curr_qty = inv_match[0]["qty_on_hand"]
            if curr_qty == it["counted_qty"]:
                print(f"    ✅ {it['sku']} {it['location']}: counted={it['counted_qty']} == inventory={curr_qty}")
            else:
                print(f"    ❌ {it['sku']} {it['location']}: counted={it['counted_qty']} != inventory={curr_qty}")
                all_ok = False
        else:
            print(f"    ❌ {it['sku']} {it['location']}: inventory 无对应行")
            all_ok = False

# Check 3: stock_takes 汇总字段 vs items 实际数据
print("\n  校验: stock_takes (matched/diff/adj) vs items 实际统计")
for t in takes:
    its = [it for it in items if it["stock_take_id"] == t["id"]]
    if not its:
        print(f"    ⚠️  盘点单 {t['id'][:8]} 无 items")
        continue
    real_diff = len(its) - sum(1 for i in its if i["diff_qty"] == 0)
    real_adj = sum(abs(i["diff_qty"]) for i in its)
    real_matched = len(its) - real_diff
    print(f"    盘点单 {t['id'][:8]}:")
    print(f"      DB存:  total={t['total_rows']} matched={t['matched_rows']} diff={t['diff_rows']} adj={t['adjusted_qty']}")
    print(f"      实算:  total={len(its)}         matched={real_matched}       diff={real_diff}       adj={real_adj}")
    if (t['total_rows'] == len(its) and t['matched_rows'] == real_matched 
        and t['diff_rows'] == real_diff and t['adjusted_qty'] == real_adj):
        print(f"      ✅ 一致!")
    else:
        print(f"      ❌ 不一致!")
        all_ok = False

# Check 4: inventory_logs 有 stock_take_adjust 类型
print("\n  校验: inventory_logs 包含 stock_take_adjust 记录")
take2_logs = [lg for lg in logs if lg["change_type"] == "stock_take_adjust"]
print(f"    stock_take_adjust 日志条数: {len(take2_logs)}")
for lg in take2_logs:
    print(f"      {lg['sku']} {lg['location']}: {lg['qty_before']}→{lg['qty_after']} ({lg['qty_change']:+d})")

print("\n" + "=" * 70)
if all_ok:
    print("  ✅ 全部一致性校验通过!")
else:
    print("  ❌ 存在不一致项，需检查")
print("=" * 70)
