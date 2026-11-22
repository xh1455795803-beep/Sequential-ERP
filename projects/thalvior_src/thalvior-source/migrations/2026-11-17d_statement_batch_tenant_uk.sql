-- 2026-11-17d 对账链路的两个 schema 缺口（主会话拍板：G-1 + G-11）
-- =====================================================================
-- 背景1（G-1，跨租户可用性事故级）：
--   statement_import_batches 的唯一键是 **全局** UNIQUE(batch_no)，不含 user_id。
--   后果不是"不优雅"而是：
--     · 任何一家卖家先导入过批次号 2026-11，别家再导入同名批次就必然 409 落不进去；
--     · batch_no 是货代侧的账单号/批次号，格式由对方决定（很多就是"月份+序号"），
--       撞号是常态而不是异常；
--     · 更糟的是它把"这个批次号已被别人占用"暴露给无关租户，等于泄露对方的对账节奏。
--   项目里同类表本来就是按租户隔离的（shipments 用 (user_id,batch_no) 唯一、
--   statements 用 (user_id,forwarder_id,period_from,period_to,currency)），这一张是漏配。
--   现网 statement_import_batches 0 行，改索引零数据风险。
-- 配套代码：bill-import 的 existingBatch() 同步改为按 (user_id, batch_no) 查，
--   否则改成复合键后同一 batch_no 会有多租户两行，maybeSingle() 直接报 PGRST116。
--
-- 背景2（G-11，规模性）：
--   对账匹配与门户检索都按 tracking_no / platform_order_no 找货件，这两列上没有任何索引
--   （shipments 现有索引只有 order_id / wms_order_no / stage / push_state / retry / tracking_status）。
--   现在 2 行无感，万级货件时每轮匹配都是全表扫。补两个租户内部分索引。
-- 回滚：见文件末尾。

BEGIN;

-- ── 1) 批次号唯一键：全局 → 租户内 ──────────────────────────────────
-- 实测它是 UNIQUE CONSTRAINT（不是裸索引）：DROP INDEX 会被 postgres 拦下
-- "constraint ... requires it"，必须走 ALTER ... DROP/ADD CONSTRAINT。
ALTER TABLE public.statement_import_batches
  DROP CONSTRAINT IF EXISTS statement_import_batches_batch_no_uk;
ALTER TABLE public.statement_import_batches
  ADD CONSTRAINT statement_import_batches_user_batch_uk UNIQUE (user_id, batch_no);

-- 批次列表排序不用补索引：statement_import_batches_user_created_idx 已经是
-- (user_id, imported_at DESC)（该表没有 created_at，imported_at 就是排序列）。

-- ── 2) 对账匹配要用的两个货件检索索引 ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_shipments_tenant_tracking
  ON public.shipments (user_id, tracking_no)
  WHERE tracking_no IS NOT NULL AND tracking_no <> '';

CREATE INDEX IF NOT EXISTS idx_shipments_tenant_platform_no
  ON public.shipments (user_id, platform_order_no)
  WHERE platform_order_no IS NOT NULL AND platform_order_no <> '';

COMMIT;

-- 回滚：
-- ALTER TABLE public.statement_import_batches DROP CONSTRAINT IF EXISTS statement_import_batches_user_batch_uk;
-- DROP INDEX IF EXISTS public.idx_shipments_tenant_tracking;
-- DROP INDEX IF EXISTS public.idx_shipments_tenant_platform_no;
-- ALTER TABLE public.statement_import_batches ADD CONSTRAINT statement_import_batches_batch_no_uk UNIQUE (batch_no);
