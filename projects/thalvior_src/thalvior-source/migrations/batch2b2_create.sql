create extension if not exists pgcrypto;

-- 仓库
create table if not exists warehouses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code text,
  name text not null,
  country text,
  city text,
  address text,
  status text not null default '启用',
  created_at timestamptz not null default now()
);

-- 库位
create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  warehouse_id uuid references warehouses(id) on delete set null,
  warehouse_code text,
  zone text,
  shelf text,
  bin text,
  capacity integer not null default 0,
  used integer not null default 0,
  status text not null default '启用',
  created_at timestamptz not null default now()
);

-- 库存调整
create table if not exists stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sku text,
  warehouse text,
  reason text,
  qty integer not null default 0,
  type text not null default '盘点调整',
  note text,
  created_at timestamptz not null default now()
);

-- 库存盘点
create table if not exists stock_takes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_no text,
  warehouse text,
  sku text,
  system_qty integer not null default 0,
  actual_qty integer not null default 0,
  diff integer not null default 0,
  operator text,
  status text not null default '待盘点',
  created_at timestamptz not null default now()
);

-- 库存流水
create table if not exists stock_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sku text,
  warehouse text,
  biz_type text,
  change_qty integer not null default 0,
  after_qty integer not null default 0,
  operator text,
  created_at timestamptz not null default now()
);

-- 库存预警
create table if not exists stock_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sku text,
  warehouse text,
  level text not null default '警告',
  current_qty integer not null default 0,
  threshold integer not null default 0,
  status text not null default '未处理',
  resolved_note text,
  created_at timestamptz not null default now()
);

-- 库存策略
create table if not exists stock_strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sku text,
  warehouse text,
  min_qty integer not null default 0,
  max_qty integer not null default 0,
  reorder_point integer not null default 0,
  lead_time integer not null default 0,
  status text not null default '启用',
  created_at timestamptz not null default now()
);

-- Listing 模板
create table if not exists listing_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  platform text,
  title_rule text,
  desc_rule text,
  price_rule text,
  status text not null default '启用',
  created_at timestamptz not null default now()
);

-- Listing 平台映射
create table if not exists listing_mappings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_platform text,
  target_platform text,
  field_map text,
  status text not null default '启用',
  created_at timestamptz not null default now()
);

-- Listing 日志
create table if not exists listing_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid,
  product text,
  platform text,
  action text,
  result text not null default '成功',
  message text,
  created_at timestamptz not null default now()
);
