-- shop_auths 补列 migration
-- 目的：让 shop_auths 跟 platform_configs 对齐，支持 OAuth/手动双模式 + 状态追踪

-- 1) 加 created_at
ALTER TABLE IF EXISTS public.shop_auths
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 2) 加 updated_at（更新时自动刷新用 trigger）
ALTER TABLE IF EXISTS public.shop_auths
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 3) 加 auth_type（从 platform_configs.auth_type 继承）
ALTER TABLE IF EXISTS public.shop_auths
  ADD COLUMN IF NOT EXISTS auth_type TEXT DEFAULT 'manual';

-- 4) 给已有数据补 created_at（优先用 authorized_at，其次 verify_at，最次 now()）
UPDATE public.shop_auths
   SET created_at = COALESCE(nullif(authorized_at, ''), verify_at, now())::timestamptz
 WHERE created_at = now() AND created_at::date = now()::date;

-- 5) 给已有数据补 auth_type（从 platform_configs 查）
UPDATE public.shop_auths a
   SET auth_type = COALESCE(c.auth_type, 'manual')
 FROM public.platform_configs c
 WHERE a.platform = c.name;

-- 6) status 字段统一枚举语义（防止自由文本乱飘）
UPDATE public.shop_auths
   SET status = CASE
     WHEN status IN ('正常', '已授权', 'active', 'ACTIVE', null, '') THEN '已授权'
     WHEN status IN ('停用', '过期', 'expired', 'EXPIRED') THEN '已过期'
     WHEN status IN ('待验证', '待授权', 'pending', 'PENDING') THEN '待验证'
     ELSE status
   END;

-- 7) 给 shop_auths 的 status 加 CHECK 约束（可选：先不加，避免跟存量冲突）
DO $$
BEGIN
  ALTER TABLE public.shop_auths
    ADD CONSTRAINT shop_auths_status_check
    CHECK (status IN ('已授权', '待验证', '已过期', '已停用'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 8) created_at 建索引（最近授权排序用）
CREATE INDEX IF NOT EXISTS idx_shop_auths_created_at
  ON public.shop_auths(created_at DESC);

-- 9) 完整 DROP + 重建 RLS policy（确保 auth_type 不会被 RLS 挡）
-- 用户：只能看自己的；admin：全表管理

DROP POLICY IF EXISTS users_select_shop_auths ON public.shop_auths;
CREATE POLICY users_select_shop_auths ON public.shop_auths
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS users_insert_shop_auths ON public.shop_auths;
CREATE POLICY users_insert_shop_auths ON public.shop_auths
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS users_update_shop_auths ON public.shop_auths;
CREATE POLICY users_update_shop_auths ON public.shop_auths
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS users_delete_shop_auths ON public.shop_auths;
CREATE POLICY users_delete_shop_auths ON public.shop_auths
  FOR DELETE USING (user_id = auth.uid());

DROP POLICY IF EXISTS admins_select_shop_auths ON public.shop_auths;
CREATE POLICY admins_select_shop_auths ON public.shop_auths
  FOR SELECT USING (has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS admins_insert_shop_auths ON public.shop_auths;
CREATE POLICY admins_insert_shop_auths ON public.shop_auths
  FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS admins_update_shop_auths ON public.shop_auths;
CREATE POLICY admins_update_shop_auths ON public.shop_auths
  FOR UPDATE USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS admins_delete_shop_auths ON public.shop_auths;
CREATE POLICY admins_delete_shop_auths ON public.shop_auths
  FOR DELETE USING (has_role(auth.uid(), 'admin'));
