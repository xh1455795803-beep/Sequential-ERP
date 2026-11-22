-- =====================================================================================
-- zz_20261117_wA09_is_active_user.sql   -- Wave A / T12, 2026-11-17
--
-- 目的：把「已申请注销 / 已匿名化」的身份从业务数据的 RLS 可达面上摘掉。
--
-- 背景（为什么 T11 单独不够）：
--   execute_account_deletion() 会删掉 sessions / refresh_tokens / one_time_tokens，
--   并把 auth.users 打上 banned_until +100 年。但 access token 的 TTL 是 1 小时：
--   执行完成后的 ≤60 分钟内，一个仍然有效的 JWT 照样能通过 PostgREST 读写这个账号的
--   全部业务数据；宽限期内（申请后 30 天）账号更是完全正常可用。
--   T12 把「身份是否还活着」这件事收敛成一个可复用的 RLS 谓词，堵住这两个窗口。
--
-- 语义（微信/Google 的「冷静期冻结」模型）：
--   inactive = profiles.deleted_at IS NOT NULL  或  存在 pending 的 account_deletions 记录
--   inactive 的身份对下面 15 条策略覆盖的表：读不到、写不进、改不了、删不了。
--
-- 刻意**没有**加谓词的地方（否则会把撤销通道本身锁死）：
--   * profiles            : users_select_own_profile / users_insert_own_profile /
--                           users_update_own_profile   —— SPA 的会话引导（src/lib/auth.ts:77）
--                           读这一张表；一挡，用户既进不了 /profile 也点不了「撤销」。
--   * account_deletions   : account_deletions_self_select —— 注销卡片的状态来源，必须可读。
--   * user_consents       : user_consents_self_select    —— 同意证据本身。
--   * admins_* / role='admin' 类策略、公告与平台配置类 public 读、所有 service_role 路径
--     （service_role 有 bypassrls，本来就不受策略约束；Edge Function 用它跑批不受影响）。
--   * refunds             —— 波 D 的文件；建议 D 自行在同一策略上 AND 同一个谓词，
--     已在波 A 收尾报告里作为跨波风险提示给 D。
--   * purchase_orders     —— 表 owner 是 supabase_admin，postgres 会话无权改策略；
--     补齐语句见本文件末尾「已知遗漏」，需单独用 supabase_admin 会话执行一次。
--
-- 防枚举：is_active_user(p_uid) 只回答「调用者自己是不是活跃」，
--   传别人的 uuid 一律返回 false，所以即使被当成 RPC 暴露出去也不是枚举预言机。
--
-- 回滚：见 /opt/wA-rollback.sql 第 16 节（含 15 条策略的原始定义逐字备份）。
-- =====================================================================================

SET lock_timeout = '5s';
SET statement_timeout = '60s';

BEGIN;

-- ------------------------------------------------------------------ 1. the predicate
CREATE OR REPLACE FUNCTION public.is_active_user(p_uid uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  -- anon / 纯 SQL 批处理（cron、psql、EF 直连）没有 JWT：一律视为不活跃。
  -- 这些上下文本来就走 bypassrls 或 anon 策略，不会因此失去合法访问。
  IF v_caller IS NULL THEN
    RETURN false;
  END IF;

  -- 只回答关于自己的问题，别人的一律 false（杜绝枚举）。
  IF p_uid IS DISTINCT FROM v_caller THEN
    RETURN false;
  END IF;

  -- 没有 profiles 行：不属于本特性管辖，交给原策略里的身份谓词判断。
  IF NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = v_caller) THEN
    RETURN true;
  END IF;

  RETURN NOT (
        EXISTS (SELECT 1 FROM public.profiles pr
                 WHERE pr.id = v_caller AND pr.deleted_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.account_deletions ad
                 WHERE ad.user_id = v_caller AND ad.status = 'pending')
  );
END;
$$;

COMMENT ON FUNCTION public.is_active_user(uuid) IS
  'Wave A/T12: one RLS predicate for "this identity is still alive". false for anon/service '
  'contexts (auth.uid() IS NULL), false for anyone other than the caller (anti-enumeration), '
  'false once account deletion is requested (profiles.deleted_at / pending account_deletions) '
  'or after erasure. Policies call it as (SELECT public.is_active_user(auth.uid())) -- a scalar '
  'sub-select with no outer reference, which the planner turns into an InitPlan, so the '
  'two index probes run ONCE per query instead of once per scanned row (verified via EXPLAIN '
  'as role authenticated; calling it bare leaves it in the per-row Filter).';

REVOKE ALL ON FUNCTION public.is_active_user(uuid) FROM PUBLIC;
-- TO PUBLIC 的策略在 anon 身份下也会求值，所以 anon 必须有 EXECUTE，
-- 否则 anon 访问这些表会从「返回空集」变成「42501 报错」。
GRANT EXECUTE ON FUNCTION public.is_active_user(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_active_user(uuid) TO postgres, supabase_admin;

ALTER FUNCTION public.is_active_user(uuid) OWNER TO postgres;

-- ------------------------------------------------------------------ 2. policy rewrites
-- 每条都是「原样保留原有子句，只是再 AND 上 is_active_user(auth.uid())」；
-- 角色子句逐字照抄线上定义（{0}=TO PUBLIC，{16444}=TO authenticated）。

-- ---- public.orders (TO PUBLIC) --------------------------------------------------------
DROP POLICY IF EXISTS users_select_orders ON public.orders;
CREATE POLICY users_select_orders ON public.orders
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((user_id = auth.uid()) AND (SELECT public.is_active_user(auth.uid()))));

