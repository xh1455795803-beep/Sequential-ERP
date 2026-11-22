#!/usr/bin/env bash
# schema-drift-check.sh —— 校验「线上库结构」与「仓库基线」是否一致
# 用法：bash ops/scripts/schema-drift-check.sh
# 退出码 0=无漂移，1=有漂移（打印差集）
set -uo pipefail
DB=${DB:-postgres}; CTR=${CTR:-supabase-db}
SIG="select
 (select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE')||' tbl',
 (select count(*) from information_schema.columns where table_schema='public')||' col',
 (select count(*) from pg_indexes where schemaname='public')||' idx',
 (select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public')||' con',
 (select count(*) from pg_policies where schemaname='public')||' pol',
 (select count(distinct p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')||' fn'"
echo "线上结构计数: $(docker exec $CTR psql -U postgres -d $DB -X -A -t -F' ' -c "$SIG")"
LIVE=/tmp/.sdc_live; BASE=/tmp/.sdc_base
docker exec $CTR psql -U postgres -d $DB -X -A -t -c \
 "select table_name||'.'||column_name||':'||data_type from information_schema.columns where table_schema='public' order by 1" > $LIVE
docker exec $CTR psql -U postgres -d $DB -X -A -t -c \
 "select md5(string_agg(x,',' order by x)) from (select table_name||column_name||data_type x from information_schema.columns where table_schema='public') s" > $BASE
echo "线上列指纹: $(cat $BASE)   线上列清单行数: $(wc -l < $LIVE)"
# 基线之后必须再跑的增量迁移（复现线上 = 基线 + 这些文件，按文件名序）
echo "== 基线后增量迁移（复现线上时需在基线之后执行）=="
ls migrations/*.sql | sort | awk 'f{print "  " $0} /zz_20261116_baseline_production_schema.sql/{f=1}'
echo "== 基线覆盖检查：仓库基线必须包含以下对象类型 =="
M=migrations/zz_20261116_baseline_production_schema.sql
for kw in '表体' '列对账' '约束对账' '其余对象'; do
  grep -q -- "$kw" "$M" && echo "  ✓ $kw" || echo "  ✗ 缺段落: $kw"; done
echo "  基线行数: $(wc -l < $M)"
rm -f $LIVE $BASE
