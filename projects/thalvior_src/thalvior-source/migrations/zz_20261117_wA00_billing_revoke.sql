-- =====================================================================
-- Wave A / T1 : RLS hardening -- revoke DML on billing / money tables
-- Date   : 2026-11-17   Owner: security-wave-A
-- Tables : tenant_quotas, subscriptions, shop_licenses,
--          quota_recharges, benefit_grants
-- Effect : anon + authenticated keep SELECT only (subject to RLS).
--          All INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER removed.
--          service_role retains BYPASSRLS + full DML (NOT revoked).
-- Rollback: /opt/wA-rollback.sql  (sections 1 + 2 restore this exactly)
-- =====================================================================

BEGIN;

-- 1) table-level DML revoke --------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON tenant_quotas, subscriptions, shop_licenses, quota_recharges, benefit_grants
  FROM authenticated, anon;

-- 2) SELECT is allowed at table level for authenticated (RLS still filters rows)
GRANT SELECT
  ON tenant_quotas, subscriptions, shop_licenses, quota_recharges, benefit_grants
  TO authenticated;

-- 2b) anon loses SELECT entirely on money tables, and both roles lose MAINTAIN.
--     PG17 introduced the MAINTAIN privilege (acl code 'm'), which the original
--     GRANT ALL had handed to anon/authenticated (VACUUM/ANALYZE/CLUSTER/REINDEX).
--     No anon code path reads these 5 tables (all readers are behind _layout auth
--     or use the service_role key), so this is safe and gives defence in depth
--     rather than relying on RLS alone to zero-out anon.
REVOKE ALL ON tenant_quotas, subscriptions, shop_licenses, quota_recharges, benefit_grants
  FROM anon;
REVOKE MAINTAIN
  ON tenant_quotas, subscriptions, shop_licenses, quota_recharges, benefit_grants
  FROM authenticated;

-- NOTE: anon deliberately gets NO select on these money tables.
--       (previously anon could read every shop_license via USING(true))

-- 3) drop the permissive self-write policies --------------------------------
-- tenant_quotas
DROP POLICY IF EXISTS "users_insert_own_quota"   ON public.tenant_quotas;
DROP POLICY IF EXISTS "users_update_own_quota"   ON public.tenant_quotas;
-- subscriptions
DROP POLICY IF EXISTS "users_insert_own_subscriptions" ON public.subscriptions;
-- shop_licenses
DROP POLICY IF EXISTS "users_insert_shop_licenses" ON public.shop_licenses;
DROP POLICY IF EXISTS "users_update_shop_licenses" ON public.shop_licenses;
DROP POLICY IF EXISTS "users_delete_shop_licenses" ON public.shop_licenses;
-- quota_recharges
DROP POLICY IF EXISTS "users_insert_own_recharge" ON public.quota_recharges;
-- benefit_grants
DROP POLICY IF EXISTS "users_insert_benefit_grants" ON public.benefit_grants;
DROP POLICY IF EXISTS "users_update_benefit_grants" ON public.benefit_grants;
DROP POLICY IF EXISTS "users_delete_benefit_grants" ON public.benefit_grants;

-- 4) keep / normalise the SELECT-only per-user policies ----------------------
-- (users_select_own_quota, users_select_own_subscriptions, users_select_shop_licenses,
--  users_select_own_recharge, users_select_benefit_grants, admins_select_* are left
--  in place; admins_select_shop_licenses / admins_select_benefit_grants USING(true)
--  is narrowed in T4 = zz_20261117_wA05_policy_narrow.sql)

COMMIT;
