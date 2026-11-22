-- =====================================================================
-- zz_20261117_fw02b_gate_return_fix.sql
-- 修 shipment_can_advance 的「多行返回」缺陷
-- （2026-11-17 生产库经 PostgREST 实测发现，非推测）
--
-- 现场证据：对不存在的货件 uuid 调 /rpc/shipment_can_advance{'received'}
--   HTTP 200  返回 3 行：
--     {"allowed":false,"reason":"货件不存在"}
--     {"allowed":false,"reason":"非法阶段转移： → received"}
--     {"allowed":true, "reason":null}          <-- 同一次调用里出现了 true
--
-- 根因：plpgsql 的 `RETURN QUERY` **不会结束函数**，只是往结果集追加行然后继续往下跑。
--       fw02 原文里 4 个失败分支只写了 RETURN QUERY 没写 RETURN;（只有 tracking_no
--       那一个分支写了 RETURN;，对比即可看出是疏漏不是设计），于是失败之后
--       仍然执行到底部 `RETURN QUERY SELECT true, ...`。
--
-- 为什么写路径今天还没出事、但这仍然是必须马上修的缺陷：
--   shipment_advance 用的是 `SELECT allowed,... INTO v_allowed FROM shipment_can_advance(...)`
--   —— plpgsql 的 SELECT INTO 只取第一行，第一行恰好是拒绝行，所以推进被正确地挡住了。
--   这是**靠巧合正确**：页面预检和 Edge Function 都会直接消费这个函数，
--   任何一处写成 `.some(r => r.allowed)` / `exists(... where allowed)` / `bool_or`，
--   门禁与状态机就整体失效（非法转移、未签收就打包、没面单就出面单）。
--
-- 本文件把契约钉死为：**任何情况下只返回一行**。
--   拒绝 → allowed=false + 中文原因 +（若为门禁则带 gate 名）
--   放行 → allowed=true  + reason=null + gate 名（无门禁则 null）
--
-- 顺带补一条原本漏判的语义：doc_status='held'（搁置）也不该能推进。
--   竞品（店小秘）明确有"手工移入搁置后 ERP 不再自动流转"的口径，
--   原先只判了 cancelled，held 会被放过去。
--
-- 幂等：CREATE OR REPLACE FUNCTION + 无 DDL，可重复执行。
-- 依赖：fw02（shipments / shipment_stage_transitions / parcels / label_files）。
-- =====================================================================
SET search_path = public;

CREATE OR REPLACE FUNCTION public.shipment_can_advance(p_shipment_id uuid, p_to_stage text)
RETURNS TABLE (allowed boolean, reason text, gate text)
LANGUAGE plpgsql STABLE
SET search_path = public
AS $fn$
DECLARE
  s record;
  t record;
  v_unsigned integer;
  v_label_ok boolean;
BEGIN
  SELECT * INTO s FROM shipments WHERE id = p_shipment_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, '货件不存在'::text, NULL::text;
    RETURN;                                   -- ← 追加完必须结束
  END IF;

  IF s.doc_status = 'cancelled' THEN
    RETURN QUERY SELECT false, '单据已取消，不可推进'::text, NULL::text;
    RETURN;
  END IF;

  IF s.doc_status = 'held' THEN
    RETURN QUERY SELECT false, '单据处于搁置(held)状态，先解除搁置再推进'::text, NULL::text;
    RETURN;
  END IF;

  IF p_to_stage IS NULL OR btrim(p_to_stage) = '' THEN
    RETURN QUERY SELECT false, '目标阶段为空'::text, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO t FROM shipment_stage_transitions
   WHERE from_stage = s.stage AND to_stage = p_to_stage;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false,
      format('非法阶段转移：%s → %s', s.stage, p_to_stage), NULL::text;
    RETURN;
  END IF;

  IF t.requires_gate = 'all_parcels_signed' THEN
    -- parcels.inbound_status 实测 NOT NULL DEFAULT 'not_inbound'，故 NOT IN 不会被 NULL 吞掉；
    -- 但仍显式加 IS NULL 分支：一旦将来放开该列，未签收的包裹必须继续挡住门禁。
    SELECT count(*) INTO v_unsigned FROM parcels
     WHERE shipment_id = p_shipment_id
       AND (inbound_status IS NULL
            OR inbound_status NOT IN ('signed','rejected','lost'));
    IF v_unsigned > 0 THEN
      RETURN QUERY SELECT false,
        format('门禁未过：仍有 %s 个包裹未签收', v_unsigned), t.requires_gate;
      RETURN;
    END IF;
  END IF;

  IF t.requires_gate = 'label_ready' THEN
    -- 依赖 label_files_type_ck：file_type 现网只允许大写 'WAYBILL'（实测 CHECK），
    -- 因此用等值匹配；若将来放开大小写，这里必须同步改成 lower()。
    -- is_update（两段式面单的"更新版"）在这里不做区分：只要有一条 ready 的 WAYBILL
    -- 就说明面单已就绪，更新版属于"换单"不属于"有没有单"。
    SELECT count(*) > 0 INTO v_label_ok FROM label_files
     WHERE shipment_id = p_shipment_id
       AND file_type = 'WAYBILL' AND status = 'ready';
    IF NOT v_label_ok THEN
      RETURN QUERY SELECT false, '门禁未过：面单尚未就绪'::text, t.requires_gate;
      RETURN;
    END IF;
  END IF;

  IF t.requires_gate = 'tracking_no'
     AND (s.tracking_no IS NULL OR btrim(s.tracking_no) = '') THEN
    RETURN QUERY SELECT false, '门禁未过：缺少运单号'::text, t.requires_gate;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::text, t.requires_gate;
