-- 1) AI 售价加价倍率：售价 = 阿里云官方成本单价 × markup
--    参考妙手 ERP 公开收费标准（图片翻译 0.036 元/张）倒推：
--    我方图片翻译成本约 ¥0.0026/张 × 15 ≈ ¥0.039/张，与妙手 0.036 元/张同一水平且略高
--    图片生成成本 ¥0.2/张 × 2.5 = ¥0.5/张（市场同类文生图 0.3~0.8 元/张）
ALTER TABLE public.service_pricing
  ADD COLUMN IF NOT EXISTS markup numeric NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.service_pricing.markup IS
  '售价倍率：向租户收取的金额 = 阿里云官方成本单价 × markup（markup=1 表示按成本价，无利润）';

UPDATE public.service_pricing SET markup = 15, updated_at = now() WHERE billing_mode = 'token';
UPDATE public.service_pricing SET markup = 2.5, updated_at = now() WHERE billing_mode = 'per_image';

-- 2) 会员赠送 AI 额度调整：月付最低 ¥10、最高 ¥50；年付按月额度 ×12 一次性发放
UPDATE public.subscription_plans SET quota = 0,   updated_at = now() WHERE plan_key = 'free';
UPDATE public.subscription_plans SET quota = 10,  updated_at = now() WHERE plan_key = 'pro_month';
UPDATE public.subscription_plans SET quota = 50,  updated_at = now() WHERE plan_key = 'max_month';
UPDATE public.subscription_plans SET quota = 120, updated_at = now() WHERE plan_key = 'pro_year';
UPDATE public.subscription_plans SET quota = 600, updated_at = now() WHERE plan_key = 'max_year';

UPDATE public.subscription_plans
SET description = '适合中小卖家，含 AI 额度与多店铺（每月赠送 ¥10 AI 额度）'
WHERE plan_key = 'pro_month';
UPDATE public.subscription_plans
SET description = '适合多店铺团队，不限商品数量（每月赠送 ¥50 AI 额度）'
WHERE plan_key = 'max_month';
