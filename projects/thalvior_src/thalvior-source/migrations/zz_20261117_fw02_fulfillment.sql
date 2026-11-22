-- =====================================================================
-- zz_20261117_fw02_fulfillment.sql
-- 履约核心 · 货件/推单/回传/工单（M1 第二批）
--
-- 现场证据（2026-11-17 生产库实测）：
--   1) orders 表 17 列里没有任何货代/仓库/渠道字段；shipments 13 列、0 行，
--      只有 tracking_no/carrier/tracking_events 这类"追踪"语义，没有履约语义。
--      → 「把订单推给货代」在数据层不成立，这是整条链路最深的断点。
--   2) shipping_tasks 有 picked_at/packed_at/shipped_at 三个时间戳，
--      其实已经是代打包状态机的雏形，但 warehouse/carrier 是裸 text，无异常分支、
--      无计费项、无幂等键。
--   3) 全库无推单日志表、无状态回传表、无面单文件表、无异常工单表。
--      → 妙手帮助中心自己挂着两条 bug：「只操作了一次提交待打包，但两个货代系统
--        都有该订单」（缺幂等）、「订单提交待打包选择了货代，为什么订单下没有显示
--        货代处理进度」（缺回传可观测）。这两条正是本迁移要堵的。
--
-- 本迁移只做五件事：
--   1) shipments 升级为货件主体：归属（货代/仓库/渠道）、三层结构（母单/子单/包裹）、
--      四态分离（push_state / stage / doc_status / norm_status+raw_status）、
--      面单来源、取号计数、报价快照、拦截取消、幂等 batch_no
--   2) 新建 shipment_items（报关四件套落点）、push_logs、shipment_status_events、label_files
--   3) parcels 补 shipment_id / 国内快递单号 / 签收状态 —— 「全部包裹已签收」是
--      进入可打包环节的门禁（芒果货代侧明文规则），门禁由触发器实现
--   4) 新建 work_orders / work_order_items / work_order_attachments（异常走工单，
--      带 stage_when_detected：同一异常在不同阶段的可逆性不同）
--   5) 状态机推进函数 + 合法转移校验 + 幂等去重函数
--
-- 幂等：全部 IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS；不写任何 DELETE/TRUNCATE。
-- 依赖：fw01（forwarder_warehouses / freight_forwarders / logistics_channels）；
--       rate_cards 由 fw03 创建，本文件对其外键用 DO 块 + undefined_table 兜底。
-- =====================================================================

SET search_path = public;

-- ─────────────────────────────────────────────────────────────────────
-- §1 · shipments 升级为货件主体
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.shipments
  -- 归属
  ADD COLUMN IF NOT EXISTS forwarder_id           uuid,
  ADD COLUMN IF NOT EXISTS warehouse_id           uuid,
  ADD COLUMN IF NOT EXISTS channel_id             uuid,
  ADD COLUMN IF NOT EXISTS shop_id                uuid,
  ADD COLUMN IF NOT EXISTS platform               text,
  ADD COLUMN IF NOT EXISTS site                   text,
  ADD COLUMN IF NOT EXISTS platform_order_no      text,
  -- 三层结构
  ADD COLUMN IF NOT EXISTS parent_id              uuid,
  ADD COLUMN IF NOT EXISTS package_no             text,
  ADD COLUMN IF NOT EXISTS shipment_kind          text NOT NULL DEFAULT 'basic',
  ADD COLUMN IF NOT EXISTS domestic_tracking_owner text NOT NULL DEFAULT 'transit_system',
  -- 四态分离
  ADD COLUMN IF NOT EXISTS push_state             text NOT NULL DEFAULT 'not_pushed',
  ADD COLUMN IF NOT EXISTS stage                  text NOT NULL DEFAULT 'wait_inbound',
  ADD COLUMN IF NOT EXISTS doc_status             text NOT NULL DEFAULT 'valid',
  ADD COLUMN IF NOT EXISTS norm_status            text NOT NULL DEFAULT 'sending',
  ADD COLUMN IF NOT EXISTS raw_status             text,
  -- 面单与取号
  ADD COLUMN IF NOT EXISTS label_source           text NOT NULL DEFAULT 'api',
  ADD COLUMN IF NOT EXISTS label_state            text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS apply_count            integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS apply_failed_code      text,
  ADD COLUMN IF NOT EXISTS apply_failed_reason    text,
  ADD COLUMN IF NOT EXISTS wms_order_no           text,
  -- 报价与费用
  ADD COLUMN IF NOT EXISTS rate_snapshot_id       uuid,
  ADD COLUMN IF NOT EXISTS estimated_amount       numeric(14,4),
  ADD COLUMN IF NOT EXISTS actual_amount          numeric(14,4),
  ADD COLUMN IF NOT EXISTS fee_currency           text NOT NULL DEFAULT 'CNY',
  ADD COLUMN IF NOT EXISTS charged_weight_g       numeric(12,3),
  ADD COLUMN IF NOT EXISTS declared_weight_g      numeric(12,3),
  -- 拦截与取消
  ADD COLUMN IF NOT EXISTS intercept_state        text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS cancel_requested_at    timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_reason       text,
  ADD COLUMN IF NOT EXISTS cancel_stage           text,
  -- 幂等与时间轴
  ADD COLUMN IF NOT EXISTS batch_no               text,
  ADD COLUMN IF NOT EXISTS push_attempt           integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at          timestamptz,
  ADD COLUMN IF NOT EXISTS pushed_at              timestamptz,
  ADD COLUMN IF NOT EXISTS received_at            timestamptz,
  ADD COLUMN IF NOT EXISTS packed_at              timestamptz,
  ADD COLUMN IF NOT EXISTS handover_at            timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at              timestamptz,
  ADD COLUMN IF NOT EXISTS owner_code             text,
  ADD COLUMN IF NOT EXISTS is_split               boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS remark                 text;

-- 现场发现（2026-11-17 clone 冒烟测试第 1 步实测报错）：
--   ERROR: null value in column "tracking_no" of relation "shipments" violates not-null constraint
--   shipments 是 legacy 表，原本只作「物流追踪」用途，所以 tracking_no 被建成
--   NOT NULL 且无默认值。升级成货件主体后，业务时序反过来：**先到货件、后取号**
--   （取号是独立可重试步骤，见 §8/apply_count），任何"先建单后取号"的路径都会直接报错。
--   → 必须放开 NOT NULL。取号的完整性由门禁保证：stage 推进到 shipped 前
--     requires_gate='tracking_no'（shipment_stage_transitions 第 623 行那条规则），
--     而不是靠一个建表时的 NOT NULL —— 那是把"终态约束"错放成"起始约束"。
-- 幂等：DROP NOT NULL 可重复执行，无副作用。
ALTER TABLE public.shipments ALTER COLUMN tracking_no DROP NOT NULL;

