-- 短信验证码表：存储阿里云短信验证码，用于注册验证
CREATE TABLE IF NOT EXISTS public.sms_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_codes_phone ON public.sms_codes (phone, created_at DESC);

ALTER TABLE public.sms_codes ENABLE ROW LEVEL SECURITY;

-- 验证码表仅由 Edge Function（service role）读写，前端不直接访问
CREATE POLICY service_role_all_sms_codes ON public.sms_codes
  FOR ALL USING (true) WITH CHECK (true);