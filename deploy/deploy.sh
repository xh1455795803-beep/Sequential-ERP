#!/usr/bin/env bash
# ===== 单一发布源 · 统一部署脚本（后端 + 前端 + 迁移 + Nginx 一把梭） =====
#
# 【单一发布源规则】
#   1. 这个仓库是唯一的"真源"：
#        backend/src/   → 对应服务器 /opt/shuxu-erp/backend/src
#        admin/         → 对应服务器 /opt/shuxu-erp/admin
#        migrations/    → 对应服务器侧临时拷贝到 backend/src/ 下执行的迁移
#        conf/          → Nginx 配置快照（来自 snapshot-server.sh）
#        data/          → DB 导出快照（来自 snapshot-server.sh）
#   2. 改代码只在本仓库改，禁止 ssh 上服务器直接 vim 改；
#      服务器若被手工改过，部署前先跑 snapshot-server.sh 把手工改动
#      拉回仓库合并进来，再从仓库发布。
#   3. snapshot 已合并 → 发布前会列出最新快照，否则提示先跑 snapshot。
#
# 用法（在能 ssh 到 120.55.6.7 的机器执行）：
#   bash snapshot-server.sh              # 先把服务器原本代码/配置/DB 拉回仓库合并（建议先跑一次）
#   bash deploy.sh                       # 默认：全量发布 backend/src + admin + migrations + 重启
#   bash deploy.sh --domain-only         # 只做 Nginx 根域名统一：/ → 301 /app/
#   bash deploy.sh --skip-migrate        # 跳过 migrate（v2/v3/v4 已经跑过）
#   bash deploy.sh --force               # 即使没有 snapshot 也强发布（不建议，第一次一定要 snapshot）
#
set -euo pipefail

HOST="120.55.6.7"
USER="admin"
export SSHPASS='yuan340364'
REMOTE_BACKEND="/opt/shuxu-erp/backend/src"
REMOTE_FRONTEND="/opt/shuxu-erp/admin"
REMOTE_NGINX="/etc/nginx/conf.d/shuxu-erp.conf"

SKIP_MIGRATE=0
NGINX_ONLY=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --skip-migrate) SKIP_MIGRATE=1 ;;
    --domain-only)  NGINX_ONLY=1 ;;
    --force)        FORCE=1 ;;
    *) echo "未知参数: $arg"; exit 1 ;;
  esac
done

cd "$(dirname "$0")"
RUN_SSH() { sshpass -e ssh -o StrictHostKeyChecking=accept-new "$USER@$HOST" "$@"; }
RUN_SCP() { sshpass -e scp -o StrictHostKeyChecking=accept-new "$@"; }
TMP_LOCAL="$(mktemp -d)"
trap 'rm -rf "$TMP_LOCAL"' EXIT

LATEST_SNAP="$(ls -1 server-snapshot 2>/dev/null | sort | tail -1 || true)"
if [ -z "$LATEST_SNAP" ] && [ "$FORCE" = "0" ]; then
  echo "❌ 你还没执行过 snapshot-server.sh。"
  echo "   为了保证『服务器原本部署的数据 + 新代码全部跌倒在一起』，必须先把服务器原始内容拉回仓库。"
  echo ""
  echo "   👉 先执行： bash snapshot-server.sh"
  echo "      （拉回 backend 源码 / admin 前端 / Nginx / shuxu_erp DB 全量）"
  echo ""
  echo "   如果你确认要强制发布（不保留服务器原代码快照），加 --force："
  echo "      bash deploy.sh --force"
  exit 1
fi

# ========== 模式1：只做 Nginx 根域名统一 ==========
if [ "$NGINX_ONLY" = "1" ]; then
  echo "==> 只处理：qianniu-erp.cc / → 301 /app/（运营+ERP 统一入口）"
  [ -n "$LATEST_SNAP" ] && echo "    最近一次快照：server-snapshot/$LATEST_SNAP"
  RUN_SSH '
    set -e
    CONF=/etc/nginx/conf.d/shuxu-erp.conf
    [ -f "$CONF" ] || { echo "❌ 找不到 $CONF" && exit 1; }
    sudo -n cp -f "$CONF" "${CONF}.$(date +%Y%m%d%H%M).bak" 2>/dev/null || cp -f "$CONF" "${CONF}.bak"
    python3 - <<PY
