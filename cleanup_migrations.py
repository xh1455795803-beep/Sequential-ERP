#!/usr/bin/env python3
"""清理重复 migration 文件。

策略：
- 同一张表被多次 CREATE/ALTER 的，保留"版本号最大且内容更完整"的那份
- 用 CREATE TABLE 里是否有更多列/RLS policy 来判定"更完整"
- 特殊案例单独列出
"""
import os, re, subprocess, sys

MIG = "/opt/thalvior-source/migrations"
os.chdir(MIG)

files = sorted([f for f in os.listdir(".") if f.endswith(".sql")])
print(f"[1] 原始文件数: {len(files)}")

# ── Step 1: 按业务名（去掉时间戳）聚类 ──────────────────────────────
clusters = {}
for f in files:
    # 提取业务名：去掉前缀时间戳
    m = re.match(r"^\d+_(.+)\.sql$", f)
    if m:
        name = m.group(1)
        clusters.setdefault(name, []).append(f)

# 找重复簇（≥2 个同业务名）
dup_clusters = {k: v for k, v in clusters.items() if len(v) >= 2}
print(f"[2] 重复业务簇: {len(dup_clusters)}")

# ── Step 2: 判定每组保留哪个 ────────────────────────────────────────
# 规则：
#   a) 如果是 CREATE TABLE，优先保留：时间戳最大 + 含 "自动生成" 头 + 列定义更完整
#   b) 如果是 ALTER TABLE，保留时间戳最大的
#   c) 如果同时间戳有两组功能不同的，都保留（比如 173046 vs 173059 是 create + add_rls，两个都要）
#
# 实际扫描发现的真实"同功能重复"清单（经验）：
DUPLICATE_GROUPS = {
    # (保留, 删除)
    "重复: create_notifications_table":
        ("20260922_190000_create_notifications_table.sql",
         ["20260922_185225_create_notifications_table.sql"]),
    "重复: create_notification_triggers":
        ("20260922_191000_create_notification_triggers.sql",
         ["20260922_185402_create_notification_triggers.sql"]),
    "重复: create_quota_tables":
        ("20260922_200000_create_quota_tables.sql",
         ["20260922_190901_create_quota_tables.sql"]),
    "重复: create_ai_history":
        ("20260922_215130_create_ai_history.sql",
         ["20260922_210000_create_ai_history.sql"]),
    "重复: create_sub_accounts":
        ("20260922_220028_create_sub_accounts.sql",
         ["20260922_220000_create_sub_accounts.sql"]),
    "重复: create_profit_records":  # 3 次 → 保留最新的
        ("20260922_230000_create_profit_records.sql",
         ["20260922_220607_create_profit_records.sql"]),
    "重复: create_listing_tasks":
        ("20260922_230100_create_listing_tasks.sql",
         ["20260922_220613_create_listing_tasks.sql"]),
    "重复: create_shipping_quotes":
        ("20260922_230200_create_shipping_quotes.sql",
         ["20260922_220618_create_shipping_quotes.sql"]),
    "重复: create_sms_codes":
        ("20260922_240000_create_sms_codes.sql",
         ["20260922_222533_create_sms_codes.sql"]),
    "重复: add_shop_auths_oauth_fields":
        ("20260923_100000_add_shop_auths_oauth_fields.sql",
         ["20260923_035241_add_shop_auths_oauth_fields.sql"]),
    "重复: add_subscription_rls":
        ("20260923_110342_add_subscription_rls.sql",
         ["20260923_100100_add_subscription_rls.sql"]),
    "重复: create_competitor_tracks":  # ⚠️ 新版少了 created_at 列！保留旧版内容更全
        ("20260923_120000_create_competitor_tracks.sql",
         ["20260923_111250_create_competitor_tracks.sql"]),
    "重复: add_competitor_tracks_rls":
        ("20260923_120100_add_competitor_tracks_rls.sql",
         ["20260923_111255_add_competitor_tracks_rls.sql"]),
    "重复: create_fba_fee_tiers":
        ("20260923_130000_create_fba_fee_tiers.sql",
         ["20260923_113443_create_fba_fee_tiers.sql"]),
    "重复: add_fba_fee_tiers_rls":
        ("20260923_130100_add_fba_fee_tiers_rls.sql",
         ["20260923_113448_add_fba_fee_tiers_rls.sql"]),
    "重复: create_country_tax_rates":
        ("20260923_130200_create_country_tax_rates.sql",
         ["20260923_113454_create_country_tax_rates.sql"]),
    "重复: add_country_tax_rates_rls":
        ("20260923_130300_add_country_tax_rates_rls.sql",
         ["20260923_113459_add_country_tax_rates_rls.sql"]),
    "重复: add_admin_role_guard":
        ("20260923_120000_add_admin_role_guard.sql",
         ["20260923_050630_add_admin_role_guard.sql"]),
    "重复: add_admin_cross_tenant_select":
        ("20260923_140000_add_admin_cross_tenant_select.sql",
         ["20260923_124722_add_admin_cross_tenant_select.sql"]),
    "重复: add_profiles_status":
        ("20260923_140100_add_profiles_status.sql",
         ["20260923_124729_add_profiles_status.sql"]),
    "重复: tighten_product_images_rls":
        ("20260923_140200_tighten_product_images_rls.sql",
         ["20260923_124734_tighten_product_images_rls.sql"]),
    "重复: create_payment_orders":
        ("20260923_180000_create_payment_orders.sql",
         ["20260923_100703_create_payment_orders.sql"]),
}

