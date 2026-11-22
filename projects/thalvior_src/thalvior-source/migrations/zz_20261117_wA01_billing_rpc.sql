-- =====================================================================
-- Wave A / T2 : SECURITY DEFINER RPCs replacing blocked direct writes
-- File : zz_20261117_wA01_billing_rpc.sql
-- Runs as: postgres  (=> functions owned by postgres, BYPASSRLS inside)
--
-- Design rules applied to every function here:
--   * SECURITY DEFINER
--   * SET search_path = public, pg_temp          (blocks pg_temp hijack)
--   * REVOKE ALL FROM PUBLIC -> explicit EXECUTE to authenticated + service_role
--     IMPORTANT: this database has ALTER DEFAULT PRIVILEGES that auto-grants
--     EXECUTE to anon/authenticated/service_role on every new function, so
--     "FROM PUBLIC" alone is NOT enough -- anon holds a *direct* grant.
--     Every revoke below is therefore "FROM PUBLIC, anon".
--   * Authorization is checked INSIDE the function with has_role(auth.uid(),...)
--     because SECURITY DEFINER bypasses RLS -- it must never be trusted to do so.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0) helper: consistent admin assertion (used by all admin_* RPCs)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wa_assert_admin()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: authentication required' USING errcode = '42501';
  END IF;
  IF NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: admin role required' USING errcode = '42501';
  END IF;
  RETURN v_uid;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_assert_admin() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.wa_assert_admin() TO authenticated, service_role;


