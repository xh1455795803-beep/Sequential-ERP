-- =====================================================================
-- Wave A / T5 : remove the service_role key from the database GUC store
-- File : zz_20261117_wA06_guc_relocate.sql
-- RUN AS : supabase_admin  (ALTER ROLE ... SET requires superuser;
--                           postgres is NOT superuser on this box)
--
-- WHAT WAS ACTUALLY READING THE GUC (all measured, not assumed):
--   * application files (volumes/functions + /opt/thalvior-source):
--       grep -rn 'app.service_role_key' => 0 hits
--   * SQL functions:
--       prosrc LIKE E'%app\\.service\\_role\\_key%' ESCAPE '\' => 0 rows
--       (an earlier un-escaped LIKE reported 2 rows; both were false
--        positives -- '_' is a LIKE wildcard, so it matched the English
--        comments "service_role key". Corrected.)
--   * pg_cron: 4 jobs (1 sync-orders, 2 sync-stock, 4 track17, 8
--       settlement-sync) call current_setting('app.service_role_key') to sign
--       their own net.http_post Authorization header. Those are the ONLY
--       readers, and they authenticate as a *login* role
--       (jobs 1/2/8 = supabase_admin, job 4 = postgres), so a ROLE-scoped
--       setting is visible to them.
--
-- WHY ROLE-SCOPED AND NOT FUNCTION-SCOPED: measured on this box --
--   ALTER ROLE postgres SET app.wa_guc_test='X';
--   login as postgres                        -> 'X'   (visible)
--   SET ROLE authenticated; call a postgres-owned SECURITY DEFINER fn
--                                          -> NULL  (NOT visible)
-- i.e. Postgres applies per-role defaults at login / SET ROLE only, never when
-- a SECURITY DEFINER switches current_user. That is exactly why the 4
-- app.mailer_secret readers could NOT be migrated this way -- see
-- /tmp/wA-blocked-sql-guc.md.
--
-- Rollback: /opt/wA-rollback.sql section 11.
-- =====================================================================

BEGIN;

-- 1) copy the value from the DB-level GUC into two ROLE-level GUCs, entirely
--    server-side. The secret is never selected to a client, never written to a
--    file, and never appears in this migration text.
DO $do$
DECLARE
  v_key text := current_setting('app.service_role_key', true);
BEGIN
  IF v_key IS NULL OR length(v_key) < 20 THEN
    RAISE EXCEPTION 'APP.SERVICE_ROLE_KEY GUC is absent - refusing to rewrite cron jobs';
  END IF;
  -- jobs 1/2/8 run as supabase_admin, job 4 runs as postgres
  EXECUTE format('ALTER ROLE postgres      SET app.service_role_key_for_cron = %L', v_key);
  EXECUTE format('ALTER ROLE supabase_admin SET app.service_role_key_for_cron = %L', v_key);
  RAISE NOTICE 'relocated (value length only, never printed) len=%', length(v_key);
END $do$;

-- 2) point the 4 cron jobs at the new, role-scoped GUC.
--    replace() on the literal substring; nothing else in the command changes.
DO $do$
DECLARE
  r record;
  v_new text;
BEGIN
  FOR r IN SELECT jobid, jobname, command FROM cron.job
            WHERE position('app.service_role_key' in command) > 0
              AND position('app.service_role_key_for_cron' in command) = 0
  LOOP
    -- replace the short name with the long name, but only where it is NOT
    -- already the long form (the WHERE clause above guarantees that)
    v_new := replace(r.command, 'app.service_role_key', 'app.service_role_key_for_cron');
    PERFORM cron.alter_job(job_id := r.jobid, command := v_new);
    RAISE NOTICE 'rewrote cron job % (%)', r.jobid, r.jobname;
  END LOOP;
END $do$;

-- 3) drop the secret from the database-level GUC store.
--    Before this change anon / authenticated could read it with
--    SELECT current_setting('app.service_role_key') from inside ANY
--    query they were allowed to run -- it was a per-database default, i.e.
--    inherited by every role including the two that face the internet.
ALTER DATABASE postgres RESET app.service_role_key;

COMMIT;
