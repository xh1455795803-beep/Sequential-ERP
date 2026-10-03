-- 利润核算表：记录每笔订单的成本与利润明细
CREATE TABLE IF NOT EXISTS public.profit_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  order_id TEXT NOT NULL DEFAULT '',
  product TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT '',
  revenue NUMERIC NOT NULL DEFAULT 0,
  cost NUMERIC NOT NULL DEFAULT 0,
  shipping NUMERIC NOT NULL DEFAULT 0,
  platform_fee NUMERIC NOT NULL DEFAULT 0,
  ad_fee NUMERIC NOT NULL DEFAULT 0,
  profit NUMERIC NOT NULL DEFAULT 0,
  margin NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profit_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_own_profit_records ON public.profit_records
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY users_insert_own_profit_records ON public.profit_records
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY users_update_own_profit_records ON public.profit_records
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY users_delete_own_profit_records ON public.profit_records
  FOR DELETE USING (user_id = auth.uid());