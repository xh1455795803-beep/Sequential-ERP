-- 订阅权益落地：套餐携带店铺数/商品数上限，新用户默认开通免费版

-- 1) 套餐权益字段（-1 表示不限）
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS max_shops integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_products integer NOT NULL DEFAULT 100;

COMMENT ON COLUMN public.subscription_plans.max_shops IS '该套餐可授权的店铺数上限，-1 表示不限';
COMMENT ON COLUMN public.subscription_plans.max_products IS '该套餐可创建的商品数上限，-1 表示不限';

UPDATE public.subscription_plans SET max_shops = 1,  max_products = 100  WHERE plan_key = 'free';
UPDATE public.subscription_plans SET max_shops = 5,  max_products = 5000 WHERE plan_key = 'pro_month';
UPDATE public.subscription_plans SET max_shops = -1, max_products = -1   WHERE plan_key = 'max_month';
UPDATE public.subscription_plans SET max_shops = 5,  max_products = 5000 WHERE plan_key = 'pro_year';
UPDATE public.subscription_plans SET max_shops = -1, max_products = -1   WHERE plan_key = 'max_year';

-- 2) 新用户注册默认开通免费版（否则「当前套餐」为空，权益无从判定）
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  free_plan_id uuid;
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data ->> 'username', ''),
      split_part(coalesce(NEW.email, ''), '@', 1),
      'user_' || replace(NEW.id::text, '-', '')
    )
  )
  ON CONFLICT (id) DO NOTHING;

  -- AI 额度账户（balance 为该租户可用余额，单位：元）
  IF NOT EXISTS (SELECT 1 FROM public.tenant_quotas q WHERE q.user_id = NEW.id) THEN
    INSERT INTO public.tenant_quotas (user_id, balance, plan_name)
    VALUES (NEW.id, 0, '');
  END IF;

  -- 默认免费版订阅
  SELECT id INTO free_plan_id FROM public.subscription_plans WHERE plan_key = 'free' LIMIT 1;
  IF free_plan_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = NEW.id) THEN
    INSERT INTO public.subscriptions (user_id, plan_id, plan_name, amount, status, started_at)
    VALUES (NEW.id, free_plan_id, '免费版', 0, 'active', now());
  END IF;

  RETURN NEW;
EXCEPTION WHEN unique_violation THEN
  INSERT INTO public.profiles (id, username)
  VALUES (NEW.id, 'user_' || replace(NEW.id::text, '-', ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 3) 存量用户补免费版订阅
INSERT INTO public.subscriptions (user_id, plan_id, plan_name, amount, status, started_at)
SELECT u.id, p.id, '免费版', 0, 'active', now()
FROM auth.users u
CROSS JOIN LATERAL (SELECT id FROM public.subscription_plans WHERE plan_key = 'free' LIMIT 1) p
WHERE NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = u.id);
