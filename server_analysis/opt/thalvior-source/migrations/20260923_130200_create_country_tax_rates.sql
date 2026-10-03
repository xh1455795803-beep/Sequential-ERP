-- 目的国关税/VAT 税率表：存储各国海关关税税率与 VAT/销售税率
CREATE TABLE IF NOT EXISTS public.country_tax_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  country_code TEXT NOT NULL,
  country_name TEXT NOT NULL,
  duty_rate NUMERIC NOT NULL DEFAULT 0,
  vat_rate NUMERIC NOT NULL DEFAULT 0,
  tax_free_threshold NUMERIC,
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 种子数据：各国通用关税税率与 VAT/销售税率（估算基准值，可在后台维护更新）
INSERT INTO public.country_tax_rates (country_code, country_name, duty_rate, vat_rate, tax_free_threshold, note, sort_order) VALUES
  ('US', '美国', 0, 0, 800, '800 美元以下免税', 1),
  ('UK', '英国', 4, 20, NULL, NULL, 2),
  ('DE', '德国', 4, 19, NULL, NULL, 3),
  ('FR', '法国', 4, 20, NULL, NULL, 4),
  ('IT', '意大利', 4, 22, NULL, NULL, 5),
  ('ES', '西班牙', 4, 21, NULL, NULL, 6),
  ('JP', '日本', 5, 10, NULL, NULL, 7),
  ('CA', '加拿大', 5, 5, NULL, NULL, 8),
  ('AU', '澳大利亚', 5, 10, NULL, NULL, 9);