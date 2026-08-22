#!/usr/bin/env bash
# ====== 单一发布源 · 服务器原始代码/配置/DB 快照拉取脚本 ======
#
# 【单一发布源规则】
#   1. 所有代码、配置、DB 结构，以这个仓库（/workspace/deploy/）为准，
#      服务器上只允许通过 deploy.sh 发布，禁止手工 ssh 上去 vim 改。
#   2. 每次改服务器之前，先跑这条脚本把服务器"原始代码+配置+DB"
#      拉回仓库 server-snapshot/YYYYMMDD-HHMM/ 目录里备份，
#      再用 diff / meld 对比决定要保留哪些服务器端的本地修改。
#   3. DB 数据导出放到 data/ 下、Nginx 配置放到 conf/ 下，
#      确保"原本部署的数据 + 你新写的代码"都在同一个仓库里（跌倒在一起）。
#
# 用法（在能 ssh 到 120.55.6.7 的机器执行）：
#   bash snapshot-server.sh                # 拉：后端 + 前端 + Nginx + DB(全量)
#   bash snapshot-server.sh --skip-db      # 只拉代码/配置，不拉数据库（赶时间）
#   bash snapshot-server.sh --skip-code    # 只拉 DB + Nginx，不拉代码（DB 备份场景）
#
set -euo pipefail

HOST="120.55.6.7"
USER="admin"
export SSHPASS='yuan340364'
REMOTE_BACKEND="/opt/shuxu-erp/backend/src"
REMOTE_FRONTEND="/opt/shuxu-erp/admin"
REMOTE_NGINX="/etc/nginx/conf.d/shuxu-erp.conf"
REMOTE_ENV="/opt/shuxu-erp/backend/.env"

SKIP_DB=0
SKIP_CODE=0
for arg in "$@"; do
  case "$arg" in
    --skip-db)   SKIP_DB=1 ;;
    --skip-code) SKIP_CODE=1 ;;
    *) echo "未知参数: $arg"; exit 1 ;;
  esac
done

cd "$(dirname "$0")"
RUN_SSH() { sshpass -e ssh -o StrictHostKeyChecking=accept-new "$USER@$HOST" "$@"; }
RUN_SCP() { sshpass -e scp -o StrictHostKeyChecking=accept-new "$@"; }

TS="$(date +%Y%m%d-%H%M)"
SNAP_DIR="$PWD/server-snapshot/$TS"
mkdir -p "$SNAP_DIR" "$PWD/conf" "$PWD/data"
TMP_REMOTE_BASE="/tmp/shuxu-erp-snapshot-$TS"
RUN_SSH "rm -rf '$TMP_REMOTE_BASE' && mkdir -p '$TMP_REMOTE_BASE'"

echo "============================================================"
echo " 📦 数序 ERP · 服务器快照拉取  timestamp=$TS"
echo "    目标服务器=$USER@$HOST"
echo "    仓库落盘= $SNAP_DIR"
echo "============================================================"

# ---------- 1. 代码：后端 + 前端 + env ----------
if [ "$SKIP_CODE" = "0" ]; then
  echo ""
  echo "==> 1. 拉代码快照（后端 backend/src / 前端 admin / 环境变量 .env）"
  RUN_SSH "
    set +e
    mkdir -p '$TMP_REMOTE_BASE/backend' '$TMP_REMOTE_BASE/admin'
    [ -d '$REMOTE_BACKEND' ]  && tar -cf '$TMP_REMOTE_BASE/backend/src.tar' -C '$REMOTE_BACKEND' . 2>/dev/null
    [ -d '$REMOTE_FRONTEND' ] && tar -cf '$TMP_REMOTE_BASE/admin.tar'       -C '$REMOTE_FRONTEND' . 2>/dev/null
    [ -f '$REMOTE_ENV' ]     && cp -f '$REMOTE_ENV' '$TMP_REMOTE_BASE/backend.env' 2>/dev/null
  "
  mkdir -p "$SNAP_DIR/backend/src" "$SNAP_DIR/admin"
  RUN_SCP "$USER@$HOST:$TMP_REMOTE_BASE/backend/src.tar" "$SNAP_DIR/backend/src.tar" 2>/dev/null || true
  RUN_SCP "$USER@$HOST:$TMP_REMOTE_BASE/admin.tar"       "$SNAP_DIR/admin.tar"       2>/dev/null || true
  RUN_SCP "$USER@$HOST:$TMP_REMOTE_BASE/backend.env"     "$SNAP_DIR/backend.env"     2>/dev/null || true
  if [ -f "$SNAP_DIR/backend/src.tar" ]; then
    tar -xf "$SNAP_DIR/backend/src.tar" -C "$SNAP_DIR/backend/src"
    echo "    ✅ 后端原始代码 → $SNAP_DIR/backend/src/   ($(du -sh "$SNAP_DIR/backend/src" | cut -f1))"
  fi
  if [ -f "$SNAP_DIR/admin.tar" ]; then
    tar -xf "$SNAP_DIR/admin.tar" -C "$SNAP_DIR/admin"
    echo "    ✅ 前端原始代码 → $SNAP_DIR/admin/        ($(du -sh "$SNAP_DIR/admin" | cut -f1))"
  fi
  [ -f "$SNAP_DIR/backend.env" ] && echo "    ✅ .env → $SNAP_DIR/backend.env（DB密码/JWT密钥等在这里，注意不要提交到公网 git）"
fi

