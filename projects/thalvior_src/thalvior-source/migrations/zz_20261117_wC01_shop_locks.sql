-- =============================================================================
-- zz_20261117_wC01_shop_locks.sql   ·  Wave C / T2：每店同步咨询锁
-- =============================================================================
-- 背景：cron thalvior-sync-orders-15min 每 15 分钟一跳，HTTP 超时刚从 30s 放宽到 14min
--       （见 wC T3）。上一跳没跑完时下一跳会撞进同一批店铺 → 同一 (shop, 水位) 并发拉两遍，
--       重复写 orders、水位互相覆盖。EF 是无状态多实例，进程内存锁互不可见，所以锁落在 DB。
-- 语义：try_acquire 用 shop_id 主键 + ON CONFLICT ... WHERE expires_at < now() 实现真正的
--       原子占用（并发两笔只有一笔能拿到）；release 只认 token，误删他人锁不可能。
-- 幂等：本文件可反复执行（IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS）。
-- 调用方：sync-orders EF 的 acquireShopLock / releaseShopLock（service_role）。

CREATE TABLE IF NOT EXISTS public.shop_sync_locks (
  shop_id uuid primary key,
  token uuid not null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null
);

CREATE INDEX IF NOT EXISTS shop_sync_locks_expires_idx
  ON public.shop_sync_locks(expires_at);

CREATE OR REPLACE FUNCTION public.try_acquire_shop_sync_lock(p_shop_id uuid, p_ttl_seconds int, p_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_exists boolean;
BEGIN
  IF (auth.jwt()->>'role') <> 'service_role' AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'try_acquire_shop_sync_lock: service_role or admin only';
  END IF;
  DELETE FROM shop_sync_locks WHERE shop_id = p_shop_id AND expires_at < now();
  INSERT INTO shop_sync_locks(shop_id, token, expires_at)
    VALUES (p_shop_id, p_token, now() + (p_ttl_seconds || ' seconds')::interval)
    ON CONFLICT (shop_id) DO UPDATE SET token = EXCLUDED.token, acquired_at = now(), expires_at = EXCLUDED.expires_at
      WHERE shop_sync_locks.expires_at < now()
    RETURNING true INTO v_exists;
  RETURN COALESCE(v_exists, false);
END $$;

CREATE OR REPLACE FUNCTION public.release_shop_sync_lock(p_shop_id uuid, p_token uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM shop_sync_locks WHERE shop_id = p_shop_id AND token = p_token;
$$;

GRANT EXECUTE ON FUNCTION public.try_acquire_shop_sync_lock(uuid, int, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_shop_sync_lock(uuid, uuid) TO service_role;

ALTER TABLE public.shop_sync_locks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_only ON public.shop_sync_locks;
CREATE POLICY service_only ON public.shop_sync_locks USING ((auth.jwt()->>'role')='service_role');

COMMENT ON TABLE public.shop_sync_locks IS 'Wave C T2：每店同步互斥锁，token 持有 + expires_at 自愈';
COMMENT ON FUNCTION public.try_acquire_shop_sync_lock(uuid, int, uuid) IS '原子抢锁；true=拿到，false=被占用';
COMMENT ON FUNCTION public.release_shop_sync_lock(uuid, uuid) IS '按 token 释放；token 不符则不动别人的锁';
