-- ============================================================
-- 缺失配置表的初始数据（从生产库导出，仅含配置类数据）
-- 生成时间：2026-09-27 · 来源：43.133.232.81 生产库
-- 仅 seed 配置表：额度套餐 / 店铺套餐 / 平台授权配置
-- 运行时数据表（email_codes 含验证码哈希、ai_cash_usage、ai_free_quotas、invoices 含用户业务数据）
--   属于业务/隐私数据，不进源码，由运行时自动生成
-- 幂等：按业务唯一键（package_code / plan_code / platform_key）判断，重复执行不会产生重复行
-- 验证：已在 postgres:15 连续执行两次，行数保持不变
-- ============================================================

-- ===== public.credit_packages（4 行，业务键 package_code）=====
INSERT INTO public.credit_packages (id, package_code, name, credits, price, original_price, per_credit, tag, recommended, sort_order, status, created_at)
SELECT '1dc67c58-d92d-45d1-887d-da3c11abe0ad', 'credits_200', '体验包', '200', '10', '10', '0.05', NULL, 'f', '1', '启用', '2026-09-25 17:03:01.512995+00'
WHERE NOT EXISTS (SELECT 1 FROM public.credit_packages WHERE package_code = 'credits_200');
INSERT INTO public.credit_packages (id, package_code, name, credits, price, original_price, per_credit, tag, recommended, sort_order, status, created_at)
SELECT '1779363b-6189-45b0-b556-c68294aacd88', 'credits_1000', '标准包', '1000', '45', '50', '0.045', '9 折', 't', '2', '启用', '2026-09-25 17:03:01.512995+00'
WHERE NOT EXISTS (SELECT 1 FROM public.credit_packages WHERE package_code = 'credits_1000');
INSERT INTO public.credit_packages (id, package_code, name, credits, price, original_price, per_credit, tag, recommended, sort_order, status, created_at)
SELECT '3faf45e1-a3b3-473f-ab54-79948061028c', 'credits_3000', '专业包', '3000', '120', '150', '0.04', '8 折', 'f', '3', '启用', '2026-09-25 17:03:01.512995+00'
WHERE NOT EXISTS (SELECT 1 FROM public.credit_packages WHERE package_code = 'credits_3000');
INSERT INTO public.credit_packages (id, package_code, name, credits, price, original_price, per_credit, tag, recommended, sort_order, status, created_at)
SELECT '138276e9-38d1-4763-b4a7-400280d268ab', 'credits_10000', '旗舰包', '10000', '350', '500', '0.035', '7 折', 'f', '4', '启用', '2026-09-25 17:03:01.512995+00'
WHERE NOT EXISTS (SELECT 1 FROM public.credit_packages WHERE package_code = 'credits_10000');

-- ===== public.shop_plans（6 行，业务键 plan_code）=====
INSERT INTO public.shop_plans (id, plan_code, shop_count, unit_price, price_month, price_quarter, price_year, discount_quarter, discount_year, recommended, sort_order, status, created_at)
SELECT '4f1df406-4963-435d-924b-b6ae7a6b58d9', 'shop_1', '1', '19.0', '19', '54', '210', '0.95', '0.92', 'f', '1', '启用', '2026-09-25 18:29:02.967068+00'
WHERE NOT EXISTS (SELECT 1 FROM public.shop_plans WHERE plan_code = 'shop_1');
INSERT INTO public.shop_plans (id, plan_code, shop_count, unit_price, price_month, price_quarter, price_year, discount_quarter, discount_year, recommended, sort_order, status, created_at)
SELECT 'd70d2be4-819c-4791-8967-ec0739d41c6e', 'shop_5', '5', '17.0', '85', '240', '898', '0.94', '0.88', 't', '2', '启用', '2026-09-25 18:29:02.967068+00'
WHERE NOT EXISTS (SELECT 1 FROM public.shop_plans WHERE plan_code = 'shop_5');
INSERT INTO public.shop_plans (id, plan_code, shop_count, unit_price, price_month, price_quarter, price_year, discount_quarter, discount_year, recommended, sort_order, status, created_at)
SELECT '49bde05b-e4e3-4cca-a890-5eff4be72dbb', 'shop_10', '10', '15.0', '150', '421', '1512', '0.935', '0.84', 'f', '3', '启用', '2026-09-25 18:29:02.967068+00'
WHERE NOT EXISTS (SELECT 1 FROM public.shop_plans WHERE plan_code = 'shop_10');
INSERT INTO public.shop_plans (id, plan_code, shop_count, unit_price, price_month, price_quarter, price_year, discount_quarter, discount_year, recommended, sort_order, status, created_at)
SELECT 'a60ecbb4-a340-422e-aa8f-bd2330e0921d', 'shop_20', '20', '13.0', '260', '725', '2496', '0.93', '0.80', 'f', '4', '启用', '2026-09-25 18:29:02.967068+00'
WHERE NOT EXISTS (SELECT 1 FROM public.shop_plans WHERE plan_code = 'shop_20');
INSERT INTO public.shop_plans (id, plan_code, shop_count, unit_price, price_month, price_quarter, price_year, discount_quarter, discount_year, recommended, sort_order, status, created_at)
SELECT 'f9551129-bac4-4592-84ab-14ea7efe6588', 'shop_50', '50', '11.0', '550', '1524', '4884', '0.925', '0.74', 'f', '5', '启用', '2026-09-25 18:29:02.967068+00'
WHERE NOT EXISTS (SELECT 1 FROM public.shop_plans WHERE plan_code = 'shop_50');
INSERT INTO public.shop_plans (id, plan_code, shop_count, unit_price, price_month, price_quarter, price_year, discount_quarter, discount_year, recommended, sort_order, status, created_at)
SELECT '50ff6319-cefb-4392-95a0-5551a6cf824b', 'shop_100', '100', '9.0', '900', '2475', '7344', '0.92', '0.68', 'f', '6', '启用', '2026-09-25 18:29:02.967068+00'
WHERE NOT EXISTS (SELECT 1 FROM public.shop_plans WHERE plan_code = 'shop_100');

