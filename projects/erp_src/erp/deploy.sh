#!/usr/bin/env bash
# 塔奥 thalvior · 一键部署脚本
# 用法： sudo ./deploy.sh your-domain.com
set -euo pipefail

DOMAIN="${1:-}"
APP_DIR="/opt/thalvior"

if [ -z "$DOMAIN" ]; then
  echo "用法: sudo ./deploy.sh your-domain.com"
  exit 1
fi

echo "==> 域名: $DOMAIN"

# 1. 落到部署目录
mkdir -p "$APP_DIR"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp -r "$SCRIPT_DIR"/backend "$SCRIPT_DIR"/frontend "$SCRIPT_DIR"/Dockerfile \
      "$SCRIPT_DIR"/docker-compose.yml "$SCRIPT_DIR"/deploy "$SCRIPT_DIR"/requirements.txt "$APP_DIR"/
mkdir -p "$APP_DIR/data" "$APP_DIR/deploy/certs"
cd "$APP_DIR"

# 2. 写入域名
sed -i "s/YOUR_DOMAIN/$DOMAIN/g" deploy/nginx.conf
echo "==> nginx 已绑定域名 $DOMAIN"

# 3. 初始化演示数据（若数据库不存在）
if [ ! -f "$APP_DIR/data/erp.db" ]; then
  echo "==> 首次部署，初始化演示数据…"
  docker compose run --rm --entrypoint "python -m backend.seed" app || \
    echo "!! 初始化失败，可稍后手动执行: docker compose run --rm app python -m backend.seed"
else
  echo "==> 已有数据库，跳过初始化"
fi

# 4. 构建并启动
echo "==> 构建镜像并启动服务…"
docker compose up -d --build

echo
echo "==> 等待服务就绪…"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1/api/health" >/dev/null 2>&1; then
    echo "==> 服务已就绪"
    break
  fi
  sleep 2
done

echo
echo "=============================================="
echo "  塔奥 thalvior 部署完成"
echo "----------------------------------------------"
echo "  访问地址： http://$DOMAIN"
echo "  健康检查： http://$DOMAIN/api/health"
echo "----------------------------------------------"
echo "  请确保："
echo "   1. 域名 A 记录已解析到本机公网 IP"
echo "   2. 服务器安全组已放行 80（与 443）端口"
echo "=============================================="
