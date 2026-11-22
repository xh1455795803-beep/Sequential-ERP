-- =====================================================================================
-- Wave A / T11  zz_20261117_wA04_deleted_at.sql   (2026-11-17)
-- Account deletion: request -> 30-day grace -> in-place PII erasure (+ cancel)
-- =====================================================================================
-- WHY THIS IS NOT A HARD DELETE (measured on this host before writing the file)
--   * 72 tables carry a FK to public.profiles(id) ON DELETE CASCADE, and
--     public.profiles.id itself FKs auth.users(id) ON DELETE CASCADE.
--     => supabase.auth.admin.deleteUser() would silently cascade through orders,
--        shipments, statements, invoices, fee records: exactly the financial evidence
--        that must be kept (会计档案管理办法: 10y+, VAT/invoice records 30y under
--        发票管理办法实施细则). A "delete my account" button cannot be that.
--   * Before this migration there was no deleted_at column, no request ledger and no
--     erasure path. "Deleting an account" was an admin ticket nobody could satisfy.
--
-- DESIGN
--   request/cancel : SECURITY DEFINER, self-service, driven by auth.uid() only. The request
--                    marks profiles.deleted_at = now() immediately, i.e. the account stops
--                    being "active" the moment it is requested (T12 exposes this as
--                    public.is_active_user(uuid) inside RLS policies), but nothing is erased
--                    yet - that is the grace window during which the user can cancel.
--   execute        : service_role / postgres / supabase_admin ONLY (NOT authenticated).
--                    Anonymizes personal data in place, destroys every credential and
--                    session, keeps the financial rows. Idempotent: a second call finds the
--                    already-tombstoned user and reports erased = {}.
--   execute-matured: the batch wrapper pg_cron calls (see /opt/wA-delete-account-cron.md).
--
-- ERASURE MAP (this one function is the whole map, deliberately)
--   auth.users .............. email/phone -> tombstone, password -> unknowable bcrypt hash,
--                             meta -> {}, confirmation/recovery tokens -> '',
--                             banned_until = +100y, deleted_at = now() (GoTrue's own marker)
--   auth.identities ......... DELETE (external provider ids are personal data)
--   auth.sessions / auth.refresh_tokens / auth.one_time_tokens /
--   auth.mfa_amr_claims / auth.mfa_challenges / auth.mfa_factors / auth.flow_state
--                             DELETE by user_id - kills every live session immediately
--   auth.audit_log_entries .. DELETE rows naming this user id / old email / old phone
--   public.profiles ......... username -> erased_<uid8>, avatar_url -> NULL, deleted_at kept
--   public.email_codes ...... DELETE rows for the old email   (T8: hashes only, no plaintext,
--   public.sms_codes ........ DELETE rows for the old phone    but the address itself is PII)
--   public.user_consents .... ip_address / user_agent -> NULL. The consent FACT (kind,
--                             version, accepted, consented_at) is retained on purpose: it is
--                             our legal evidence of what the user agreed to.
--   public.sub_accounts ..... email/name -> tombstone, invite_token -> NULL
--   public.orders ........... phone/address -> tombstone, shop_name -> anonymized
--   public.shop_auths ....... access_token/refresh_token -> '', shop_name/global_store_name
--                             -> anonymized (the linkage is meaningless without its owner)
--   public.suppliers ........ name -> anonymized, contact/phone -> NULL
--   public.shops ............ name -> anonymized
--
-- DELIBERATELY NOT ERASED HERE (needs the compliance owner - flagged to Wave B)
--   * orders.buyer, tracking numbers, consignee addresses: third-party data inside records
--     we must retain; erasing them breaks dispute/tax evidence.
--   * storage.objects: currently 0 rows on this host. When objects exist, deletion has to go
--     through the Storage API (SQL-only removal would orphan the bytes in the bucket).
--   * provider-side copies: Aliyun SMS send logs, WeChat Pay statements, carrier waybills.
--   * auth.audit_log_entries rows written about OTHER users that merely mention this user.
--
-- IDEMPOTENT: safe to re-apply.
-- =====================================================================================

BEGIN;

-- ------------------------------------------------------------------ 1. profiles.deleted_at
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
COMMENT ON COLUMN public.profiles.deleted_at IS
  'Wave A/T11: set the instant account deletion is requested (not when it is executed). '
  'NULL = live account. public.is_active_user() (T12) and the delete-account EF read this. '
  'Never used to hard-delete the row: 72 tables cascade from profiles(id).';

CREATE INDEX IF NOT EXISTS profiles_deleted_at_idx
  ON public.profiles (deleted_at) WHERE deleted_at IS NOT NULL;

-- ------------------------------------------------------------------ 2. request ledger
CREATE TABLE IF NOT EXISTS public.account_deletions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  grace_until     timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  channel         text NOT NULL DEFAULT 'self',
  obligations     jsonb NOT NULL DEFAULT '{}'::jsonb,
  erased          jsonb,
  request_ip      inet,
  request_ua      text,
  note            text,
  executed_at     timestamptz,
  cancelled_at    timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_deletions_status_chk
    CHECK (status IN ('pending', 'executed', 'cancelled')),
  CONSTRAINT account_deletions_channel_chk
    CHECK (channel IN ('self', 'admin', 'cron')),
  CONSTRAINT account_deletions_grace_chk
    CHECK (grace_until >= requested_at),
  CONSTRAINT account_deletions_executed_chk
    CHECK ((status = 'executed') = (executed_at IS NOT NULL)),
  CONSTRAINT account_deletions_cancelled_chk
    CHECK (NOT (status = 'cancelled' AND executed_at IS NOT NULL)),
  CONSTRAINT account_deletions_obligations_chk
    CHECK (jsonb_typeof(obligations) = 'object'),
  CONSTRAINT account_deletions_erased_chk
    CHECK (erased IS NULL OR jsonb_typeof(erased) = 'object')
);

