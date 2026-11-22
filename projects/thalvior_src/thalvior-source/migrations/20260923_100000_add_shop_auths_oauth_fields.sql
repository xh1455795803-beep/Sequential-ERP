-- 为 shop_auths 表新增 OAuth 授权凭证字段，用于真实存储第三方平台授权 token
ALTER TABLE public.shop_auths
  ADD COLUMN IF NOT EXISTS access_token TEXT,
  ADD COLUMN IF NOT EXISTS refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shop_domain TEXT,
  ADD COLUMN IF NOT EXISTS scope TEXT;