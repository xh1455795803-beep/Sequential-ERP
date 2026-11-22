# AGENTS.md

## Dependencies
- `recharts`：图表库，用于工作台销售走势面积图、渠道分布饼图、报表柱状图
- `lucide-react`：图标库，侧边栏菜单与各页面操作图标
- `@tanstack/react-router`：路由，采用文件式路由（`src/routes/` 下 `createFileRoute`）
- `base64-arraybuffer`：文件上传依赖，`supabase.storage` 上传必须用 `decode(base64)` 转 ArrayBuffer（Blob/File/FormData 会 400）

## Architecture
- 布局壳：`src/routes/_layout.tsx` 组合 `Sidebar`（侧边栏）+ `Topbar`（顶部栏）+ `<Outlet />`，所有后台页面挂在 `/_layout` 前缀下
- 侧边栏菜单：`src/components/sidebar.tsx` 内 `menu` 数组定义一级菜单与子菜单，新增页面需在此注册入口
- 通用列表页：`src/components/data-list-page.tsx` 是「配置驱动的 CRUD 列表页」，传入 `table`（表名）+ `columns`（列）+ `fields`（表单字段）即自动完成加载/搜索/新增/编辑/删除，薄页面（授权/采购/货代/广告/财务等）复用此组件
- 通用组件：`page-header.tsx`（页面标题 + 统计卡片）、`status-badge.tsx`（状态徽章，覆盖全模块状态配色）
- 数据访问层：`src/lib/data-access.ts` 封装 Supabase 查询（`fetchProducts`/`fetchOrders`/`fetchInventory`/`fetchShops`/`fetchPurchaseSuggestions`/`fetchAfterSales`），并提供通用 CRUD（`fetchTable`/`insertRow`/`updateRow`/`deleteRow`），页面通过 `useEffect` 加载真实数据
- 数据库表（Meoo Cloud）：核心表 `products`/`orders`/`inventory`/`shops`/`purchase_suggestions`/`after_sales` + 17 张扩展业务表（`shop_auths`/`source_auths`/`collect_items`/`materials`/`order_rules`/`fulfillment_plans`/`outbound_orders`/`suppliers`/`purchase_plans`/`inbound_orders`/`freight_forwarders`/`logistics_channels`/`shipments`/`bills`/`fees`/`reconciliations`/`traffic_stats`），均启用 RLS 多租户隔离（`user_id = auth.uid()`）
- 多租户模型：租户 = `auth.users` 用户（无独立 tenants 表），`profiles` 表承载 `role`（admin/tenant）与 `status`（active/frozen）字段；管理员跨租户只读通过各业务表的 `admins_select_*` 策略（`USING (has_role(auth.uid(), 'admin'))`）实现，仅开放 SELECT 不开放写；`has_role()` 为 SECURITY DEFINER 函数防 RLS 递归
- 租户冻结：`profiles.status` 字段，管理员经 `admins_update_profiles` 策略冻结/解冻；前端 `_layout.tsx` 在 `status === 'frozen'` 时拦截进入后台，`useAuth()` 返回 `status`
- 微信支付：`functions/wechat-pay/index.ts` 实现 APIv3 下单（native 扫码/h5 手机网页）+ 回调验签解密 + 主动查单；订单表 `payment_orders`（`order_no` 唯一，`status` pending/paid，`plan_id` 区分「充值/订阅」）；凭证（`WECHAT_MCH_ID`/`WECHAT_API_V3_KEY`/`WECHAT_SERIAL_NO`/`WECHAT_PRIVATE_KEY`/`WECHAT_PUB_KEY_ID`/`WECHAT_PUB_KEY`/`WECHAT_APP_ID`）通过云服务面板密钥卡片配置，严禁写入源码；前端封装在 `src/services/meooAI.ts`（`createWechatPayOrder`/`queryWechatPayOrder`）。注意：`WECHAT_APP_ID` 是 native/h5 下单的 `appid` 字段必需，不能删
- 订阅套餐：`subscription_plans`（套餐表，`plan_key` 唯一，`features` 为 JSONB 数组）+ `subscriptions`（订阅记录表，`status` active/pending）；`tenant_quotas` 增加 `plan_id`/`plan_name`/`plan_expires_at` 字段。订阅下单走 `createWechatPayOrder(price, payType, { planId })`，回调 `settleOrder` 按 `plan_id` 区分：订阅订单开通套餐（写 subscriptions + 更新 tenant_quotas 套餐字段 + 赠送 quota 额度），充值订单累加 balance + 写 quota_recharges
- 模拟数据：`src/lib/mock-data.ts` 仍保留销售趋势、渠道分布、待办、利润、物流面单、刊登任务等聚合/未建表数据；业务实体均已改为从数据库读取
- 落地页：`src/routes/index.tsx` 是营销首页（`/`），后台工作台在 `/dashboard`（`_layout.dashboard.tsx`），登录/注册后跳转 `/dashboard`
- 商品图片存储：`product-images` 存储桶（bucket ID `d1439de1-7fc8-470b-93ba-152887a05385`，public=true），RLS 已收紧为「上传/更新/删除仅限本人（`owner = auth.uid()`）、读取公开」；商品编辑页 `_layout.products_.$id.tsx` 用 `supabase.storage.from(bucketId).upload()` 前端直传，禁止在云函数里上传文件（拿不到公网 URL）

## Lessons
- 路由文件命名：列表 + 详情用 `orders.tsx`（`/orders`）+ `orders_.$id.tsx`（`/orders/$id`），后缀 `_` 打断嵌套避免需要 `Outlet`
- 侧边栏子菜单仅在父级 `active` 时展开，`active` 判断用 `pathname === item.path || pathname.startsWith(item.path + "/")`
- `insertRow` 会自动注入 `user_id`（从 `supabase.auth.getSession()` 取当前用户），页面新增记录无需手动传 `user_id`，避免漏传导致 RLS 拦截