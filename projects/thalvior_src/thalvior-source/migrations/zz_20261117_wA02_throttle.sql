-- =====================================================================
-- Wave A / T9 : shared request-throttling primitive
-- File : zz_20261117_wA02_throttle.sql
-- RUN AS : postgres  (creates its own objects; the SECURITY DEFINER function
--                     is owned by postgres and writes a postgres-owned table,
--                     so no superuser and no BYPASSRLS is involved)
--
-- WHY IN THE DATABASE AND NOT IN THE EDGE FUNCTION
--   Edge functions are stateless and several Deno workers can serve one
--   request burst, so an in-process Map counter is trivially bypassed and also
--   resets on every (cached) worker recycling - which Wave A measured directly
--   while landing T7: an already-warm /functions/v1/track17 worker kept serving
--   the PREVIOUS module after the file changed. A counter has to live where the
--   write is atomic, i.e. Postgres, and the increment must be a single
--   INSERT..ON CONFLICT..WHERE statement so two concurrent callers cannot both
--   slip past the limit.
--
-- CONTRACT (used by _shared/throttle.ts)
--   throttle_consume(scope, bucket_key, limit, window_seconds, cost)
--     -> (allowed, remaining, retry_after_seconds, window_resets_at)
--   Fixed-window counting: window_start = floor(epoch/window)*window.
--   A window, once opened, cannot be shortened by an attacker; the only knob is
--   the limit. Purge keeps the table bounded.
--
-- ROLLBACK : /opt/wA-rollback.sql section 12 (pre-state snapshot + drop stmts)
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.throttle_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope        text        NOT NULL,
  bucket_key   text        NOT NULL,
  window_start timestamptz NOT NULL,
  hits         integer     NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT throttle_log_scope_key_window_udx UNIQUE (scope, bucket_key, window_start),
  CONSTRAINT throttle_log_hits_chk CHECK (hits >= 0)
);
CREATE INDEX IF NOT EXISTS throttle_log_window_start_idx ON public.throttle_log (window_start);

COMMENT ON TABLE public.throttle_log IS
  'Wave A/T9 fixed-window rate counters shared by the edge functions. Not tenant data: '
  'never expose it through the API - RLS is enabled with zero policies and all grants to '
  'anon/authenticated are revoked. Read/write happens only via throttle_consume().';

ALTER TABLE public.throttle_log ENABLE ROW LEVEL SECURITY;

-- RLS with no policy is belt-and-braces; the grant revoke is what actually shuts
-- PostgREST out (a SELECT on a non-granted table fails before RLS is consulted).
REVOKE ALL ON public.throttle_log FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.throttle_log TO service_role;

