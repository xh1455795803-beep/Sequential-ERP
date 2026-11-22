-- AI 能力按阿里云百炼官方真实单价计费
-- 价格来源（2026-09-25 核对，华北2（北京）地域，按量付费原价，不含限时折扣）：
--   https://docs.bailian.console.aliyun.com/zh/model-studio/model-pricing
--   https://help.aliyun.com/zh/model-studio/qwen-image-2-0
--
-- qwen3.6-plus  : 0<Token≤256K 输入 2 元/百万、输出 12 元/百万；256K<Token≤1M 输入 8、输出 48
-- qwen3-vl-plus : 0<Token≤32K 输入 1、输出 10；32K<Token≤128K 输入 1.5、输出 15；128K<Token≤256K 输入 3、输出 30
-- qwen-image-2.0: 0.2 元/张（按张计费）

-- 1) 扩展计费字段
ALTER TABLE public.service_pricing
  ADD COLUMN IF NOT EXISTS billing_mode text NOT NULL DEFAULT 'flat',          -- flat | token | per_image
  ADD COLUMN IF NOT EXISTS input_price_per_mtok numeric NOT NULL DEFAULT 0,    -- 输入单价（元/百万 Token）
  ADD COLUMN IF NOT EXISTS output_price_per_mtok numeric NOT NULL DEFAULT 0,   -- 输出单价（元/百万 Token）
  ADD COLUMN IF NOT EXISTS price_tiers jsonb,                                  -- 阶梯价 [{up_to_tokens, input, output}]
  ADD COLUMN IF NOT EXISTS source_url text,                                    -- 官方价格出处
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.service_pricing.billing_mode IS
  'flat=按次固定价；token=按真实 Token 用量（阶梯）；per_image=按生成张数';
COMMENT ON COLUMN public.service_pricing.price_tiers IS
  '阶梯价 JSON 数组，按单次请求输入 Token 数取档：[{up_to_tokens, input, output}]';

-- 2) 灌入官方真实单价
--    service_key 需唯一，否则 upsert 无法定位
CREATE UNIQUE INDEX IF NOT EXISTS service_pricing_service_key_uidx
  ON public.service_pricing (service_key);

--    说明：billing_mode=token 的能力，unit_price 仅作兜底展示，真实扣费按 usage 精算
INSERT INTO public.service_pricing
  (service_name, service_key, model, unit_price, unit, status, billing_mode,
   input_price_per_mtok, output_price_per_mtok, price_tiers, source_url)
VALUES
  ('文案优化', 'copywriting', 'qwen3.6-plus', 0, '按 Token 计费', '启用', 'token', 2, 12,
   '[{"up_to_tokens":256000,"input":2,"output":12},{"up_to_tokens":1000000,"input":8,"output":48}]'::jsonb,
   'https://docs.bailian.console.aliyun.com/zh/model-studio/model-pricing'),

  ('AI 智能选品', 'ai_select', 'qwen3.6-plus', 0, '按 Token 计费', '启用', 'token', 2, 12,
   '[{"up_to_tokens":256000,"input":2,"output":12},{"up_to_tokens":1000000,"input":8,"output":48}]'::jsonb,
   'https://docs.bailian.console.aliyun.com/zh/model-studio/model-pricing'),

  ('AI 市场分析', 'ai_market', 'qwen3.6-plus', 0, '按 Token 计费', '启用', 'token', 2, 12,
   '[{"up_to_tokens":256000,"input":2,"output":12},{"up_to_tokens":1000000,"input":8,"output":48}]'::jsonb,
   'https://docs.bailian.console.aliyun.com/zh/model-studio/model-pricing'),

  ('AI 评论分析', 'ai_review', 'qwen3.6-plus', 0, '按 Token 计费', '启用', 'token', 2, 12,
   '[{"up_to_tokens":256000,"input":2,"output":12},{"up_to_tokens":1000000,"input":8,"output":48}]'::jsonb,
   'https://docs.bailian.console.aliyun.com/zh/model-studio/model-pricing'),

  ('AI 竞品分析', 'ai_competitor', 'qwen3.6-plus', 0, '按 Token 计费', '启用', 'token', 2, 12,
   '[{"up_to_tokens":256000,"input":2,"output":12},{"up_to_tokens":1000000,"input":8,"output":48}]'::jsonb,
   'https://docs.bailian.console.aliyun.com/zh/model-studio/model-pricing'),

  ('关键词挖掘', 'keyword_mining', 'qwen3.6-plus', 0, '按 Token 计费', '启用', 'token', 2, 12,
   '[{"up_to_tokens":256000,"input":2,"output":12},{"up_to_tokens":1000000,"input":8,"output":48}]'::jsonb,
   'https://docs.bailian.console.aliyun.com/zh/model-studio/model-pricing'),

  ('智能客服', 'customer_service', 'qwen3.6-plus', 0, '按 Token 计费', '启用', 'token', 2, 12,
   '[{"up_to_tokens":256000,"input":2,"output":12},{"up_to_tokens":1000000,"input":8,"output":48}]'::jsonb,
   'https://docs.bailian.console.aliyun.com/zh/model-studio/model-pricing'),

  ('图片翻译', 'image_translate', 'qwen3-vl-plus', 0, '按 Token 计费', '启用', 'token', 1, 10,
   '[{"up_to_tokens":32000,"input":1,"output":10},{"up_to_tokens":128000,"input":1.5,"output":15},{"up_to_tokens":256000,"input":3,"output":30}]'::jsonb,
   'https://docs.bailian.console.aliyun.com/zh/model-studio/model-pricing'),

  ('图片处理（生成/编辑）', 'image_process', 'qwen-image-2.0', 0.2, '张', '启用', 'per_image', 0, 0,
   NULL,
   'https://help.aliyun.com/zh/model-studio/qwen-image-2-0')
ON CONFLICT (service_key) DO UPDATE SET
  service_name = EXCLUDED.service_name,
  model = EXCLUDED.model,
  unit_price = EXCLUDED.unit_price,
  unit = EXCLUDED.unit,
  billing_mode = EXCLUDED.billing_mode,
  input_price_per_mtok = EXCLUDED.input_price_per_mtok,
  output_price_per_mtok = EXCLUDED.output_price_per_mtok,
  price_tiers = EXCLUDED.price_tiers,
  source_url = EXCLUDED.source_url,
  updated_at = now();

-- 3) 记录用量日志的真实消耗（便于对账与前端展示）
ALTER TABLE public.ai_usage_logs
  ADD COLUMN IF NOT EXISTS prompt_tokens integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completion_tokens integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.ai_usage_logs.quantity IS '按张/次计费的数量（如生图张数）';
