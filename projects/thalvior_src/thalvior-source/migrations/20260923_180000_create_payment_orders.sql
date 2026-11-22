-- 微信支付订单表：记录每笔充值订单，支付回调后幂等入账
CREATE TABLE IF NOT EXISTS public.payment_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  order_no TEXT UNIQUE NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  pay_type TEXT NOT NULL DEFAULT 'native',
  status TEXT NOT NULL DEFAULT 'pending',
  wechat_trade_no TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ
);

ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_own_payment ON public.payment_orders
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY users_insert_own_payment ON public.payment_orders
  FOR INSERT WITH CHECK (user_id = auth.uid());