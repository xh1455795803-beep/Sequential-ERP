#!/bin/bash
set -e

echo "============ 步骤 1：初始化 Git 仓库 ============"
cd /opt/thalvior-source
git config --global user.name "Thalvior Admin"
git config --global user.email "admin@thalvior.icu"

cat > .gitignore << 'GITIGNORE'
# dependencies
node_modules/
.pnpm-store/

# build output
dist/
dist-ssr/
*.local
.tanstack/
.tsbuildinfo

# env & secrets
.env
.env.local
.env.*.local

# logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
*.log

# editor
.vscode/
.idea/
.DS_Store

# backups & tmp
*.bak
*.bak.*
*.tmp
*.tar.gz
*.tgz

# OS
Thumbs.db
GITIGNORE

if [ ! -d .git ]; then
  git init
  echo "✅ git init 完成"
else
  echo "ℹ️ 已经有 .git 目录，跳过 init"
fi

git add .gitignore

echo ""
echo "============ 步骤 2：纳入 ops/ 部署与运维资产 ============"
mkdir -p ops/static-pages ops/nginx ops/scripts

echo "  → 复制手写静态页面..."
cp -r /var/www/landing ops/static-pages/landing
cp -r /var/www/subscribe ops/static-pages/subscribe
cp -r /var/www/invoice ops/static-pages/invoice
cp -r /var/www/legal ops/static-pages/legal
cp -r /var/www/theme ops/static-pages/theme
find ops/static-pages/theme -name "*.bak*" -delete 2>/dev/null
echo "    ✅ 静态页面已复制"

echo "  → 复制 Nginx 配置..."
sudo cp /etc/nginx/sites-enabled/meoo ops/nginx/meoo.conf
echo "    ✅ nginx 配置已复制"

echo "  → 复制运维脚本..."
cp /opt/thalvior-monitor/check.sh ops/scripts/monitor-check.sh
cp /opt/thalvior/notify-expiring.sh ops/scripts/notify-expiring.sh
echo "    ✅ 运维脚本已复制"

cat > ops/README.md << 'OPSREADME'
# ops/ — 部署与运维资产

本目录收纳那些 **不经过 Vite 构建、也不属于 Supabase 官方**、但直接影响线上运行的资产。

## 结构

### static-pages/
手写纯静态 HTML/CSS/JS，由 nginx 直接 serve，与 Vite SPA (`/var/www/meoo/`) 独立发布。

| 目录 | 线上路径 | 说明 |
|------|---------|------|
| landing/ | `https://thalvior.icu/` | 营销落地页 |
| subscribe/ | `https://thalvior.icu/subscription` | 订阅套餐 / AI 积分中心 |
| invoice/ | `https://thalvior.icu/finance/invoice` | 发票管理页 |
| legal/ | `/privacy`, `/terms` | 隐私政策 & 用户协议 |
| theme/ | nginx 内联注入 | CSS 主题补丁 + JS 增强，脱离 dist 独立部署 |

发布方式：`scp -r ops/static-pages/* root@server:/var/www/`

### nginx/
站点配置文件，`cp nginx/meoo.conf /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx`

### scripts/
- `monitor-check.sh` — 每 5 分钟 cron 跑，HTTP/磁盘/内存/容器 告警
- `notify-expiring.sh` — 订阅到期通知

## Cron 现状
```
*/5 * * * * /opt/thalvior-monitor/check.sh
0 3 * * * /opt/supabase/backups/backup.sh
```
OPSREADME
echo "    ✅ ops/README.md 已生成"

echo ""
echo "============ 步骤 3：全部 add + commit ============"
git add -A

total=$(git status --short | wc -l)
echo "  → 待提交条目共 $total 个"

git commit -m "chore: initial snapshot — Thalvior ERP production code + ops assets

Captures everything currently running on thalvior.icu:
- Vite + TanStack Router SPA source (176 routes)
- 82 Supabase SQL migrations
- 22 Edge Functions (agent-chat, ai-chat, collect, wechat-pay, etc.)
- collect-proxy Playwright scraper (port 8788)
- ops/: hand-written static pages (landing/subscribe/invoice/legal/theme),
  nginx site conf, monitor/notify scripts

This repo replaces /tmp/thalvior-git which was out of sync with /opt/thalvior-source.
Supabase docker compose is in /opt/supabase (upstream clone), not duplicated here."

echo ""
echo "============ 步骤 4：验证 ============"
git log --oneline
echo ""
echo "总文件数：$(git ls-files | wc -l)"
echo "其中 src/routes：$(git ls-files 'src/routes/*' | wc -l)"
echo "其中 migrations：$(git ls-files 'migrations/*' | wc -l)"
echo "其中 functions：$(git ls-files 'functions/*' | wc -l)"
echo "其中 ops/static-pages：$(git ls-files 'ops/static-pages/*' | wc -l)"

echo ""
echo "============ 步骤 5：清理 /tmp/thal 旧 monorepo + /tmp/thalvior-git ============"
rm -rf /tmp/thal
rm -rf /tmp/thalvior-git
echo "✅ 已清理 /tmp/thal（旧 Next.js monorepo）+ /tmp/thalvior-git（过时快照）"

echo ""
echo "🎉 全部修复完成！Git 仓库已就绪。"
