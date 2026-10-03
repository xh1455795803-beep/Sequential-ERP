-- 租户额度表：每个租户一条记录，balance 为剩余额度
CREATE TABLE IF NOT EXISTS public.tenant_quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE,
  balance NUMERIC NOT NULL DEFAULT 100,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_quotas ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_own_quota ON public.tenant_quotas
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY users_insert_own_quota ON public.tenant_quotas
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY users_update_own_quota ON public.tenant_quotas
  FOR UPDATE USING (user_id = auth.uid());

-- AI 消耗明细表：记录每一笔调用
CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  service_key TEXT NOT NULL DEFAULT '',
  service_name TEXT NOT NULL DEFAULT '',
  cost NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '成功',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_own_usage ON public.ai_usage_logs
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY users_insert_own_usage ON public.ai_usage_logs
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- 充值流水表：模拟充值记录
CREATE TABLE IF NOT EXISTS public.quota_recharges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  amount NUMERIC NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT '模拟支付',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.quota_recharges ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_own_recharge ON public.quota_recharges
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY users_insert_own_recharge ON public.quota_recharges
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- service_pricing 表新增 service_key 字段（唯一标识能力）
ALTER TABLE public.service_pricing ADD COLUMN IF NOT EXISTS service_key TEXT NOT NULL DEFAULT '';