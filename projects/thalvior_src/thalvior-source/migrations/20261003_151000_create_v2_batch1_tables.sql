-- V2 批次1：3 个新一级模块（异常中心 / 自动化中心 / 开放平台）建表
-- 统一约定：id UUID + user_id(多租户隔离) + 业务字段 + created_at
create extension if not exists pgcrypto;

-- ============ 异常中心 ============
create table if not exists public.exceptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null default '订单',               -- 订单/库存/采购/物流/售后/财务/平台同步/Webhook
  level text not null default '警告',              -- 严重/警告/提示
  source text,                                     -- 来源系统/模块
  title text not null,
  message text,
  related_id text,                                 -- 关联单号
  status text not null default '待处理',           -- 待处理/处理中/已解决/已忽略
  handled_by text,
  handled_at timestamptz,
  resolved_note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_exceptions_user_type on public.exceptions(user_id, type);
create index if not exists idx_exceptions_user_status on public.exceptions(user_id, status);

-- ============ 自动化中心 ============
create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  trigger text not null default '订单创建',          -- 触发器类型
  condition text,                                   -- 条件描述
  action text,                                      -- 动作
  workflow_def jsonb default '{}'::jsonb,           -- 工作流定义
  enabled boolean not null default true,
  status text not null default '启用',              -- 启用/停用/异常
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_automation_rules_user on public.automation_rules(user_id);

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rule_id uuid references public.automation_rules(id) on delete cascade,
  trigger_at timestamptz not null default now(),
  status text not null default '成功',              -- 成功/失败/跳过
  result text,
  duration_ms integer
);
create index if not exists idx_automation_runs_user on public.automation_runs(user_id);

create table if not exists public.automation_failures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid,
  rule_id uuid references public.automation_rules(id) on delete set null,
  error text,
  retry_at timestamptz,
  retries integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_automation_failures_user on public.automation_failures(user_id);

-- ============ 开放平台 ============
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  key_value text not null,                          -- 实际密钥（列表页掩码展示）
  scope text not null default 'read',              -- read/write/admin
  status text not null default '启用',             -- 启用/停用
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_api_keys_user on public.api_keys(user_id);

create table if not exists public.oauth_apps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  client_id text not null,
  client_secret text,                              -- 掩码展示
  redirect_uri text,
  status text not null default '启用',             -- 启用/停用
  created_at timestamptz not null default now()
);
create index if not exists idx_oauth_apps_user on public.oauth_apps(user_id);

create table if not exists public.webhooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  event text not null default 'order.created',     -- 事件类型
  secret text,
  status text not null default '启用',             -- 启用/停用
  last_triggered_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_webhooks_user on public.webhooks(user_id);

create table if not exists public.api_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  key_id uuid references public.api_keys(id) on delete set null,
  method text not null default 'GET',
  path text not null,
  status_code integer,
  ip text,
  called_at timestamptz not null default now()
);
create index if not exists idx_api_logs_user on public.api_logs(user_id);