# ---------- 2. Nginx 配置 ----------
echo ""
echo "==> 2. 拉 Nginx 配置（$REMOTE_NGINX）"
mkdir -p "$SNAP_DIR/conf"
set +e
RUN_SCP "$USER@$HOST:$REMOTE_NGINX" "$SNAP_DIR/conf/shuxu-erp.conf" 2>/dev/null
if [ -f "$SNAP_DIR/conf/shuxu-erp.conf" ]; then
  cp -f "$SNAP_DIR/conf/shuxu-erp.conf" "$PWD/conf/shuxu-erp.conf.$TS"
  # conf/ 下放一份"当前"同名配置（方便 deploy.sh --domain-only 比对）
  ln -sf "shuxu-erp.conf.$TS" "$PWD/conf/shuxu-erp.conf" 2>/dev/null || cp -f "$SNAP_DIR/conf/shuxu-erp.conf" "$PWD/conf/shuxu-erp.conf"
  echo "    ✅ Nginx → conf/shuxu-erp.conf  （最新快照 $TS）"
else
  echo "    ⚠️  Nginx 配置没拉到（可能 sudo 权限），手工执行也可以："
  echo "        ssh admin@$HOST sudo cat $REMOTE_NGINX > conf/shuxu-erp.conf"
fi
set -e

# ---------- 3. DB 数据 mysqldump ----------
if [ "$SKIP_DB" = "0" ]; then
  echo ""
  echo "==> 3. 拉数据库全量快照（MariaDB · shuxu_erp）"
  DB_FILE="$PWD/data/shuxu_erp-$TS.sql.gz"
  # 优先读服务器 .env 的 DB_USER / DB_PASS，兜底写死 summary 里的 shuxu / K9mXw7pQ2vRn5tLz
  RUN_SSH "
    set +e
    ENV_FILE='$REMOTE_ENV'
    DB_USER=shuxu
    DB_PASS='K9mXw7pQ2vRn5tLz'
    if [ -f \"\$ENV_FILE\" ]; then
      U=\$(grep -E '^DB_USER=' \"\$ENV_FILE\"   | head -1 | cut -d= -f2-)
      P=\$(grep -E '^DB_PASS=' \"\$ENV_FILE\"   | head -1 | cut -d= -f2-)
      [ -n \"\$U\" ] && DB_USER=\"\$U\"
      [ -n \"\$P\" ] && DB_PASS=\"\$P\"
    fi
    # 服务器端先 dump → gzip → 放到临时路径
    OUT='$TMP_REMOTE_BASE/shuxu_erp.sql.gz'
    MYSQLDUMP=\$(command -v mysqldump || echo /usr/bin/mysqldump)
    \$MYSQLDUMP -u\"\$DB_USER\" -p\"\$DB_PASS\" --default-character-set=utf8mb4 \
      --single-transaction --routines --triggers --quick shuxu_erp 2>/tmp/dump-err.log \
      | gzip > \"\$OUT\"
    RC=\${PIPESTATUS[0]}
    echo \"DUMP_RC=\$RC  SIZE=\$(du -k \"\$OUT\" 2>/dev/null | cut -f1)KB\"
    if [ \"\$RC\" != \"0\" ]; then cat /tmp/dump-err.log 1>&2; fi
    exit \$RC
  " || {
    echo "    ⚠️  DB 导出失败（上面是具体错误），可能是 mysqldump 路径或密码；跳过 DB，继续其他快照"
  }
  RUN_SCP "$USER@$HOST:$TMP_REMOTE_BASE/shuxu_erp.sql.gz" "$DB_FILE" 2>/dev/null || true
  if [ -s "$DB_FILE" ]; then
    # 保持 data/shuxu_erp-latest.sql.gz → 最新一份的软链
    ln -sf "shuxu_erp-$TS.sql.gz" "$PWD/data/shuxu_erp-latest.sql.gz"
    echo "    ✅ DB → data/shuxu_erp-$TS.sql.gz   ($(du -sh "$DB_FILE" | cut -f1))"
    echo "       data/shuxu_erp-latest.sql.gz → 已指向该快照（方便 restore）"
  else
    echo "    ⚠️  DB 文件未落盘到本地（忽略本条，后续可单独补导）"
    rm -f "$DB_FILE"
  fi
fi

# ---------- 4. 汇总 + 后续建议 ----------
RUN_SSH "rm -rf '$TMP_REMOTE_BASE'" 2>/dev/null || true
echo ""
echo "============================================================"
echo "  ✅ 快照完成：server-snapshot/$TS"
echo ""
echo "  现在仓库里"跌倒在一起"的东西（你要的『原本部署的数据 + 新写的代码』）："
if [ "$SKIP_CODE" = "0" ]; then
  echo "   ① 服务器原本后端代码  → server-snapshot/$TS/backend/src/"
  echo "   ② 服务器原本前端代码  → server-snapshot/$TS/admin/"
  echo "   ③ 服务器 .env         → server-snapshot/$TS/backend.env"
fi
echo "   ④ Nginx 配置          → conf/shuxu-erp.conf  （软链到 $TS 快照）"
if [ "$SKIP_DB" = "0" ]; then
  echo "   ⑤ 数据库全量数据      → data/shuxu_erp-latest.sql.gz → shuxu_erp-$TS.sql.gz"
fi
echo "   ⑥ 我新写的代码（待发）→ backend/src/  +  admin/index.html  +  migrations/"
echo ""
echo "  👉 下一步（合并对比）："
echo "     diff -rq server-snapshot/$TS/backend/src backend/src   # 后端差异清单"
echo "     diff    server-snapshot/$TS/admin/index.html admin/index.html   # 前端差异"
echo ""
echo "  👉 下一步（正式发布到服务器，统一成一个版本）："
echo "     bash deploy.sh          # 发布 backend/src + migrations + admin → 服务器（先 302 跳到 /app/ dashboard）"
echo "     bash deploy.sh --domain-only    # 根域名 / → 301 /app/，把所有入口跌倒一个 URL"
echo "============================================================"
