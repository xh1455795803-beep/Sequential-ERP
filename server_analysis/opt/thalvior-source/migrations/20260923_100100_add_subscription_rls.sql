-- 订阅套餐表 RLS：套餐公开可读，仅管理员可写（写操作走云函数 service role）
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_select_subscription_plans ON public.subscription_plans
  FOR SELECT USING (true);

-- 订阅记录表 RLS：用户只能读写自己的订阅
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_own_subscriptions ON public.subscriptions
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY users_insert_own_subscriptions ON public.subscriptions
  FOR INSERT WITH CHECK (user_id = auth.uid());