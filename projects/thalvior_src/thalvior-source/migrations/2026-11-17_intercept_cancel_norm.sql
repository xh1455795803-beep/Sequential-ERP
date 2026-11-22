-- 2026-11-17 拦截成功后把轨迹归一态收敛到 cancel
-- 背景：shipments 有四态分离（push_state / stage / doc_status / norm_status+raw_status）。
--       原实现里拦截成功只改 doc_status=cancelled + intercept_state=succeeded，
--       norm_status 仍停在 sending，导致货件履约看板上「已作废的单据」还显示成「流转中」，
--       与协议 §4.4「cancel 是终态、一旦确立不再被洗回」矛盾。
-- 影响面：ERP 侧与货代门户侧的拦截回执都走这个函数，一次修复两条路。
-- 回滚：执行文件末尾注释里的旧定义（或直接跑 /tmp/*.bak 里的备份）。

CREATE OR REPLACE FUNCTION public.shipment_set_intercept_result(
  p_shipment_id uuid, p_result text, p_by uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text
)
RETURNS TABLE(ok boolean, message text, doc_status text, intercept_state text)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  s record;
  v_norm text;
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

  INSERT INTO shipment_status_events
    (user_id, shipment_id, raw_status, norm_status, stage, source, payload)
  VALUES
    (s.user_id, s.id, 'ERP:intercept_' || p_result, v_norm, s.stage, 'system',
     jsonb_build_object('intercept_result', p_result, 'by', p_by, 'note', p_note));

  IF p_result = 'succeeded' THEN
    RETURN QUERY SELECT true, '拦截成功，单据已作废'::text, 'cancelled'::text, 'succeeded'::text;
  ELSE
    RETURN QUERY SELECT true, '拦截失败，已解冻继续履约'::text, 'valid'::text, 'failed'::text;
  END IF;
END $function$;

-- 回滚用（原定义的两处差异：不写 norm_status / cancelled_reason，事件 norm_status 恒为 'sending'）：
-- CREATE OR REPLACE FUNCTION public.shipment_set_intercept_result(p_shipment_id uuid, p_result text, p_by uuid DEFAULT NULL, p_note text DEFAULT NULL)
-- RETURNS TABLE(ok boolean, message text, doc_status text, intercept_state text) LANGUAGE plpgsql SET search_path TO 'public'
-- AS $function$ ... 见 git 历史 / /tmp/shipments_set_intercept_result.bak ... $function$;
