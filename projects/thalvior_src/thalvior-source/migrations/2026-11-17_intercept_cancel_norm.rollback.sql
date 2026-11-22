CREATE OR REPLACE FUNCTION public.shipment_set_intercept_result(p_shipment_id uuid, p_result text, p_by uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text)
 RETURNS TABLE(ok boolean, message text, doc_status text, intercept_state text)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  s record;
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

  UPDATE shipments
     SET intercept_state = p_result,
         doc_status      = CASE WHEN p_result = 'succeeded' THEN 'cancelled' ELSE 'valid' END
   WHERE id = p_shipment_id;

  INSERT INTO shipment_status_events
    (user_id, shipment_id, raw_status, norm_status, stage, source, payload)
  VALUES
    (s.user_id, s.id, 'ERP:intercept_' || p_result, 'sending', s.stage, 'system',
     jsonb_build_object('intercept_result', p_result, 'by', p_by, 'note', p_note));

  IF p_result = 'succeeded' THEN
    RETURN QUERY SELECT true, '拦截成功，单据已作废'::text, 'cancelled'::text, 'succeeded'::text;
  ELSE
    RETURN QUERY SELECT true, '拦截失败，已解冻继续履约'::text, 'valid'::text, 'failed'::text;
  END IF;
END $function$

