-- =====================================================================
-- Wave A / T3 : profiles.role self-escalation fix
-- File : zz_20261117_wA03a_profiles_role_guard.sql
--
-- PROVEN BEFORE FIX (live box, reverted in the same script):
--   non-admin PATCH /rest/v1/profiles?id=eq.<self> {"role":"admin"} -> HTTP 204
--   SELECT has_role(<self>,'admin') -> true
-- i.e. any logged-in user could grant themselves the admin role, because
-- trg_profiles_rbac_guard only protected owner_id / is_sub_account /
-- tenant_role / tenant_id -- never `role`.
--
-- DESIGN: the old guard let "admin OR the tenant root" mutate the column.
-- That exception is correct for TENANCY columns (a tenant owner re-parenting
-- their own sub-accounts) but is WRONG for role/status: a tenant root must not
-- be able to promote themselves to platform admin. So the privilege ladder is
-- split in two:
--   tier 1 (owner_id, is_sub_account, tenant_role, tenant_id) : admin OR tenant root
--   tier 2 (role, status)                                     : admin ONLY
-- =====================================================================

BEGIN;

-- 1) harden the existing trigger function (same name => trigger binding kept) --
CREATE OR REPLACE FUNCTION public.trg_profiles_rbac_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
begin
  -- tier 1 : tenancy columns -- admin OR the root of the tenant being edited
  if new.owner_id        is distinct from old.owner_id
     or new.is_sub_account is distinct from old.is_sub_account
     or new.tenant_role    is distinct from old.tenant_role
     or new.tenant_id      is distinct from old.tenant_id then
     if auth.uid() is not null
        and not public.has_role(auth.uid(), 'admin')
        and auth.uid() <> public.tenant_root(auth.uid()) then
       raise exception 'PERMISSION_DENIED: cannot modify RBAC columns of profiles'
         using errcode = '42501';
     end if;
  end if;

  -- tier 2 : role / status -- admin ONLY (tenant root is NOT enough)
  -- auth.uid() IS NULL means the write came from a trusted server path
  -- (service_role key has no `sub` claim, SECURITY DEFINER triggers, pg_cron),
  -- which is exactly the "only service_role may do this" requirement.
  if new.role is distinct from old.role
     or new.status is distinct from old.status then
     if auth.uid() is not null
        and not public.has_role(auth.uid(), 'admin') then
       raise exception 'PERMISSION_DENIED: cannot modify role/status of profiles'
         using errcode = '42501';
     end if;
  end if;

  return new;
end $function$;

-- 2) column-level revoke: authenticated / anon may not write `role` at all ----
-- GOTCHA discovered while verifying: `REVOKE UPDATE (role) ... FROM authenticated`
-- is a NO-OP while the role still holds the *table-level* UPDATE privilege --
-- PostgreSQL only subtracts from a column-level grant, never from an implied one.
-- The only way to get has_column_privilege(...,'role','UPDATE') = false is to drop
-- the table-level UPDATE and re-grant it on an explicit column allow-list.
REVOKE UPDATE ON public.profiles FROM authenticated, anon;
GRANT UPDATE (username, avatar_url) ON public.profiles TO authenticated;
-- id / created_at / role / status / owner_id / is_sub_account / tenant_role /
-- tenant_id are now unwritable by `authenticated` at the GRANT layer.
-- role + status changes therefore require either the admin RPCs below or a
-- service_role / SECURITY DEFINER server path -- and the trigger in section 1
-- stays as defence in depth (and to catch a future careless re-grant).

-- anon has no legitimate business on profiles whatsoever (signup writes happen
-- as `authenticated` in register.tsx, and the auth trigger uses SECURITY DEFINER).
REVOKE ALL ON public.profiles FROM anon;
GRANT SELECT ON public.profiles TO anon;  -- keep PostgREST schema introspection happy

-- 3) admin_set_user_role RPC --------------------------------------------------
-- The admin UX (admin.tsx / admin.users) must call this instead of PATCHing
-- profiles.role directly, so that a stolen non-admin session can never escalate.
CREATE OR REPLACE FUNCTION public.admin_set_user_role(
  p_user_id uuid,
  p_role    text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  PERFORM public.wa_assert_admin();

  IF p_role IS NULL OR p_role NOT IN ('admin','tenant_user') THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED: %', p_role USING errcode = '22023';
  END IF;

  -- an admin may not remove the last admin (lockout protection)
  IF p_role <> 'admin' THEN
    IF (SELECT count(*) FROM public.profiles WHERE role = 'admin') <= 1 THEN
      RAISE EXCEPTION 'LAST_ADMIN_LOCKOUT_REFUSED' USING errcode = 'P0001';
    END IF;
  END IF;

  UPDATE public.profiles SET role = p_role WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND' USING errcode = 'P0002';
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_set_user_role(uuid, text) TO authenticated, service_role;

-- 4) admin_set_user_status RPC -----------------------------------------------
-- REVOKE UPDATE(status) above would otherwise break the freeze/unfreeze button in
-- src/routes/admin.tenants.tsx (toggleStatus -> PATCH profiles.status), so the
-- admin UX is moved onto this RPC in the same wave.
CREATE OR REPLACE FUNCTION public.admin_set_user_status(
  p_user_id uuid,
  p_status  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  PERFORM public.wa_assert_admin();
  IF p_status IS NULL OR p_status NOT IN ('active','frozen') THEN
    RAISE EXCEPTION 'STATUS_NOT_ALLOWED: %', p_status USING errcode = '22023';
  END IF;
  -- admins may not freeze themselves out of the console
  IF p_status = 'frozen' AND p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'SELF_FREEZE_REFUSED' USING errcode = 'P0001';
  END IF;
  UPDATE public.profiles SET status = p_status WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND' USING errcode = 'P0002';
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.admin_set_user_status(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_set_user_status(uuid, text) TO authenticated, service_role;

COMMIT;