-- ---------------------------------------------------------------------
-- 1) user_self_topup_quota  -- placeholder stub (rejects)
--    Exists so a future legitimate self-serve topup can plug in without
--    ever re-opening direct DML on tenant_quotas.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_self_topup_quota(
  p_amount_credits bigint,
  p_amount_yuan    numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- deliberate reject: money must enter the system only through a paid order
  RAISE EXCEPTION 'manual quota topup not allowed; please use checkout'
    USING errcode = 'P0001';
END $fn$;
REVOKE ALL ON FUNCTION public.user_self_topup_quota(bigint, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.user_self_topup_quota(bigint, numeric) TO authenticated, service_role;


-- ---------------------------------------------------------------------
-- 2) user_self_redeem_license -- placeholder stub (rejects)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_self_redeem_license(
  p_platform_code text,
  p_shop_count    int,
  p_months        int
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION 'self license redemption not allowed; please use checkout'
    USING errcode = 'P0001';
END $fn$;
REVOKE ALL ON FUNCTION public.user_self_redeem_license(text, int, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.user_self_redeem_license(text, int, int) TO authenticated, service_role;


-- ---------------------------------------------------------------------
-- 3) admin_set_tenant_quota -- whitelisted single-field quota write
--    p_field whitelist: workbench_credits | agent_credits | balance
--    NOTE: signature uses bigint per spec; these three columns are numeric
--          in this schema, so a bigint argument stores a whole number.
--          For fractional balance topups use admin_topup_quota_recharge().
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_tenant_quota(
  p_user_id uuid,
  p_field   text,
  p_value   bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_ok boolean;
BEGIN
  PERFORM public.wa_assert_admin();

  SELECT (p_field = ANY (ARRAY['workbench_credits','agent_credits','balance']))
    INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'VAULT_FIELD_NOT_ALLOWED: %', p_field
      USING errcode = '22023';
  END IF;
  IF p_value IS NULL OR p_value < 0 THEN
    RAISE EXCEPTION 'INVALID_VALUE: quota field cannot be negative'
      USING errcode = '22003';
  END IF;

  -- %I on a value already proven to be one of three literals => no injection surface
  EXECUTE format(
    'UPDATE public.tenant_quotas SET %I = $1, updated_at = now() WHERE user_id = $2',
    p_field
  ) USING p_value, p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QUOTA_ROW_NOT_FOUND for %', p_user_id USING errcode = 'P0002';
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.admin_set_tenant_quota(uuid, text, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_set_tenant_quota(uuid, text, bigint) TO authenticated, service_role;


-- ---------------------------------------------------------------------
-- 4) admin_topup_quota_recharge -- replaces the direct writes in
--    src/routes/admin.quotas.tsx addQuota():
--      UPDATE tenant_quotas.balance  +  INSERT quota_recharges
--    Made atomic (one tx) which the old two-call frontend flow was not.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_topup_quota_recharge(
  p_user_id uuid,
  p_amount  numeric,
  p_method  text DEFAULT 'admin_manual'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  PERFORM public.wa_assert_admin();
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: must be > 0' USING errcode = '22003';
  END IF;

  UPDATE public.tenant_quotas
     SET balance = COALESCE(balance,0) + p_amount, updated_at = now()
   WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    -- no quota row yet -> create the tenant baseline (mirrors wechat-pay settle)
    INSERT INTO public.tenant_quotas (user_id, balance, updated_at)
    VALUES (p_user_id, p_amount, now());
  END IF;

  INSERT INTO public.quota_recharges (user_id, amount, method)
  VALUES (p_user_id, p_amount, COALESCE(NULLIF(p_method,''),'admin_manual'));
END $fn$;
REVOKE ALL ON FUNCTION public.admin_topup_quota_recharge(uuid, numeric, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_topup_quota_recharge(uuid, numeric, text) TO authenticated, service_role;


-- ---------------------------------------------------------------------
-- 5) admin_assign_subscription -- replaces direct writes in
--    src/routes/admin.quotas.tsx assignPlanToTenant():
--      UPDATE tenant_quotas.plan_*  +  INSERT subscriptions
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_assign_subscription(
  p_user_id uuid,
  p_plan_id uuid,
  p_days    int DEFAULT 30
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_plan_name text;
  v_price     numeric;
  v_exp       timestamptz;
BEGIN
  PERFORM public.wa_assert_admin();
  IF p_days IS NULL OR p_days <= 0 OR p_days > 3660 THEN
    RAISE EXCEPTION 'INVALID_DAYS' USING errcode = '22003';
  END IF;

  SELECT name, price INTO v_plan_name, v_price
    FROM public.subscription_plans WHERE id = p_plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PLAN_NOT_FOUND' USING errcode = 'P0002';
  END IF;

  v_exp := now() + make_interval(days => p_days);

  UPDATE public.tenant_quotas
     SET plan_id = p_plan_id,
         plan_name = v_plan_name,
         plan_expires_at = v_exp,
         updated_at = now()
   WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    INSERT INTO public.tenant_quotas (user_id, plan_id, plan_name, plan_expires_at, updated_at)
    VALUES (p_user_id, p_plan_id, v_plan_name, v_exp, now());
  END IF;

  INSERT INTO public.subscriptions
    (user_id, plan_id, plan_name, amount, status, started_at, expires_at)
  VALUES
    (p_user_id, p_plan_id, v_plan_name, COALESCE(v_price,0), 'active', now(), v_exp);
END $fn$;
REVOKE ALL ON FUNCTION public.admin_assign_subscription(uuid, uuid, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_assign_subscription(uuid, uuid, int) TO authenticated, service_role;


-- ---------------------------------------------------------------------
-- 6) user_view_my_entitlements -- read-only aggregate for own money state.
--    SECURITY DEFINER so it returns a consistent single row even when the
--    caller has no tenant_quotas row yet. Reads only auth.uid()'s own data.
--    (Direct SELECT on the tables still works via the surviving
--     users_select_* policies; this RPC exists to give the frontend one
--     atomic, stable read shape.)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_view_my_entitlements()
RETURNS TABLE (
  plan_name          text,
  plan_expires_at    timestamptz,
  workbench_credits  bigint,
  agent_credits      bigint,
  shop_license_quota jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT
    q.plan_name,
    q.plan_expires_at,
    q.workbench_credits::bigint,
    q.agent_credits::bigint,
    jsonb_build_object(
      'quota_row_present',  q.id IS NOT NULL,
      'active_shops',       COALESCE(l.active_shops, 0),
      'shop_slots_used',    COALESCE(l.shop_slots_used, 0),
      'by_platform',        COALESCE(l.by_platform, '{}'::jsonb),
      'licenses',           COALESCE(l.licenses, '[]'::jsonb)
    )
  FROM (SELECT auth.uid()::uuid AS uid) s
  LEFT JOIN public.tenant_quotas q ON q.user_id = s.uid
  LEFT JOIN LATERAL (
    SELECT
      count(*)              FILTER (WHERE sl.status = 'active')::int            AS active_shops,
      coalesce(sum(sl.shop_count) FILTER (WHERE sl.status = 'active'), 0)::int  AS shop_slots_used,
      (SELECT coalesce(jsonb_object_agg(x.platform_code, x.n), '{}'::jsonb)
         FROM (SELECT coalesce(sl2.platform_code,'unknown') AS platform_code, count(*) AS n
                 FROM public.shop_licenses sl2
                WHERE sl2.user_id = s.uid AND sl2.status = 'active'
                GROUP BY 1) x) AS by_platform,
      (SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', sl3.id, 'platform_code', sl3.platform_code,
               'plan_code', sl3.plan_code, 'shop_count', sl3.shop_count,
               'status', sl3.status, 'started_at', sl3.started_at,
               'expires_at', sl3.expires_at) ORDER BY sl3.created_at DESC), '[]'::jsonb)
         FROM public.shop_licenses sl3 WHERE sl3.user_id = s.uid) AS licenses
    FROM public.shop_licenses sl WHERE sl.user_id = s.uid
  ) l ON true;
$fn$;
REVOKE ALL ON FUNCTION public.user_view_my_entitlements() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.user_view_my_entitlements() TO authenticated, service_role;

COMMIT;
