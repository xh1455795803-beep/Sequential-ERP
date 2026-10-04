#!/bin/bash
set -e

PSQL="sudo docker exec supabase-db psql -U postgres -d postgres"

echo "══════ 1. DELETE 旧月付 3 条 ══════"
$PSQL -c "DELETE FROM subscription_plans WHERE plan_key IN ('pro_month','max_month','ultra_month') RETURNING plan_key, name, status;"

echo ""
echo "══════ 2. DROP shop_plans 表 ══════"
$PSQL -c "DROP TABLE IF EXISTS shop_plans;"

echo ""
echo "══════ 3. DROP 3 张空表（兜底） ══════"
$PSQL -c "DROP TABLE IF EXISTS listing_templates, fulfillment_plans, purchase_plans;"

echo ""
echo "══════ 4. 模板类表盘点 ══════"
$PSQL -c "
SELECT table_name FROM information_schema.tables
WHERE table_schema='public'
AND (table_name ILIKE '%template%' OR table_name ILIKE '%plan%' OR table_name ILIKE '%email%')
ORDER BY table_name;"

echo ""
echo "══════ 5. subscription_plans 剩余数据 ══════"
$PSQL -c "SELECT plan_key, name, price, status FROM subscription_plans ORDER BY sort_order;"
COUNT=$($PSQL -t -A -c "SELECT count(*) FROM subscription_plans")
echo "总条数: $COUNT"

echo ""
echo "══════ 6. 外键完整性 ══════"
$PSQL -c "
SELECT sp.plan_key, sp.name, count(s.id) as sub_count
FROM subscription_plans sp LEFT JOIN subscriptions s ON s.plan_id = sp.id
GROUP BY sp.plan_key, sp.name ORDER BY sp.plan_key;"

echo ""
echo "══════ DONE ══════"
