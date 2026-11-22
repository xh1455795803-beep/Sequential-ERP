-- ============================================
-- 租户冻结能力：profiles 表新增 status 字段 + 管理员可更新策略
-- status: active（正常）/ frozen（已冻结）
-- ============================================

-- 1. profiles 表新增 status 字段
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- 2. 管理员可更新租户状态（冻结/解冻）
CREATE POLICY admins_update_profiles ON public.profiles
  FOR UPDATE USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));