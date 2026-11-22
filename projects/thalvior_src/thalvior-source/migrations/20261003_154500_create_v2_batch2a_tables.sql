-- V2 批次2A：商品域新表（分类 / 品牌 / 采集规则）
-- 统一约定：id UUID + user_id(多租户隔离) + 业务字段 + created_at
create extension if not exists pgcrypto;

-- ============ 商品分类与属性 ============
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  parent_id uuid references public.categories(id) on delete set null,
  sort integer not null default 0,
  status text not null default '启用',              -- 启用/停用
  created_at timestamptz not null default now()
);
create index if not exists idx_categories_user on public.categories(user_id);

-- ============ 品牌 ============
create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  logo text,
  country text,
  status text not null default '启用',              -- 启用/停用
  created_at timestamptz not null default now()
);
create index if not exists idx_brands_user on public.brands(user_id);

-- ============ 采集规则 ============
create table if not exists public.collect_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  platform text,                                    -- 来源平台
  source_type text not null default '关键词',          -- 关键词/链接/店铺
  source_value text,                                 -- 关键词 / 链接 / 店铺名
  category text,                                     -- 归属分类
  interval_hours integer not null default 24,        -- 采集间隔(小时)
  status text not null default '启用',              -- 启用/停用
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_collect_rules_user on public.collect_rules(user_id);
