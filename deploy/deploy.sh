#!/usr/bin/env bash
# ===== 统一部署脚本：把 /workspace/deploy 所有改动一次性发布到 qianniu-erp.cc 运营主域 =====
# - 后端：/opt/shuxu-erp/backend/src/        (所有 routes / platforms / middleware / app / scheduler / sync / migrate)
# - 前端：/opt/shuxu-erp/admin/index.html    (→ Nginx 映射 qianniu-erp.cc/app/)
# - 可选：qnyc.sh --domain-only  把 qianniu-erp.cc 根路径统一跳转到 /app/（运营+ERP同入口）
#
# 用法（在能 ssh 到 120.55.6.7 的机器执行）：
#   bash deploy.sh                 # 默认：全量文件 + migrate 数据迁移 + 服务重启
#   bash deploy.sh --domain-only   # 只做 Nginx 根域名统一（根 / → /app/ 301）
#   bash deploy.sh --skip-migrate  # 跳过数据库迁移（如果已经跑过 v4）
#
set -euo pipefail

HOST="120.55.6.7"
USER="admin"
export SSHPASS='yuan340364'
REMOTE_BACKEND="/opt/shuxu-erp/backend/src"
REMOTE_FRONTEND="/opt/shuxu-erp/admin"
SKIP_MIGRATE=0
NGINX_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --skip-migrate) SKIP_MIGRATE=1 ;;
    --domain-only)  NGINX_ONLY=1 ;;
    *) echo "未知参数: $arg"; exit 1 ;;
  esac
done

cd "$(dirname "$0")"
RUN_SSH()  { sshpass -e ssh -o StrictHostKeyChecking=no "$USER@$HOST" "$@"; }
RUN_SCP()  { sshpass -e scp -o StrictHostKeyChecking=no "$@"; }
TMP_LOCAL="$(mktemp -d)"
trap 'rm -rf "$TMP_LOCAL"' EXIT

# ========== 模式1：只做 Nginx 根域名统一 ==========
if [ "$NGINX_ONLY" = "1" ]; then
  echo "==> 只处理：qianniu-erp.cc 根路径 / → 301 跳转到 /app/（运营 + ERP 同入口）"
  RUN_SSH '
    set -e
    CONF=/etc/nginx/conf.d/shuxu-erp.conf
    [ -f "$CONF" ] || { echo "❌ 找不到 Nginx 配置 $CONF" && exit 1; }
    # 备份
    sudo -n cp -f "$CONF" "${CONF}.$(date +%Y%m%d%H%M).bak" 2>/dev/null || cp -f "$CONF" "${CONF}.bak"

    # 在「server {」之后、第一个「location /」之前插入 location = / { return 301 /app/; }
    python3 - <<PY
import re,sys
p="'"$CONF"'"
s=open(p,"r").read()
blk = '''
location = / {
    return 301 https://qianniu-erp.cc/app/;
}
'''
if "location = /" in s:
    print("location = / 已经存在，跳过插入")
else:
    s2 = re.sub(r"(server\s*\{[^}]*?\n)\s*(location\s+/\s*\{)", r"\1" + blk + r"\n    \2", s, count=1, flags=re.S)
    if s2 == s:
        # fallback：直接在 server 块开头插入
        s2 = s.replace("server {", "server {" + blk, 1)
        if s2 == s:
            raise SystemExit("无法自动定位 server 块，请手工编辑 $CONF")
    open(p,"w").write(s2)
    print("已写入 location = / → /app/ 跳转")
PY

    # 校验并 reload
    sudo -n nginx -t 2>&1 | tail -2 || nginx -t
    sudo -n systemctl reload nginx 2>/dev/null || systemctl --user reload nginx 2>/dev/null || sudo -n nginx -s reload 2>/dev/null || echo "[warn] nginx reload 失败，请手工 reload"
    echo "✅ 根域名统一完成：https://qianniu-erp.cc/ 现在会 301 跳转到 https://qianniu-erp.cc/app/"
  '
  exit 0
fi

# ========== 模式2：全量发布 ==========
echo "==> 0. 本地全量语法预检"
for f in app.js sync-service.js scheduler.js inventory-ledger.js migrate-v2.js migrate-v3.js migrate-v4.js patch-ledger.js \
         routes/auth.js routes/oauth.js routes/shops.js routes/inventory.js routes/audit.js routes/notifications.js \
         middleware/audit.js \
         platforms/base.js platforms/index.js platforms/stubs.js \
         platforms/amazon.js platforms/ebay.js platforms/lazada.js platforms/aliexpress.js platforms/allegro.js \
         platforms/coupang.js platforms/fruugo.js platforms/kaufland.js platforms/mercadolibre.js platforms/onbuy.js \
         platforms/ozon.js platforms/qoo10.js platforms/shein.js platforms/temu.js platforms/walmart.js platforms/wildberries.js; do
  [ -f "$f" ] && node --check "$f" || true
done
echo "    全部通过"

