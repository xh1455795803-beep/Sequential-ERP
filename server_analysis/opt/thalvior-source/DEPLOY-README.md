# Thalvior 改版源码（2026-09-27 更新）

## 本次改动文件
- `src/routes/_layout.subscription.tsx` — 订阅页面大改
- `src/routes/index.tsx` — 落地页大改
- `src/routes/_layout.products.tsx` — 商品列表（复制功能修复）
- `src/routes/_layout.products_.$id.tsx` — 商品编辑页大改（全页面Tab式）
- `src/i18n/translations.ts` — 新增翻译键

## 构建与部署
```bash
cd /opt/thalvior-source
cp .env.example .env  # 编辑 .env 填入实际值
pnpm install
npx vite build
sudo cp -f dist/index.html /var/www/meoo/
sudo rm -f /var/www/meoo/assets/index-*.js /var/www/meoo/assets/index-*.css
sudo cp -f dist/assets/* /var/www/meoo/assets/
sudo chown -R www-data:www-data /var/www/meoo/
```

## 目录说明
- `/opt/thalvior-source/` — 完整源码（含 node_modules）
- `/var/www/meoo/` — 网站部署目录（nginx root）
- `/opt/backups/` — 历史备份
- `/opt/supabase/docker/.env` — Supabase 后端配置
