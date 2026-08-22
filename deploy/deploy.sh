#!/usr/bin/env bash
# ===== 平台扩展部署脚本：把本地 /workspace/deploy 的 5 个关键文件上传到服务器 =====
# 用法：
#   1) 把整个 /workspace/deploy 目录复制到能 SSH 访问 120.55.6.7 的机器
#   2) 在该机器上执行：bash deploy.sh
#
set -euo pipefail

HOST="120.55.6.7"
USER="admin"
# SSH 密码（如果不想写死，可以注释掉，改走 ssh key）
export SSHPASS='yuan340364'

REMOTE_BACKEND="/opt/shuxu-erp/backend/src"
REMOTE_FRONTEND="/opt/shuxu-erp/admin"

cd "$(dirname "$0")"

echo "==> 0. 本地语法预检"
node --check routes/oauth.js
node --check sync-service.js
node --check platforms/index.js
node --check platforms/stubs.js
echo "    全部通过"

echo "==> 1. 上传后端 + 前端文件"
# 确保远端 platforms 目录存在
sshpass -e ssh -o StrictHostKeyChecking=no "$USER@$HOST" "mkdir -p '$REMOTE_BACKEND/platforms'"

# 上传 5 个文件
sshpass -e scp -o StrictHostKeyChecking=no platforms/index.js  "$USER@$HOST:$REMOTE_BACKEND/platforms/index.js"
sshpass -e scp -o StrictHostKeyChecking=no platforms/stubs.js  "$USER@$HOST:$REMOTE_BACKEND/platforms/stubs.js"
sshpass -e scp -o StrictHostKeyChecking=no sync-service.js     "$USER@$HOST:$REMOTE_BACKEND/sync-service.js"
sshpass -e scp -o StrictHostKeyChecking=no routes/oauth.js     "$USER@$HOST:$REMOTE_BACKEND/routes/oauth.js"
sshpass -e scp -o StrictHostKeyChecking=no admin/index.html    "$USER@$HOST:$REMOTE_FRONTEND/index.html"
echo "    上传完毕"

echo "==> 2. 远端语法校验"
sshpass -e ssh -o StrictHostKeyChecking=no "$USER@$HOST" "
  set -e
  cd '$REMOTE_BACKEND'
  node --check routes/oauth.js     && echo 'oauth.js OK'
  node --check sync-service.js     && echo 'sync-service.js OK'
  node --check platforms/index.js  && echo 'platforms/index.js OK'
  node --check platforms/stubs.js  && echo 'platforms/stubs.js OK'
"

echo "==> 3. 重启后端服务（优先 systemd，否则 pm2 / 直接进程）"
sshpass -e ssh -o StrictHostKeyChecking=no "$USER@$HOST" "
  set +e
  if command -v systemctl >/dev/null 2>&1; then
    SVC=\$(systemctl list-units --type=service --no-legend 2>/dev/null | grep -iE 'shuxu|erp|node' | awk '{print \$1}' | head -1)
    if [ -n \"\$SVC\" ]; then
      echo '通过 systemd 重启:' \$SVC
      sudo -n systemctl restart \"\$SVC\" 2>/dev/null || systemctl --user restart \"\$SVC\" 2>/dev/null || echo '[warn] systemctl 失败，尝试 pm2'
    fi
  fi
  if command -v pm2 >/dev/null 2>&1; then
    PM2_APP=\$(pm2 list 2>/dev/null | grep -iE 'shuxu|erp|index|app' | awk '{print \$4}' | head -1)
    if [ -n \"\$PM2_APP\" ]; then
      echo '通过 pm2 重启:' \$PM2_APP
      pm2 restart \"\$PM2_APP\" || true
    fi
  fi
  # 兜底：如果能找到 node 进程占用 8090，直接 kill 让守护进程拉起
  PID=\$(ss -ltnp 2>/dev/null | grep ':8090 ' | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
  if [ -n \"\$PID\" ]; then
    echo '8090进程 PID='\$PID' ，尝试 HUP 重启'
    kill -HUP \"\$PID\" 2>/dev/null || kill \"\$PID\" 2>/dev/null || true
  fi
  sleep 2
  echo 'HTTP 8090 探测：'
  curl -s -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:8090/ || true
"

echo ""
echo "🎉 部署完成！浏览器验证步骤："
echo "   打开 https://qianniu-erp.cc/app/"
echo "   - 『平台接入』页应看到 70+ 张平台卡片（原来是 24 张）"
echo "   - 『店铺授权』页 → 新增店铺 → 平台下拉应有 70+ 选项"
echo "   - 控制台 → 新建库存流水/审计日志 菜单保留"