-- ===== public.platform_auth_config（13 行，业务键 platform_key）=====
INSERT INTO public.platform_auth_config (id, platform_key, platform_name, region, auth_type, oauth_ready, sort_order, note, updated_at)
SELECT '42fb12ba-1b04-4e5e-982c-023f83a5ebb0', 'Shopify', 'Shopify', '独立站', 'oauth', 'f', '10', '平台官方支持 OAuth。后端 shop-oauth 已实现，待配置 SHOPIFY_CLIENT_ID/SECRET 后启用', '2026-09-27 00:28:06.002271+00'
WHERE NOT EXISTS (SELECT 1 FROM public.platform_auth_config WHERE platform_key = 'Shopify');
INSERT INTO public.platform_auth_config (id, platform_key, platform_name, region, auth_type, oauth_ready, sort_order, note, updated_at)
SELECT 'd3a429b8-1683-41d7-94c6-7983f73aff0e', 'TikTok Shop', 'TikTok Shop', '短视频电商', 'oauth', 'f', '20', '平台官方支持 OAuth 一键授权。后端待接入', '2026-09-27 00:28:06.002271+00'
WHERE NOT EXISTS (SELECT 1 FROM public.platform_auth_config WHERE platform_key = 'TikTok Shop');
INSERT INTO public.platform_auth_config (id, platform_key, platform_name, region, auth_type, oauth_ready, sort_order, note, updated_at)
SELECT 'dd33b532-3e8e-40a7-99f8-271d49fc6812', 'Lazada', 'Lazada', '东南亚', 'oauth', 'f', '30', '平台官方支持 OAuth 一键授权。后端待接入', '2026-09-27 00:28:06.002271+00'
WHERE NOT EXISTS (SELECT 1 FROM public.platform_auth_config WHERE platform_key = 'Lazada');
INSERT INTO public.platform_auth_config (id, platform_key, platform_name, region, auth_type, oauth_ready, sort_order, note, updated_at)
SELECT '298e0cc4-e6e9-4dd9-9c5a-22d40ded4cb0', 'Shopee', 'Shopee', '东南亚', 'oauth', 'f', '40', '平台官方支持 OAuth（部分站点）。后端待接入', '2026-09-27 00:28:06.002271+00'
WHERE NOT EXISTS (SELECT 1 FROM public.platform_auth_config WHERE platform_key = 'Shopee');
INSERT INTO public.platform_auth_config (id, platform_key, platform_name, region, auth_type, oauth_ready, sort_order, note, updated_at)
SELECT 'e6ef82f2-8b74-45c0-be0e-2ca6fd1f43d5', 'Amazon US', 'Amazon', '美国站', 'manual', 'f', '50', '需手动填写 SP-API 密钥与卖家ID', '2026-09-27 00:28:06.002271+00'
WHERE NOT EXISTS (SELECT 1 FROM public.platform_auth_config WHERE platform_key = 'Amazon US');
INSERT INTO public.platform_auth_config (id, platform_key, platform_name, region, auth_type, oauth_ready, sort_order, note, updated_at)
SELECT 'f9b9daf4-68ce-4bb6-9768-e2797d3de618', 'Amazon JP', 'Amazon', '日本站', 'manual', 'f', '51', '需手动填写 SP-API 密钥与卖家ID', '2026-09-27 00:28:06.002271+00'
WHERE NOT EXISTS (SELECT 1 FROM public.platform_auth_config WHERE platform_key = 'Amazon JP');
INSERT INTO public.platform_auth_config (id, platform_key, platform_name, region, auth_type, oauth_ready, sort_order, note, updated_at)
SELECT '3590d7ba-8cd3-4c67-b55f-4e10d805bc63', 'Amazon EU', 'Amazon', '欧洲站', 'manual', 'f', '52', '需手动填写 SP-API 密钥与卖家ID', '2026-09-27 00:28:06.002271+00'
WHERE NOT EXISTS (SELECT 1 FROM public.platform_auth_config WHERE platform_key = 'Amazon EU');
INSERT INTO public.platform_auth_config (id, platform_key, platform_name, region, auth_type, oauth_ready, sort_order, note, updated_at)
SELECT '982c663d-7266-42bc-8f6b-81e6a1b77dc9', 'eBay', 'eBay', '全球拍卖', 'manual', 'f', '60', '需手动填写 API 密钥与店铺信息', '2026-09-27 00:28:06.002271+00'
WHERE NOT EXISTS (SELECT 1 FROM public.platform_auth_config WHERE platform_key = 'eBay');
INSERT INTO public.platform_auth_config (id, platform_key, platform_name, region, auth_type, oauth_ready, sort_order, note, updated_at)
SELECT '0aacddb9-adc1-48d9-99f4-4040ee76ff6d', 'Walmart', 'Walmart', '美国商超', 'manual', 'f', '70', '需手动填写 API 密钥与店铺信息', '2026-09-27 00:28:06.002271+00'
WHERE NOT EXISTS (SELECT 1 FROM public.platform_auth_config WHERE platform_key = 'Walmart');
INSERT INTO public.platform_auth_config (id, platform_key, platform_name, region, auth_type, oauth_ready, sort_order, note, updated_at)
SELECT 'bc1890f1-0da1-4c8b-8783-777ca1fdbd26', 'Etsy', 'Etsy', '手工艺品', 'manual', 'f', '80', '需手动填写 API 密钥与店铺信息', '2026-09-27 00:28:06.002271+00'
WHERE NOT EXISTS (SELECT 1 FROM public.platform_auth_config WHERE platform_key = 'Etsy');
INSERT INTO public.platform_auth_config (id, platform_key, platform_name, region, auth_type, oauth_ready, sort_order, note, updated_at)
SELECT '30e57950-a739-445e-863c-73401691b428', 'Temu', 'Temu', '全托管', 'manual', 'f', '90', '平台未开放 OAuth，需手动填写店铺信息', '2026-09-27 00:28:06.002271+00'
WHERE NOT EXISTS (SELECT 1 FROM public.platform_auth_config WHERE platform_key = 'Temu');
INSERT INTO public.platform_auth_config (id, platform_key, platform_name, region, auth_type, oauth_ready, sort_order, note, updated_at)
SELECT 'c6e6c2af-4a16-4774-9d2f-f0f20e60669b', 'Shein', 'Shein', '快时尚', 'manual', 'f', '100', '平台未开放 OAuth，需手动填写店铺信息', '2026-09-27 00:28:06.002271+00'
WHERE NOT EXISTS (SELECT 1 FROM public.platform_auth_config WHERE platform_key = 'Shein');
INSERT INTO public.platform_auth_config (id, platform_key, platform_name, region, auth_type, oauth_ready, sort_order, note, updated_at)
SELECT 'f2fdd9ba-98d3-400b-b6cf-d13cbcd753b8', 'AliExpress', 'AliExpress', '速卖通', 'manual', 'f', '110', '平台未开放 OAuth，需手动填写店铺信息', '2026-09-27 00:28:06.002271+00'
WHERE NOT EXISTS (SELECT 1 FROM public.platform_auth_config WHERE platform_key = 'AliExpress');
