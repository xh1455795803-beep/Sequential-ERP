#!/usr/bin/env bash
# =============================================================================
# Thalvior ERP — Supabase 备份（Wave C · T4 重写版，2026-11-17）
#
# 为什么重写（三条都是现网实测，不是推测）：
#  1) 旧版用 pg_dumpall 纯文本、带 OWNER TO/GRANT → 还原时报一堆「role does not exist」。
#  2) PG 17.6 的 pg_dump 会在纯文本里注入 \restrict/\unrestrict 标记；psql 进入 restricted 模式后，
#     把每个 COPY 的结束符 `\.` 也当成「被限制的反斜杠命令」拒绝 → COPY 永不结束 →
#     后面的 DDL 和数据全被当成 COPY 数据吞掉。实测还原结果：224 张表在、**索引 552→2、RLS 策略 496→0**，
#     而 psql 全程只报 0 条 SQL 错误 —— 静默残缺，比报错更危险。
#  3) 因此本脚本以 custom(-Fc) 归档为**唯一可信恢复入口**，并每次真的还原进临时库做结构对账。
#
# 恢复姿势（已验证）：
#   createdb tal
#   pg_restore -U postgres -d tal --no-owner --no-privileges < thalvior-<UTC>.dump
#
# 现网坑位（写死在下面的实现里，别改回去）：
#   - 宿主机没有 pg_dump/pg_restore（必须 docker exec 进 supabase-db 跑，客户端版本与服务端 17.6 天然对齐）
#   - `pg_dump -Fc -f -` 走 docker exec 的 stdout 会产出 0 字节文件 → 必须在容器内落盘再 docker cp 出来
#   - DROP DATABASE 不能和 CREATE DATABASE 放在同一条 -c（隐式事务块报错）
#   - `docker exec psql -d <db>` 不带 -U postgres 会以 OS 用户 root 走 peer 认证失败
# =============================================================================
set -euo pipefail

BACKUP_DIR=/opt/supabase/backups
DATE=$(date -u +%Y%m%d-%H%M%S)
ENV_FILE=/opt/supabase/docker/.env
DB=postgres
DBUSER=postgres
VERIFY_DB=backup_restore_test
LOCAL_DUMP="$BACKUP_DIR/thalvior-$DATE.dump"
LOCAL_FILE="$BACKUP_DIR/thalvior-$DATE.sql.gz"
RVS_LOG="$BACKUP_DIR/restore-verify-$DATE.log"
LOG="$BACKUP_DIR/backup.log"

export PGPASSWORD="$(sudo grep '^POSTGRES_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"

psql_db() { sudo docker exec -i supabase-db psql -U "$DBUSER" -d "$1" -tA -c "$2" 2>/dev/null; }
pg_dump_in_container() {
  sudo docker exec -e PGPASSWORD="$PGPASSWORD" supabase-db \
    pg_dump -h 127.0.0.1 -p 5432 -U "$DBUSER" -d "$DB" "$@"
}
log() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

log "backup start $DATE"

# ── 1. custom 归档（可信恢复入口）────────────────────────────────────────
pg_dump_in_container --no-owner --no-privileges --clean --if-exists -Fc -f /tmp/_thalvior_backup.dump
sudo docker cp "supabase-db:/tmp/_thalvior_backup.dump" "$LOCAL_DUMP"
sudo docker exec supabase-db rm -f /tmp/_thalvior_backup.dump
[ -s "$LOCAL_DUMP" ] || { log "BACKUP FAIL: .dump 为空"; exit 1; }

# ── 2. 纯文本（人读 / 异备；已剥 restrict 标记，恢复仍优先用 .dump）───────
pg_dump_in_container --no-owner --no-privileges --clean --if-exists \
  | sed '/^\\restrict /d; /^\\unrestrict /d' | gzip > "$LOCAL_FILE"
gzip -t "$LOCAL_FILE" || { log "BACKUP FAIL: gzip 校验不过 $LOCAL_FILE"; exit 1; }

# ── 3. 还原校验：真的灌进临时库，再和源库做结构指纹对账 ──────────────────
psql_db "$DB" "DROP DATABASE IF EXISTS $VERIFY_DB;" >/dev/null
psql_db "$DB" "CREATE DATABASE $VERIFY_DB;" >/dev/null

