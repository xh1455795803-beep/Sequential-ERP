-- zz_20261117_wA07_otp_hardening.sql
-- Wave A / T8: SMS OTP structural hardening + email_codes grant tightening
--
-- WHY (three defects in aliyun-sms that were only fixable in the schema)
--   1) MAX_ATTEMPTS = 5 is declared at aliyun-sms/index.ts:11 but never enforced: the
--      verify branch compares the 6-digit code and returns on mismatch, so a code can be
--      brute-forced ~1e6 times per 5-minute window (throttling the send path does not
--      protect the verify path at all). sms_codes had no attempts column to count with.
--   2) The code is stored in the clear. It is a bearer credential for a password reset, so
--      every DB reader (backups, replicas, psql history, Wave C sync dumps, log lines) could
--      replay a reset without touching Aliyun. aliyun-sms now stores
--      hex(HMAC-SHA256(JWT_SECRET, id || '|' || code)) in code_hash and writes an empty
--      plaintext column.
--   3) email_codes is granted ALL to anon/authenticated while having zero policies for them.
--      RLS denies today, but the grant is one careless policy or one BYPASSRLS mistake away
--      from exposing the OTP audit trail (and letting anon insert rows that suppress future
--      sends, because email-otp reads this table for its resend gate).
--
-- Apply as: postgres.  Idempotent.
-- Deferred, deliberately NOT run here (see rollback section 13): the still-warm pre-restart
-- Deno worker keeps writing the plaintext column, so `ALTER TABLE public.sms_codes DROP
-- COLUMN code;` must wait until after the wave restart + 24h of quiet.

BEGIN;

-- 1) wrong-code counter ---------------------------------------------------------------
ALTER TABLE public.sms_codes ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace AND conname = 'sms_codes_attempts_chk'
  ) THEN
    ALTER TABLE public.sms_codes ADD CONSTRAINT sms_codes_attempts_chk CHECK (attempts >= 0);
  END IF;
END $$;

-- 2) hashed code ---------------------------------------------------------------------
ALTER TABLE public.sms_codes ADD COLUMN IF NOT EXISTS code_hash text;

COMMENT ON COLUMN public.sms_codes.code_hash IS
  'hex(HMAC-SHA256(JWT_SECRET, id||"|"||code)) - the SMS OTP is no longer stored in the clear (Wave A T8, 20261117-wA)';
COMMENT ON COLUMN public.sms_codes.attempts IS
  'wrong-code tries for this OTP; row is invalidated (used=true) at MAX_ATTEMPTS=5 (Wave A T8)';
COMMENT ON COLUMN public.sms_codes.code IS
  'LEGACY plaintext OTP - empty for every row written after 20261117-wA; drop this column once no pre-restart worker remains';

-- 3) email_codes: no client-role table rights ----------------------------------------
REVOKE ALL ON TABLE public.email_codes FROM anon, authenticated;

COMMIT;

-- read-back ---------------------------------------------------------------------------
SELECT c.relname, a.attnum, a.attname, format_type(a.atttypid, a.atttypmod) AS type,
       a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS default_expr
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
WHERE c.relname = 'sms_codes' AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum;

SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity AS rls_on,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
       has_table_privilege('authenticated', c.oid, 'INSERT') AS auth_insert,
       has_table_privilege('service_role', c.oid, 'UPDATE') AS svc_update
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('sms_codes', 'email_codes')
ORDER BY c.relname;
