-- 商品采集：只有 HTML 解析失败、需要 AI 兜底解析时才会调用大模型（qwen3.6-plus）
-- 因此按官方 Token 单价计费，未触发 AI 兜底时费用为 0（真实成本，不做虚假标价）
INSERT INTO public.service_pricing
  (service_name, service_key, model, unit_price, unit, status, billing_mode,
   input_price_per_mtok, output_price_per_mtok, price_tiers, source_url)
VALUES
  ('智能采集', 'collect', 'qwen3.6-plus', 0, '按 Token 计费（仅 AI 兜底时）', '启用', 'token', 2, 12,
   '[{"up_to_tokens":256000,"input":2,"output":12},{"up_to_tokens":1000000,"input":8,"output":48}]'::jsonb,
   'https://docs.bailian.console.aliyun.com/zh/model-studio/model-pricing')
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
