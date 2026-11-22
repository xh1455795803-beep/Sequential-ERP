-- shop_auths 升级：补 created_at/updated_at/auth_type 列
-- 统一 status 枚举语义（已授权/待验证/已过期/已停用）
-- 8 个 RLS policy（4 user + 4 admin）

ALTER TABLE shop_auths ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE shop_auths ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE shop_auths ADD COLUMN IF NOT EXISTS auth_type TEXT;

-- 存量数据回填
UPDATE shop_auths SET auth_type = COALESCE(
  (SELECT auth_type FROM platform_configs WHERE name = shop_auths.platform),
  'manual'
) WHERE auth_type IS NULL;

UPDATE shop_auths SET status = CASE
  WHEN status IN ('正常','已授权','active','ACTIVE') THEN '已授权'
  WHEN status IN ('停用','过期','expired','EXPIRED') THEN '已过期'
  WHEN status IN ('待验证','待授权','pending','PENDING') THEN '待验证'
  ELSE COALESCE(status, '已授权')
END;

DO $$ BEGIN
  ALTER TABLE shop_auths ADD CONSTRAINT shop_auths_status_check
    CHECK (status IN ('已授权','待验证','已过期','已停用'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_shop_auths_created_at ON shop_auths(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shop_auths_auth_type ON shop_auths(auth_type);

-- RLS：8 个 policy（已由 pg_policies 验证存在）
-- users_select / users_insert / users_update / users_delete
-- admins_select / admins_insert / admins_update / admins_delete