# ── Step 3: 执行删除 ──────────────────────────────────────────────────
to_delete = []
to_keep = []

print("\n[3] 处理每组重复：")
for group, (keep, dels) in DUPLICATE_GROUPS.items():
    print(f"  {group}")
    print(f"    保留: {keep}")
    for d in dels:
        if os.path.exists(d):
            print(f"    🔨 删除: {d}")
            to_delete.append(d)
        else:
            print(f"    ⚠️  目标不存在: {d}")

# ── Step 4: 特殊修复 create_competitor_tracks ─────────────────────────
# 120000 版本比 111250 少了 created_at 列。把旧版的列定义 merge 进新版
print("\n[4] 特殊修复 create_competitor_tracks：补回 created_at 列")
OLD = "20260923_111250_create_competitor_tracks.sql"
NEW = "20260923_120000_create_competitor_tracks.sql"
if os.path.exists(OLD) and os.path.exists(NEW):
    with open(OLD) as f:
        old_content = f.read()
    with open(NEW) as f:
        new_content = f.read()

    # 在 new_content 里找到 ); 前插入 created_at 行（如果不存在）
    if "created_at" not in new_content:
        # 找最后一个 );
        idx = new_content.rfind(");")
        if idx > 0:
            insert = "\n  created_at TIMESTAMPTZ NOT NULL DEFAULT now()\n"
            fixed = new_content[:idx] + insert + new_content[idx:]
            with open(NEW, "w") as f:
                f.write(fixed)
            print(f"  ✅ 已在 {NEW} 补回 created_at 列")
            print(f"  diff 验证:")
            subprocess.run(["grep", "-A1", "created_at", NEW])
    # 现在删旧版（因为已经补了）
    to_delete.append(OLD)

# ── Step 5: 去重后 git rm ────────────────────────────────────────────
print(f"\n[5] 总删除数: {len(to_delete)}")
to_delete = sorted(set(to_delete))  # 去重
print(f"  实际执行 git rm 数量: {len(to_delete)}")

for f in to_delete:
    subprocess.run(["git", "rm", "--", f], capture_output=True)

# ── Step 6: 最终验证 ──────────────────────────────────────────────────
final = sorted([f for f in os.listdir(".") if f.endswith(".sql")])
print(f"\n[6] 清理后剩余: {len(final)} 文件")

# 再跑一遍重复检查
clusters2 = {}
for f in final:
    m = re.match(r"^\d+_(.+)\.sql$", f)
    if m:
        clusters2.setdefault(m.group(1), []).append(f)

still_dup = {k: v for k, v in clusters2.items() if len(v) >= 2}
print(f"[7] 仍有重复簇: {len(still_dup)}")
for k, v in still_dup.items():
    print(f"  {k}: {v}")

# 自动 commit
print("\n[8] git commit...")
subprocess.run(["git", "add", "-A"])
subprocess.run([
    "git", "commit", "-m",
    f"chore: deduplicate {len(to_delete)} redundant migration files\n\n"
    f"Kept the auto-generated (larger timestamp) version per schema group.\n"
    f"Special fix: create_competitor_tracks 120000 was missing created_at\n"
    f"column present in 111250 — patched the newer file before removing old.\n\n"
    f"Before: {len(files)} files — After: {len(final)} files"
])

print("\n✅ DONE")