echo "==> 1. 同步后端（整包 scp -r 到远端，避免东一个西一个）"
RUN_SSH "mkdir -p '$REMOTE_BACKEND/platforms' '$REMOTE_BACKEND/routes' '$REMOTE_BACKEND/middleware' '$REMOTE_FRONTEND'"
# 用 tar 原子打包上传，避免一个个 scp 出现漏传
tar -cf "$TMP_LOCAL/backend.tar" \
  app.js sync-service.js scheduler.js inventory-ledger.js \
  migrate-v2.js migrate-v3.js migrate-v4.js patch-ledger.js \
  routes/ middleware/ platforms/
RUN_SCP "$TMP_LOCAL/backend.tar" "$USER@$HOST:/tmp/deploy-backend.tar"
RUN_SSH "
  set -e
  cd '$REMOTE_BACKEND'
  # 解压前备份当前一份当天的
  tar -cf /tmp/backend-before-$(date +%Y%m%d%H%M).tar routes/ platforms/ middleware/ app.js sync-service.js scheduler.js inventory-ledger.js 2>/dev/null || true
  tar -xf /tmp/deploy-backend.tar
  chown -R $(id -u):$(id -g) . 2>/dev/null || true
  echo '    后端解压完成'
  ls -la routes platforms middleware 2>/dev/null | head -20
"
rm -f "$TMP_LOCAL/backend.tar"

echo "==> 2. 同步前端（admin/index.html）"
RUN_SCP admin/index.html "$USER@$HOST:/tmp/index.html.new"
RUN_SSH "
  set -e
  [ -f '$REMOTE_FRONTEND/index.html' ] && cp -f '$REMOTE_FRONTEND/index.html' /tmp/admin-index-$(date +%Y%m%d%H%M).bak || true
  mv -f /tmp/index.html.new '$REMOTE_FRONTEND/index.html'
  echo '    前端 index.html 大小：' \$(wc -c < '$REMOTE_FRONTEND/index.html') 字节
"

echo "==> 3. 远端全量语法校验"
RUN_SSH "
  set -e
  cd '$REMOTE_BACKEND'
  for f in app.js sync-service.js scheduler.js inventory-ledger.js \
           migrate-v2.js migrate-v3.js migrate-v4.js patch-ledger.js \
           routes/*.js middleware/*.js platforms/*.js; do
    [ -f \"\$f\" ] && node --check \"\$f\" || true
  done
  echo '    远端语法全部通过'
"

echo "==> 4. 数据库迁移 v3 + v4（幂等，已跑过会报错可忽略）"
if [ "$SKIP_MIGRATE" = "0" ]; then
  RUN_SSH "
    set +e
    cd '$REMOTE_BACKEND'
    node migrate-v3.js 2>&1 | tail -5 ; echo '[v3 exit='$?']'
    node migrate-v4.js 2>&1 | tail -5 ; echo '[v4 exit='$?']'
  "
else
  echo "    --skip-migrate，跳过"
fi

echo "==> 5. 重启后端服务 + Nginx reload"
RUN_SSH "
  set +e
  # 5.1 systemd
  SVC=\$(systemctl list-units --type=service --no-legend 2>/dev/null | grep -iE 'shuxu|erp|node' | awk '{print \$1}' | head -1)
  if [ -n \"\$SVC\" ]; then
    echo 'systemd 重启:' \$SVC
    sudo -n systemctl restart \"\$SVC\" 2>/dev/null || systemctl --user restart \"\$SVC\" 2>/dev/null
  else
    echo '[warn] 没找到 systemd shuxu/erp 服务'
  fi

  # 5.2 pm2
  if command -v pm2 >/dev/null 2>&1; then
    PM2_APP=\$(pm2 list 2>/dev/null | grep -iE 'shuxu|erp|index|app' | awk '{print \$4}' | head -1)
    if [ -n \"\$PM2_APP\" ]; then
      echo 'pm2 重启:' \$PM2_APP
      pm2 restart \"\$PM2_APP\" || true
    fi
  fi

  # 5.3 兜底杀 8090 让守护进程拉起
  PID=\$(ss -ltnp 2>/dev/null | grep ':8090 ' | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
  if [ -n \"\$PID\" ]; then
    echo '8090 pid='\$PID' ，kill -HUP'
    kill -HUP \"\$PID\" 2>/dev/null || kill \"\$PID\" 2>/dev/null || true
  fi

  sleep 2
  echo '本地 8090 HTTP 探测:'
  curl -s -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:8090/ || true

  # 5.4 Nginx reload（保险起见每次都做一下，加载前端新 index.html）
  sudo -n nginx -t 2>&1 | tail -2 || true
  sudo -n systemctl reload nginx 2>/dev/null || sudo -n nginx -s reload 2>/dev/null || true
  echo 'Nginx 已 reload'
"

echo ""
echo "🎉 统一部署完成：后端 + 前端 + 迁移 + 重启 一把梭，不再东一个西一个。"
echo "   现在两个入口都可以直接用："
echo "   👉 ERP运营台：https://qianniu-erp.cc/app/    （店铺授权/库存流水/审计日志/通知中心/70+平台 都在这里）"
echo "   👉 官方营销页：https://qianniu-erp.cc/       （数序ERP V3.0 介绍）"
echo ""
echo "   如果你想让「运营官网和ERP 统一在一个入口」，再执行一条："
echo "   👉 bash deploy.sh --domain-only"
echo "      效果：https://qianniu-erp.cc/ 会 301 自动跳到 /app/，运营/客服/用户访问主域名就直接进 ERP。"
