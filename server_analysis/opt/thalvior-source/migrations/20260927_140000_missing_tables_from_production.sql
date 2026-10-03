-- ============================================================
-- 缺失表结构补齐（从生产库反向生成）
-- 生成时间：2026-09-27 13:55 · 来源：43.133.232.81 生产库 pg_dumpall
-- 背景：以下 7 张表在线上库中存在，但 migrations/ 中没有任何建表语句（线上手工创建，未留迁移）
-- 影响：新环境从零执行 migrations 会缺表 → AI 计费 / 发票 / 店铺套餐 / 平台授权 / 邮箱验证码不可用
-- 幂等：全部语句均可重复执行（CREATE ... IF NOT EXISTS / DROP ... IF EXISTS 前置）
-- 依赖：策略部分引用 Supabase 内置角色与 public.has_role()/auth.uid()，需在 Supabase 库中执行
-- 幂等角色兜底：标准 Supabase 库已存在这些角色，此处 IF NOT EXISTS 保证脚本可移植
-- 验证：已在 postgres:15 实测执行通过（策略部分依赖 has_role/auth.uid，已在测试库以同名桩函数验证语法）
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.ai_cash_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    service_key text NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit_price numeric DEFAULT 0 NOT NULL,
    amount numeric DEFAULT 0 NOT NULL,
    free_used integer DEFAULT 0 NOT NULL,
    paid_used integer DEFAULT 0 NOT NULL,
    balance_after numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.ai_free_quotas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    image_translate_free integer DEFAULT 5 NOT NULL,
    shop_plan_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.credit_packages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    package_code text NOT NULL,
    name text NOT NULL,
    credits numeric DEFAULT 0 NOT NULL,
    price numeric DEFAULT 0 NOT NULL,
    original_price numeric DEFAULT 0 NOT NULL,
    per_credit numeric DEFAULT 0 NOT NULL,
    tag text,
    recommended boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    status text DEFAULT '启用'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.email_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    code_hash text NOT NULL,
    scene text DEFAULT 'login'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used boolean DEFAULT false NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    invoice_no text,
    invoice_type text DEFAULT 'normal'::text NOT NULL,
    title_type text DEFAULT 'personal'::text NOT NULL,
    title text NOT NULL,
    tax_no text,
    amount numeric DEFAULT 0 NOT NULL,
    content text DEFAULT '信息技术服务费'::text NOT NULL,
    email text,
    remark text,
    status text DEFAULT 'pending'::text NOT NULL,
    reject_reason text,
    order_nos jsonb DEFAULT '[]'::jsonb NOT NULL,
    file_url text,
    issued_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.platform_auth_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    platform_key text NOT NULL,
    platform_name text NOT NULL,
    region text DEFAULT ''::text NOT NULL,
    auth_type text DEFAULT 'manual'::text NOT NULL,
    oauth_ready boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    note text DEFAULT ''::text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_auth_config_auth_type_check CHECK ((auth_type = ANY (ARRAY['oauth'::text, 'manual'::text])))
);

CREATE TABLE IF NOT EXISTS public.shop_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_code text NOT NULL,
    shop_count integer NOT NULL,
    unit_price numeric NOT NULL,
    price_month numeric NOT NULL,
    price_quarter numeric NOT NULL,
    price_year numeric NOT NULL,
    discount_quarter numeric NOT NULL,
    discount_year numeric NOT NULL,
    recommended boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    status text DEFAULT '启用'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ===== 索引 =====
CREATE INDEX IF NOT EXISTS ai_cash_usage_user_idx ON public.ai_cash_usage USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_codes_lookup_idx ON public.email_codes USING btree (email, scene, created_at DESC);
CREATE INDEX IF NOT EXISTS invoices_status_idx ON public.invoices USING btree (status, created_at DESC);
CREATE INDEX IF NOT EXISTS invoices_user_idx ON public.invoices USING btree (user_id, created_at DESC);

-- ===== 唯一约束 / 外键 =====
-- 无

-- ===== 依赖函数（invoices 自动更新 updated_at）=====
CREATE OR REPLACE FUNCTION public.touch_invoices() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ===== 触发器 =====
DROP TRIGGER IF EXISTS trg_touch_invoices ON public.invoices;
CREATE TRIGGER trg_touch_invoices BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.touch_invoices();

-- ===== 行级安全策略 =====
DROP POLICY IF EXISTS "admins_all_credit_packages" ON public.credit_packages;
CREATE POLICY admins_all_credit_packages ON public.credit_packages TO authenticated USING (public.has_role(auth.uid(), 'admin'::text)) WITH CHECK (public.has_role(auth.uid(), 'admin'::text));
DROP POLICY IF EXISTS "admins_all_free_quota" ON public.ai_free_quotas;
CREATE POLICY admins_all_free_quota ON public.ai_free_quotas TO authenticated USING (public.has_role(auth.uid(), 'admin'::text)) WITH CHECK (public.has_role(auth.uid(), 'admin'::text));
DROP POLICY IF EXISTS "admins_all_invoices" ON public.invoices;
CREATE POLICY admins_all_invoices ON public.invoices TO authenticated USING (public.has_role(auth.uid(), 'admin'::text)) WITH CHECK (public.has_role(auth.uid(), 'admin'::text));
DROP POLICY IF EXISTS "admins_all_shop_plans" ON public.shop_plans;
CREATE POLICY admins_all_shop_plans ON public.shop_plans TO authenticated USING (public.has_role(auth.uid(), 'admin'::text)) WITH CHECK (public.has_role(auth.uid(), 'admin'::text));
DROP POLICY IF EXISTS "anyone_read_platform_auth_config" ON public.platform_auth_config;
CREATE POLICY anyone_read_platform_auth_config ON public.platform_auth_config FOR SELECT TO authenticated, anon USING (true);
DROP POLICY IF EXISTS "public_select_credit_packages" ON public.credit_packages;
CREATE POLICY public_select_credit_packages ON public.credit_packages FOR SELECT TO authenticated, anon USING (true);
DROP POLICY IF EXISTS "public_select_shop_plans" ON public.shop_plans;
CREATE POLICY public_select_shop_plans ON public.shop_plans FOR SELECT TO authenticated, anon USING (true);
DROP POLICY IF EXISTS "users_insert_own_invoices" ON public.invoices;
CREATE POLICY users_insert_own_invoices ON public.invoices FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));
DROP POLICY IF EXISTS "users_select_own_cash_usage" ON public.ai_cash_usage;
CREATE POLICY users_select_own_cash_usage ON public.ai_cash_usage FOR SELECT TO authenticated USING ((user_id = auth.uid()));
DROP POLICY IF EXISTS "users_select_own_free_quota" ON public.ai_free_quotas;
CREATE POLICY users_select_own_free_quota ON public.ai_free_quotas FOR SELECT TO authenticated USING ((user_id = auth.uid()));
DROP POLICY IF EXISTS "users_select_own_invoices" ON public.invoices;
CREATE POLICY users_select_own_invoices ON public.invoices FOR SELECT TO authenticated USING ((user_id = auth.uid()));

-- ===== 注释 =====
-- 无