import re,sys
p="'"$CONF"'"
s=open(p,"r").read()
blk = """
location = / {
    return 301 https://qianniu-erp.cc/app/;
}
"""
if "location = /" in s:
    print("location = / 已经存在，跳过插入")
else:
    s2 = re.sub(r"(server\s*\{[^}]*?\n)\s*(location\s+/\s*\{)", r"\1" + blk + r"\n    \2", s, count=1, flags=re.S)
    if s2 == s:
        s2 = s.replace("server {", "server {" + blk, 1)
        if s2 == s:
            raise SystemExit("Nginx 自动插入失败，请手工在 server 块第一行加 location = / { return 301 /app/; }")
    open(p,"w").write(s2)
    print("已写入 location = / → /app/ 跳转")
PY
    sudo -n nginx -t 2>&1 | tail -2 || nginx -t
    sudo -n systemctl reload nginx 2>/dev/null || systemctl --user reload nginx 2>/dev/null || sudo -n nginx -s reload 2>/dev/null || echo "[warn] reload 失败请手工 reload"
    echo "✅ qianniu-erp.cc /  →  301 https://qianniu-erp.cc/app/"
  '
  exit 0
fi

# ========== 模式2：全量发布 ==========
echo "============================================================"
echo " 🚀 数序 ERP · 统一部署"
[ -n "$LATEST_SNAP" ] && echo "    服务器快照基线（已拉回仓库，可 diff 对比）：server-snapshot/$LATEST_SNAP"
echo "    发布内容：backend/src/*  +  admin/index.html  +  migrations/v2~v4"
echo "    目标机器：$USER@$HOST"
echo "============================================================"