DROP POLICY IF EXISTS users_insert_orders ON public.orders;
CREATE POLICY users_insert_orders ON public.orders
  AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (((user_id = auth.uid()) AND (SELECT public.is_active_user(auth.uid()))));

DROP POLICY IF EXISTS users_update_orders ON public.orders;
CREATE POLICY users_update_orders ON public.orders
  AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (((user_id = auth.uid()) AND (SELECT public.is_active_user(auth.uid()))))
  WITH CHECK (((user_id = auth.uid()) AND (SELECT public.is_active_user(auth.uid()))));

DROP POLICY IF EXISTS users_delete_orders ON public.orders;
CREATE POLICY users_delete_orders ON public.orders
  AS PERMISSIVE FOR DELETE TO PUBLIC
  USING (((user_id = auth.uid()) AND (SELECT public.is_active_user(auth.uid()))));

-- ---- public.invoices (TO authenticated) ----------------------------------------------
DROP POLICY IF EXISTS users_select_own_invoices ON public.invoices;
CREATE POLICY users_select_own_invoices ON public.invoices
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id = auth.uid()) AND (SELECT public.is_active_user(auth.uid()))));

DROP POLICY IF EXISTS users_insert_own_invoices ON public.invoices;
CREATE POLICY users_insert_own_invoices ON public.invoices
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((user_id = auth.uid()) AND (SELECT public.is_active_user(auth.uid()))));

DROP POLICY IF EXISTS users_update_own_invoices ON public.invoices;
CREATE POLICY users_update_own_invoices ON public.invoices
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((((user_id = auth.uid()) AND (status = 'pending'::text)) AND (SELECT public.is_active_user(auth.uid()))))
  WITH CHECK (((user_id = auth.uid()) AND (SELECT public.is_active_user(auth.uid()))));

-- ---- public.statements (TO PUBLIC) --------------------------------------------------
DROP POLICY IF EXISTS users_select_statements ON public.statements;
CREATE POLICY users_select_statements ON public.statements
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((auth.uid() = user_id) AND (SELECT public.is_active_user(auth.uid()))));

-- ---- public.shop_auths (TO PUBLIC) --------------------------------------------------
DROP POLICY IF EXISTS users_select_shop_auths ON public.shop_auths;
CREATE POLICY users_select_shop_auths ON public.shop_auths
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((user_id = auth.uid()) AND (SELECT public.is_active_user(auth.uid()))));

-- ---- public.suppliers (TO PUBLIC) ---------------------------------------------------
DROP POLICY IF EXISTS users_select_suppliers ON public.suppliers;
CREATE POLICY users_select_suppliers ON public.suppliers
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((user_id = auth.uid()) AND (SELECT public.is_active_user(auth.uid()))));

-- ---- public.shipments (TO PUBLIC) ---------------------------------------------------
DROP POLICY IF EXISTS users_select_shipments ON public.shipments;
CREATE POLICY users_select_shipments ON public.shipments
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((user_id = auth.uid()) AND (SELECT public.is_active_user(auth.uid()))));

-- ---- public.work_orders (TO PUBLIC) -------------------------------------------------
DROP POLICY IF EXISTS users_select_work_orders ON public.work_orders;
CREATE POLICY users_select_work_orders ON public.work_orders
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((auth.uid() = user_id) AND (SELECT public.is_active_user(auth.uid()))));

-- ---- public.shop_auths 更新通道 (TO PUBLIC) ----------------------------------------
-- 冻结中的身份不得改写 OAuth 授权行（否则能在“已申请注销”后继续刷新店铺授权链路）。
DROP POLICY IF EXISTS users_update_shop_auths ON public.shop_auths;
CREATE POLICY users_update_shop_auths ON public.shop_auths
  AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (((user_id = auth.uid()) AND (SELECT public.is_active_user(auth.uid()))))
  WITH CHECK (((user_id = auth.uid()) AND (SELECT public.is_active_user(auth.uid()))));

-- ---- 已知遗漏（**不是**忘了）：public.purchase_orders --------------------------------
-- purchase_orders_owner_select 需要同样 AND 上本谓词，但那张表的 owner 是 supabase_admin，
-- 而本仓库存迁移统一以 postgres 身份回放，postgres 既非 superuser 也不是 supabase_admin 成员：
--   postgres> SET ROLE supabase_admin;  →  ERROR: permission denied to set role
--   postgres> DROP POLICY ... purchase_orders → ERROR: must be owner of relation
-- 所以留给一次独立会话执行（重启窗口里由运维用下面这条，勿放入常规迁移链）：
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c \
--     "DROP POLICY IF EXISTS purchase_orders_owner_select ON public.purchase_orders;
--      CREATE POLICY purchase_orders_owner_select ON public.purchase_orders
--        AS PERMISSIVE FOR SELECT TO authenticated
--        USING (((user_id = ( SELECT auth.uid() AS uid))
--                 AND (SELECT public.is_active_user(auth.uid()))));"

-- ---- public.sub_accounts (TO PUBLIC) ------------------------------------------------
DROP POLICY IF EXISTS users_select_own_sub_accounts ON public.sub_accounts;
CREATE POLICY users_select_own_sub_accounts ON public.sub_accounts
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((user_id = auth.uid()) AND (SELECT public.is_active_user(auth.uid()))));

-- ---- public.listing_templates (TO authenticated) ------------------------------------
DROP POLICY IF EXISTS users_select_own_listing_templates ON public.listing_templates;
CREATE POLICY users_select_own_listing_templates ON public.listing_templates
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id = auth.uid()) AND (SELECT public.is_active_user(auth.uid()))));

COMMIT;

-- 让 PostgREST 立刻看到新函数（无需重启容器）
NOTIFY pgrst, 'reload schema';
