-- fix P0（2026-10-07）：
-- 1) sms_codes 增加 client_ip 用于 IP 维度限流；RLS 策略由 public 收紧为仅 service_role
-- 2) 补建前端「刊登 → Listing 模板」页（table=listing_templates）缺失的表，
--    结构/隔离与 listing_tasks 同构（user_id = auth.uid()）

-- ========== 1. sms_codes 限流配套 ==========
ALTER TABLE public.sms_codes ADD COLUMN IF NOT EXISTS client_ip TEXT;

CREATE INDEX IF NOT EXISTS idx_sms_codes_ip
  ON public.sms_codes (client_ip, created_at DESC);

-- 该表仅由 Edge Function 以 service_role（默认 BYPASSRLS）访问；
-- 旧策略未指定角色（等同对 public 生效），此处显式收紧
DROP POLICY IF EXISTS service_role_all_sms_codes ON public.sms_codes;

CREATE POLICY service_role_all_sms_codes ON public.sms_codes
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ========== 2. listing_templates 补建 ==========
CREATE TABLE IF NOT EXISTS public.listing_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  name TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  title_rule TEXT NOT NULL DEFAULT '',
  desc_rule TEXT NOT NULL DEFAULT '',
  price_rule TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '启用',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_templates_user
  ON public.listing_templates (user_id);

ALTER TABLE public.listing_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_own_listing_templates ON public.listing_templates
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY users_insert_own_listing_templates ON public.listing_templates
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY users_update_own_listing_templates ON public.listing_templates
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

CREATE POLICY users_delete_own_listing_templates ON public.listing_templates
  FOR DELETE TO authenticated USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.listing_templates TO authenticated;
