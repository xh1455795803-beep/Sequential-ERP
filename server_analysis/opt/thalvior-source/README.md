# Thalvior 跨境 ERP

面向跨境电商卖家的多租户 SaaS ERP：订单、库存、物流、财务、广告、AI 能力一站式管理。

- **线上站点**：https://thalvior.icu
- **部署形态**：自托管 Supabase（Docker）+ 静态前端（Nginx）+ Supabase Edge Functions
- **AI 通道**：阿里云百炼（已彻底脱离 Meoo 云）
- **源码状态**：与线上生产环境逐文件 md5 对齐（18 项校验 0 差异）

---

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 19 + TypeScript + Vite 7 + Tailwind v4 |
| 路由 | TanStack Router（文件式路由，`src/routes/`） |
| UI | Radix UI + shadcn 组件（`src/components/ui/`） |
| 后端 | Supabase 自托管：PostgREST / GoTrue Auth / Edge Functions（Deno） |
| 数据库 | PostgreSQL 15（56 张业务表） |
| 支付 | 微信支付 Native/H5（API v3） |
| 邮件 | 自建 mailer 服务 + QQ 邮箱 SMTP 465 |

---

## 目录结构

```
├── src/                     前端源码
│   ├── routes/              页面路由（_layout.* 主控制台 / _admin.* 后台管理）
│   ├── components/          组件（ui/ 为基础组件）
│   ├── i18n/translations.ts 中英文案字典
│   ├── lib/                 工具与封装（mailer.ts / email-otp.ts）
│   └── supabase/            客户端与类型定义
├── functions/               15 个 Edge Function（Deno/TS，线上运行版本）
├── migrations/              数据库迁移 SQL（按文件名时间戳顺序执行）
├── extension/               浏览器采集插件
├── public/                  静态资源
├── scripts/
│   ├── build-extension.mjs  采集插件打包（build 时自动执行）
│   ├── notify-expiring.sh   会员到期提醒（服务器 cron 每日 09:00）
│   ├── smoke/               端到端冒烟脚本
│   ├── ops/                 运维脚本（服务器配置修复、邮件调试）
│   └── tools/               辅助工具（模板预览、示例邮件发送）
├── .env.example             环境变量清单（键名 + 用途 + 获取方式）
└── 源码使用说明.md           安装 / 构建 / 部署 / 注意事项
```

---

## 快速开始

```bash
pnpm install        # 安装依赖
pnpm dev            # 本地开发 http://localhost:3015
pnpm typecheck      # 类型检查
pnpm build          # 构建（先打采集插件包，再 vite build），产物在 dist/
```

---

## 环境变量

- **前端**：复制 `.env.example` 第三节到 `src/.env`（`VITE_` 前缀，非敏感）
- **服务端**：`.env.example` 第二节全部变量写入服务器 `/opt/supabase/docker/.env`，并同步到 `docker-compose.yml` 的 `functions.environment` 段
- **运维脚本**：`scripts/smoke/` 与 `scripts/ops/` 从环境变量读取凭证，不硬编码

```bash
export SSH_PASSWORD='<服务器 SSH 密码>'
export MAIL_PASSWORD='<邮箱授权码>'
node scripts/smoke/smoke-mail-templates.mjs
```

> compose 中以 `${VAR}` 引用的是 `.env` 里的实际值，只改模板不生效。

---

## 部署

```bash
# 前端
pnpm build && tar czf dist.tar.gz -C dist .
scp dist.tar.gz ubuntu@<服务器>:/tmp/
ssh ubuntu@<服务器> 'sudo rm -rf /var/www/meoo/assets /var/www/meoo/index.html && \
  sudo tar xzf /tmp/dist.tar.gz -C /var/www/meoo && \
  sudo chown -R www-data:www-data /var/www/meoo && sudo nginx -s reload'

# 单个 Edge Function
scp functions/mailer/index.ts ubuntu@<服务器>:/tmp/m.ts
ssh ubuntu@<服务器> 'sudo cp /tmp/m.ts /opt/supabase/docker/volumes/functions/mailer/index.ts && \
  cd /opt/supabase/docker && sudo docker compose restart functions'
```

---

## 硬约束（改动前必读）

1. **不得引入 `api.meoo.host`** —— AI 已全面迁至阿里云百炼，回退会重新绑定第三方云。
2. **前端不得引用 Google Fonts** —— 国内不可达会拖慢首屏，`index.html` 内联系统字体栈不可删除。
3. **前端改动必须走「改源码 → build → 部署」** —— 禁止直接编辑服务器 `assets/*.js`，已发生过覆盖回退事故。
4. **密钥禁止入库** —— 所有脚本从环境变量读取凭证，服务端密钥不进版本库。
5. **数据库改动必须留迁移文件** —— 已有 7 张表因线上手工创建而缺失迁移，导致新环境缺表，教训在前。