-- one live request per user; history (cancelled / executed) stays readable
CREATE UNIQUE INDEX IF NOT EXISTS account_deletions_pending_udx
  ON public.account_deletions (user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS account_deletions_due_idx
  ON public.account_deletions (grace_until) WHERE status = 'pending';

ALTER TABLE public.account_deletions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.account_deletions FROM anon, authenticated, public;
GRANT ALL  ON TABLE public.account_deletions TO service_role;
GRANT SELECT ON TABLE public.account_deletions TO authenticated;

DROP POLICY IF EXISTS account_deletions_self_select ON public.account_deletions;
CREATE POLICY account_deletions_self_select ON public.account_deletions
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

COMMENT ON TABLE public.account_deletions IS
  'Wave A/T11: audit trail of account-deletion requests - who asked, when it becomes '
  'executable, what was erased. service_role writes; users can only read their own row.';

-- ------------------------------------------------------------------ 3. shared helpers
-- Request metadata is read from the JWT headers PostgREST exposes, never from the body.
-- Returns jsonb (NOT RETURNS TABLE): a plpgsql set-returning helper without RETURN NEXT
-- would silently yield zero rows and the caller would store NULL evidence.
CREATE OR REPLACE FUNCTION public._wA_request_meta()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_headers jsonb;
  v_ip      inet;
  v_ua      text;
BEGIN
  BEGIN
    v_headers := coalesce(current_setting('request.headers', true)::jsonb, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_headers := '{}'::jsonb;
  END;
  v_ua := nullif(left(coalesce(v_headers ->> 'user-agent', ''), 512), '');
  BEGIN
    v_ip := nullif(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1), '')::inet;
  EXCEPTION WHEN OTHERS THEN
    v_ip := NULL;
  END;
  RETURN jsonb_build_object('ip', v_ip, 'ua', v_ua);
END;
$$;

CREATE OR REPLACE FUNCTION public._wA_obligation_snapshot(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE v jsonb;
BEGIN
  SELECT jsonb_build_object(
    -- active paid plan still running: erasing this user mid-period is a billing dispute
    'active_subscription', (SELECT count(*) FROM public.subscriptions s
                            WHERE s.user_id = p_user_id AND s.status = 'active'
                              AND s.expires_at > now()),
    -- orders that are not cancelled: fulfilment / refund obligations
    'open_orders',         (SELECT count(*) FROM public.orders o
                            WHERE o.user_id = p_user_id AND o.status <> '已取消'),
    -- invoices issued or pending: tax evidence the user is a party to
    'invoices',            (SELECT count(*) FROM public.invoices i
                            WHERE i.user_id = p_user_id),
    'work_orders_pending', (SELECT count(*) FROM public.work_orders w
                            WHERE w.user_id = p_user_id AND w.status = 'pending'),
    -- shops whose sync jobs / OAuth refreshes would break
    'shops',               (SELECT count(*) FROM public.shops h WHERE h.user_id = p_user_id),
    -- sub-accounts under this user: they keep their own logins after erasure
    -- (sub_accounts has no owner_id column - the parent link is user_id)
    'sub_accounts',        (SELECT count(*) FROM public.sub_accounts a
                            WHERE a.user_id = p_user_id)
  ) INTO v;
  RETURN coalesce(v, '{}'::jsonb);
END;
$$;

-- ------------------------------------------------------------------ 4. request
CREATE OR REPLACE FUNCTION public.request_account_deletion(p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_row     public.account_deletions;
  v_id      uuid;
  v_meta    jsonb;
  v_already boolean := false;
  v_note    text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'request_account_deletion requires an authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  v_note := nullif(left(btrim(coalesce(p_note, '')), 500), '');

  SELECT * INTO v_row FROM public.account_deletions
   WHERE user_id = v_uid AND status = 'pending' LIMIT 1;
  IF FOUND THEN
    v_already := true;
    v_id := v_row.id;
  ELSE
    v_meta := public._wA_request_meta();
    INSERT INTO public.account_deletions
      (user_id, requested_at, grace_until, status, channel, obligations, request_ip, request_ua, note)
      SELECT v_uid, now(), now() + interval '30 days', 'pending', 'self',
             public._wA_obligation_snapshot(v_uid),
             (v_meta ->> 'ip')::inet, v_meta ->> 'ua', v_note
      RETURNING id INTO v_id;
    -- inactive from this moment on (T12 is_active_user), erasure happens only at grace_until
    UPDATE public.profiles SET deleted_at = now() WHERE id = v_uid AND deleted_at IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'request_id', v_id,
    'already_requested', v_already,
    'grace_until', (SELECT grace_until FROM public.account_deletions WHERE id = v_id),
    'obligations', (SELECT obligations FROM public.account_deletions WHERE id = v_id),
    'cancel_hint', '在宽限期内可随时调用 cancel_account_deletion() 撤销；到期后由 pg_cron 执行匿名化'
  );
END;
$$;

COMMENT ON FUNCTION public.request_account_deletion(text) IS
  'Wave A/T11: self-service deletion request. Sets profiles.deleted_at now, schedules '
  'erasure at grace_until (30 days). Never deletes a row.';

-- ------------------------------------------------------------------ 5. cancel
CREATE OR REPLACE FUNCTION public.cancel_account_deletion()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.account_deletions;
  v_other boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'cancel_account_deletion requires an authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.account_deletions
   WHERE user_id = v_uid AND status = 'pending' LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'cancelled', false,
      'reason', 'no pending deletion request');
  END IF;

  UPDATE public.account_deletions
     SET status = 'cancelled', cancelled_at = now(), updated_at = now()
   WHERE id = v_row.id;

  -- reactivate only if no other pending request exists for this user
  SELECT EXISTS (SELECT 1 FROM public.account_deletions
                  WHERE user_id = v_uid AND status = 'pending') INTO v_other;
  IF NOT v_other THEN
    UPDATE public.profiles SET deleted_at = NULL WHERE id = v_uid AND deleted_at IS NOT NULL;
  END IF;

  RETURN jsonb_build_object('ok', true, 'cancelled', true, 'request_id', v_row.id,
                            'active_again', NOT v_other);
END;
$$;

COMMENT ON FUNCTION public.cancel_account_deletion() IS
  'Wave A/T11: withdraw a pending deletion request inside the grace window and reactivate.';

-- ------------------------------------------------------------------ 6. execute (the eraser)
CREATE OR REPLACE FUNCTION public.execute_account_deletion(
  p_user_id        uuid,
  p_channel        text DEFAULT 'cron',
  p_override_grace boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row      public.account_deletions;
  v_email    text;
  v_phone    text;
  v_digits   text;
  v_uid8     text := left(p_user_id::text, 8);
  v_tomb     text := 'erased-' || p_user_id::text || '@erasure.invalid';
  v_counts   jsonb := '{}'::jsonb;
  v_n        integer;
  v_due      boolean := false;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'execute_account_deletion: p_user_id is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_channel NOT IN ('self', 'admin', 'cron') THEN
    RAISE EXCEPTION 'execute_account_deletion: unknown channel %', p_channel
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.account_deletions
   WHERE user_id = p_user_id AND status = 'pending' ORDER BY requested_at DESC LIMIT 1;

  IF FOUND THEN
    v_due := v_row.grace_until <= now();
    IF NOT v_due AND NOT p_override_grace THEN
      RAISE EXCEPTION 'deletion for % is not executable before % (grace window)',
        p_user_id, v_row.grace_until USING ERRCODE = '22023';
    END IF;
  ELSIF p_override_grace THEN
    -- operator-initiated erasure with no prior in-app request: record it, then erase
    INSERT INTO public.account_deletions
      (user_id, requested_at, grace_until, status, channel, obligations, note)
      SELECT p_user_id, now(), now(), 'pending', p_channel,
             public._wA_obligation_snapshot(p_user_id),
             'forced execution (p_override_grace=true) by ' || coalesce(auth.uid()::text, 'service_role')
      RETURNING * INTO v_row;
  ELSE
    RAISE EXCEPTION 'no pending deletion request for %', p_user_id
      USING ERRCODE = '22023';
  END IF;

  -- identifiers are snapshotted BEFORE tombstoning: they are the keys into the
  -- PII-only side tables (email_codes / sms_codes / audit_log_entries).
  SELECT u.email, u.phone INTO v_email, v_phone
    FROM auth.users u WHERE u.id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'auth.users row % disappeared', p_user_id USING ERRCODE = 'P0002';
  END IF;

  -- ---- sessions / credentials --------------------------------------------------------
  -- Explicit statements (no dynamic loop): each DELETE is individually auditable and
  -- POSTGRES_* naming cannot be mistaken for an injectable string.
  DELETE FROM auth.identities        WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('identities_deleted', v_n);

  -- mfa_amr_claims has no user_id column (keyed by session_id), so it must go while the
  -- sessions still exist - children before parents, or the FK blocks the session delete.
  DELETE FROM auth.mfa_amr_claims a
   WHERE a.session_id IN (SELECT s.id FROM auth.sessions s WHERE s.user_id = p_user_id);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('mfa_amr_deleted', v_n);

  DELETE FROM auth.sessions          WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('sessions_deleted', v_n);

  -- auth.refresh_tokens.user_id is legacy `character varying` in this GoTrue version
  -- (verified via pg_attribute: every other auth.* user_id is uuid). Casting the parameter
  -- to varchar keeps the index usable; comparing uuid=varchar aborts the whole function.
  DELETE FROM auth.refresh_tokens    WHERE user_id = p_user_id::varchar;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('refresh_tokens_deleted', v_n);

  DELETE FROM auth.one_time_tokens   WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('one_time_tokens_deleted', v_n);

  DELETE FROM auth.flow_state        WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('flow_state_deleted', v_n);

  -- mfa_challenges is reached through factors (no user_id column there); delete children
  -- first so the parent delete cannot be blocked by a FK.
  DELETE FROM auth.mfa_challenges c
   WHERE c.factor_id IN (SELECT f.id FROM auth.mfa_factors f WHERE f.user_id = p_user_id);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('mfa_challenges_deleted', v_n);

  DELETE FROM auth.mfa_factors       WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('mfa_factors_deleted', v_n);

  -- auth.audit_log_entries has no user column at all - match on payload content
  DELETE FROM auth.audit_log_entries a
   WHERE a.payload ->> 'actor_id' = p_user_id::text
      OR a.payload ->> 'aud'      = p_user_id::text
      OR (v_email IS NOT NULL AND a.payload::text LIKE '%' || v_email || '%')
      OR (v_phone IS NOT NULL AND a.payload::text LIKE '%' || v_phone || '%');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('audit_log_deleted', v_n);

  -- ---- OTP side tables keyed by the raw identifier -----------------------------------
  -- The two stores normalize differently, so every form of the same address/number is
  -- matched (measured on this host: auth.users.phone = '86138xxxxxxxx' WITHOUT '+', while
  -- sms_codes.phone is written by the aliyun-sms EF as E.164 '+86138xxxxxxxx'):
  --   email  : as stored, plus lower-cased
  --   phone  : as stored, digits-only, '+'+digits, and the 11-digit domestic form
  IF v_email IS NOT NULL THEN
    DELETE FROM public.email_codes
     WHERE email = v_email OR email = lower(v_email);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('email_codes_deleted', v_n);
  END IF;

  IF v_phone IS NOT NULL THEN
    v_digits := regexp_replace(v_phone, '[^0-9]', '', 'g');
    DELETE FROM public.sms_codes
     WHERE phone = v_phone
        OR phone = v_digits
        OR phone = '+' || v_digits
        OR (v_digits LIKE '86%' AND (phone = right(v_digits, 11) OR phone = '+86' || right(v_digits, 11)));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('sms_codes_deleted', v_n);
  END IF;

  -- ---- auth.users tombstone ----------------------------------------------------------
  -- Row is KEPT (72 cascades hang off profiles.id). Everything that identifies the human
  -- is overwritten with an unguessable, unroutable value; the password becomes a bcrypt
  -- hash of throwaway random text, so even a full dump leak cannot restore it.
  UPDATE auth.users u
     SET email                  = v_tomb,
         phone                  = NULL,
         encrypted_password     = extensions.crypt(
                                    -- encode() is pg_catalog (always resolvable); the
                                    -- pgcrypto pieces must be schema-qualified because
                                    -- this function pins search_path = public, pg_temp
                                    encode(extensions.gen_random_bytes(24), 'hex')
                                      || clock_timestamp()::text,
                                    extensions.gen_salt('bf')),
         email_confirmed_at     = NULL,
         phone_confirmed_at     = NULL,
         -- confirmed_at is GENERATED ALWAYS AS (coalesce(email_confirmed_at, phone_confirmed_at))
         -- STORED in this GoTrue schema: assigning it aborts the whole UPDATE (SQLSTATE 428C9),
         -- so it is deliberately absent and follows the two columns above automatically.
         confirmation_token     = '',
         confirmation_sent_at   = NULL,
         recovery_token         = '',
         recovery_sent_at       = NULL,
         reauthentication_token = '',
         reauthentication_sent_at = NULL,
         email_change           = NULL,
         email_change_token_new = '',
         email_change_sent_at   = NULL,
         phone_change           = NULL,
         phone_change_token     = '',
         phone_change_sent_at   = NULL,
         last_sign_in_at        = NULL,
         invited_at             = NULL,
         raw_user_meta_data     = jsonb_build_object('erased_at',
                                    to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                                    'erased_by', 'Wave A/T11'),
         banned_until           = now() + interval '100 years',
         deleted_at             = now(),
         updated_at             = now()
   WHERE u.id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('users_tombstoned', v_n);

  -- ---- application tables ------------------------------------------------------------
  UPDATE public.profiles
     SET username   = 'erased_' || v_uid8,
         avatar_url = NULL,
         deleted_at = COALESCE(deleted_at, now())
   WHERE id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('profiles_anonymized', v_n);

  UPDATE public.user_consents
     SET ip_address = NULL, user_agent = NULL
   WHERE user_id = p_user_id AND (ip_address IS NOT NULL OR user_agent IS NOT NULL);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('consents_device_data_cleared', v_n);

  UPDATE public.sub_accounts
     SET email        = 'erased-sub-' || left(id::text, 8) || '@erasure.invalid',
         name         = '已匿名化' || left(id::text, 8),
         invite_token = NULL,
         status       = '已离职'          -- sub_accounts_status_ck only allows
   WHERE user_id = p_user_id;            -- 待激活/启用/停用/已离职
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('sub_accounts_anonymized', v_n);

  UPDATE public.orders
     SET phone     = '',
         address   = NULL,
         shop_name = '匿名化' || v_uid8
   WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('orders_contact_erased', v_n);

  UPDATE public.shop_auths
     SET access_token      = '',
         refresh_token     = '',
         shop_name         = '匿名化' || v_uid8,
         global_store_name = NULL
   WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('shop_tokens_cleared', v_n);

  UPDATE public.suppliers
     SET name    = '匿名供应商' || left(id::text, 8),
         contact = NULL,
         phone   = NULL
   WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('suppliers_anonymized', v_n);

  UPDATE public.shops
     SET name = '匿名店铺' || left(id::text, 8)
   WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('shops_anonymized', v_n);

  -- ---- ledger ------------------------------------------------------------------------
  UPDATE public.account_deletions d
     SET status = 'executed', executed_at = now(), erased = v_counts,
         channel = p_channel, updated_at = now()
   WHERE d.id = v_row.id;

  RETURN jsonb_build_object('ok', true, 'user_id', p_user_id, 'request_id', v_row.id,
                            'erased', v_counts,
                            'retained', jsonb_build_object(
                              'financial_rows', 'orders/shipments/invoices/statements kept (tax retention)',
                              'consent_facts', 'user_consents rows kept, device data cleared'));
END;
$$;

COMMENT ON FUNCTION public.execute_account_deletion(uuid, text, boolean) IS
  'Wave A/T11: anonymize one account. service_role / postgres / supabase_admin only. '
  'Refuses before grace_until unless p_override_grace=true (which is itself recorded).';

-- ------------------------------------------------------------------ 7. batch (pg_cron)
CREATE OR REPLACE FUNCTION public.execute_matured_deletions(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r    record;
  v_done   jsonb := '[]'::jsonb;
  v_failed jsonb := '[]'::jsonb;
  v_res    jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'execute_matured_deletions: p_limit must be between 1 and 200'
      USING ERRCODE = '22023';
  END IF;

  FOR r IN SELECT id, user_id, grace_until FROM public.account_deletions
            WHERE status = 'pending' AND grace_until <= now()
            ORDER BY grace_until LIMIT p_limit
  LOOP
    BEGIN
      v_res := public.execute_account_deletion(r.user_id, 'cron', false);
      v_done := v_done || jsonb_build_array(jsonb_build_object(
        'user_id', r.user_id, 'targets', v_res -> 'erased'));
    EXCEPTION WHEN OTHERS THEN
      -- one bad account must not stop the run; keep the evidence and surface it
      UPDATE public.account_deletions d
         SET note = 'cron failed: ' || SQLERRM, updated_at = now()
       WHERE d.id = r.id;
      v_failed := v_failed || jsonb_build_array(jsonb_build_object(
        'user_id', r.user_id, 'error', left(SQLERRM, 300)));
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'executed', jsonb_array_length(v_done),
                            'failed', jsonb_array_length(v_failed),
                            'detail', jsonb_build_object('done', v_done, 'failed', v_failed));
END;
$$;

COMMENT ON FUNCTION public.execute_matured_deletions(integer) IS
  'Wave A/T11: pg_cron entry point. Executes pending deletions whose 30-day grace elapsed. '
  'Each account runs in its own subtransaction so one failure cannot block the rest.';

-- ------------------------------------------------------------------ 8. grants
REVOKE ALL ON FUNCTION public.request_account_deletion(text)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_account_deletion()               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.execute_account_deletion(uuid,text,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.execute_matured_deletions(integer)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._wA_request_meta()                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._wA_obligation_snapshot(uuid)           FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.request_account_deletion(text)      TO authenticated, service_role, postgres, supabase_admin;
GRANT EXECUTE ON FUNCTION public.cancel_account_deletion()           TO authenticated, service_role, postgres, supabase_admin;
GRANT EXECUTE ON FUNCTION public.execute_account_deletion(uuid,text,boolean) TO service_role, postgres, supabase_admin;
GRANT EXECUTE ON FUNCTION public.execute_matured_deletions(integer)  TO service_role, postgres, supabase_admin;
-- The two _wA_* helpers stay UNGRANTED to every non-owner role on purpose:
-- _wA_obligation_snapshot(uuid) accepts an arbitrary user id and returns that account's
-- order / invoice / subscription counts, which is an enumeration oracle if it is exposed
-- through PostgREST. They are only ever called from inside the SECURITY DEFINER functions
-- above, where the effective user is the owner (postgres) and EXECUTE is implicit.

COMMIT;

-- publish the new RPCs to PostgREST without a restart
NOTIFY pgrst, 'reload schema';