set +e
sudo docker exec -i supabase-db pg_restore -U "$DBUSER" -d "$VERIFY_DB" \
  --no-owner --no-privileges < "$LOCAL_DUMP" > "$RVS_LOG" 2>&1
RST_EXIT=$?
set -e
# exit=1 允许：cron/net/realtime 是扩展绑定 schema，物理上只能在 cron.database_name 那个库重建
log "pg_restore exit=$RST_EXIT (扩展绑定对象在临时库不可重建，属预期；详见 $RVS_LOG)"

# 排除 cron/net/realtime 后要求逐类完全相等
FINGERPRINT="
SELECT 'tbl='||count(*) FROM information_schema.tables
 WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema','cron','net','realtime')
UNION ALL SELECT 'col='||count(*) FROM information_schema.columns c
 JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name
 WHERE c.table_schema NOT IN ('pg_catalog','information_schema','cron','net','realtime') AND t.table_type='BASE TABLE'
UNION ALL SELECT 'idx='||count(*) FROM pg_indexes
 WHERE schemaname NOT IN ('pg_catalog','information_schema','cron','net','realtime')
UNION ALL SELECT 'con='||count(*) FROM pg_constraint
 WHERE connamespace::regnamespace::text NOT IN ('pg_catalog','information_schema','cron','net','realtime')
UNION ALL SELECT 'pol='||count(*) FROM pg_policies
 WHERE schemaname NOT IN ('pg_catalog','information_schema','cron','net','realtime')"

SRC_FP=$(psql_db "$DB" "$FINGERPRINT" | sort | paste -sd' ' -)
RST_FP=$(psql_db "$VERIFY_DB" "$FINGERPRINT" | sort | paste -sd' ' -)
{ echo "pg_restore_exit=$RST_EXIT"; echo "source : $SRC_FP"; echo "restore: $RST_FP"; } >> "$RVS_LOG"

psql_db "$DB" "DROP DATABASE IF EXISTS $VERIFY_DB;" >/dev/null

if [ "$SRC_FP" != "$RST_FP" ]; then
  log "BACKUP RESTORE VERIFY FAIL: 结构对账不一致 src[$SRC_FP] restore[$RST_FP] 见 $RVS_LOG"
  exit 1
fi
log "RESTORE VERIFY OK $SRC_FP"

# ── 4. 异地上传（配好 /opt/thalvior-monitor/oss.env 才走）────────────────
OSS_ENV=/opt/thalvior-monitor/oss.env
if [ -f "$OSS_ENV" ] && command -v ossutil >/dev/null 2>&1; then
  set -a; # shellcheck disable=SC1090
  . "$OSS_ENV"; set +a
  HOST_TAG=${HOSTNAME:-thalvior}
  oss_args=(-e "$OSS_ENDPOINT" -i "$OSS_ACCESS_KEY_ID" -k "$OSS_ACCESS_KEY_SECRET")
  if ossutil cp "$LOCAL_FILE" "oss://$OSS_BUCKET/$HOST_TAG/thalvior-$DATE.sql.gz" "${oss_args[@]}" >>"$LOG" 2>&1 \
     && ossutil cp "$LOCAL_DUMP" "oss://$OSS_BUCKET/$HOST_TAG/thalvior-$DATE.dump" "${oss_args[@]}" >>"$LOG" 2>&1; then
    log "BACKUP OK local+$OSS_BUCKET"
  else
    log "BACKUP OFFSITE FAIL (local ok) bucket=$OSS_BUCKET"
    exit 1
  fi
else
  log "BACKUP OK local only (no oss.env or no ossutil)"
fi

# ── 5. 本地保留 14 天（只滚本脚本自己的产物）─────────────────────────────
# 注意：**故意不动** 旧命名的 thalvior_full_*.sql.gz —— 那是 wC 之前唯一的夜间历史，
# 等连续几天 RESTORE VERIFY OK 之后，由主人决定再删。
find "$BACKUP_DIR" -name 'thalvior-[0-9]*.sql.gz' -mtime +14 -delete
find "$BACKUP_DIR" -name 'thalvior-[0-9]*.dump'   -mtime +14 -delete
find "$BACKUP_DIR" -name 'restore-verify-*.log'   -mtime +14 -delete
log "backup done dump=$(du -h "$LOCAL_DUMP" | cut -f1) sqlgz=$(du -h "$LOCAL_FILE" | cut -f1)"