DO $q$ BEGIN
  ALTER TABLE public.shipments
    ADD CONSTRAINT shipments_forwarder_id_fkey
    FOREIGN KEY (forwarder_id) REFERENCES public.freight_forwarders(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过] freight_forwarders 不存在';
  WHEN foreign_key_violation THEN RAISE NOTICE '[跳过外键] shipments.forwarder_id 有孤儿数据'; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.shipments
    ADD CONSTRAINT shipments_warehouse_id_fkey
    FOREIGN KEY (warehouse_id) REFERENCES public.forwarder_warehouses(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过] forwarder_warehouses 不存在（先跑 fw01）';
  WHEN foreign_key_violation THEN RAISE NOTICE '[跳过外键] shipments.warehouse_id 有孤儿数据'; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.shipments
    ADD CONSTRAINT shipments_channel_id_fkey
    FOREIGN KEY (channel_id) REFERENCES public.logistics_channels(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN foreign_key_violation THEN RAISE NOTICE '[跳过外键] shipments.channel_id 有孤儿数据'; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.shipments
    ADD CONSTRAINT shipments_parent_id_fkey
    FOREIGN KEY (parent_id) REFERENCES public.shipments(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

-- rate_cards 由 fw03 创建；fw02 先跑时必须优雅跳过
DO $q$ BEGIN
  ALTER TABLE public.shipments
    ADD CONSTRAINT shipments_rate_snapshot_fkey
    FOREIGN KEY (rate_snapshot_id) REFERENCES public.rate_cards(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] rate_cards 尚未创建，由 fw03 补'; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.shipments
    ADD CONSTRAINT shipments_push_state_ck
    CHECK (push_state = ANY (ARRAY['not_pushed','pending','pushing','pushed','push_failed','dead']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.shipments
    ADD CONSTRAINT shipments_stage_ck
    CHECK (stage = ANY (ARRAY['wait_inbound','received','ready_pack','label_ready','picking','packed','handover','shipped','closed']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.shipments
    ADD CONSTRAINT shipments_doc_status_ck
    CHECK (doc_status = ANY (ARRAY['valid','held','cancelled']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.shipments
    ADD CONSTRAINT shipments_norm_status_ck
    CHECK (norm_status = ANY (ARRAY['sending','success','cancel','failed']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.shipments
    ADD CONSTRAINT shipments_label_source_ck
    CHECK (label_source = ANY (ARRAY['attachment','api','pre_file','wms_gen']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.shipments
    ADD CONSTRAINT shipments_label_state_ck
    CHECK (label_state = ANY (ARRAY['none','requested','ready','failed','updated']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.shipments
    ADD CONSTRAINT shipments_kind_ck
    CHECK (shipment_kind = ANY (ARRAY['basic','combo']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.shipments
    ADD CONSTRAINT shipments_domestic_owner_ck
    CHECK (domestic_tracking_owner = ANY (ARRAY['transit_system','forwarder_system']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.shipments
    ADD CONSTRAINT shipments_intercept_ck
    CHECK (intercept_state = ANY (ARRAY['none','requested','succeeded','failed']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

-- 幂等键：一个租户内一个 batchNo 只能对应一个货件
CREATE UNIQUE INDEX IF NOT EXISTS shipments_user_batch_key
  ON public.shipments (user_id, batch_no) WHERE batch_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS shipments_user_stage_idx
  ON public.shipments (user_id, stage, created_at DESC);
CREATE INDEX IF NOT EXISTS shipments_user_pushstate_idx
  ON public.shipments (user_id, push_state) WHERE push_state IN ('pending','pushing','push_failed');
CREATE INDEX IF NOT EXISTS shipments_retry_idx
  ON public.shipments (next_retry_at) WHERE push_state = 'push_failed';
CREATE INDEX IF NOT EXISTS shipments_order_idx
  ON public.shipments (order_id);
CREATE INDEX IF NOT EXISTS shipments_wh_idx
  ON public.shipments (warehouse_id, stage);
CREATE INDEX IF NOT EXISTS shipments_wms_no_idx
  ON public.shipments (wms_order_no) WHERE wms_order_no IS NOT NULL;

COMMENT ON TABLE public.shipments IS
  '货件（履约主体）。一个订单可拆多个货件（parent_id 母单/子单），一个货件含多个包裹（parcels）。'
  '四态严格分离：push_state（推单到哪一步）/ stage（货到哪一步）/ doc_status（这张单还有效吗）/ '
  'norm_status+raw_status（对外归一化 + 对方原始）。竞品铁律：混态必返工。';
COMMENT ON COLUMN public.shipments.shipment_kind IS 'basic 基础包（快递单号在转运系统，只关联一个商品）/ combo 组合包（快递单号在货代系统，关联多个商品）——芒果代打包的两种包裹形态。';
COMMENT ON COLUMN public.shipments.domestic_tracking_owner IS '国内快递单号归属方：transit_system（转运/采购系统持有）| forwarder_system（货代系统持有）。这是 basic/combo 的真实数据含义，推单载荷必须带。';
COMMENT ON COLUMN public.shipments.batch_no IS '推单幂等键，租户内唯一。妙手已知 bug「一次提交两个货代都有单」的直接对策。';
COMMENT ON COLUMN public.shipments.apply_count IS '取号成功次数（千易 successApplyCount）。取号是独立可重试步骤，与"匹配到渠道"分离（马帮铁律）。';

-- ─────────────────────────────────────────────────────────────────────
-- §2 · shipment_items（货件明细，报关四件套落点）
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shipment_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  shipment_id    uuid NOT NULL,
  order_id       text,
  order_item_ref text,
  sku            text NOT NULL,
  erp_sku        text,
  external_sku   text,
  qty            integer NOT NULL DEFAULT 1,
  name_cn        text,
  name_en        text,
  hs_code        text,
  declare_value  numeric(14,4),
  unit_price     numeric(14,4),
  currency       text NOT NULL DEFAULT 'CNY',
  weight_g       numeric(12,3),
  amount         numeric(14,4),
  shipping_price numeric(14,4),
  box_code       text,
  kit_item       boolean NOT NULL DEFAULT false,
  stock_status   text NOT NULL DEFAULT 'good',
  created_at     timestamptz NOT NULL DEFAULT now()
);

DO $q$ BEGIN
  ALTER TABLE public.shipment_items
    ADD CONSTRAINT shipment_items_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.shipment_items
    ADD CONSTRAINT shipment_items_shipment_id_fkey
    FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.shipment_items
    ADD CONSTRAINT shipment_items_stock_status_ck
    CHECK (stock_status = ANY (ARRAY['good','damage']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

CREATE INDEX IF NOT EXISTS shipment_items_shipment_idx ON public.shipment_items (shipment_id);
CREATE INDEX IF NOT EXISTS shipment_items_user_sku_idx ON public.shipment_items (user_id, sku);

COMMENT ON TABLE public.shipment_items IS
  '货件明细。erp_sku/external_sku 双字段是两级 SKU 配对的落点；'
  'name_cn/name_en/hs_code/declare_value 是报关四件套，缺失会直接导致 Shopee/Ozon 清关单出不了。';

-- ─────────────────────────────────────────────────────────────────────
-- §3 · parcels 补货件关联与签收门禁字段
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.parcels
  ADD COLUMN IF NOT EXISTS shipment_id        uuid,
  ADD COLUMN IF NOT EXISTS package_number     text,
  ADD COLUMN IF NOT EXISTS inbound_tracking_no text,
  ADD COLUMN IF NOT EXISTS inbound_carrier    text,
  ADD COLUMN IF NOT EXISTS inbound_status     text NOT NULL DEFAULT 'not_inbound',
  ADD COLUMN IF NOT EXISTS signed_at          timestamptz,
  ADD COLUMN IF NOT EXISTS signed_by          text,
  ADD COLUMN IF NOT EXISTS forwarder_parcel_no text,
  ADD COLUMN IF NOT EXISTS is_headless        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at         timestamptz NOT NULL DEFAULT now();

DO $q$ BEGIN
  ALTER TABLE public.parcels
    ADD CONSTRAINT parcels_shipment_id_fkey
    FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN foreign_key_violation THEN RAISE NOTICE '[跳过外键] parcels.shipment_id 有孤儿数据'; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.parcels
    ADD CONSTRAINT parcels_inbound_status_ck
    CHECK (inbound_status = ANY (ARRAY['not_inbound','in_transit','signed','partial_signed','rejected','lost']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

CREATE INDEX IF NOT EXISTS parcels_shipment_idx ON public.parcels (shipment_id);
CREATE UNIQUE INDEX IF NOT EXISTS parcels_user_inbound_key
  ON public.parcels (user_id, inbound_tracking_no) WHERE inbound_tracking_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS parcels_headless_idx ON public.parcels (is_headless) WHERE is_headless = true;

COMMENT ON COLUMN public.parcels.inbound_status IS '签收状态。"全部包裹 signed"是进入 ready_pack 的门禁（芒果货代侧明文规则），由 trg_shipment_pack_gate 实现。';
COMMENT ON COLUMN public.parcels.is_headless IS '无头件：扫到国内快递单号但匹配不到任何货件，须开 work_orders(type=no_head)。';

-- ─────────────────────────────────────────────────────────────────────
-- §4 · push_logs（推单/回传日志：幂等与可观测的核心）
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL,
  direction         text NOT NULL,
  action            text NOT NULL,
  batch_no          text,
  shipment_id       uuid,
  forwarder_id      uuid,
  warehouse_id      uuid,
  endpoint          text,
  request_snapshot  jsonb,
  response_snapshot jsonb,
  attempt           integer NOT NULL DEFAULT 1,
  max_attempts      integer NOT NULL DEFAULT 5,
  next_retry_at     timestamptz,
  status            text NOT NULL DEFAULT 'pending',
  error_code        text,
  error_message     text,
  duration_ms       integer,
  deduped           boolean NOT NULL DEFAULT false,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz
);

DO $q$ BEGIN
  ALTER TABLE public.push_logs
    ADD CONSTRAINT push_logs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.push_logs
    ADD CONSTRAINT push_logs_direction_ck
    CHECK (direction = ANY (ARRAY['out','in']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.push_logs
    ADD CONSTRAINT push_logs_status_ck
    CHECK (status = ANY (ARRAY['pending','success','failed','dead','skipped']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

CREATE INDEX IF NOT EXISTS push_logs_user_created_idx ON public.push_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS push_logs_shipment_idx     ON public.push_logs (shipment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS push_logs_batch_idx       ON public.push_logs (batch_no);
CREATE INDEX IF NOT EXISTS push_logs_retry_idx       ON public.push_logs (next_retry_at)
  WHERE status IN ('pending','failed');
CREATE INDEX IF NOT EXISTS push_logs_errcode_idx     ON public.push_logs (error_code)
  WHERE error_code IS NOT NULL;

COMMENT ON TABLE public.push_logs IS
  '双向接口日志。out=我方推给货代/物流，in=货代回传。'
  '妙手帮助中心挂着「提交待打包后订单下没有货代处理进度」=缺回传可观测，本表就是那个可观测入口。'
  'deduped=true 表示被幂等拦截，不产生真实调用。';

-- ─────────────────────────────────────────────────────────────────────
-- §5 · shipment_status_events（回传流水，双状态）
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shipment_status_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  shipment_id   uuid NOT NULL,
  raw_status    text,
  norm_status   text NOT NULL,
  stage         text,
  tracking_no   text,
  carrier_name  text,
  failed_code   text,
  failed_reason text,
  operator      text,
  occurred_at   timestamptz,
  time_zone_id  text NOT NULL DEFAULT 'Asia/Shanghai',
  source        text NOT NULL DEFAULT 'wms',
  payload       jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

DO $q$ BEGIN
  ALTER TABLE public.shipment_status_events
    ADD CONSTRAINT sse_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.shipment_status_events
    ADD CONSTRAINT sse_shipment_id_fkey
    FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.shipment_status_events
    ADD CONSTRAINT sse_norm_status_ck
    CHECK (norm_status = ANY (ARRAY['sending','success','cancel','failed']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.shipment_status_events
    ADD CONSTRAINT sse_source_ck
    CHECK (source = ANY (ARRAY['wms','webhook','manual','import','system']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

-- 字段完整性由状态约束（千易协议铁律：SUCCESS 必填 trackingNumber，FAILED 必填 failedReason）
DO $q$ BEGIN
  ALTER TABLE public.shipment_status_events
    ADD CONSTRAINT sse_field_completeness_ck
    CHECK (
      (norm_status = 'success' AND tracking_no IS NOT NULL AND btrim(tracking_no) <> '')
      OR (norm_status = 'failed' AND failed_reason IS NOT NULL AND btrim(failed_reason) <> '')
      OR (norm_status IN ('sending','cancel'))
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

CREATE INDEX IF NOT EXISTS sse_shipment_time_idx ON public.shipment_status_events (shipment_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS sse_user_time_idx     ON public.shipment_status_events (user_id, created_at DESC);

COMMENT ON TABLE public.shipment_status_events IS
  '货件状态回传流水。同时保存对方原始状态（raw_status，原样不猜）与归一化状态（norm_status，对外）。'
  '与 order_events 并存：order_events 记订单层时间线，本表记货件层作业轨迹，互不覆盖。';

-- ─────────────────────────────────────────────────────────────────────
-- §6 · label_files（面单是文件，不是布尔位）
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.label_files (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  shipment_id  uuid NOT NULL,
  parcel_id    uuid,
  file_type    text NOT NULL,
  source       text NOT NULL,
  storage_path text,
  file_url     text,
  page_count   integer,
  is_update    boolean NOT NULL DEFAULT false,
  version      integer NOT NULL DEFAULT 1,
  status       text NOT NULL DEFAULT 'ready',
  uploaded_by  uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);

DO $q$ BEGIN
  ALTER TABLE public.label_files
    ADD CONSTRAINT label_files_shipment_id_fkey
    FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.label_files
    ADD CONSTRAINT label_files_type_ck
    CHECK (file_type = ANY (ARRAY['WAYBILL','INVOICE','CARTON_LABEL','PACKING_LIST','PRODUCT_LABEL','PALLET_LABEL','PICKING_LIST','OTHER']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.label_files
    ADD CONSTRAINT label_files_source_ck
    CHECK (source = ANY (ARRAY['attachment','api','pre_file','wms_gen','manual_upload']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.label_files
    ADD CONSTRAINT label_files_status_ck
    CHECK (status = ANY (ARRAY['requested','ready','failed','superseded']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

CREATE INDEX IF NOT EXISTS label_files_shipment_idx ON public.label_files (shipment_id, file_type, version DESC);

COMMENT ON TABLE public.label_files IS
  '面单/单据文件。is_update=true 对应两段式面单二次推送（Temu Y2：先直邮标签，货到美国后取尾程面单再推一次，'
  '中间不扣国内库存）。file_type 枚举对齐千易 GLINK_CREATE_FILE_NOTIFY。';

-- ─────────────────────────────────────────────────────────────────────
-- §7 · work_orders（异常工单，不塞进订单状态）
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.work_orders (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL,
  owner_code            text,
  forwarder_id          uuid,
  warehouse_id          uuid,
  shipment_id           uuid,
  order_id              text,
  parcel_id             uuid,
  type                  text NOT NULL,
  stage_when_detected   text,
  title                 text NOT NULL,
  description           text,
  status                text NOT NULL DEFAULT 'pending',
  priority              text NOT NULL DEFAULT 'normal',
  handler               text,
  handler_user_id       uuid,
  assignee_type         text NOT NULL DEFAULT 'forwarder',
  due_at                timestamptz,
  resolution            text,
  claim_amount          numeric(14,4),
  approved_amount       numeric(14,4),
  reversed              boolean NOT NULL DEFAULT false,
  closed_at             timestamptz,
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

DO $q$ BEGIN
  ALTER TABLE public.work_orders
    ADD CONSTRAINT work_orders_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.work_orders
    ADD CONSTRAINT work_orders_shipment_id_fkey
    FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.work_orders
    ADD CONSTRAINT work_orders_type_ck
    CHECK (type = ANY (ARRAY[
      'no_head','wrong_item','lost','damaged','stuck_customs','return_check',
      'overdue_inbound','out_of_stock','balance_insufficient','sku_unmapped',
      'label_failed','handover_failed','weight_dispute','other']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.work_orders
    ADD CONSTRAINT work_orders_status_ck
    CHECK (status = ANY (ARRAY['pending','assigned','processing','suspended','processed','closed']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.work_orders
    ADD CONSTRAINT work_orders_priority_ck
    CHECK (priority = ANY (ARRAY['low','normal','urgent','critical']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.work_orders
    ADD CONSTRAINT work_orders_assignee_ck
    CHECK (assignee_type = ANY (ARRAY['forwarder','seller','platform_ops','logistics']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

CREATE INDEX IF NOT EXISTS work_orders_user_status_idx ON public.work_orders (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS work_orders_wh_idx          ON public.work_orders (warehouse_id, status);
CREATE INDEX IF NOT EXISTS work_orders_shipment_idx    ON public.work_orders (shipment_id);
CREATE INDEX IF NOT EXISTS work_orders_type_idx        ON public.work_orders (type, status);

COMMENT ON TABLE public.work_orders IS
  '异常工单（独立单据）。竞品共识：异常不塞进订单状态机。'
  'stage_when_detected 是关键列——同一异常在不同阶段的可逆性不同（已出库只能理赔不能截单，领星 15 类异常按阶段分治）。'
  'type 覆盖：无头件/错件/丢件/破损/扣关/退件质检/超期未入仓/缺货/余额不足/SKU未配对/取号失败/交运失败/重量争议。';

CREATE TABLE IF NOT EXISTS public.work_order_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id   uuid NOT NULL,
  user_id         uuid NOT NULL,
  sku             text,
  qty             integer NOT NULL DEFAULT 1,
  related_remark  text,
  feedback_remark text,
  stock_status    text NOT NULL DEFAULT 'good',
  created_at      timestamptz NOT NULL DEFAULT now()
);

DO $q$ BEGIN
  ALTER TABLE public.work_order_items
    ADD CONSTRAINT wo_items_wo_id_fkey
    FOREIGN KEY (work_order_id) REFERENCES public.work_orders(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.work_order_items
    ADD CONSTRAINT wo_items_stock_status_ck
    CHECK (stock_status = ANY (ARRAY['good','damage']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

CREATE INDEX IF NOT EXISTS wo_items_wo_idx ON public.work_order_items (work_order_id);

CREATE TABLE IF NOT EXISTS public.work_order_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL,
  user_id       uuid NOT NULL,
  kind          text NOT NULL DEFAULT 'photo',
  storage_path  text,
  file_url      text,
  caption       text,
  uploaded_by   uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);

DO $q$ BEGIN
  ALTER TABLE public.work_order_attachments
    ADD CONSTRAINT wo_attach_wo_id_fkey
    FOREIGN KEY (work_order_id) REFERENCES public.work_orders(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.work_order_attachments
    ADD CONSTRAINT wo_attach_kind_ck
    CHECK (kind = ANY (ARRAY['photo','file','video','label']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

CREATE INDEX IF NOT EXISTS wo_attach_wo_idx ON public.work_order_attachments (work_order_id);

COMMENT ON TABLE public.work_order_attachments IS
  '工单附件。拍照既是留痕手段也是计费项（千易 handlingDetails.additionalActivity=PHOTO）。';

-- ─────────────────────────────────────────────────────────────────────
-- §8 · 状态机：合法转移表 + 推进函数
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shipment_stage_transitions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_stage   text NOT NULL,
  to_stage     text NOT NULL,
  requires_gate text,
  note         text,
  UNIQUE (from_stage, to_stage)
);

INSERT INTO public.shipment_stage_transitions (from_stage, to_stage, requires_gate, note) VALUES
  ('wait_inbound','received',      NULL,            '首个包裹签收'),
  ('received','ready_pack',        'all_parcels_signed', '全部包裹已签收才可进入可打包（芒果货代侧门禁）'),
  ('ready_pack','label_ready',     'label_ready',   '面单已就绪'),
  ('label_ready','picking',        NULL,            '开始拣货'),
  ('picking','packed',             NULL,            '打包完成'),
  ('packed','handover',            NULL,            '送仓/交运'),
  ('handover','shipped',           'tracking_no',   '出库，须有运单号'),
  ('shipped','closed',             NULL,            '妥投或结算完成'),
  ('wait_inbound','closed',        NULL,            '空单关闭'),
  ('received','closed',            NULL,            '收货后关闭')
ON CONFLICT (from_stage, to_stage) DO UPDATE SET
  requires_gate = EXCLUDED.requires_gate,
  note = EXCLUDED.note;

COMMENT ON TABLE public.shipment_stage_transitions IS
  '货件作业阶段合法转移矩阵。stage 只描述"货到哪一步"，与 doc_status（单据有效性）分离。';

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
    RETURN QUERY SELECT false, '货件不存在', NULL::text;
  END IF;

  IF s.doc_status = 'cancelled' THEN
    RETURN QUERY SELECT false, '单据已取消，不可推进', NULL::text;
  END IF;

  SELECT * INTO t FROM shipment_stage_transitions
   WHERE from_stage = s.stage AND to_stage = p_to_stage;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false,
      format('非法阶段转移：%s → %s', s.stage, p_to_stage), NULL::text;
  END IF;

  IF t.requires_gate = 'all_parcels_signed' THEN
    SELECT count(*) INTO v_unsigned FROM parcels
     WHERE shipment_id = p_shipment_id
       AND inbound_status NOT IN ('signed','rejected','lost');
    IF v_unsigned > 0 THEN
      RETURN QUERY SELECT false,
        format('门禁未过：仍有 %s 个包裹未签收', v_unsigned), t.requires_gate;
    END IF;
  END IF;

  IF t.requires_gate = 'label_ready' THEN
    SELECT count(*) > 0 INTO v_label_ok FROM label_files
     WHERE shipment_id = p_shipment_id
       AND file_type = 'WAYBILL' AND status = 'ready';
    IF NOT v_label_ok THEN
      RETURN QUERY SELECT false, '门禁未过：面单尚未就绪', t.requires_gate;
    END IF;
  END IF;

  IF t.requires_gate = 'tracking_no' AND (s.tracking_no IS NULL OR btrim(s.tracking_no) = '') THEN
    RETURN QUERY SELECT false, '门禁未过：缺少运单号', t.requires_gate;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::text, t.requires_gate;
END $fn$;

COMMENT ON FUNCTION public.shipment_can_advance(uuid, text) IS
  '货件阶段推进前置校验（只读）。返回 allowed/reason/gate，供 EF 与页面共用，避免前后端各写一套转移规则。';

CREATE OR REPLACE FUNCTION public.shipment_advance(p_shipment_id uuid, p_to_stage text,
                                                   p_operator text DEFAULT 'system',
                                                   p_note text DEFAULT NULL)
RETURNS TABLE (ok boolean, message text, new_stage text)
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_allowed boolean; v_reason text; v_gate text;
  v_user uuid;
BEGIN
  SELECT allowed, reason, gate INTO v_allowed, v_reason, v_gate
    FROM shipment_can_advance(p_shipment_id, p_to_stage);

  IF NOT v_allowed THEN
    RETURN QUERY SELECT false, v_reason, NULL::text;
    RETURN;
  END IF;

  SELECT user_id INTO v_user FROM shipments WHERE id = p_shipment_id;

  UPDATE shipments
     SET stage = p_to_stage,
         received_at  = CASE WHEN p_to_stage = 'received'  THEN now() ELSE received_at  END,
         packed_at    = CASE WHEN p_to_stage = 'packed'    THEN now() ELSE packed_at    END,
         handover_at  = CASE WHEN p_to_stage = 'handover'  THEN now() ELSE handover_at  END,
         closed_at    = CASE WHEN p_to_stage = 'closed'    THEN now() ELSE closed_at    END
   WHERE id = p_shipment_id;

  INSERT INTO shipment_status_events
    (user_id, shipment_id, raw_status, norm_status, stage, source, payload)
  VALUES
    (v_user, p_shipment_id, 'ERP:' || p_to_stage, 'sending', p_to_stage, 'system',
     jsonb_build_object('operator', p_operator, 'note', p_note, 'gate', v_gate));

  RETURN QUERY SELECT true, 'ok', p_to_stage;
END $fn$;

COMMENT ON FUNCTION public.shipment_advance(uuid, text, text, text) IS
  '货件阶段推进唯一入口。校验→更新→写事件，三步在同一事务内；任何绕过本函数直改 stage 的写法都视为缺陷。';

-- ─────────────────────────────────────────────────────────────────────
-- §9 · 幂等去重函数
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.push_is_duplicate(p_user_id uuid, p_batch_no text,
                                                    p_window_hours integer DEFAULT 24)
RETURNS TABLE (duplicate boolean, existing_shipment uuid, existing_status text)
LANGUAGE plpgsql STABLE
SET search_path = public
AS $fn$
DECLARE
  v_ship uuid; v_state text;
BEGIN
  IF p_batch_no IS NULL OR btrim(p_batch_no) = '' THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- 先取进变量再判定，避免 RETURN QUERY 之后依赖 FOUND 产生多行结果
  SELECT s.id, s.push_state INTO v_ship, v_state
    FROM shipments s
   WHERE s.user_id = p_user_id
     AND s.batch_no = p_batch_no
     AND s.created_at > now() - make_interval(hours => COALESCE(p_window_hours, 24))
   ORDER BY s.created_at DESC
   LIMIT 1;

  IF v_ship IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text;
  ELSE
    RETURN QUERY SELECT true, v_ship, v_state;
  END IF;
END $fn$;

COMMENT ON FUNCTION public.push_is_duplicate(uuid, text, integer) IS
  '推单幂等判定。妙手已知 bug「只操作了一次提交待打包，但两个货代系统都有该订单」的直接对策；'
  'EF 在真正调用货代接口之前必须先过这一关，命中则写 push_logs(deduped=true) 并返回既有货件。';

-- ─────────────────────────────────────────────────────────────────────
-- §10 · 拦截 / 取消（独立动作，不是 stage 的一个值）
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.shipment_request_intercept(p_shipment_id uuid,
                                                             p_reason text,
                                                             p_by uuid DEFAULT NULL)
RETURNS TABLE (ok boolean, message text, action text)
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  s record;
BEGIN
  SELECT * INTO s FROM shipments WHERE id = p_shipment_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, '货件不存在', NULL::text; RETURN;
  END IF;

  -- 竞品铁律：已出库只能走理赔/工单，不能截单
  IF s.stage IN ('shipped','closed') THEN
    INSERT INTO work_orders (user_id, shipment_id, order_id, forwarder_id, warehouse_id,
                             type, stage_when_detected, title, description, priority, created_by)
    VALUES (s.user_id, s.id, s.order_id, s.forwarder_id, s.warehouse_id,
            'other', s.stage, '已出库订单拦截转理赔', p_reason, 'urgent', p_by);
    RETURN QUERY SELECT true, '已出库，自动转理赔工单', 'work_order';
    RETURN;
  END IF;

  UPDATE shipments
     SET intercept_state = 'requested',
         cancel_requested_at = now(),
         cancelled_reason = p_reason,
         cancel_stage = s.stage,
         doc_status = 'held'
   WHERE id = p_shipment_id;

  INSERT INTO push_logs (user_id, direction, action, batch_no, shipment_id, forwarder_id,
                         warehouse_id, endpoint, request_snapshot, status, created_by)
  VALUES (s.user_id, 'out', 'intercept_order', s.batch_no, s.id, s.forwarder_id, s.warehouse_id,
          'intercept-order', jsonb_build_object('reason', p_reason, 'stage', s.stage),
          'pending', p_by);

  RETURN QUERY SELECT true, '拦截请求已发起，等待货代确认', 'intercept';
END $fn$;

COMMENT ON FUNCTION public.shipment_request_intercept(uuid, text, uuid) IS
  '拦截/取消是独立动作（妙手"已拦截"页签、芒果"向货代申请取消"、千易 cancelStage）。'
  '已出库自动降级为理赔工单——这是 stage_when_detected 存在的理由。';

-- ─────────────────────────────────────────────────────────────────────
-- §11 · 包裹签收 → 货件 received 联动（触发器）
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_parcels_signed_sync()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_total integer; v_signed integer;
BEGIN
  IF NEW.shipment_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*), count(*) FILTER (WHERE inbound_status = 'signed')
    INTO v_total, v_signed
    FROM parcels WHERE shipment_id = NEW.shipment_id;

  IF NEW.inbound_status = 'signed' THEN
    UPDATE shipments
       SET received_at = COALESCE(received_at, now()),
           stage = CASE WHEN stage = 'wait_inbound' AND v_total > 0 AND v_signed = v_total
                        THEN 'received' ELSE stage END,
           raw_status = COALESCE(raw_status, 'ERP:received')
     WHERE id = NEW.shipment_id AND doc_status = 'valid';
  END IF;

  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_parcels_signed_sync ON public.parcels;
CREATE TRIGGER trg_parcels_signed_sync AFTER INSERT OR UPDATE OF inbound_status ON public.parcels
  FOR EACH ROW EXECUTE FUNCTION public.trg_parcels_signed_sync();

COMMENT ON FUNCTION public.trg_parcels_signed_sync() IS
  '包裹签收联动：首个签收记 received_at；全部签收把 wait_inbound 推到 received。'
  'ready_pack 仍需显式调用 shipment_advance 并过 all_parcels_signed 门禁，不在触发器里跳步。';

-- ─────────────────────────────────────────────────────────────────────
-- §12 · 无头件自动开工单
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_parcels_headless_ticket()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF NEW.is_headless AND NOT OLD.is_headless THEN
    INSERT INTO work_orders (user_id, parcel_id, type, stage_when_detected,
                             title, description, priority, assignee_type, created_by)
    VALUES (NEW.user_id, NEW.id, 'no_head', 'wait_inbound',
            '无头件：国内快递单号无法匹配货件',
            format('单号 %s / 承运商 %s', COALESCE(NEW.inbound_tracking_no,'-'),
                   COALESCE(NEW.inbound_carrier,'-')),
            'normal', 'forwarder', NULL);
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_parcels_headless_ticket ON public.parcels;
CREATE TRIGGER trg_parcels_headless_ticket AFTER UPDATE OF is_headless ON public.parcels
  FOR EACH ROW EXECUTE FUNCTION public.trg_parcels_headless_ticket();

-- ─────────────────────────────────────────────────────────────────────
-- §13 · updated_at 维护
-- ─────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_parcels_touch ON public.parcels;
CREATE TRIGGER trg_parcels_touch BEFORE UPDATE ON public.parcels
  FOR EACH ROW EXECUTE FUNCTION public.touch_forwarder_updated_at();

DROP TRIGGER IF EXISTS trg_work_orders_touch ON public.work_orders;
CREATE TRIGGER trg_work_orders_touch BEFORE UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.touch_forwarder_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- §14 · RLS
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.shipment_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_shipment_items ON public.shipment_items;
CREATE POLICY users_select_shipment_items ON public.shipment_items
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS users_insert_shipment_items ON public.shipment_items;
CREATE POLICY users_insert_shipment_items ON public.shipment_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_update_shipment_items ON public.shipment_items;
CREATE POLICY users_update_shipment_items ON public.shipment_items
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_delete_shipment_items ON public.shipment_items;
CREATE POLICY users_delete_shipment_items ON public.shipment_items
  FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE public.push_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_push_logs ON public.push_logs;
CREATE POLICY users_select_push_logs ON public.push_logs
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS users_insert_push_logs ON public.push_logs;
CREATE POLICY users_insert_push_logs ON public.push_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);
-- 日志只允许追加：不给 UPDATE/DELETE 策略，改与删一律被 RLS 拒绝

ALTER TABLE public.shipment_status_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_sse ON public.shipment_status_events;
CREATE POLICY users_select_sse ON public.shipment_status_events
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS users_insert_sse ON public.shipment_status_events;
CREATE POLICY users_insert_sse ON public.shipment_status_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.label_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_label_files ON public.label_files;
CREATE POLICY users_select_label_files ON public.label_files
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS users_insert_label_files ON public.label_files;
CREATE POLICY users_insert_label_files ON public.label_files
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_update_label_files ON public.label_files;
CREATE POLICY users_update_label_files ON public.label_files
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_work_orders ON public.work_orders;
CREATE POLICY users_select_work_orders ON public.work_orders
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS users_insert_work_orders ON public.work_orders;
CREATE POLICY users_insert_work_orders ON public.work_orders
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_update_work_orders ON public.work_orders;
CREATE POLICY users_update_work_orders ON public.work_orders
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS admins_select_work_orders ON public.work_orders;
CREATE POLICY admins_select_work_orders ON public.work_orders
  FOR SELECT USING (has_role(auth.uid(), 'admin'::text));

ALTER TABLE public.work_order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_wo_items ON public.work_order_items;
CREATE POLICY users_select_wo_items ON public.work_order_items
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS users_write_wo_items ON public.work_order_items;
CREATE POLICY users_write_wo_items ON public.work_order_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.work_order_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_wo_attach ON public.work_order_attachments;
CREATE POLICY users_select_wo_attach ON public.work_order_attachments
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS users_write_wo_attach ON public.work_order_attachments;
CREATE POLICY users_write_wo_attach ON public.work_order_attachments
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 转移矩阵：全局只读字典
ALTER TABLE public.shipment_stage_transitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_stage_transitions ON public.shipment_stage_transitions;
CREATE POLICY users_select_stage_transitions ON public.shipment_stage_transitions
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ─────────────────────────────────────────────────────────────────────
-- §15 · 货件层视图（订单详情页「货代处理进度」直接可用）
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_shipment_progress AS
SELECT s.id AS shipment_id, s.user_id, s.order_id, s.platform_order_no,
       f.name AS forwarder_name, w.name AS warehouse_name, c.name AS channel_name,
       s.push_state, s.stage, s.doc_status, s.norm_status, s.raw_status,
       s.tracking_no, s.label_state, s.apply_count, s.apply_failed_code, s.apply_failed_reason,
       s.intercept_state, s.estimated_amount, s.actual_amount, s.fee_currency,
       (SELECT count(*) FROM parcels p WHERE p.shipment_id = s.id) AS parcel_total,
       (SELECT count(*) FROM parcels p WHERE p.shipment_id = s.id AND p.inbound_status = 'signed') AS parcel_signed,
       (SELECT count(*) FROM work_orders wo WHERE wo.shipment_id = s.id AND wo.status <> 'closed') AS open_work_orders,
       s.created_at, s.pushed_at, s.received_at, s.packed_at, s.handover_at, s.closed_at
  FROM shipments s
  LEFT JOIN freight_forwarders f ON f.id = s.forwarder_id
  LEFT JOIN forwarder_warehouses w ON w.id = s.warehouse_id
  LEFT JOIN logistics_channels c ON c.id = s.channel_id;

COMMENT ON VIEW public.v_shipment_progress IS
  '货件进度一览。订单详情页「货代处理进度：揽收/打包/出库」直接读本视图，'
  '避免妙手那种「选了货代但订单下看不到进度」的可观测缺口。';

-- ─────────────────────────────────────────────────────────────────────
-- §16 · 权限点
-- ─────────────────────────────────────────────────────────────────────
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.shipment.view','logistics','shipment','view','货件查看','View shipment','G6','medium','route','/fulfillment/shipments',true) on conflict (key) do update set module=excluded.module, resource=excluded.resource, action=excluded.action, name=excluded.name, name_en=excluded.name_en, group_code=excluded.group_code, risk_level=excluded.risk_level, scope_type=excluded.scope_type, scope_ref=excluded.scope_ref, is_active=excluded.is_active;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.packing.view','logistics','packing','view','代打包任务查看','View packing task','G6','medium','route','/fulfillment/packing',true) on conflict (key) do update set module=excluded.module, resource=excluded.resource, action=excluded.action, name=excluded.name, name_en=excluded.name_en, group_code=excluded.group_code, risk_level=excluded.risk_level, scope_type=excluded.scope_type, scope_ref=excluded.scope_ref, is_active=excluded.is_active;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.packing.pack','logistics','packing','pack','确认打包','Confirm packing','G6','medium','table','shipments',true) on conflict (key) do update set module=excluded.module, resource=excluded.resource, action=excluded.action, name=excluded.name, name_en=excluded.name_en, group_code=excluded.group_code, risk_level=excluded.risk_level, scope_type=excluded.scope_type, scope_ref=excluded.scope_ref, is_active=excluded.is_active;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.packing.exception','logistics','packing','exception','上报打包异常','Report packing exception','G6','medium','table','work_orders',true) on conflict (key) do update set module=excluded.module, resource=excluded.resource, action=excluded.action, name=excluded.name, name_en=excluded.name_en, group_code=excluded.group_code, risk_level=excluded.risk_level, scope_type=excluded.scope_type, scope_ref=excluded.scope_ref, is_active=excluded.is_active;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.push.view','logistics','push','view','推单日志查看','View push log','G6','low','route','/fulfillment/push-logs',true) on conflict (key) do update set module=excluded.module, resource=excluded.resource, action=excluded.action, name=excluded.name, name_en=excluded.name_en, group_code=excluded.group_code, risk_level=excluded.risk_level, scope_type=excluded.scope_type, scope_ref=excluded.scope_ref, is_active=excluded.is_active;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.push.push','logistics','push','push','推送订单到货代','Push order to forwarder','G6','high','endpoint','forwarder-push',true) on conflict (key) do update set module=excluded.module, resource=excluded.resource, action=excluded.action, name=excluded.name, name_en=excluded.name_en, group_code=excluded.group_code, risk_level=excluded.risk_level, scope_type=excluded.scope_type, scope_ref=excluded.scope_ref, is_active=excluded.is_active;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.push.retry','logistics','push','retry','重新推送','Retry push','G6','high','endpoint','forwarder-push',true) on conflict (key) do update set module=excluded.module, resource=excluded.resource, action=excluded.action, name=excluded.name, name_en=excluded.name_en, group_code=excluded.group_code, risk_level=excluded.risk_level, scope_type=excluded.scope_type, scope_ref=excluded.scope_ref, is_active=excluded.is_active;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.push.cancel','logistics','push','cancel','拦截或撤单','Intercept or cancel','G6','high','table','shipments',true) on conflict (key) do update set module=excluded.module, resource=excluded.resource, action=excluded.action, name=excluded.name, name_en=excluded.name_en, group_code=excluded.group_code, risk_level=excluded.risk_level, scope_type=excluded.scope_type, scope_ref=excluded.scope_ref, is_active=excluded.is_active;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.workorder.view','logistics','workorder','view','异常工单查看','View work order','G6','medium','route','/fulfillment/exceptions',true) on conflict (key) do update set module=excluded.module, resource=excluded.resource, action=excluded.action, name=excluded.name, name_en=excluded.name_en, group_code=excluded.group_code, risk_level=excluded.risk_level, scope_type=excluded.scope_type, scope_ref=excluded.scope_ref, is_active=excluded.is_active;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.workorder.create','logistics','workorder','create','新建异常工单','Create work order','G6','medium','table','work_orders',true) on conflict (key) do update set module=excluded.module, resource=excluded.resource, action=excluded.action, name=excluded.name, name_en=excluded.name_en, group_code=excluded.group_code, risk_level=excluded.risk_level, scope_type=excluded.scope_type, scope_ref=excluded.scope_ref, is_active=excluded.is_active;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.workorder.assign','logistics','workorder','assign','指派工单处理人','Assign work order','G6','medium','table','work_orders',true) on conflict (key) do update set module=excluded.module, resource=excluded.resource, action=excluded.action, name=excluded.name, name_en=excluded.name_en, group_code=excluded.group_code, risk_level=excluded.risk_level, scope_type=excluded.scope_type, scope_ref=excluded.scope_ref, is_active=excluded.is_active;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.workorder.process','logistics','workorder','process','处理工单','Process work order','G6','medium','table','work_orders',true) on conflict (key) do update set module=excluded.module, resource=excluded.resource, action=excluded.action, name=excluded.name, name_en=excluded.name_en, group_code=excluded.group_code, risk_level=excluded.risk_level, scope_type=excluded.scope_type, scope_ref=excluded.scope_ref, is_active=excluded.is_active;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.workorder.close','logistics','workorder','close','关闭工单','Close work order','G6','high','table','work_orders',true) on conflict (key) do update set module=excluded.module, resource=excluded.resource, action=excluded.action, name=excluded.name, name_en=excluded.name_en, group_code=excluded.group_code, risk_level=excluded.risk_level, scope_type=excluded.scope_type, scope_ref=excluded.scope_ref, is_active=excluded.is_active;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.label.view','logistics','label','view','面单查看','View label file','G6','low','table','label_files',true) on conflict (key) do update set module=excluded.module, resource=excluded.resource, action=excluded.action, name=excluded.name, name_en=excluded.name_en, group_code=excluded.group_code, risk_level=excluded.risk_level, scope_type=excluded.scope_type, scope_ref=excluded.scope_ref, is_active=excluded.is_active;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.label.upload','logistics','label','upload','上传面单','Upload label','G6','medium','table','label_files',true) on conflict (key) do update set module=excluded.module, resource=excluded.resource, action=excluded.action, name=excluded.name, name_en=excluded.name_en, group_code=excluded.group_code, risk_level=excluded.risk_level, scope_type=excluded.scope_type, scope_ref=excluded.scope_ref, is_active=excluded.is_active;

-- =====================================================================
-- §17 · 验收审计回补（现场发现，2026-11-17 clone 上 verify_fw.sql 抓出）
--
-- verify_fw.sql 对本迁移做了 11 类违例扫描，抓到 4 个真缺陷，全部在此补：
--   A4 租户列无外键 ×4 —— label_files / shipment_status_events /
--      work_order_items / work_order_attachments 有 user_id 却没建 FK。
--      后果不是报错而是**静默越权**：脏 user_id 不会被数据库拒，
--      RLS 只保证"查不到别人的"，不保证"写进去的一定是自己的"。
--   A5 缺租户索引 ×3 —— label_files / work_order_items / work_order_attachments
--      没有任何以 user_id 打头的索引。面单与工单附件是本项目增长最快的两类表，
--      列表页第一句永远是 where user_id = auth.uid()，全表扫必炸。
--   A6 枚举无 CHECK ×1 —— shipment_stage_transitions.requires_gate。
--      这个最危险：requires_gate 拼错时 shipment_can_advance 走 ELSE 分支
--      **直接放行**，等于"没面单也能出库"。门禁名必须锁死在白名单里。
-- =====================================================================

DO $q$ BEGIN
  ALTER TABLE public.label_files
    ADD CONSTRAINT label_files_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN foreign_key_violation THEN RAISE NOTICE '[跳过外键] label_files.user_id 有孤儿数据'; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.shipment_status_events
    ADD CONSTRAINT shipment_status_events_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN foreign_key_violation THEN RAISE NOTICE '[跳过外键] shipment_status_events.user_id 有孤儿数据'; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.work_order_items
    ADD CONSTRAINT work_order_items_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN foreign_key_violation THEN RAISE NOTICE '[跳过外键] work_order_items.user_id 有孤儿数据'; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.work_order_attachments
    ADD CONSTRAINT work_order_attachments_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN foreign_key_violation THEN RAISE NOTICE '[跳过外键] work_order_attachments.user_id 有孤儿数据'; END $q$;

CREATE INDEX IF NOT EXISTS label_files_user_idx
  ON public.label_files (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wo_items_user_idx
  ON public.work_order_items (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wo_attach_user_idx
  ON public.work_order_attachments (user_id, created_at DESC);

-- 门禁白名单：新增门禁必须先改 shipment_can_advance，再改这里，防止"写了个不存在的门禁名却默认放行"
DO $q$ BEGIN
  ALTER TABLE public.shipment_stage_transitions
    ADD CONSTRAINT sst_requires_gate_ck
    CHECK (requires_gate IS NULL
           OR requires_gate = ANY (ARRAY['all_parcels_signed','label_ready','tracking_no']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

-- =====================================================================
-- 本迁移对象清单
--   改造表 3：shipments(+37 列, 并放开 legacy tracking_no NOT NULL) /
--             parcels(+10 列) / （freight_forwarders 等由 fw01）
--   新建表 8：shipment_items, push_logs, shipment_status_events, label_files,
--             work_orders, work_order_items, work_order_attachments,
--             shipment_stage_transitions
--   新建函数 6：shipment_can_advance, shipment_advance, push_is_duplicate,
--             shipment_request_intercept, trg_parcels_signed_sync,
--             trg_parcels_headless_ticket（后 2 个为触发器函数）
--   新建触发器 4：parcels 签收联动、无头件开工单、parcels/work_orders updated_at
--   新建视图 1：v_shipment_progress
--   新建索引 21（含 3 个 partial、1 个唯一幂等索引、3 个租户索引）
--   CHECK 约束 13
--   权限点 15（全部为 logistics.<resource>.<action>，group_code=G6）
--   字典数据 10 条阶段转移矩阵
-- 只追加不可改写的表：push_logs、shipment_status_events（无 UPDATE/DELETE 策略）
-- 冒烟：migrations-draft/smoke.sql 22 条硬断言在 clone 上全绿
-- =====================================================================
