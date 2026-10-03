-- AI 额度账户闭环：每个用户必须有一条 tenant_quotas 记录，否则扣费会被静默跳过（等于免费用 AI）

-- 1) 新用户注册时自动开户（余额 0，需通过订阅/充值获得额度）
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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

  RETURN NEW;
EXCEPTION WHEN unique_violation THEN
  INSERT INTO public.profiles (id, username)
  VALUES (NEW.id, 'user_' || replace(NEW.id::text, '-', ''))
  ON CONFLICT (id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_quotas q WHERE q.user_id = NEW.id) THEN
    INSERT INTO public.tenant_quotas (user_id, balance, plan_name)
    VALUES (NEW.id, 0, '');
  END IF;
  RETURN NEW;
END;
$$;

-- 2) 存量用户补开户
INSERT INTO public.tenant_quotas (user_id, balance, plan_name)
SELECT u.id, 0, ''
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.tenant_quotas q WHERE q.user_id = u.id
);
