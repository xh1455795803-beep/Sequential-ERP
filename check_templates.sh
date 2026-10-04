#!/bin/bash
set +e

ENV_FILE=/opt/supabase/docker/.env
ANON_KEY=$(grep -E "^ANON_KEY=" $ENV_FILE | cut -d= -f2)

echo "═══════════════════════════════════════════════════"
echo "  Thalvior 模板连通性 + 重复性检查"
echo "  $(date "+%Y-%m-%d %H:%M:%S")"
echo "═══════════════════════════════════════════════════"

echo ""
echo "═══════════════════════════════════════════════════"
echo "  PART 1. 模板类数据库表盘点"
echo "═══════════════════════════════════════════════════"

sudo docker exec supabase-db psql -U postgres -d postgres -c "
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND (table_name ILIKE '%template%' OR table_name ILIKE '%plan%' OR table_name ILIKE '%email%')
ORDER BY table_name;" 2>&1

echo ""
echo "═══════════════════════════════════════════════════"
echo "  PART 2. subscription_plans 表 — 数据 + 重复"
echo "═══════════════════════════════════════════════════"

echo "--- REST 拉取 ---"
curl -s --max-time 10 -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  "http://127.0.0.1:8000/rest/v1/subscription_plans?select=*" 2>&1
echo ""

echo "--- 数据库详情 ---"
sudo docker exec supabase-db psql -U postgres -d postgres -c \
  "SELECT id, name, price, currency, active, sort FROM subscription_plans ORDER BY sort;" 2>&1

echo "--- 重复检查 (按 name) ---"
sudo docker exec supabase-db psql -U postgres -d postgres -c "
SELECT name, count(*) as cnt, string_agg(id::text, ',') as ids
FROM subscription_plans GROUP BY name HAVING count(*) > 1;" 2>&1

echo ""
echo "═══════════════════════════════════════════════════"
echo "  PART 3. email_templates 表 — 数据 + 重复"
echo "═══════════════════════════════════════════════════"

echo "--- REST 拉取 ---"
curl -s --max-time 10 -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  "http://127.0.0.1:8000/rest/v1/email_templates?select=*" 2>&1 | head -100
echo ""

echo "--- 数据库详情 ---"
sudo docker exec supabase-db psql -U postgres -d postgres -c \
  "SELECT id, name, subject, category, is_default FROM email_templates ORDER BY category, name;" 2>&1

echo "--- 重复检查 (按 name) ---"
sudo docker exec supabase-db psql -U postgres -d postgres -c "
SELECT name, count(*) as cnt, string_agg(id::text, ',') as ids
FROM email_templates GROUP BY name HAVING count(*) > 1;" 2>&1

echo "--- 重复检查 (按 subject) ---"
sudo docker exec supabase-db psql -U postgres -d postgres -c "
SELECT subject, count(*) as cnt
FROM email_templates GROUP BY subject HAVING count(*) > 1;" 2>&1

echo ""
echo "═══════════════════════════════════════════════════"
echo "  PART 4. 前端路由 /admin.plans /admin.email-templates 是否互通"
echo "═══════════════════════════════════════════════════"

for path in "/admin/plans" "/admin/email-templates" "/admin/quotas"; do
  code=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 10 "https://thalvior.icu${path}")
  echo "  $path → HTTP $code"
done

echo ""
echo "═══════════════════════════════════════════════════"
echo "  PART 5. Edge Functions 中模板/邮件相关的功能"
echo "═══════════════════════════════════════════════════"

ls /opt/thalvior-source/functions/ | grep -iE "template|email|mail|plan"
echo "--- mailer function 健康 ---"
curl -sk -o /dev/null -w "mailer HTTP=%{http_code}\n" --max-time 10 \
  https://thalvior.icu/functions/v1/mailer
curl -sk -o /dev/null -w "email-otp HTTP=%{http_code}\n" --max-time 10 \
  https://thalvior.icu/functions/v1/email-otp
curl -sk -o /dev/null -w "gotrue-sms HTTP=%{http_code}\n" --max-time 10 \
  https://thalvior.icu/functions/v1/gotrue-sms

echo ""
echo "═══════════════════════════════════════════════════"
echo "  PART 6. 全数据库重复扫描（所有表）"
echo "═══════════════════════════════════════════════════"

sudo docker exec supabase-db psql -U postgres -d postgres -c "
DO \$\$
DECLARE
  tbl text; dup_count int := 0;
BEGIN
  FOR tbl IN SELECT table_name FROM information_schema.tables
            WHERE table_schema='public' AND table_type='BASE TABLE'
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM (SELECT * FROM %I GROUP BY * HAVING count(*) > 1) x',
      tbl
    ) INTO dup_count;
    IF dup_count > 0 THEN
      RAISE NOTICE '重复: %. 重复行数=%', tbl, dup_count;
    END IF;
  END LOOP;
END\$\$;" 2>&1

echo ""
echo "═══════════════════════════════════════════════════"
echo "  PART 7. 源码 / 数据库 / REST 三方一致性"
echo "═══════════════════════════════════════════════════"

echo "--- src/routes/admin.* 存在吗 ---"
ls /opt/thalvior-source/src/routes/admin.* 2>/dev/null
echo "--- src 里引用 email_templates / subscription_plans ---"
grep -rn "email_templates\|subscription_plans" /opt/thalvior-source/src --include="*.tsx" --include="*.ts" 2>/dev/null | head -10
echo "--- migrations 里关于这两张表 ---"
grep -l "email_templates\|subscription_plans" /opt/thalvior-source/migrations/*.sql 2>/dev/null

echo ""
echo "═══════════════════════════════════════════════════"
echo "  DONE"
echo "═══════════════════════════════════════════════════"
