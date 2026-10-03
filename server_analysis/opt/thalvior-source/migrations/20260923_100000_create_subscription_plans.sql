-- 订阅套餐表：定义可订阅的套餐（基础版/高级版/旗舰版）
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  price NUMERIC NOT NULL DEFAULT 0,
  period TEXT NOT NULL DEFAULT '月',
  description TEXT,
  quota NUMERIC NOT NULL DEFAULT 0,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '启用',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 订阅记录表：记录用户的订阅历史与当前生效套餐
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  plan_id UUID REFERENCES public.subscription_plans(id),
  plan_name TEXT NOT NULL DEFAULT '',
  amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- payment_orders 增加 plan_id，用于区分「充值」与「订阅」
ALTER TABLE public.payment_orders ADD COLUMN IF NOT EXISTS plan_id UUID;

-- tenant_quotas 增加当前套餐字段
ALTER TABLE public.tenant_quotas ADD COLUMN IF NOT EXISTS plan_id UUID;
ALTER TABLE public.tenant_quotas ADD COLUMN IF NOT EXISTS plan_name TEXT NOT NULL DEFAULT '';
ALTER TABLE public.tenant_quotas ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ;