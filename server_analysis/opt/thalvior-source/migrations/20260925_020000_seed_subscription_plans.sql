-- 订阅套餐（三档 + 年付）。价格与权益可在后台「套餐管理」随时调整
-- quota = 每月赠送的 AI 额度（元），按阿里云百炼官方单价实时扣减
INSERT INTO public.subscription_plans
  (plan_key, name, price, period, description, quota, features, sort_order, status)
VALUES
  ('free', '免费版', 0, '月', '适合刚起步的卖家，体验完整流程', 0,
   '["1 个店铺授权","100 个商品","基础订单管理","不含 AI 额度（可单独充值）"]'::jsonb, 1, '启用'),

  ('pro_month', '专业版', 199, '月', '适合中小卖家，含 AI 额度与多店铺', 50,
   '["5 个店铺授权","5000 个商品","订单/库存/采购全链路","每月赠送 ¥50 AI 额度","智能采集 + 图片翻译"]'::jsonb, 2, '启用'),

  ('max_month', '旗舰版', 599, '月', '适合多店铺团队，不限商品数量', 200,
   '["不限店铺授权","不限商品数量","订单/库存/采购/财务全链路","每月赠送 ¥200 AI 额度","全部 AI 能力 + 优先客服"]'::jsonb, 3, '启用'),

  ('pro_year', '专业版（年付）', 1999, '年', '按年付费，相当于省 2 个月', 600,
   '["5 个店铺授权","5000 个商品","订单/库存/采购全链路","全年赠送 ¥600 AI 额度","智能采集 + 图片翻译"]'::jsonb, 4, '启用'),

  ('max_year', '旗舰版（年付）', 5999, '年', '按年付费，相当于省 2 个月', 2400,
   '["不限店铺授权","不限商品数量","订单/库存/采购/财务全链路","全年赠送 ¥2400 AI 额度","全部 AI 能力 + 优先客服"]'::jsonb, 5, '启用')
ON CONFLICT (plan_key) DO UPDATE SET
  name = EXCLUDED.name,
  price = EXCLUDED.price,
  period = EXCLUDED.period,
  description = EXCLUDED.description,
  quota = EXCLUDED.quota,
  features = EXCLUDED.features,
  sort_order = EXCLUDED.sort_order,
  status = EXCLUDED.status;
