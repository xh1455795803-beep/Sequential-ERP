-- =============================================================================
-- split_rules 拆单规则表建表迁移（幂等）
--
-- 背景：线上 public.split_rules 表实际存在并被前端使用，但 migrations/ 目录里
--       没有任何建表脚本（grep split_rules migrations/*.sql 无命中），
--       一旦按 migrations 重建库，该表会直接丢失 → /fulfillment/split-rules 页面白屏。
--       本文件补齐缺失的建表脚本，表结构与线上库逐列一致。
--
-- 用途：履约模块「拆单规则」配置表。订单按 platform（电商平台）+ region（收货区域）
--       + warehouse（目标仓库）匹配，priority 决定匹配优先级（数值小者先匹配），
--       status 控制规则启用/停用。
--       前端页面 /fulfillment/split-rules
--       （src/routes/_layout.fulfillment.split-rules.tsx）通过 DataListPage 直接读写本表。
--
-- 幂等性说明：CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS + GRANT，
--             可重复执行；不修改既有数据（本次线上执行前后行数均为 0）。
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------- 建表（与线上结构逐列一致） ----------
create table if not exists public.split_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  platform text,
  region text,
  warehouse text,
  priority integer not null default 0,
  status text not null default '启用',
  created_at timestamptz not null default now()
);

-- ---------- 字段说明 ----------
comment on table public.split_rules is '拆单规则：按 平台/区域/目标仓库 + 优先级 匹配的订单拆单配置';
comment on column public.split_rules.name is '规则名称';
comment on column public.split_rules.platform is '命中的电商平台，空表示不限';
comment on column public.split_rules.region is '命中的收货区域，空表示不限';
comment on column public.split_rules.warehouse is '订单拆分到的目标仓库';
comment on column public.split_rules.priority is '匹配优先级，数值小者优先命中';
comment on column public.split_rules.status is '启用 / 停用';

-- ---------- 多租户隔离（RLS + owner 策略） ----------
alter table public.split_rules enable row level security;
drop policy if exists "split_rules_owner" on public.split_rules;
create policy "split_rules_owner" on public.split_rules
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- 授权（与线上 grant 集合一致） ----------
grant all on table public.split_rules to anon, authenticated, service_role;
