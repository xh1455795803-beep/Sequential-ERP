-- zz_20261117_wA08_user_consents.sql
-- Wave A / T10: record which version of the legal documents each account actually accepted.
--
-- WHY
--   Registration had no terms gate at all: register.tsx went straight from password + OTP to a
--   dashboard, so there was no evidence - for any of the 21 existing accounts or for any future
--   one - that the user was ever shown or accepted 用户服务协议 / 隐私政策. For a commercial
--   cross-border ERP that bills in CNY and moves buyer data around, "we never recorded it" is the
--   answer nobody wants in a dispute. The documents themselves live at /terms, /privacy, /refund
--   (served from /var/www/legal/*.html, owned by Wave B); this migration records the *version*
--   the user saw, which is the only part that has evidentiary value.
--
-- DESIGN
--   * Append-only by (user_id, kind, legal_version): re-accepting the same version does not move
--     consented_at, so the first acceptance timestamp survives as the evidence.
--   * The version string is the document's effective date (2026-10-04 today, per /var/www/legal),
--     validated by CHECK, so a stale bundle cannot record a version that never existed.
--   * user_agent / ip_address are convenience evidence only - both come from client-controlled
--     headers, so treat them as corroborating, never as proof of identity.
--   * FK is ON DELETE CASCADE: Wave A/T11 (account deletion + PII erasure) must not leave a
--     shadow table of consents behind. If Wave B decides a *retention receipt* is required after
--     deletion, that is a separate pseudonymised table (sha256(user_id||pepper), kind, version,
--     consented_at, no FK) - deliberately not built here, it needs a legal decision first.
--   * Writes happen only through the SECURITY DEFINER RPC (no INSERT policy for clients), so a
--     user cannot forge a consent for someone else's user_id, and the headers are read server
--     side instead of being trusted from the request body.
--
-- Apply as: postgres.  Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_consents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind           text NOT NULL,
  legal_version  text NOT NULL,
  locale         text NOT NULL DEFAULT 'zh',
  user_agent     text,
  ip_address     inet,
  accepted       boolean NOT NULL DEFAULT true,
  consented_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  CONSTRAINT user_consents_kind_chk CHECK (kind IN ('terms','privacy','refund','dpa','marketing')),
  CONSTRAINT user_consents_version_chk CHECK (legal_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  CONSTRAINT user_consents_locale_chk CHECK (char_length(locale) BETWEEN 1 AND 8),
  CONSTRAINT user_consents_state_chk CHECK (
    (accepted AND revoked_at IS NULL) OR (NOT accepted AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT user_consents_user_kind_version_udx UNIQUE (user_id, kind, legal_version)
);

CREATE INDEX IF NOT EXISTS user_consents_user_kind_idx
  ON public.user_consents (user_id, kind, consented_at DESC);

ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.user_consents IS
  'Append-only legal consent ledger: which version of which document each account accepted (Wave A T10)';
COMMENT ON COLUMN public.user_consents.legal_version IS
  'effective date of the document as shown to the user, e.g. 2026-10-04 = the version in /var/www/legal/*.html';
COMMENT ON COLUMN public.user_consents.user_agent IS
  'corroborating evidence only - taken from request.headers, which the client controls';
COMMENT ON COLUMN public.user_consents.ip_address IS
  'corroborating evidence only - first x-forwarded-for hop, also client-visible text';

-- Client roles get no direct table rights; reads for the owner go through the policy below.
REVOKE ALL ON TABLE public.user_consents FROM anon, authenticated, public;
GRANT SELECT, INSERT, UPDATE ON TABLE public.user_consents TO service_role;
GRANT SELECT ON TABLE public.user_consents TO authenticated;

DROP POLICY IF EXISTS user_consents_self_select ON public.user_consents;
CREATE POLICY user_consents_self_select ON public.user_consents
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- No INSERT/UPDATE policy on purpose: the only writer is record_user_consent(), which is
-- SECURITY DEFINER and runs as postgres (BYPASSRLS), and it takes user_id from auth.uid().

CREATE OR REPLACE FUNCTION public.record_user_consent(
  p_kind text,
  p_legal_version text,
  p_accepted boolean DEFAULT true,
  p_locale text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_kind     text;
  v_locale   text;
  v_ua       text;
  v_ip       inet;
  v_headers  jsonb;
  v_row      public.user_consents;
  v_id       uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'record_user_consent requires an authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  v_kind := lower(btrim(coalesce(p_kind, '')));
  IF v_kind NOT IN ('terms','privacy','refund','dpa','marketing') THEN
    RAISE EXCEPTION 'unknown consent kind %', left(v_kind, 32)
      USING ERRCODE = '22023';
  END IF;

  IF p_legal_version IS NULL OR p_legal_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'legal_version must be the ISO effective date of the document shown to the user'
      USING ERRCODE = '22023';
  END IF;

  IF p_accepted IS NULL THEN
    RAISE EXCEPTION 'p_accepted must be true (accept) or false (withdraw)'
      USING ERRCODE = '22023';
  END IF;

  v_locale := lower(left(btrim(coalesce(p_locale, 'zh')), 8));
  IF v_locale !~ '^[a-z]{2,3}(-[a-z0-9]{2,8})*$' THEN
    v_locale := 'zh';
  END IF;

  -- PostgREST exposes the caller's headers as a GUC; anything that is not a JSON object here
  -- (direct SQL, a future non-REST entrypoint) must not break the recording.
  BEGIN
    v_headers := current_setting('request.headers', true)::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v_headers := NULL;
  END;
  IF jsonb_typeof(v_headers) = 'object' THEN
    v_ua := nullif(left(coalesce(v_headers ->> 'user-agent', ''), 512), '');
    BEGIN
      v_ip := nullif(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1), '')::inet;
    EXCEPTION WHEN OTHERS THEN
      v_ip := NULL;
    END;
  ELSE
    v_ua := NULL;
    v_ip := NULL;
  END IF;

  INSERT INTO public.user_consents AS c
      (user_id, kind, legal_version, locale, user_agent, ip_address, accepted, revoked_at, consented_at)
  VALUES
      (v_uid, v_kind, p_legal_version, v_locale, v_ua, v_ip, p_accepted,
       CASE WHEN p_accepted THEN NULL ELSE now() END, now())
  ON CONFLICT (user_id, kind, legal_version) DO UPDATE SET
      accepted     = EXCLUDED.accepted,
      revoked_at   = CASE WHEN EXCLUDED.accepted THEN NULL ELSE now() END,
      locale       = EXCLUDED.locale,
      user_agent   = COALESCE(EXCLUDED.user_agent, c.user_agent),
      ip_address   = COALESCE(EXCLUDED.ip_address, c.ip_address)
    -- do not re-write an unchanged acceptance: consented_at is the evidence and must not drift
    WHERE c.accepted IS DISTINCT FROM EXCLUDED.accepted
       OR c.revoked_at IS NOT NULL
  RETURNING c.id INTO v_id;

  IF v_id IS NULL THEN
    SELECT * INTO v_row FROM public.user_consents
      WHERE user_id = v_uid AND kind = v_kind AND legal_version = p_legal_version;
  ELSE
    SELECT * INTO v_row FROM public.user_consents WHERE id = v_id;
  END IF;

  IF v_row.id IS NULL THEN
    -- only reachable if the row vanished between the write and the read-back
    RAISE EXCEPTION 'consent row disappeared; retry'
      USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'id', v_row.id,
    'kind', v_row.kind,
    'legal_version', v_row.legal_version,
    'accepted', v_row.accepted,
    'locale', v_row.locale,
    'consented_at', v_row.consented_at,
    'revoked_at', v_row.revoked_at,
    'replayed', v_id IS NULL
  );
END $function$;

REVOKE ALL ON FUNCTION public.record_user_consent(text, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_user_consent(text, text, boolean, text)
  TO authenticated, service_role, postgres, supabase_admin;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- read-back -----------------------------------------------------------------------------------
SELECT c.relname, c.relrowsecurity AS rls,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_read,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_read,
       has_table_privilege('service_role', c.oid, 'INSERT') AS svc_write
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'user_consents';

SELECT polname, polpermissive, polcmd, polroles::regrole[] AS for_roles,
       polqual IS NOT NULL AS has_qual
FROM pg_policy WHERE polrelid = 'public.user_consents'::regclass;

SELECT p.proname, p.prosecdef AS secdef, pg_get_userbyid(p.proowner) AS owner,
       p.proconfig AS search_path_pin,
       has_function_privilege('anon', p.oid, 'execute') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') AS auth_exec
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'record_user_consent';

SELECT count(*) AS consent_rows FROM public.user_consents;
