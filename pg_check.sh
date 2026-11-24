#!/bin/bash
# Single-connection pg check
set -e
PSQL="docker exec supabase-db psql -U supabase_admin -d postgres -P pager=off -P tuples_only=off"

echo "========== 1. tlv_* tables =========="
$PSQL -c "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'tlv_%' ORDER BY tablename;"

echo ""
echo "========== 2. row counts =========="
TABLES=$($PSQL -t -A -c "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'tlv_%' ORDER BY tablename;")
for t in $TABLES; do
  CNT=$($PSQL -t -A -c "SELECT count(*) FROM $t;")
  echo "$t | $CNT"
done

echo ""
echo "========== 3. FK constraints =========="
$PSQL -c "SELECT r.relname AS table, c.conname AS fk FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid WHERE r.relname LIKE 'tlv_%' AND c.contype = 'f' ORDER BY r.relname, c.conname;"

echo ""
echo "========== 4. RPC functions =========="
$PSQL -c "SELECT n.nspname, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (proname LIKE 'calc%' OR proname LIKE 'outbound%') ORDER BY proname;"

echo ""
echo "========== 5. RLS policies =========="
$PSQL -c "SELECT schemaname, tablename, policyname FROM pg_policies WHERE tablename LIKE 'tlv_%' ORDER BY tablename, policyname;"

echo ""
echo "========== 6. triggers =========="
$PSQL -c "SELECT c.relname AS table, t.tgname AS trigger FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relname LIKE 'tlv_%' ORDER BY c.relname, t.tgname;"

echo ""
echo "========== 7. residual old tables =========="
$PSQL -c "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'tlv_%' AND tablename NOT LIKE 'auth_%' AND tablename NOT LIKE 'storage_%' AND tablename NOT LIKE 'realtime_%' AND tablename NOT LIKE 'cron_%' AND tablename NOT LIKE 'graphql_%' ORDER BY tablename;"

echo ""
echo "DONE."
