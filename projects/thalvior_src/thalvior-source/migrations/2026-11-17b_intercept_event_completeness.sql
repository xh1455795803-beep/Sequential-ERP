-- 2026-11-17b 修正 2026-11-17_intercept_cancel_norm.sql 带出的一个回归
-- 背景：上一条迁移把拦截回执事件的 norm_status 从硬编码 'sending' 改成沿用货件的 norm_status。
--       于是「拦截失败」的回执在 norm_status='success' 的货件上会写一条
--       norm_status='success' 且 tracking_no 为空的事件行，直接撞 sse_field_completeness_ck
--       （success⇒tracking_no 非空 / failed⇒failed_reason 非空），RPC 抛异常 →
--       门户 intercept_report 回 "拦截回执 RPC 调用失败"，货代永远回执不了失败件。
--       线上复现：演示货件 S2（norm=success, track=TKDEMO0000002）回执 failed → RPC 500。
-- 做法：事件行把 sse 的追溯字段一起带上（tracking_no / carrier_name / failed_reason），
--       并在脏数据（norm=success 却没有运单号）时把事件降级成 sending，
--       绝不允许一条追溯事件把一次业务回执整体打断。
-- 影响面：ERP 侧 shipment_intercept_report EF 与货代门户 intercept_report 共用本函数，一次修两条路。
-- 回滚：/tmp/shipments_set_intercept_result.rollback2.bak（本文件应用前的定义）。

CREATE OR REPLACE FUNCTION public.shipment_set_intercept_result(
  p_shipment_id uuid, p_result text, p_by uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text
)
RETURNS TABLE(ok boolean, message text, doc_status text, intercept_state text)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  s record;
  v_norm   text;
  v_track  text;
  v_reason text;
BEGIN
  IF p_result IS NULL OR p_result NOT IN ('succeeded','failed') THEN
    RETURN QUERY SELECT false, 'p_result 只允许 succeeded / failed'::text,
                         NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO s FROM shipments WHERE id = p_shipment_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, '货件不存在'::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF s.doc_status = 'cancelled' THEN
    RETURN QUERY SELECT false, '单据已作废，不可重复接收拦截回执'::text,
                         s.doc_status, s.intercept_state;
    RETURN;
  END IF;

  IF s.intercept_state <> 'requested' THEN
    RETURN QUERY SELECT false,
      format('当前 intercept_state=%s，只有 requested 能接收回执（疑似乱序或重复回执）',
             s.intercept_state), s.doc_status, s.intercept_state;
    RETURN;
  END IF;

  -- 拦截成功 = 这单确定不发了：轨迹归一态收敛到 cancel（终态，回传侧不得再洗回）
  -- 拦截失败 = 解冻继续履约，norm 保持货件原状（success 就是 success，不能假装回退成 sending）
  v_norm := CASE WHEN p_result = 'succeeded' THEN 'cancel' ELSE s.norm_status END;

  UPDATE shipments
     SET intercept_state = p_result,
         doc_status      = CASE WHEN p_result = 'succeeded' THEN 'cancelled' ELSE 'valid' END,
         norm_status     = v_norm,
         cancelled_reason = CASE WHEN p_result = 'succeeded'
                                 THEN COALESCE(NULLIF(btrim(p_note),''), '拦截成功，单据作废')
                                 ELSE s.cancelled_reason END,
         updated_at      = now()
   WHERE id = p_shipment_id;

  -- 事件行必须自证 completeness：照抄货件 norm 时把对应字段补齐
  v_track  := NULLIF(btrim(coalesce(s.tracking_no, '')), '');
  v_reason := CASE WHEN p_result = 'failed'
                   THEN COALESCE(NULLIF(btrim(p_note), ''), '拦截失败，已解冻继续履约')
                   ELSE NULL END;
  IF v_norm = 'success' AND v_track IS NULL THEN
    v_norm := 'sending';   -- 脏数据兜底：没有单号就不能声明 success，宁可降级也不能抛错
  END IF;
  IF v_norm = 'failed' AND v_reason IS NULL THEN
    v_reason := '拦截失败';
  END IF;

  INSERT INTO shipment_status_events
    (user_id, shipment_id, raw_status, norm_status, stage, tracking_no, carrier_name,
     failed_reason, source, payload)
  VALUES
    (s.user_id, s.id, 'ERP:intercept_' || p_result, v_norm, s.stage, v_track, s.carrier,
     v_reason, 'system',
     jsonb_build_object('intercept_result', p_result, 'by', p_by, 'note', p_note));

  IF p_result = 'succeeded' THEN
    RETURN QUERY SELECT true, '拦截成功，单据已作废'::text, 'cancelled'::text, 'succeeded'::text;
  ELSE
    RETURN QUERY SELECT true, '拦截失败，已解冻继续履约'::text, 'valid'::text, 'failed'::text;
  END IF;
END $function$;
