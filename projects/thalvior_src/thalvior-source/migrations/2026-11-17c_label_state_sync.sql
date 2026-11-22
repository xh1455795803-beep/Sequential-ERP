-- 2026-11-17c 面单状态落地：label_files → shipments.label_state 同步 + 漏配的视图 invoker
-- 背景1（真实可见的错误显示）：
--   shipments.label_state 的 5 值域（none/requested/ready/failed/updated）在生产里**没有任何写入方**：
--   forwarder-push 建单时写死 'none'，之后全库无人再改（pg_proc 里搜 label_state 命中 0 个函数，
--   label_files 上也没有触发器）。于是货代明明已经出了面单（label_files 里有 WAYBILL/ready，
--   而且 ready_pack→label_ready 的门禁就是读这张表判定的），
--   卖家侧「货件履约看板」的面单列却永远显示"未出单"——门禁与展示各读各的，自相矛盾。
-- 做法：在 label_files 上加行级触发器，按"最新一张非 superseded 的 WAYBILL"回写 shipments.label_state。
--   用触发器而不是让每个写入方自己维护：面单的行可能来自货代门户、webhook、SQL 导入、
--   将来的 17track/货代 API 抓取，写入方越多越不可能各自写对；口径只留一份。
--   只认 file_type='WAYBILL'：发票/箱标/装箱单不是"能不能发货"的那张面单，混进来会让看板乱跳 ready。
-- 背景2：v_order_refund_summary 是 8 个视图里唯一没带 security_invoker=true 的（其余 7 个都有）。
--   它现在没给 authenticated 授权所以还漏不出去，但 supabase_admin/postgres 有 BYPASSRLS，
--   一旦哪天有人补一条 grant，跨租户退款金额立刻可见。这里一次性补齐口径，不留"下次再改"。
-- 回滚：本文件末尾两条 DROP / ALTER。

CREATE OR REPLACE FUNCTION public.fn_label_files_sync_shipment_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_shipment uuid;
  v_state    text;
BEGIN
  v_shipment := COALESCE(NEW.shipment_id, OLD.shipment_id);
  IF v_shipment IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- 面单是"多版本 + 作废"的：is_update=true 的两段式面单（先出标签、尾程再换单）会追加新版本，
  -- 旧版本置 superseded 而不是删掉，所以取"非 superseded 里 version 最大、时间最新"的那一张为准。
  SELECT CASE
           WHEN lf.status = 'ready' AND lf.is_update THEN 'updated'
           WHEN lf.status = 'ready'                  THEN 'ready'
           WHEN lf.status = 'failed'                 THEN 'failed'
           ELSE 'requested'          -- status='requested'：已向货代申请、面单还没回来
         END
    INTO v_state
    FROM label_files lf
   WHERE lf.shipment_id = v_shipment
     AND lf.file_type = 'WAYBILL'
   ORDER BY (lf.status = 'superseded') ASC, lf.version DESC NULLS LAST, lf.created_at DESC
   LIMIT 1;

  IF v_state IS NULL THEN
    v_state := 'none';               -- 一张 WAYBILL 都没有（含全被作废/删光）
  END IF;

  -- 同值不写：包裹签收触发器 + 面单触发器都挂在同一条链上，避免无谓的 updated_at 抖动与写放大
  UPDATE shipments
     SET label_state = v_state,
         updated_at  = now()
   WHERE id = v_shipment
     AND label_state IS DISTINCT FROM v_state;

  RETURN COALESCE(NEW, OLD);
END $function$;

DROP TRIGGER IF EXISTS trg_label_files_sync_state ON public.label_files;
CREATE TRIGGER trg_label_files_sync_state
  AFTER INSERT OR UPDATE OR DELETE ON public.label_files
  FOR EACH ROW EXECUTE FUNCTION public.fn_label_files_sync_shipment_state();

ALTER VIEW public.v_order_refund_summary SET (security_invoker = true);

-- 首次回填：按同一口径把现存货件的 label_state 算一遍（只写 shipments 这一列，不动 label_files）。
-- 当前 label_files 是空表 → 本段等价于全表校验，不会改变任何值；将来重放也幂等。
UPDATE shipments s
   SET label_state = coalesce(l.v_state, 'none'), updated_at = now()
  FROM (
    SELECT lf.shipment_id,
           CASE WHEN lf.status = 'ready' AND lf.is_update THEN 'updated'
                WHEN lf.status = 'ready'                  THEN 'ready'
                WHEN lf.status = 'failed'                 THEN 'failed'
                ELSE 'requested' END AS v_state
      FROM label_files lf
     WHERE lf.file_type = 'WAYBILL'
       AND lf.id IN (SELECT id FROM (SELECT id,
                       row_number() OVER (PARTITION BY shipment_id
                                          ORDER BY (status = 'superseded') ASC,
                                                   version DESC NULLS LAST,
                                                   created_at DESC) AS rn
                                    FROM label_files WHERE file_type = 'WAYBILL') t WHERE rn = 1)
  ) l
 WHERE l.shipment_id = s.id
   AND s.label_state IS DISTINCT FROM l.v_state;

UPDATE shipments s SET label_state = 'none', updated_at = now()
 WHERE s.label_state IS DISTINCT FROM 'none'
   AND NOT EXISTS (SELECT 1 FROM label_files lf
                    WHERE lf.shipment_id = s.id AND lf.file_type = 'WAYBILL');

-- 回滚：
-- DROP TRIGGER IF EXISTS trg_label_files_sync_state ON public.label_files;
-- DROP FUNCTION IF EXISTS public.fn_label_files_sync_shipment_state();
-- ALTER VIEW public.v_order_refund_summary SET (security_invoker = false);
