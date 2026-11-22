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
- `db-backup.sh` — Supabase 全库 pg_dumpall 备份（每日 03:00 cron）

## Cron 现状
```
*/5 * * * * /opt/thalvior-monitor/check.sh
0 3 * * * /opt/supabase/backups/backup.sh
```
