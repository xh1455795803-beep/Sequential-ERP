-- =====================================================================
-- Wave A / T4 : cross-tenant USING(true) policy narrowing + related lockdown
-- File : zz_20261117_wA05_policy_narrow.sql
-- RUN AS: supabase_admin (NOT postgres).
--   The views (v_admin_invoices, invoice_paid_sources, v_forwarder_readiness,
--   v_shipment_progress), the 19 of 36 exposed SECURITY DEFINER functions,
--   the dblink()/query_to_xml()/system() family and 2 of the *_bak_* tables are
--   owned by supabase_admin. postgres is NOT a member of supabase_admin, so the
--   first attempt run as postgres aborted at "ALTER VIEW ... security_invoker"
--   with `must be owner of view v_admin_invoices`; because the whole file is
--   wrapped in BEGIN/COMMIT + ON_ERROR_STOP=1, ZERO of it had committed.
-- Rollback: /opt/wA-rollback.sql sections 5-10 (policies, grants, reloptions,
--   original search_path configs, dblink grants, and the pre-Wave-A snapshot).
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- SECTION 1  Spec-required fixes: "admins_select_*" policies that were
-- actually TO public USING(true), i.e. readable by ANONYMOUS internet
-- clients. DROP + recreate as authenticated + has_role('admin').
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "admins_select_shop_licenses" ON public.shop_licenses;
CREATE POLICY admin_select_shop_licenses ON public.shop_licenses
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "admins_select_benefit_grants" ON public.benefit_grants;
CREATE POLICY admin_select_benefit_grants ON public.benefit_grants
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Same bug class, found by the sweep (policy literally named "admins_select"
-- but granted TO public USING true) and translate_packs carries user_id =>
-- anonymous cross-tenant entitlement + usage read.
DROP POLICY IF EXISTS "admins_select_translate_packs" ON public.translate_packs;
CREATE POLICY admin_select_translate_packs ON public.translate_packs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));


-- ---------------------------------------------------------------------
-- SECTION 2  Remaining USING(true) SELECT policies, classified.
--
-- KEPT as intentional public reference/config data (documented per task):
--   license_periods / license_platforms / license_shop_tiers
--        -> license checkout catalog: prices, platforms, shop tiers. No user
--           rows, no secrets; the register/pricing page renders them logged out.
--   platform_field_map_select_anon / _authenticated
--        -> column set is (id, platform, target_column, api_endpoint, api_path,
--           value_kind, coverage, manual_hint jsonb, source_note, created_at).
--           Verified 96 rows, 0 user_id/PII columns. The 17 regex hits on
--           'token|secret|password' are all *field labels* of the third-party
--           API (e.g. platform="TikTok Shop", api_endpoint="token",
--           api_path="open_id") -- schema mapping metadata, not credentials.
--           => OK to keep. See /tmp/wA-blocked-platform-config-secrets.md for
--              the one sibling table that DOES carry a credential column.
--   credit_packages, service_pricing, fee_categories, cn_sensitive_words,
--   cn_platform_rules, cn_category_qualifications, forwarder_catalog
--        -> commercial reference data used by the public pricing/AI listing UI.
--           forwarder_catalog exposes 货代 rate bands (business-sensitive) but
--           no user data; left for the coordinator as a product decision.
--   subscription_plans.anon_select_subscription_plans -> pricing page, keep.
--
-- NARROWED (public -> authenticated; no user data crossed either way, but an
-- anonymous client should not be enumerating them):
-- ---------------------------------------------------------------------
ALTER POLICY "permissions_select_all"      ON public.permissions      TO authenticated;
ALTER POLICY "users_select_announcements"  ON public.announcements    TO authenticated;
ALTER POLICY "public_read_platform_configs" ON public.platform_configs TO authenticated;


-- ---------------------------------------------------------------------
-- SECTION 3  Cross-tenant WRITE hole found by the sweep:
-- users_insert_shop_listing_rules had WITH CHECK (true) -- any authenticated
-- user could insert listing rules owned by any other user_id. Every other
-- INSERT policy in this DB uses (user_id = auth.uid()); this was the only
-- outlier of 1 out of the whole set.
-- ---------------------------------------------------------------------
ALTER POLICY "users_insert_shop_listing_rules" ON public.shop_listing_rules
  WITH CHECK (user_id = auth.uid());


-- ---------------------------------------------------------------------
-- SECTION 4  Tables found with RLS DISABLED *and* full anon DML grants.
-- These are backup/shadow copies of production tables; they completely bypass
-- the T1 money-table hardening (an anonymous client could simply read the
-- _bak_license copy of shop_licenses). Nothing in src/ or any EF references
-- them (grep of /opt/thalvior-source/src and volumes/functions = 0 hits), so
-- they are locked to server roles only.
--   _bak_field_map_20261117, _bak_license_20261117, country_tax_rates_bak_taxfix,
--   platform_configs_bak_20261012, subscription_plans_bak_20261010
-- translate_pack_defs also had RLS disabled; it IS app config and is read by
-- logged-in pages, so it keeps SELECT for authenticated but loses all anon
-- access and all client DML.
-- ---------------------------------------------------------------------
REVOKE ALL ON public."_bak_field_map_20261117"        FROM anon, authenticated;
REVOKE ALL ON public."_bak_license_20261117"          FROM anon, authenticated;
REVOKE ALL ON public."country_tax_rates_bak_taxfix"   FROM anon, authenticated;  -- supabase_admin-owned
REVOKE ALL ON public."platform_configs_bak_20261012"  FROM anon, authenticated;  -- supabase_admin-owned
REVOKE ALL ON public."subscription_plans_bak_20261010" FROM anon, authenticated;

