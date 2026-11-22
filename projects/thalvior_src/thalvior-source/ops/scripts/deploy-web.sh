#!/usr/bin/env bash
# 前端发布（带守卫）—— 跨境 ERP thalvior.icu
#
# 为什么要守卫：2026-11 曾因构建时 .env 缺失，产物里 VITE_* 被打成 undefined，
# 全站白屏约 8 小时才定位到。构建"成功"不代表产物可用，所以这里在切换
# /var/www/meoo 之前，必须验证真实值已经内联进 dist，并在切换后回读线上校验。
#
# 用法：bash ops/scripts/deploy-web.sh
set -euo pipefail

SRC=/opt/thalvior-source
WEB=/var/www/meoo
TS=$(date +%Y%m%d_%H%M%S)
BAK=/var/www/meoo.bak.$TS

cd "$SRC"

echo "[1/5] 源码侧 .env 校验"
[ -f .env ] || { echo "FAIL: 缺少 $SRC/.env —— 构建会把 VITE_* 打成 undefined，拒绝发布"; exit 1; }
read_env() { grep -m1 "^$1=" .env | cut -d= -f2- | tr -d '"'; }
URL=$(read_env VITE_SUPABASE_URL)
APP=$(read_env VITE_ONEDAY_APP_ID)
ANON=$(read_env VITE_SUPABASE_ANON_KEY)
for pair in "VITE_SUPABASE_URL=$URL" "VITE_SUPABASE_ANON_KEY=$ANON" "VITE_ONEDAY_APP_ID=$APP"; do
  v="${pair#*=}"
  [ -n "$v" ] || { echo "FAIL: .env 里 ${pair%%=*} 为空，拒绝发布"; exit 1; }
done

if [ "${1:-}" = "--verify-only" ]; then
  echo "[2/5] 跳过构建（--verify-only）"
else
  echo "[2/5] 构建（低 IO/CPU 优先级，避免打满小机器）"
  nice -n 19 ionice -c3 env NODE_OPTIONS=--max-old-space-size=1024 npm run build
fi

echo "[3/5] 产物侧校验：真实 VITE_* 必须已内联"
[ -f dist/index.html ] || { echo "FAIL: dist/index.html 缺失"; exit 1; }
grep -rqF "$URL" dist/assets/ || { echo "FAIL: dist/assets 里没有 VITE_SUPABASE_URL 的真实值，拒绝发布"; exit 1; }
grep -rqF "$APP" dist/assets/ || { echo "FAIL: dist/assets 里没有 VITE_ONEDAY_APP_ID 的真实值，拒绝发布"; exit 1; }
if grep -rqF "Missing environment variable: VITE_SUPABASE_URL" dist/assets/ && ! grep -rqF "$ANON" dist/assets/; then
  echo "FAIL: 疑似空环境变量产物"; exit 1
fi

echo "[4/5] 备份现网并切换（备份：$BAK）"
sudo mkdir -p "$BAK"
sudo rsync -a "$WEB/" "$BAK/"
sudo rsync -a --delete dist/ "$WEB/"
sudo chown -R www-data:www-data "$WEB"

echo "[5/5] 线上回读校验"
# 注意：/ 是营销落地页（root /var/www/landing），应用 HTML 只能从 SPA 路径取
APP_PAGE=${APP_PAGE:-/auth}
code=$(curl -s -o /tmp/deploy-check.html -w "%{http_code}" --max-time 20 "https://thalvior.icu$APP_PAGE" || echo 000)
if [ "$code" != "200" ]; then
  echo "FAIL: 线上 $APP_PAGE 返回 $code；回滚：sudo rsync -a --delete $BAK/ $WEB/"
  exit 1
fi
grep -q "<title>Thalvior" /tmp/deploy-check.html || { echo "FAIL: 线上 HTML 不像应用页（可能被落地页规则劫持）"; exit 1; }
# Vite 按模块拆 chunk，VITE_* 真实值未必在主 bundle 里，取实际含值的那个 chunk 回读
CHUNK=$(grep -rlF "$URL" dist/assets/ | head -1 | sed "s|^dist/||")
[ -n "$CHUNK" ] || { echo "FAIL: dist 里找不到内联 VITE_SUPABASE_URL 的 chunk"; exit 1; }
curl -s --max-time 30 "https://thalvior.icu/$CHUNK" | grep -qF "$URL" || {
  echo "FAIL: 线上 $CHUNK 缺少 VITE_SUPABASE_URL 真实值；回滚：sudo rsync -a --delete $BAK/ $WEB/"
  exit 1
}
echo "OK: 已发布 https://thalvior.icu（应用校验页 $APP_PAGE，env chunk $CHUNK，备份保留在 $BAK）"