END $fn$;

COMMENT ON FUNCTION public.shipment_can_advance(uuid, text) IS
  '货件阶段推进前置校验（只读，STABLE）。契约：任何输入都只返回一行 {allowed,reason,gate}。'
  '历史缺陷：RETURN QUERY 不结束函数，导致同一次调用同时返回 false 与 true（fw02b 已修）。'
  '页面与 Edge Function 必须共用本函数，禁止在前端另写一套转移规则。';

-- =====================================================================
-- 补一条闭环：拦截结果回执 shipment_set_intercept_result
--
-- 为什么必须一起加：fw02 的 shipment_request_intercept 会把 doc_status 置成 'held'
--   （"等货代确认"期间冻结流转，这是对的），但**全项目没有任何一处把 held 放回 valid**——
--   我逐列 grep 过 fw01~fw04，doc_status='valid' 只出现在建表默认值和一条触发器的 WHERE 里。
--   于是本文件新增的 held 拒绝规则会变成"拦截点错了就永久卡死"，那比原缺陷更糟。
--   所以规则与逃生口必须同批上线，链路才算齐（用户要求：商用产品链路一定要齐全）。
--
-- 语义（对齐竞品）：
--   succeeded → 单据作废 doc_status='cancelled'，intercept_state='succeeded'
--   failed    → 拦截失败但货还在走，解冻 doc_status='valid'，intercept_state='failed'
--   只有 intercept_state='requested' 的货件能接收回执（否则是乱序/重复回执）
--   已 cancelled 的单据不可再改回执（千易 cancelStage 之后就是终态）
-- =====================================================================
CREATE OR REPLACE FUNCTION public.shipment_set_intercept_result(
  p_shipment_id uuid,
  p_result text,
  p_by uuid DEFAULT NULL,
  p_note text DEFAULT NULL)
RETURNS TABLE (ok boolean, message text, doc_status text, intercept_state text)
LANGUAGE plpgsql
SET search_path = public
AS $fn$
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
END $fn$;

COMMENT ON FUNCTION public.shipment_set_intercept_result(uuid, text, uuid, text) IS
  '接收拦截/取消的执行结果（货代回执或人工回填）。succeeded→单据作废；failed→解冻回 valid。'
  '与 shipment_request_intercept 成对，缺它就等于"拦截只能进不能出"。';

-- =====================================================================
-- 自检（只读、可重复执行）：拒绝场景必须「恰好 1 行」且 allowed=false
-- 不满足就直接 RAISE，让重放失败可见，而不是留个静默的空转门禁。
-- =====================================================================
DO $q$
DECLARE
  v_cnt     integer;
  v_allowed boolean;
  v_reason  text;
  bogus     uuid := gen_random_uuid();
BEGIN
  -- ① 不存在的货件
  SELECT count(*) INTO v_cnt FROM shipment_can_advance(bogus, 'received');
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '[fw02b 自检失败] 不存在货件应恰好返回 1 行，实得 % 行', v_cnt;
  END IF;
  SELECT allowed, reason INTO v_allowed, v_reason
    FROM shipment_can_advance(bogus, 'received');
  IF v_allowed IS DISTINCT FROM false THEN
    RAISE EXCEPTION '[fw02b 自检失败] 不存在货件必须拒绝，实得 allowed=%', v_allowed;
  END IF;

  -- ② 非法阶段（同样必须只有 1 行，不能再混进 true）
  SELECT count(*) INTO v_cnt FROM shipment_can_advance(bogus, 'shipped');
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '[fw02b 自检失败] 非法转移应恰好返回 1 行，实得 % 行', v_cnt;
  END IF;

  -- ③ 空目标阶段
  SELECT count(*) INTO v_cnt FROM shipment_can_advance(bogus, '');
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '[fw02b 自检失败] 空目标阶段应恰好返回 1 行，实得 % 行', v_cnt;
  END IF;

  RAISE NOTICE '[fw02b 自检通过] shipment_can_advance 单行契约成立（3 个拒绝场景各 1 行）';
END $q$;

-- =====================================================================
-- 本迁移对象清单
--   替换函数 1：shipment_can_advance（补 RETURN;、补 held/空阶段判定、单行契约）
--   数据变更 0：不写任何业务数据
--   自检 DO 块 1：3 个拒绝场景各断言恰好 1 行且 allowed=false
-- =====================================================================