REVOKE ALL ON public.translate_pack_defs FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.translate_pack_defs FROM authenticated;
GRANT  SELECT ON public.translate_pack_defs TO authenticated;

-- anon must not be able to touch config/reference tables at all
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.platform_configs, public.platform_field_map, public.permissions,
     public.announcements, public.credit_packages, public.service_pricing,
     public.fee_categories, public.license_periods, public.license_platforms,
     public.license_shop_tiers, public.platform_auth_config, public.subscription_plans
  FROM anon, authenticated;


-- ---------------------------------------------------------------------
-- SECTION 5  Views bypass RLS (they are executed as their owner, postgres,
-- which has BYPASSRLS). All 7 of these expose a user_id column and were
-- readable with the bare anon key -- confirmed live on the box:
--   GET /rest/v1/v_admin_invoices  with anon key -> HTTP 200
--   GET /rest/v1/invoice_paid_sources with anon key -> HTTP 200
-- They returned 0 rows only because invoices/shipments are still empty in
-- this environment; the mechanism is fully open.
-- Fix = (a) drop anon access, (b) security_invoker=true so the calling
-- user's RLS policies are applied to the underlying tables, (c) SELECT only.
-- ---------------------------------------------------------------------
DO $do$
DECLARE v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'v_admin_invoices','invoice_quota','invoice_paid_sources','v_forwarder_fee_summary',
    'v_forwarder_readiness','v_shipment_progress','v_tracking_stale']
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', v_name);
    -- 4 of the 7 already had security_invoker=true; re-setting is a no-op.
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v_name);
    EXECUTE format('GRANT SELECT  ON public.%I TO authenticated', v_name);
  END LOOP;
END $do$;


-- ---------------------------------------------------------------------
-- SECTION 6  dblink() family is EXECUTE-granted to PUBLIC + anon +
-- authenticated and is used by ZERO lines of application code (grep across
-- src/ and all 33 edge functions = 0 hits). That is unauthenticated SSRF from
-- the database host: any client holding only the anon key can POST
-- /rest/v1/rpc/dblink and make the DB open arbitrary TCP/HTTP to the internal
-- network, or dial out with attacker-supplied credentials.
-- query_to_xml / system() are also default-PUBLIC and unused by the app.
-- ---------------------------------------------------------------------
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    -- pg_catalog members first, so regprocedure still resolves unambiguously
    SELECT p.oid
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('public','extensions','pg_catalog')
       AND p.proname IN ('dblink','dblink_connect','dblink_connect_u','dblink_exec',
                         'dblink_open','dblink_close','dblink_send_query','dblink_get_connections',
                         'dblink_disconnect','query_to_xml','query_to_xml_and_xmlschema',
                         'query_to_xmlschema','system')
  LOOP
    -- oid::regprocedure already renders "public.dblink(text)" including args
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
                   r.oid::regprocedure);
  END LOOP;
END $do$;


-- ---------------------------------------------------------------------
-- SECTION 7  SECURITY DEFINER search_path pinning.
-- The task flagged has_role() as the check to make. It was
--   SECURITY DEFINER SET search_path TO 'public'
-- i.e. pg_temp NOT excluded => a normal logged-in user can create pg_temp
-- .profiles (or pg_temp.has_perm etc.) and, on any definer that resolves a
-- name unqualified, have it resolve into the attacker's object while running
-- as postgres. 36 functions in public were exposed.
--
-- The schemas are APPENDED, never overwritten: the live distribution of
-- existing configs was  search_path=public (23), none (5),
-- public,auth,extensions (5), public,auth (2), public,net (1). Several of
-- those bodies call auth.* / net.http_post unqualified, so forcing a flat
-- 'public, pg_temp' would have broken them. pg_temp is always appended LAST,
-- which is what makes the hijack impossible (public wins name resolution).
-- ---------------------------------------------------------------------
DO $do$
DECLARE
  r       record;
  v_cfg   text[];
  v_paths text[];
  v_new   text;
  s       text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef
       AND (p.proconfig IS NULL OR p.proconfig::text NOT LIKE '%pg_temp%')
  LOOP
    -- start from the existing search_path, if any
    v_paths := ARRAY[]::text[];
    v_cfg   := coalesce(r.proconfig, ARRAY[]::text[]);
    FOREACH s IN ARRAY v_cfg LOOP
      IF s LIKE 'search_path=%' THEN
        SELECT array_agg(x) INTO v_paths
          FROM unnest(string_to_array(replace(s, 'search_path=', ''), ',')) x;
      END IF;
    END LOOP;
    IF v_paths IS NULL OR array_length(v_paths, 1) IS NULL THEN
      -- no pinned path today => emulate the Supabase session path explicitly
      v_paths := ARRAY['public','extensions'];
    END IF;
    v_paths := v_paths || ARRAY['pg_temp'];

    SELECT string_agg(btrim(x), ', ') INTO v_new FROM unnest(v_paths) x;
    EXECUTE format('ALTER FUNCTION %s SET search_path = %s', r.oid::regprocedure, v_new);
  END LOOP;
END $do$;

COMMIT;