CREATE OR REPLACE FUNCTION public.throttle_consume(
  p_scope          text,
  p_bucket_key     text,
  p_limit          integer,
  p_window_seconds integer,
  p_cost           integer DEFAULT 1
) RETURNS TABLE (
  allowed                boolean,
  remaining              integer,
  retry_after_seconds    integer,
  window_resets_at       timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_window  integer;
  v_start   timestamptz;
  v_hits    integer;
  v_key     text;
  v_scope   text;
  v_cost    integer;
  v_limit   integer;
BEGIN
  -- ---- input hygiene: this function is reachable by service_role only, but the
  --      edge functions forward attacker-controlled values straight into it.
  v_scope := lower(btrim(coalesce(p_scope, '')));
  v_key   := lower(btrim(coalesce(p_bucket_key, '')));
  v_cost  := greatest(1, coalesce(p_cost, 1));
  v_limit := coalesce(p_limit, 0);

  IF v_scope = '' OR length(v_scope) > 64 THEN
    RAISE EXCEPTION 'throttle_consume: bad scope' USING errcode = '22023';
  END IF;
  IF v_key = '' OR length(v_key) > 200 THEN
    RAISE EXCEPTION 'throttle_consume: bad bucket_key' USING errcode = '22023';
  END IF;
  IF v_limit < 1 OR v_limit > 100000 THEN
    RAISE EXCEPTION 'throttle_consume: p_limit must be within 1..100000' USING errcode = '22023';
  END IF;

  v_window := coalesce(p_window_seconds, 0);
  IF v_window < 1 OR v_window > 86400 THEN
    RAISE EXCEPTION 'throttle_consume: p_window_seconds must be within 1..86400' USING errcode = '22023';
  END IF;

  v_start := to_timestamp(floor(extract(epoch FROM now()) / v_window) * v_window);

  -- ---- the whole point: check-and-increment in ONE statement, so two concurrent
  --      requests cannot both be admitted at the boundary. The WHERE clause makes
  --      the ON CONFLICT arm a no-op (zero rows returned) once the window is spent.
  BEGIN
    INSERT INTO public.throttle_log AS t
           (scope, bucket_key, window_start, hits, created_at, updated_at)
      VALUES (v_scope, v_key, v_start, v_cost, now(), now())
    ON CONFLICT (scope, bucket_key, window_start) DO UPDATE
      SET hits       = t.hits + v_cost,
          updated_at = now()
      WHERE t.hits + v_cost <= v_limit
    RETURNING t.hits INTO v_hits;
  EXCEPTION WHEN unique_violation THEN
    -- race between two requests landing in the same instant; treat as a denial for
    -- this attempt (the client retries and lands on the existing row)
    v_hits := NULL;
  END;

  IF v_hits IS NOT NULL THEN
    allowed             := true;
    remaining           := greatest(v_limit - v_hits, 0);
    retry_after_seconds := 0;
    window_resets_at    := v_start + make_interval(secs => v_window);
    RETURN NEXT;
    RETURN;
  END IF;

  -- ---- denied: report when this window closes so the caller can back off honestly
  SELECT t.hits INTO v_hits
    FROM public.throttle_log t
   WHERE t.scope = v_scope AND t.bucket_key = v_key AND t.window_start = v_start;

  allowed             := false;
  remaining           := 0;
  window_resets_at    := v_start + make_interval(secs => v_window);
  retry_after_seconds := greatest(
    ceil(extract(epoch FROM v_start + make_interval(secs => v_window) - now()))::integer, 1);

  RAISE NOTICE 'throttle_consume DENIED scope=% key=<redacted len=>% limit=%/% window=%s retry=%s',
    v_scope, length(v_key), coalesce(v_hits, v_limit), v_limit, v_window, retry_after_seconds;
  RETURN NEXT;
END $function$;

COMMENT ON FUNCTION public.throttle_consume(text, text, integer, integer, integer) IS
  'Wave A/T9 atomic fixed-window counter. Returns allowed=false once p_limit hits are '
  'consumed for (p_scope,p_bucket_key) inside p_window_seconds. SECURITY DEFINER with a '
  'pinned search_path (public, pg_temp) so it cannot be hijacked by a caller-planted '
  'pg_temp object.';

-- ---- API surface: the RPC is for the edge functions (service role) only.
--      `FROM PUBLIC, anon` is required here, not just PUBLIC: this database has
--      ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE TO anon, so a plain
--      REVOKE ... FROM PUBLIC would still leave anon with a direct grant.
REVOKE ALL ON FUNCTION public.throttle_consume(text, text, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.throttle_consume(text, text, integer, integer, integer)
  TO service_role, postgres, supabase_admin;

-- ---- bounded growth: 25h is longer than the largest window the RPC accepts (86400s)
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('thalvior-throttle-purge')
      FROM cron.job WHERE jobname = 'thalvior-throttle-purge';
    PERFORM cron.schedule('thalvior-throttle-purge', '17 4 * * *',
      $$DELETE FROM public.throttle_log WHERE window_start < now() - interval '25 hours'$$);
    RAISE NOTICE 'scheduled thalvior-throttle-purge (daily 04:17, keeps 25h)';
  ELSE
    RAISE NOTICE 'pg_cron not installed - schedule the purge manually';
  END IF;
END $do$;

COMMIT;