echo ""
echo "==> 0. 本地语法预检（backend/src 下所有 *.js + migrations）"
cd backend/src
  for f in app.js sync-service.js scheduler.js inventory-ledger.js patch-ledger.js routes/*.js middleware/*.js platforms/*.js; do
    [ -f "$f" ] && node --check "$f" || true
  done
cd ../../
cd migrations
  for f in migrate-v*.js; do
    [ -f "$f" ] && node --check "$f" || true
  done
cd ..
echo "    本地语法全部通过"

echo ""
echo "==> 1. 打包 backend/src + migrations → 远端原子上传（避免东一个西一个漏文件）"
tar -cf "$TMP_LOCAL/backend.tar" -C backend/src .
RUN_SSH "mkdir -p '$REMOTE_BACKEND' '$REMOTE_FRONTEND'"
RUN_SCP "$TMP_LOCAL/backend.tar" "$USER@$HOST:/tmp/deploy-backend.tar"
RUN_SSH "
  set -e
  cd '$REMOTE_BACKEND'
  # 部署前做一份远端当天备份（tar 到 /tmp），回滚有依据
  tar -cf /tmp/backend-backup-$(date +%Y%m%d%H%M).tar . 2>/dev/null || true
  tar -xf /tmp/deploy-backend.tar
  echo '    后端已原子替换：'
  ls -la routes platforms middleware app.js sync-service.js scheduler.js inventory-ledger.js 2>/dev/null | head -20
"
rm -f "$TMP_LOCAL/backend.tar"

# migrations 独立 cp 到 REMOTE_BACKEND（这样远端 node migrate-v4.js 可以直接跑）
if [ "$SKIP_MIGRATE" = "0" ]; then
  echo ""
  echo "==> 2. 拷贝 migrations/*.js → 远端 backend/src"
  tar -cf "$TMP_LOCAL/migrations.tar" -C migrations .
  RUN_SCP "$TMP_LOCAL/migrations.tar" "$USER@$HOST:/tmp/deploy-migrations.tar"
  RUN_SSH "cd '$REMOTE_BACKEND' && tar -xf /tmp/deploy-migrations.tar && echo '    migrate-v2/v3/v4 就绪'"
  rm -f "$TMP_LOCAL/migrations.tar"
fi

echo ""
echo "==> 3. 同步前端 admin/index.html → $REMOTE_FRONTEND"
RUN_SCP admin/index.html "$USER@$HOST:/tmp/index.html.new"
RUN_SSH "
  set -e
  [ -f '$REMOTE_FRONTEND/index.html' ] && cp -f '$REMOTE_FRONTEND/index.html' /tmp/admin-index-$(date +%Y%m%d%H%M).bak || true
  mv -f /tmp/index.html.new '$REMOTE_FRONTEND/index.html'
  echo '    前端 index.html size='\$(wc -c < '$REMOTE_FRONTEND/index.html') 字节
"

echo ""
echo "==> 4. 远端语法二次校验"
RUN_SSH "
  set -e
  cd '$REMOTE_BACKEND'
  for f in app.js sync-service.js scheduler.js inventory-ledger.js migrate-v2.js migrate-v3.js migrate-v4.js patch-ledger.js routes/*.js middleware/*.js platforms/*.js; do
    [ -f \"\$f\" ] && node --check \"\$f\" || true
  done
  echo '    远端语法全部通过'
"

echo ""
echo "==> 5. 数据库迁移 v2 → v3 → v4（幂等，已跑过 Duplicate 报错可忽略）"
if [ "$SKIP_MIGRATE" = "0" ]; then
  RUN_SSH "
    set +e
    cd '$REMOTE_BACKEND'
    node migrate-v2.js 2>&1 | tail -3 ; echo '[v2 exit='$?']'
    node migrate-v3.js 2>&1 | tail -3 ; echo '[v3 exit='$?']'
    node migrate-v4.js 2>&1 | tail -3 ; echo '[v4 exit='$?']'
  "
else
  echo "    --skip-migrate，跳过"
fi

echo ""
echo "==> 6. 重启后端服务（systemd → pm2 → 8090 兜底） + Nginx reload"
RUN_SSH "
  set +e
  SVC=\$(systemctl list-units --type=service --no-legend 2>/dev/null | grep -iE 'shuxu|erp|node' | awk '{print \$1}' | head -1)
  if [ -n \"\$SVC\" ]; then
    echo 'systemd 重启:' \$SVC
    sudo -n systemctl restart \"\$SVC\" 2>/dev/null || systemctl --user restart \"\$SVC\" 2>/dev/null
  else
    echo '[warn] 未找到 systemd shuxu/erp 服务'
  fi
  if command -v pm2 >/dev/null 2>&1; then
    PM2_APP=\$(pm2 list 2>/dev/null | grep -iE 'shuxu|erp|index|app' | awk '{print \$4}' | head -1)
    if [ -n \"\$PM2_APP\" ]; then
      echo 'pm2 重启:' \$PM2_APP
      pm2 restart \"\$PM2_APP\" || true
    fi
  fi
  PID=\$(ss -ltnp 2>/dev/null | grep ':8090 ' | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
  if [ -n \"\$PID\" ]; then
    echo '8090 pid='\$PID' ，kill -HUP'
    kill -HUP \"\$PID\" 2>/dev/null || kill \"\$PID\" 2>/dev/null || true
  fi
  sleep 2
  echo '本地 8090 HTTP 探测：'
  curl -s -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:8090/ || true
  sudo -n nginx -t 2>&1 | tail -2 || true
  sudo -n systemctl reload nginx 2>/dev/null || sudo -n nginx -s reload 2>/dev/null || true
  echo 'Nginx 已 reload'
"

echo ""
echo "🎉 统一部署完成：仓库的 backend/src/、admin/、migrations/ 已经和服务器跌倒一个版本。"
echo ""
echo "   现在线上所有入口已经统一："
echo "     ① 官方营销页：https://qianniu-erp.cc/      （如果你想让它也进 ERP，再执行 bash deploy.sh --domain-only）"
echo "     ② ERP 运营台：https://qianniu-erp.cc/app/#/dashboard   （登录后首屏概览，不再是 shops）"
echo "     ③ 店铺授权只是侧边栏子菜单：店铺中心 → 店铺授权"
echo ""
echo "   想确认『跌倒在一起』效果："
echo "     👉 bash snapshot-server.sh"
echo "        跑完会生成 server-snapshot/<新时间戳>/，和 server-snapshot/$LATEST_SNAP/ 去 diff，差异项就是本次发布的变更。"
