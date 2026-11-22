-- =====================================================================
-- zz_20261117_wD01_pool_rpc.sql   —  Billing Wave D / T1
-- 原子积分池操作：把「读-改-写」下推到 SQL 层，用行锁消除双花
-- 背景（审计 pool.ts:69-92 / 96-122）：
--   deductFromPool 先 SELECT 余额再在 JS 里算新值、再 UPDATE 绝对值。
--   两个并发请求都读到 100，各扣 60，最后写入 40 —— 实际只扣了 60。
--   addPurchasedCredits 同样：在途结算会把刚充值的积分覆盖掉。
-- 真实列名（现网 \d tenant_quotas 核实，非任务书假设的 free_today/free_granted_on）：
--   workbench_free_date / workbench_free_today / workbench_credits
--   agent_free_date     / agent_free_today     / agent_credits      （均为 numeric）
-- 语义保持与 _shared/pool.ts 一致：余额 = 今日赠送 + 充值；扣分先赠送后充值。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) 原子扣分：行锁内判定 + 扣减，绝不返回「先判后扣」的中间态
--    p_field 白名单：workbench_credits / agent_credits
--    返回 free_used / paid_used 以便 pool.ts 维持 {freeUsed,paidUsed} 契约
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.deduct_user_pool(
  p_user_id uuid,
  p_field   text,
  p_amount  numeric
) RETURNS TABLE (ok boolean, remaining numeric, reason text, free_used numeric, paid_used numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_free_col      text;
  v_daily_workbench numeric := 20;
  v_daily_agent     numeric := 100;
  v_today         date := current_date;
  v_free          numeric := 0;
  v_paid          numeric := 0;
  v_used_free     numeric := 0;
  v_used_paid     numeric := 0;
  v_rem           numeric := 0;
BEGIN
  -- 鉴权：service_role（EF 结算通道）或 admin。auth.jwt() 在无请求上下文时为 NULL，
  -- 用 COALESCE 让「无 JWT 的直连」也走拒绝分支，不能因为 NULL 判定为假而放行。
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
      RAISE EXCEPTION 'deduct_user_pool: service_role or admin only';
    END IF;
  END IF;

  IF p_field = 'workbench_credits' THEN
    v_free_col := 'workbench_free_today';
  ELSIF p_field = 'agent_credits' THEN
    v_free_col := 'agent_free_today';
  ELSE
    RETURN QUERY SELECT false, 0::numeric, 'field_not_allowed', 0::numeric, 0::numeric;
    RETURN;
  END IF;

  IF p_amount IS NULL OR p_amount < 0 THEN
    RETURN QUERY SELECT false, 0::numeric, 'negative_amount', 0::numeric, 0::numeric;
    RETURN;
  END IF;

  -- (a) 建行 + 每日免费赠送刷新，合并成一条 UPSERT（取代 pool.ts::ensureFreeGrant）。
  --     ON CONFLICT 的 SET 表达式全部读到旧行，因此四个 CASE 互不干扰。
  INSERT INTO tenant_quotas AS t
    (user_id, workbench_free_date, workbench_free_today, agent_free_date, agent_free_today, updated_at)
  VALUES
    (p_user_id, v_today, v_daily_workbench, v_today, v_daily_agent, now())
  ON CONFLICT (user_id) DO UPDATE SET
    workbench_free_date  = CASE WHEN COALESCE(t.workbench_free_date , DATE '1970-01-01') < v_today THEN v_today ELSE t.workbench_free_date  END,
    workbench_free_today = CASE WHEN COALESCE(t.workbench_free_date , DATE '1970-01-01') < v_today THEN v_daily_workbench ELSE t.workbench_free_today END,
    agent_free_date      = CASE WHEN COALESCE(t.agent_free_date , DATE '1970-01-01') < v_today THEN v_today ELSE t.agent_free_date      END,
    agent_free_today     = CASE WHEN COALESCE(t.agent_free_date , DATE '1970-01-01') < v_today THEN v_daily_agent   ELSE t.agent_free_today     END,
    updated_at           = now();

  -- (b) 取行锁后读当前余额。此后到事务结束前，其它事务无法改这一行 → 无双花窗口。
  --     p_field 已被上面的白名单分支限定为两个字面量之一，%I 只是双保险。
  EXECUTE format(
    'SELECT COALESCE(%I, 0)::numeric, COALESCE(%I, 0)::numeric FROM tenant_quotas WHERE user_id = $1 FOR UPDATE',
    v_free_col, p_field
  ) USING p_user_id INTO v_free, v_paid;

  IF v_free + v_paid < p_amount THEN
    RETURN QUERY SELECT false, (v_free + v_paid), 'insufficient', 0::numeric, 0::numeric;
    RETURN;
  END IF;

  v_used_free := LEAST(p_amount, v_free);
  v_used_paid := p_amount - v_used_free;

  EXECUTE format(
    'UPDATE tenant_quotas SET %I = COALESCE(%I, 0) - $2, %I = COALESCE(%I, 0) - $3, updated_at = now() WHERE user_id = $1',
    v_free_col, v_free_col, p_field, p_field
  ) USING p_user_id, v_used_free, v_used_paid;

  EXECUTE format(
    'SELECT (COALESCE(%I, 0) + COALESCE(%I, 0))::numeric FROM tenant_quotas WHERE user_id = $1',
    v_free_col, p_field
  ) USING p_user_id INTO v_rem;

  RETURN QUERY SELECT true, COALESCE(v_rem, 0), NULL::text, v_used_free, v_used_paid;
END $$;

-- ---------------------------------------------------------------------
-- 2) 原子加分：结算到账专用，SET x = x + amount，绝不用旧值覆盖
--    p_field 白名单：workbench_credits / agent_credits / balance
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.credit_user_pool(
  p_user_id  uuid,
  p_field    text,
  p_amount   numeric,
  p_reason   text DEFAULT 'settlement'
) RETURNS TABLE (ok boolean, new_balance numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bal numeric;
BEGIN
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'credit_user_pool: service_role only';
  END IF;

  IF p_field NOT IN ('workbench_credits', 'agent_credits', 'balance') THEN
    RETURN QUERY SELECT false, 0::numeric;
    RETURN;
  END IF;

  IF p_amount IS NULL OR p_amount < 0 THEN
    RETURN QUERY SELECT false, 0::numeric;
    RETURN;
  END IF;

  INSERT INTO tenant_quotas (user_id) VALUES (p_user_id) ON CONFLICT (user_id) DO NOTHING;

  EXECUTE format(
    'UPDATE tenant_quotas SET %I = COALESCE(%I, 0) + $2, updated_at = now() WHERE user_id = $1 RETURNING %I',
    p_field, p_field, p_field
  ) USING p_user_id, p_amount INTO v_bal;

  -- p_reason 不落列（tenant_quotas 无该字段，流水账在 quota_recharges / payment_orders），
  -- 仅进服务端日志，保留参数以免调用方签名变更。
  RAISE NOTICE 'credit_user_pool user=% field=% amount=% reason=%', p_user_id, p_field, p_amount, COALESCE(p_reason, 'settlement');

  RETURN QUERY SELECT true, COALESCE(v_bal, 0)::numeric;
END $$;

-- ---------------------------------------------------------------------
-- 授权：DEFINER 函数属主 = postgres（表属主 + BYPASSRLS），因此 wave A 在
-- tenant_quotas 上收紧 RLS / 撤销 authenticated DML 都不会影响这两个函数。
-- 这里显式收回 PUBLIC/anon 的 EXECUTE，避免变成公开提权面。
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.deduct_user_pool(uuid, text, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.credit_user_pool(uuid, text, numeric, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.deduct_user_pool(uuid, text, numeric) TO service_role, authenticated;
GRANT  EXECUTE ON FUNCTION public.credit_user_pool(uuid, text, numeric, text) TO service_role;
