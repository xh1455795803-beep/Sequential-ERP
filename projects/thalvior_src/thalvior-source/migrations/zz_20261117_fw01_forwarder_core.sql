-- =====================================================================
-- zz_20261117_fw01_forwarder_core.sql
-- 货代服务 · 接入层数据模型（M1 第一批）
--
-- 现场证据（2026-11-17 生产库实测，非推测）：
--   1) freight_forwarders 仅 6 个业务列（name/channel/region/status/contact/phone），
--      全站 1 行，且该行 name='log.carrierYuntu'、channel='log.chYuntuType'、
--      region='log.chYuntuRegion' —— 批量导入路径把 i18n key 当值写进了库，
--      页面直接渲染出 "log.carrierYuntu"。见 B1。
--   2) forwarder_catalog 106 行，全仓库 grep 零引用；前端 _layout.logistics.index.tsx
--      用的是硬编码 FREIGHT_LIBRARY 数组（12 条）。见 B2。
--   3) 无货代授权表：平台有 shop_auths、货源有 source_auths，货代什么都没有
--      → 妙手那套「授权态 / 可用态」在竞品里是两条独立状态（通途审核制、
--        妙手帮助中心「授权了货代、备货也建了，但还是无法调用库存」），
--        我们连一条都没有。
--   4) 无货代仓库实体：warehouses.user_id NOT NULL，语义是「卖家自有仓」，
--      不能拿来装货代仓。竞品一致把「货代」与「仓库」建成一对多两个实体。
--   5) shipments.order_id / parcels.order_id / shipping_tasks.order_id 全是裸 text，
--      无外键；waybills.shipment_id 是 uuid 但无 FK，parcels.waybill_no 又用 text 关联
--      —— 同一层关系两种连法。见 B3/B4。
--   6) permissions 表里 logistics 模块 25 个权限点已注册（group_code=G6），
--      但 src 与 functions 里零调用。见 B5。
--
-- 本迁移只做六件事：
--   1) freight_forwarders 扩列（平台/站点/城市/服务项/标签/实景图/时效/来源/授权态冗余）
--   2) 新建 forwarder_auths（授权态与可用态分离，4 种绑定协议，凭据加密沿用 shop_auths 口径）
--   3) 新建 forwarder_warehouses（货代 1:N 仓库，code 为外部契约字段）
--   4) forwarder_catalog 加 kind 列 + 把现有 106 行重新打标为 carrier/overseas_warehouse
--      （概念纠偏：这批是干线物流商/海外仓，不是代打包货代）
--   5) logistics_channels 扩列（挂仓库、挂标发映射、面单来源默认值、自动交运开关）
--   6) 新建 forwarder_sku_mappings / warehouse_inventory / inventory_adjustments /
--      fulfillment_switches / push_error_codes，并补齐 B1/B3/B4 的数据与约束修复
--
-- 幂等：全部 IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS / ON CONFLICT DO UPDATE，
--       可重复执行；数据修复类 UPDATE 带 WHERE 条件守卫，重跑不改变已修复的行。
-- 依赖：zz_20261116_baseline_production_schema.sql 之后执行；
--       引用 public.profiles(id)、public.orders(id text)、public.shipments、public.parcels。
-- =====================================================================

SET search_path = public;

-- ─────────────────────────────────────────────────────────────────────
-- §1 · freight_forwarders 扩列（货代主体）
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.freight_forwarders
  ADD COLUMN IF NOT EXISTS code            text,
  ADD COLUMN IF NOT EXISTS platforms       text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sites           text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS province        text,
  ADD COLUMN IF NOT EXISTS city            text,
  ADD COLUMN IF NOT EXISTS services        text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tags            text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS intro           text,
  ADD COLUMN IF NOT EXISTS photos          text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS wechat          text,
  ADD COLUMN IF NOT EXISTS source          text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS sla_hours       integer,
  ADD COLUMN IF NOT EXISTS rating          numeric(3,1),
  ADD COLUMN IF NOT EXISTS packing_flow    text NOT NULL DEFAULT 'simple',
  ADD COLUMN IF NOT EXISTS auth_state      text NOT NULL DEFAULT 'unregistered',
  ADD COLUMN IF NOT EXISTS available_state text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS remark          text,
  ADD COLUMN IF NOT EXISTS is_deleted      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at      timestamptz NOT NULL DEFAULT now();

DO $q$ BEGIN
  ALTER TABLE public.freight_forwarders
    ADD CONSTRAINT freight_forwarders_source_ck
    CHECK (source = ANY (ARRAY['preset_catalog','manual','market','api_onboarded']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.freight_forwarders
    ADD CONSTRAINT freight_forwarders_packing_flow_ck
    CHECK (packing_flow = ANY (ARRAY['simple','task_based']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.freight_forwarders
    ADD CONSTRAINT freight_forwarders_auth_state_ck
    CHECK (auth_state = ANY (ARRAY['unregistered','registered','pending_review','approved','authorized','expired','revoked']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.freight_forwarders
    ADD CONSTRAINT freight_forwarders_available_ck
    CHECK (available_state = ANY (ARRAY['available','unavailable','unknown']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

-- 外部契约码：同一租户内唯一、不可变（通途铁律：仓库/渠道代码必须与对方系统字面一致）
CREATE UNIQUE INDEX IF NOT EXISTS freight_forwarders_user_code_key
  ON public.freight_forwarders (user_id, code) WHERE code IS NOT NULL AND is_deleted = false;
CREATE INDEX IF NOT EXISTS freight_forwarders_user_deleted_idx
  ON public.freight_forwarders (user_id, is_deleted);
-- 四维筛选（平台 / 站点 / 城市 / 服务项）走 GIN
CREATE INDEX IF NOT EXISTS freight_forwarders_platforms_gin
  ON public.freight_forwarders USING gin (platforms);
CREATE INDEX IF NOT EXISTS freight_forwarders_sites_gin
  ON public.freight_forwarders USING gin (sites);
CREATE INDEX IF NOT EXISTS freight_forwarders_services_gin
  ON public.freight_forwarders USING gin (services);

COMMENT ON TABLE public.freight_forwarders IS
  '货代主体（代打包仓经营者）。一个货代 1:N 仓库（forwarder_warehouses），履约对象是仓库不是货代。'
  '注意：本表专指代打包货代（A/B 型履约的服务商主体），不含干线物流商——后者是 logistics_channels.carrier。';
COMMENT ON COLUMN public.freight_forwarders.region IS '【已废弃】原"全球/欧美"粒度无决策价值，改用 province/city（城市级）。前端不再展示。';
COMMENT ON COLUMN public.freight_forwarders.code IS '外部契约码，租户内唯一，创建后不可变；对接口径与本表 forwarder_warehouses.code 组合定位对方系统。';
COMMENT ON COLUMN public.freight_forwarders.packing_flow IS '作业路径：simple=出库单→打面单→拣货打包→确认出库；task_based=生成拣货任务→拣货→复核打包→称重扫描出库（小货代用 simple）。';
COMMENT ON COLUMN public.freight_forwarders.auth_state IS '冗余自 forwarder_auths.auth_state，列表页免 join；权威值以 forwarder_auths 为准。';

-- ─────────────────────────────────────────────────────────────────────
-- §2 · forwarder_auths（授权态）
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.forwarder_auths (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL,
  forwarder_id         uuid NOT NULL,
  protocol             text    NOT NULL DEFAULT 'auth_code',
  external_account     text,
  external_tenant_id   text,
  credentials_enc      text,
  app_key              text,
  callback_url         text,
  auth_state           text    NOT NULL DEFAULT 'unregistered',
  available_state      text    NOT NULL DEFAULT 'unknown',
  unavailable_reason   text,
  push_enabled         boolean NOT NULL DEFAULT false,
  webhook_secret_enc   text,
  registered_at        timestamptz,
  reviewed_at          timestamptz,
  authorized_at        timestamptz,
  expires_at           timestamptz,
  last_valid_check_at  timestamptz,
  last_error           text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

DO $q$ BEGIN
  ALTER TABLE public.forwarder_auths
    ADD CONSTRAINT forwarder_auths_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] profiles 表不存在'; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.forwarder_auths
    ADD CONSTRAINT forwarder_auths_forwarder_id_fkey
    FOREIGN KEY (forwarder_id) REFERENCES public.freight_forwarders(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.forwarder_auths
    ADD CONSTRAINT forwarder_auths_protocol_ck
    CHECK (protocol = ANY (ARRAY['auth_code','redirect_login','appkey_token','manual_invite']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.forwarder_auths
    ADD CONSTRAINT forwarder_auths_auth_state_ck
    CHECK (auth_state = ANY (ARRAY['unregistered','registered','pending_review','approved','authorized','expired','revoked']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.forwarder_auths
    ADD CONSTRAINT forwarder_auths_available_ck
    CHECK (available_state = ANY (ARRAY['available','unavailable','unknown']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

CREATE UNIQUE INDEX IF NOT EXISTS forwarder_auths_user_fwd_proto_key
  ON public.forwarder_auths (user_id, forwarder_id, protocol);
CREATE INDEX IF NOT EXISTS forwarder_auths_user_state_idx
  ON public.forwarder_auths (user_id, auth_state);
CREATE INDEX IF NOT EXISTS forwarder_auths_expires_idx
  ON public.forwarder_auths (expires_at) WHERE auth_state = 'authorized';

COMMENT ON TABLE public.forwarder_auths IS
  '货代授权绑定记录。一个货代可有多种协议并存（如同时有授权码与 appKey）。'
  'auth_state（授权走到哪一步）与 available_state（现在能不能推单/调库存）必须分离——'
  '竞品实测教训：妙手帮助中心挂着「授权了货代、备货也创建了，但还是无法调用库存」。';
COMMENT ON COLUMN public.forwarder_auths.protocol IS 'auth_code=系统授权码/密钥粘贴（妙手式）；redirect_login=跳转货代官网登录同意（OAuth 式）；appkey_token=服务商在开放平台建应用+平台审核（马帮/通途式）；manual_invite=平台运营人工绑定（芒果式）。';
COMMENT ON COLUMN public.forwarder_auths.credentials_enc IS 'AES-256-GCM/PBKDF2 100000/SHA-256，盐 thalvior-cred-v1，secret=JWT_SECRET；与 shop_auths.credentials_enc 同口径，禁止明文。';

-- ─────────────────────────────────────────────────────────────────────
-- §3 · forwarder_warehouses（货代仓库 1:N，真正的履约对象）
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.forwarder_warehouses (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL,
  forwarder_id          uuid NOT NULL,
  code                  text NOT NULL,
  external_warehouse_id text,
  name                  text NOT NULL,
  country               text NOT NULL DEFAULT 'CN',
  province              text,
  city                  text,
  address               text,
  contact               text,
  phone                 text,
  capabilities          text[] NOT NULL DEFAULT '{}',
  photos                text[] NOT NULL DEFAULT '{}',
  promise               text,
  status                text NOT NULL DEFAULT 'active',
  is_default            boolean NOT NULL DEFAULT false,
  platform_sites        text[] NOT NULL DEFAULT '{}',
  distance_to_official  text,
  synced_at             timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

DO $q$ BEGIN
  ALTER TABLE public.forwarder_warehouses
    ADD CONSTRAINT forwarder_warehouses_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.forwarder_warehouses
    ADD CONSTRAINT forwarder_warehouses_forwarder_id_fkey
    FOREIGN KEY (forwarder_id) REFERENCES public.freight_forwarders(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.forwarder_warehouses
    ADD CONSTRAINT forwarder_warehouses_status_ck
    CHECK (status = ANY (ARRAY['active','inactive','pending_confirm']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

CREATE UNIQUE INDEX IF NOT EXISTS forwarder_warehouses_fwd_code_key
  ON public.forwarder_warehouses (forwarder_id, code);
CREATE INDEX IF NOT EXISTS forwarder_warehouses_user_city_idx
  ON public.forwarder_warehouses (user_id, city);
CREATE INDEX IF NOT EXISTS forwarder_warehouses_caps_gin
  ON public.forwarder_warehouses USING gin (capabilities);

COMMENT ON TABLE public.forwarder_warehouses IS
  '货代仓库。推单/库存/渠道/账单都挂在仓库层，不是货代层（竞品一致口径）。'
  '不复用 warehouses（该表 user_id NOT NULL 且语义为卖家自有仓）。';
COMMENT ON COLUMN public.forwarder_warehouses.code IS '外部契约码，必须与对方系统仓库代码字面一致（通途明文要求）；不一致会导致推单落到错误仓。禁止自增 ID 顶替。';
COMMENT ON COLUMN public.forwarder_warehouses.distance_to_official IS '到平台官方仓的距离描述（卖家选仓核心决策项，妙手按城市筛的动机即在此）。';

-- ─────────────────────────────────────────────────────────────────────
-- §4 · forwarder_catalog 概念纠偏（B 型打标）
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.forwarder_catalog
  ADD COLUMN IF NOT EXISTS kind        text NOT NULL DEFAULT 'carrier',
  ADD COLUMN IF NOT EXISTS intro       text,
  ADD COLUMN IF NOT EXISTS is_active   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz NOT NULL DEFAULT now();

DO $q$ BEGIN
  ALTER TABLE public.forwarder_catalog
    ADD CONSTRAINT forwarder_catalog_kind_ck
    CHECK (kind = ANY (ARRAY['forwarder_pack','carrier','overseas_warehouse']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

CREATE INDEX IF NOT EXISTS forwarder_catalog_kind_idx
  ON public.forwarder_catalog (kind, is_active);

COMMENT ON TABLE public.forwarder_catalog IS
  '平台预置资源库（只读目录，非租户数据）。'
  'kind=forwarder_pack 代打包货代仓（妙手「货代管理」那一层）；'
  'kind=carrier 干线物流商；kind=overseas_warehouse 海外仓。';

-- 数据纠偏：现有 106 行全是云途/燕文/4PX/万邑通/安骏/纵腾/中外运/DHL/FedEx/UPS/USPS 一类，
-- 属干线物流商或海外仓，不是代打包货代。按 channel 文本重算 kind，
-- 幂等：重复执行得到同一结果，不需要额外守卫。
UPDATE public.forwarder_catalog
   SET kind = CASE
         WHEN channel ILIKE '%海外仓%' OR channel ILIKE '%FBA%' OR channel ILIKE '%头程%'
           THEN 'overseas_warehouse'
         ELSE 'carrier'
       END,
       updated_at = now();

-- ─────────────────────────────────────────────────────────────────────
-- §5 · logistics_channels 扩列（渠道挂仓库 + 标发映射 + 面单来源）
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.logistics_channels
  ADD COLUMN IF NOT EXISTS code                  text,
  ADD COLUMN IF NOT EXISTS warehouse_id          uuid,
  ADD COLUMN IF NOT EXISTS forwarder_id          uuid,
  ADD COLUMN IF NOT EXISTS platform_carrier      text,
  ADD COLUMN IF NOT EXISTS tracking_no_type      text NOT NULL DEFAULT 'final',
  ADD COLUMN IF NOT EXISTS label_source_default  text NOT NULL DEFAULT 'api',
  ADD COLUMN IF NOT EXISTS transport_type        text NOT NULL DEFAULT 'wms_label',
  ADD COLUMN IF NOT EXISTS oda_supported         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS insurance_types       text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS auto_commit_enabled   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS supported_platforms   text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS supported_sites       text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS synced_shop_location  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active             boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deleted_at            timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at            timestamptz NOT NULL DEFAULT now();

DO $q$ BEGIN
  ALTER TABLE public.logistics_channels
    ADD CONSTRAINT logistics_channels_warehouse_id_fkey
    FOREIGN KEY (warehouse_id) REFERENCES public.forwarder_warehouses(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] forwarder_warehouses 表不存在'; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.logistics_channels
    ADD CONSTRAINT logistics_channels_forwarder_id_fkey
    FOREIGN KEY (forwarder_id) REFERENCES public.freight_forwarders(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.logistics_channels
    ADD CONSTRAINT logistics_channels_tracking_type_ck
    CHECK (tracking_no_type = ANY (ARRAY['final','logistics','none']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.logistics_channels
    ADD CONSTRAINT logistics_channels_label_source_ck
    CHECK (label_source_default = ANY (ARRAY['attachment','api','pre_file','wms_gen']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.logistics_channels
    ADD CONSTRAINT logistics_channels_transport_type_ck
    CHECK (transport_type = ANY (ARRAY['wms_label','push_platform_label','platform_ship']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

CREATE UNIQUE INDEX IF NOT EXISTS logistics_channels_user_code_key
  ON public.logistics_channels (user_id, code) WHERE code IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS logistics_channels_warehouse_idx
  ON public.logistics_channels (warehouse_id) WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.logistics_channels.label_source_default IS
  '面单默认来源。attachment=卖家提供 / api=我方取号 / pre_file=两段式后补 / wms_gen=仓自取。'
  '竞品 5 家同构铁律：必须是枚举不是布尔位，否则接 30 家货代必返工。';
COMMENT ON COLUMN public.logistics_channels.auto_commit_enabled IS
  '马帮铁律：已匹配渠道 ≠ 已成功交运，只有物流返回运单号才算交运成功。此开关控制是否自动交运。';

-- ─────────────────────────────────────────────────────────────────────
-- §6 · forwarder_sku_mappings（两级配对的第二级）
--
-- 现场发现（clone 实测）：库里已存在 public.sku_mappings，列是
--   id / listing_id / local_sku / platform_sku / created_at —— 它是
--   「平台 listing SKU ↔ 我方 SKU」，即竞品说的第一级配对（订单行 SKU↔ERP SKU），
--   已接通商品域，本迁移不动它。
-- 本表补的是第二级：「ERP SKU ↔ 货代/海外仓 SKU」，这是推单前必须存在、
-- 而现网完全没有的一层。因此表名避让为 forwarder_sku_mappings，
-- 不再使用 sku_mappings 这个名字（首版误用导致 FK 报
-- "column user_id referenced in foreign key constraint does not exist"）。
-- level 列保留：'external'=ERP SKU↔仓 SKU（本表主用途）；
--               'orderline'=需要按店铺/站点覆盖时的一行副本，不替代 sku_mappings。
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.forwarder_sku_mappings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  forwarder_id  uuid,
  warehouse_id  uuid,
  level         text NOT NULL DEFAULT 'external',
  erp_sku       text NOT NULL,
  external_sku  text,
  product_id    uuid,
  status        text NOT NULL DEFAULT 'unmapped',
  verified_at   timestamptz,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

DO $q$ BEGIN
  ALTER TABLE public.forwarder_sku_mappings
    ADD CONSTRAINT forwarder_sku_mappings_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.forwarder_sku_mappings
    ADD CONSTRAINT forwarder_sku_mappings_wh_id_fkey
    FOREIGN KEY (warehouse_id) REFERENCES public.forwarder_warehouses(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.forwarder_sku_mappings
    ADD CONSTRAINT forwarder_sku_mappings_level_ck
    CHECK (level = ANY (ARRAY['external','orderline']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.forwarder_sku_mappings
    ADD CONSTRAINT forwarder_sku_mappings_status_ck
    CHECK (status = ANY (ARRAY['mapped','unmapped','conflict','disabled']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

CREATE UNIQUE INDEX IF NOT EXISTS forwarder_sku_mappings_lvl_wh_sku_key
  ON public.forwarder_sku_mappings (user_id, level, COALESCE(warehouse_id::text,'-'), erp_sku);
CREATE INDEX IF NOT EXISTS forwarder_sku_mappings_ext_idx
  ON public.forwarder_sku_mappings (warehouse_id, external_sku);

COMMENT ON TABLE public.forwarder_sku_mappings IS
  'SKU 两级配对：level=external（外部仓 SKU ↔ ERP SKU）、level=orderline（订单行 SKU ↔ ERP SKU）。'
  '未配对必须成为一等失败原因（领星「三方仓SKU未配对」、芒果「未查询到商品配对关系」），不能只报「推送失败」。';

-- ─────────────────────────────────────────────────────────────────────
-- §7 · warehouse_inventory + inventory_adjustments
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.warehouse_inventory (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  sku          text NOT NULL,
  onway        integer NOT NULL DEFAULT 0,
  pending      integer NOT NULL DEFAULT 0,
  sellable     integer NOT NULL DEFAULT 0,
  unsellable   integer NOT NULL DEFAULT 0,
  reserved     integer NOT NULL DEFAULT 0,
  total        integer NOT NULL DEFAULT 0,
  unit         text NOT NULL DEFAULT 'PCS',
  synced_at    timestamptz,
  source       text NOT NULL DEFAULT 'wms',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

DO $q$ BEGIN
  ALTER TABLE public.warehouse_inventory
    ADD CONSTRAINT warehouse_inventory_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.warehouse_inventory
    ADD CONSTRAINT warehouse_inventory_wh_id_fkey
    FOREIGN KEY (warehouse_id) REFERENCES public.forwarder_warehouses(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

CREATE UNIQUE INDEX IF NOT EXISTS warehouse_inventory_wh_sku_key
  ON public.warehouse_inventory (warehouse_id, sku);
CREATE INDEX IF NOT EXISTS warehouse_inventory_user_idx
  ON public.warehouse_inventory (user_id, warehouse_id);

COMMENT ON TABLE public.warehouse_inventory IS
  '三方仓实时库存（字段对齐千易 syncInventory）。与 ERP 单据库存是两套视图，'
  '审核/配货校验用哪一套由 fulfillment_switches.inventory_check_source 显式决定，不得隐式混用。';

CREATE TABLE IF NOT EXISTS public.inventory_adjustments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  warehouse_id   uuid NOT NULL,
  adjust_number  text NOT NULL,
  sku            text NOT NULL,
  adjust_type    text NOT NULL,
  qty            integer NOT NULL,
  before_qty     integer,
  after_qty      integer,
  reason         text,
  diff_snapshot  jsonb,
  status         text NOT NULL DEFAULT 'pending',
  created_by     uuid,
  applied_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

DO $q$ BEGIN
  ALTER TABLE public.inventory_adjustments
    ADD CONSTRAINT inventory_adjustments_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.inventory_adjustments
    ADD CONSTRAINT inventory_adjustments_wh_id_fkey
    FOREIGN KEY (warehouse_id) REFERENCES public.forwarder_warehouses(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.inventory_adjustments
    ADD CONSTRAINT inventory_adjustments_type_ck
    CHECK (adjust_type = ANY (ARRAY['good','bad','available','in_transit','reserved']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.inventory_adjustments
    ADD CONSTRAINT inventory_adjustments_status_ck
    CHECK (status = ANY (ARRAY['pending','applied','reverted','voided']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_adjustments_number_key
  ON public.inventory_adjustments (user_id, adjust_number);
CREATE INDEX IF NOT EXISTS inventory_adjustments_wh_status_idx
  ON public.inventory_adjustments (warehouse_id, status);

COMMENT ON TABLE public.inventory_adjustments IS
  '库存差异调整单（独立单据，可追溯）。赛狐模式：定时差异检测 + 自动调整 + 生成调整单。'
  'qty 可正可负；diff_snapshot 保留检测当时的双方数值，供事后审计。';

-- ─────────────────────────────────────────────────────────────────────
-- §8 · fulfillment_switches（自动化开关，三者独立可配）
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fulfillment_switches (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL,
  scope                   text NOT NULL DEFAULT 'global',
  scope_ref               text,
  auto_commit             boolean NOT NULL DEFAULT false,
  auto_push_forwarder     boolean NOT NULL DEFAULT false,
  auto_mark_ship          boolean NOT NULL DEFAULT false,
  auto_deduct_inventory   boolean NOT NULL DEFAULT true,
  auto_inventory_sync     boolean NOT NULL DEFAULT false,
  inventory_check_source  text NOT NULL DEFAULT 'erp',
  stock_snapshot_enabled  boolean NOT NULL DEFAULT false,
  retry_max               integer NOT NULL DEFAULT 5,
  retry_backoff_minutes   integer NOT NULL DEFAULT 15,
  dedupe_window_hours     integer NOT NULL DEFAULT 24,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

DO $q$ BEGIN
  ALTER TABLE public.fulfillment_switches
    ADD CONSTRAINT fulfillment_switches_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.fulfillment_switches
    ADD CONSTRAINT fulfillment_switches_scope_ck
    CHECK (scope = ANY (ARRAY['global','shop','platform','warehouse','channel','forwarder']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.fulfillment_switches
    ADD CONSTRAINT fulfillment_switches_check_src_ck
    CHECK (inventory_check_source = ANY (ARRAY['erp','warehouse']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

CREATE UNIQUE INDEX IF NOT EXISTS fulfillment_switches_scope_key
  ON public.fulfillment_switches (user_id, scope, COALESCE(scope_ref,'-'));

COMMENT ON TABLE public.fulfillment_switches IS
  '履约自动化开关。auto_commit（自动交运）/ auto_mark_ship（自动标发）/ auto_deduct_inventory（自动扣库存）'
  '三者必须独立可配（马帮、积加、店小秘三家共识），不得合并成一个总开关。';

-- ─────────────────────────────────────────────────────────────────────
-- §9 · push_error_codes（失败码表，不能只返回"失败"）
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_error_codes (
  code            text PRIMARY KEY,
  message_cn      text NOT NULL,
  message_en      text NOT NULL,
  suggested_action text,
  retryable       boolean NOT NULL DEFAULT false,
  category        text NOT NULL DEFAULT 'business',
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

DO $q$ BEGIN
  ALTER TABLE public.push_error_codes
    ADD CONSTRAINT push_error_codes_category_ck
    CHECK (category = ANY (ARRAY['technical','business','credential','data']));
EXCEPTION WHEN duplicate_object THEN NULL; END $q$;

INSERT INTO public.push_error_codes (code, message_cn, message_en, suggested_action, retryable, category) VALUES
  ('CH_LABELING','渠道正在生成运单号','Channel is generating tracking number','稍后重试，勿重复提交',true,'technical'),
  ('CH_DISABLED','渠道已停用','Channel disabled','更换渠道或联系运营启用',false,'business'),
  ('TK_MANUAL','请手动上传跟踪号','Please upload tracking number manually','改为手动回填单号',false,'business'),
  ('HS_REQUIRED','需填海关编码','HS code required','补全商品海关编码',false,'data'),
  ('ADDR_INCOMPLETE','缺电话/邮箱/城市/州省','Missing phone/email/city/state','补全收件人字段',false,'data'),
  ('SKU_NOT_FILED','SKU 未备案','SKU not filed with customs','先做商品备案',false,'data'),
  ('SKU_CN_NAME','SKU 含中文','SKU contains Chinese characters','改用英文 SKU',false,'data'),
  ('DECL_NOT_EN','报关品名非英文','Customs name must be English','补英文报关品名',false,'data'),
  ('ORDER_URL_REQ','order_url is required','order_url is required','补采购链接',false,'data'),
  ('ZIP_INVALID','邮编不规范','Invalid postal code','校验目的国邮编格式',false,'data'),
  ('CH_CHANGED','已申请单号后换物流','Channel changed after number issued','先作废原运单再换渠道',false,'business'),
  ('SKU_UNMAPPED','三方仓 SKU 未配对','3PL SKU not mapped','到 SKU 配对页完成映射',false,'data'),
  ('BALANCE_LOW','货代账户余额不足','Forwarder balance insufficient','先充值再推单',true,'business'),
  ('NO_LABEL_YET','订单已创建暂未生成运单号','Order created, label not ready','等待或手动触发取号',true,'technical'),
  ('AUTH_EXPIRED','货代授权已失效','Forwarder authorization expired','重新授权',false,'credential'),
  ('WH_CODE_MISMATCH','仓库代码与对方系统不一致','Warehouse code mismatch','核对 forwarder_warehouses.code',false,'data'),
  ('IDEMPOTENT_HIT','重复推单被幂等拦截','Duplicate push blocked by idempotency','确认是否已推成功，勿强行重试',false,'business'),
  ('WMS_TIMEOUT','货代系统响应超时','Forwarder system timeout','按退避策略重试',true,'technical')
ON CONFLICT (code) DO UPDATE SET
  message_cn = EXCLUDED.message_cn,
  message_en = EXCLUDED.message_en,
  suggested_action = EXCLUDED.suggested_action,
  retryable = EXCLUDED.retryable,
  category = EXCLUDED.category,
  is_active = EXCLUDED.is_active;

COMMENT ON TABLE public.push_error_codes IS
  '推单/取号失败码字典。竞品口径（店小秘 12 类报错 + 妙手已知 bug 场景）整理。'
  'retryable 决定重试策略；category 区分技术失败与业务异常（领星铁律：查询异常≠物流异常）。';

-- ─────────────────────────────────────────────────────────────────────
-- §10 · 数据与约束修复（B1 / B3 / B4）
-- ─────────────────────────────────────────────────────────────────────

-- B1：把被当值写进库的 i18n key 还原成中文。守卫：仅当值形如 log.carrier* / log.ch* 才改。
UPDATE public.freight_forwarders f
   SET name = CASE
         WHEN f.name = 'log.carrierYuntu'    THEN '云途物流'
         WHEN f.name = 'log.carrierYanwen'   THEN '燕文物流'
         WHEN f.name = 'log.carrier4PX'      THEN '递四方 4PX'
         WHEN f.name = 'log.carrierWinit'    THEN '万邑通'
         WHEN f.name = 'log.carrierFeihe'    THEN '递四方递飞达'
         WHEN f.name = 'log.carrierZongteng' THEN '纵腾集团'
         WHEN f.name = 'log.carrierAnjun'    THEN '安骏物流'
         WHEN f.name = 'log.carrierSinotrans' THEN '中外运'
         ELSE f.name END,
       channel = COALESCE((SELECT c.channel FROM public.forwarder_catalog c
                           WHERE c.name = CASE
                             WHEN f.name = 'log.carrierYuntu' THEN '云途物流'
                             WHEN f.name = 'log.carrierYanwen' THEN '燕文物流'
                             WHEN f.name = 'log.carrier4PX' THEN '递四方 4PX'
                             WHEN f.name = 'log.carrierSinotrans' THEN '中外运' END
                           LIMIT 1), f.channel),
       updated_at = now()
 WHERE f.name ~ '^log\.carrier';

-- B3：orders ↔ 履约层补外键。注意 orders.id 是 text 不是 uuid。
DO $q$ BEGIN
  ALTER TABLE public.shipments
    ADD CONSTRAINT shipments_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN foreign_key_violation THEN RAISE NOTICE '[跳过外键] shipments.order_id 存在孤儿数据，需先清理';
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] orders/shipments 表不存在'; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.parcels
    ADD CONSTRAINT parcels_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN foreign_key_violation THEN RAISE NOTICE '[跳过外键] parcels.order_id 存在孤儿数据'; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.shipping_tasks
    ADD CONSTRAINT shipping_tasks_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN foreign_key_violation THEN RAISE NOTICE '[跳过外键] shipping_tasks.order_id 存在孤儿数据'; END $q$;

-- B4：包裹统一走 shipment_id，waybill_no 降为展示字段
--     （parcels.shipment_id 由 fw02 添加，此处仅在列已存在时建约束）
DO $q$ BEGIN
  ALTER TABLE public.parcels
    ADD CONSTRAINT parcels_shipment_id_fkey
    FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN undefined_column THEN RAISE NOTICE '[跳过] parcels 无 shipment_id 列，由 fw02 添加并建约束';
  WHEN foreign_key_violation THEN RAISE NOTICE '[跳过外键] parcels.shipment_id 存在孤儿数据'; END $q$;

DO $q$ BEGIN
  ALTER TABLE public.waybills
    ADD CONSTRAINT waybills_shipment_id_fkey
    FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN foreign_key_violation THEN RAISE NOTICE '[跳过外键] waybills.shipment_id 存在孤儿数据'; END $q$;

-- ─────────────────────────────────────────────────────────────────────
-- §11 · RLS
-- ─────────────────────────────────────────────────────────────────────
-- forwarder_auths
ALTER TABLE public.forwarder_auths ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_forwarder_auths ON public.forwarder_auths;
CREATE POLICY users_select_forwarder_auths ON public.forwarder_auths
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS users_insert_forwarder_auths ON public.forwarder_auths;
CREATE POLICY users_insert_forwarder_auths ON public.forwarder_auths
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_update_forwarder_auths ON public.forwarder_auths;
CREATE POLICY users_update_forwarder_auths ON public.forwarder_auths
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_delete_forwarder_auths ON public.forwarder_auths;
CREATE POLICY users_delete_forwarder_auths ON public.forwarder_auths
  FOR DELETE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS admins_select_forwarder_auths ON public.forwarder_auths;
CREATE POLICY admins_select_forwarder_auths ON public.forwarder_auths
  FOR SELECT USING (has_role(auth.uid(), 'admin'::text));

-- forwarder_warehouses
ALTER TABLE public.forwarder_warehouses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_forwarder_warehouses ON public.forwarder_warehouses;
CREATE POLICY users_select_forwarder_warehouses ON public.forwarder_warehouses
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS users_insert_forwarder_warehouses ON public.forwarder_warehouses;
CREATE POLICY users_insert_forwarder_warehouses ON public.forwarder_warehouses
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_update_forwarder_warehouses ON public.forwarder_warehouses;
CREATE POLICY users_update_forwarder_warehouses ON public.forwarder_warehouses
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_delete_forwarder_warehouses ON public.forwarder_warehouses;
CREATE POLICY users_delete_forwarder_warehouses ON public.forwarder_warehouses
  FOR DELETE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS admins_select_forwarder_warehouses ON public.forwarder_warehouses;
CREATE POLICY admins_select_forwarder_warehouses ON public.forwarder_warehouses
  FOR SELECT USING (has_role(auth.uid(), 'admin'::text));

-- forwarder_sku_mappings
ALTER TABLE public.forwarder_sku_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_sku_mappings ON public.forwarder_sku_mappings;
CREATE POLICY users_select_sku_mappings ON public.forwarder_sku_mappings
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS users_insert_sku_mappings ON public.forwarder_sku_mappings;
CREATE POLICY users_insert_sku_mappings ON public.forwarder_sku_mappings
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_update_sku_mappings ON public.forwarder_sku_mappings;
CREATE POLICY users_update_sku_mappings ON public.forwarder_sku_mappings
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_delete_sku_mappings ON public.forwarder_sku_mappings;
CREATE POLICY users_delete_sku_mappings ON public.forwarder_sku_mappings
  FOR DELETE USING (auth.uid() = user_id);

-- warehouse_inventory
ALTER TABLE public.warehouse_inventory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_warehouse_inventory ON public.warehouse_inventory;
CREATE POLICY users_select_warehouse_inventory ON public.warehouse_inventory
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS users_write_warehouse_inventory ON public.warehouse_inventory;
CREATE POLICY users_write_warehouse_inventory ON public.warehouse_inventory
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_update_warehouse_inventory ON public.warehouse_inventory;
CREATE POLICY users_update_warehouse_inventory ON public.warehouse_inventory
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- inventory_adjustments
ALTER TABLE public.inventory_adjustments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_inventory_adjustments ON public.inventory_adjustments;
CREATE POLICY users_select_inventory_adjustments ON public.inventory_adjustments
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS users_insert_inventory_adjustments ON public.inventory_adjustments;
CREATE POLICY users_insert_inventory_adjustments ON public.inventory_adjustments
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_update_inventory_adjustments ON public.inventory_adjustments;
CREATE POLICY users_update_inventory_adjustments ON public.inventory_adjustments
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- fulfillment_switches
ALTER TABLE public.fulfillment_switches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_fulfillment_switches ON public.fulfillment_switches;
CREATE POLICY users_select_fulfillment_switches ON public.fulfillment_switches
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS users_insert_fulfillment_switches ON public.fulfillment_switches;
CREATE POLICY users_insert_fulfillment_switches ON public.fulfillment_switches
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_update_fulfillment_switches ON public.fulfillment_switches;
CREATE POLICY users_update_fulfillment_switches ON public.fulfillment_switches
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- push_error_codes：全局字典，登录可读，仅 admin 可写
ALTER TABLE public.push_error_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_push_error_codes ON public.push_error_codes;
CREATE POLICY users_select_push_error_codes ON public.push_error_codes
  FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS admins_write_push_error_codes ON public.push_error_codes;
CREATE POLICY admins_write_push_error_codes ON public.push_error_codes
  FOR ALL USING (has_role(auth.uid(), 'admin'::text))
          WITH CHECK (has_role(auth.uid(), 'admin'::text));

-- forwarder_catalog：全局目录，登录可读，仅 admin 可写
ALTER TABLE public.forwarder_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_forwarder_catalog ON public.forwarder_catalog;
CREATE POLICY users_select_forwarder_catalog ON public.forwarder_catalog
  FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS admins_write_forwarder_catalog ON public.forwarder_catalog;
CREATE POLICY admins_write_forwarder_catalog ON public.forwarder_catalog
  FOR ALL USING (has_role(auth.uid(), 'admin'::text))
          WITH CHECK (has_role(auth.uid(), 'admin'::text));

-- ─────────────────────────────────────────────────────────────────────
-- §12 · updated_at 自动维护
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_forwarder_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_forwarder_auths_touch ON public.forwarder_auths;
CREATE TRIGGER trg_forwarder_auths_touch BEFORE UPDATE ON public.forwarder_auths
  FOR EACH ROW EXECUTE FUNCTION public.touch_forwarder_updated_at();
DROP TRIGGER IF EXISTS trg_forwarder_wh_touch ON public.forwarder_warehouses;
CREATE TRIGGER trg_forwarder_wh_touch BEFORE UPDATE ON public.forwarder_warehouses
  FOR EACH ROW EXECUTE FUNCTION public.touch_forwarder_updated_at();
DROP TRIGGER IF EXISTS trg_sku_mappings_touch ON public.forwarder_sku_mappings;
CREATE TRIGGER trg_sku_mappings_touch BEFORE UPDATE ON public.forwarder_sku_mappings
  FOR EACH ROW EXECUTE FUNCTION public.touch_forwarder_updated_at();
DROP TRIGGER IF EXISTS trg_wh_inventory_touch ON public.warehouse_inventory;
CREATE TRIGGER trg_wh_inventory_touch BEFORE UPDATE ON public.warehouse_inventory
  FOR EACH ROW EXECUTE FUNCTION public.touch_forwarder_updated_at();
DROP TRIGGER IF EXISTS trg_fulfill_switches_touch ON public.fulfillment_switches;
CREATE TRIGGER trg_fulfill_switches_touch BEFORE UPDATE ON public.fulfillment_switches
  FOR EACH ROW EXECUTE FUNCTION public.touch_forwarder_updated_at();
DROP TRIGGER IF EXISTS trg_freight_fwd_touch ON public.freight_forwarders;
CREATE TRIGGER trg_freight_fwd_touch BEFORE UPDATE ON public.freight_forwarders
  FOR EACH ROW EXECUTE FUNCTION public.touch_forwarder_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- §13 · 权限点（照抄 20261025_rbac_s1.sql 写法：on conflict (key) do update）
-- ─────────────────────────────────────────────────────────────────────
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.warehouse.view','logistics','warehouse','view','货代仓库查看','View forwarder warehouse','G6','medium','route','/forwarder/warehouse',true) on conflict (key) do update set module=excluded.module, resource=excluded.resource, action=excluded.action, name=excluded.name, name_en=excluded.name_en, group_code=excluded.group_code, risk_level=excluded.risk_level, scope_type=excluded.scope_type, scope_ref=excluded.scope_ref, is_active=excluded.is_active;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.warehouse.create','logistics','warehouse','create','货代仓库新建','Create forwarder warehouse','G6','high','table','forwarder_warehouses',true) on conflict (key) do update set module=excluded.module, resource=excluded.resource, action=excluded.action, name=excluded.name, name_en=excluded.name_en, group_code=excluded.group_code, risk_level=excluded.risk_level, scope_type=excluded.scope_type, scope_ref=excluded.scope_ref, is_active=excluded.is_active;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.warehouse.edit','logistics','warehouse','edit','货代仓库编辑','Edit forwarder warehouse','G6','high','table','forwarder_warehouses',true) on conflict (key) do update set module=excluded.module, resource=excluded.resource, action=excluded.action, name=excluded.name, name_en=excluded.name_en, group_code=excluded.group_code, risk_level=excluded.risk_level, scope_type=excluded.scope_type, scope_ref=excluded.scope_ref, is_active=excluded.is_active;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.warehouse.delete','logistics','warehouse','delete','货代仓库删除','Delete forwarder warehouse','G6','high','table','forwarder_warehouses',true) on conflict (key) do update set module=excluded.module, resource=excluded.resource, action=excluded.action, name=excluded.name, name_en=excluded.name_en, group_code=excluded.group_code, risk_level=excluded.risk_level, scope_type=excluded.scope_type, scope_ref=excluded.scope_ref, is_active=excluded.is_active;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.forwarder_auth.view','logistics','forwarder_auth','view','货代授权查看','View forwarder authorization','G6','medium','route','/forwarder/auth',true) on conflict (key) do update set module=excluded.module, resource=excluded.resource, action=excluded.action, name=excluded.name, name_en=excluded.name_en, group_code=excluded.group_code, risk_level=excluded.risk_level, scope_type=excluded.scope_type, scope_ref=excluded.scope_ref, is_active=excluded.is_active;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.forwarder_auth.bind','logistics','forwarder_auth','bind','货代授权绑定','Bind forwarder','G6','high','table','forwarder_auths',true) on conflict (key) do update set module=excluded.module, resource=excluded.resource, action=excluded.action, name=excluded.name, name_en=excluded.name_en, group_code=excluded.group_code, risk_level=excluded.risk_level, scope_type=excluded.scope_type, scope_ref=excluded.scope_ref, is_active=excluded.is_active;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.forwarder_auth.revoke','logistics','forwarder_auth','revoke','货代授权解绑','Revoke forwarder authorization','G6','high','table','forwarder_auths',true) on conflict (key) do update set module=excluded.module, resource=excluded.resource, action=excluded.action, name=excluded.name, name_en=excluded.name_en, group_code=excluded.group_code, risk_level=excluded.risk_level, scope_type=excluded.scope_type, scope_ref=excluded.scope_ref, is_active=excluded.is_active;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.sku_mapping.view','logistics','sku_mapping','view','SKU配对查看','View SKU mapping','G6','low','route','/forwarder/sku-mapping',true) on conflict (key) do update set module=excluded.module, resource=excluded.resource, action=excluded.action, name=excluded.name, name_en=excluded.name_en, group_code=excluded.group_code, risk_level=excluded.risk_level, scope_type=excluded.scope_type, scope_ref=excluded.scope_ref, is_active=excluded.is_active;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.sku_mapping.edit','logistics','sku_mapping','edit','SKU配对编辑','Edit SKU mapping','G6','medium','table','forwarder_sku_mappings',true) on conflict (key) do update set module=excluded.module, resource=excluded.resource, action=excluded.action, name=excluded.name, name_en=excluded.name_en, group_code=excluded.group_code, risk_level=excluded.risk_level, scope_type=excluded.scope_type, scope_ref=excluded.scope_ref, is_active=excluded.is_active;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.inventory.view','logistics','inventory','view','货代仓库存查看','View forwarder inventory','G6','medium','table','warehouse_inventory',true) on conflict (key) do update set module=excluded.module, resource=excluded.resource, action=excluded.action, name=excluded.name, name_en=excluded.name_en, group_code=excluded.group_code, risk_level=excluded.risk_level, scope_type=excluded.scope_type, scope_ref=excluded.scope_ref, is_active=excluded.is_active;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.inventory.adjust','logistics','inventory','adjust','库存调整单','Inventory adjustment','G6','high','table','inventory_adjustments',true) on conflict (key) do update set module=excluded.module, resource=excluded.resource, action=excluded.action, name=excluded.name, name_en=excluded.name_en, group_code=excluded.group_code, risk_level=excluded.risk_level, scope_type=excluded.scope_type, scope_ref=excluded.scope_ref, is_active=excluded.is_active;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.switch.view','logistics','switch','view','履约开关查看','View fulfillment switches','G6','low','table','fulfillment_switches',true) on conflict (key) do update set module=excluded.module, resource=excluded.resource, action=excluded.action, name=excluded.name, name_en=excluded.name_en, group_code=excluded.group_code, risk_level=excluded.risk_level, scope_type=excluded.scope_type, scope_ref=excluded.scope_ref, is_active=excluded.is_active;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.switch.config','logistics','switch','config','履约开关配置','Configure fulfillment switches','G6','high','table','fulfillment_switches',true) on conflict (key) do update set module=excluded.module, resource=excluded.resource, action=excluded.action, name=excluded.name, name_en=excluded.name_en, group_code=excluded.group_code, risk_level=excluded.risk_level, scope_type=excluded.scope_type, scope_ref=excluded.scope_ref, is_active=excluded.is_active;

-- 把现有 /logistics 的货代查看指向新路由
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.forwarder.view','logistics','forwarder','view','货代查看','View forwarder','G6','high','route','/forwarder',true) on conflict (key) do update set module=excluded.module, resource=excluded.resource, action=excluded.action, name=excluded.name, name_en=excluded.name_en, group_code=excluded.group_code, risk_level=excluded.risk_level, scope_type=excluded.scope_type, scope_ref=excluded.scope_ref, is_active=excluded.is_active;

-- ─────────────────────────────────────────────────────────────────────
-- §14 · 视图：货代可用态一览（授权态 + 仓库数 + 渠道数 + 配对率）
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_forwarder_readiness AS
SELECT f.id AS forwarder_id, f.user_id, f.name, f.code, f.auth_state, f.city,
       a.protocol, a.auth_state AS auth_state_real, a.available_state, a.unavailable_reason,
       (SELECT count(*) FROM public.forwarder_warehouses w WHERE w.forwarder_id = f.id) AS warehouse_count,
       (SELECT count(*) FROM public.logistics_channels c WHERE c.forwarder_id = f.id AND c.deleted_at IS NULL) AS channel_count,
       (SELECT count(*) FROM public.forwarder_sku_mappings m WHERE m.forwarder_id = f.id AND m.status = 'mapped') AS mapped_sku_count,
       (SELECT count(*) FROM public.forwarder_sku_mappings m WHERE m.forwarder_id = f.id) AS total_sku_count
  FROM public.freight_forwarders f
  LEFT JOIN public.forwarder_auths a ON a.forwarder_id = f.id AND a.user_id = f.user_id
 WHERE f.is_deleted = false;

COMMENT ON VIEW public.v_forwarder_readiness IS
  '货代接入就绪度：授权态/可用态/仓库数/渠道数/SKU 配对率一次看全，列表页与"能否推单"判定共用。';

-- ---------------------------------------------------------------------
-- 11. 对账 / 费用拉取三条策略规则的落位（2026-11-17 第五轮补）
--     来源：店小秘「费用对账」的三条实测规则，fw04 交付时问"这三条放哪张表"。
--     判定依据（不是一次性都塞进开关表）：
--       ①「费用 N 天内可被系统自动覆盖更新」②「账单只能导 N 天内的」
--         → 租户/店铺级**策略旋钮**，与已有的 retry_max / dedupe_window_hours 同类
--         → fulfillment_switches（scope 粒度已经现成）。
--       ③「哪些渠道支持自动拉费用」
--         → 这是**渠道自身能力**，不是租户开关。若把渠道 id 数组塞进 switches，
--           渠道删除后数组里留脏引用且无法用 FK 约束，读侧还得在应用里过滤——
--           所以放 logistics_channels.auto_fee_fetch，
--           "白名单" = `WHERE auto_fee_fetch`，天然跟着渠道生命周期走。
--     0 的语义：两个 *_days 字段取 0 = 不限制（不是"关掉"，关掉用 false 表达）。
--     幂等：ADD COLUMN IF NOT EXISTS；CHECK 块同时兜 duplicate_object（42710）
--           和 duplicate_table（42P07）—— 后者是本轮学到的：ADD CONSTRAINT 建的
--           对象若重名，PG 报的 SQLSTATE 取决于它顺带创建了什么，不能只接一个。
-- ---------------------------------------------------------------------
ALTER TABLE public.fulfillment_switches
  ADD COLUMN IF NOT EXISTS fee_auto_update_days  integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS bill_import_max_days  integer NOT NULL DEFAULT 120;

DO $q$ BEGIN
  ALTER TABLE public.fulfillment_switches
    ADD CONSTRAINT fulfillment_switches_fee_window_ck
    CHECK (fee_auto_update_days BETWEEN 0 AND 90
           AND bill_import_max_days   BETWEEN 0 AND 365);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $q$;

COMMENT ON COLUMN public.fulfillment_switches.fee_auto_update_days IS
  '费用自动覆盖窗口（天）：货代回传/账单导入的实际费用只允许覆盖 N 天内的预估费用，超期只记差异不改动原流水。0=不限制。对齐店小秘"7 天内自动更新费用"。';
COMMENT ON COLUMN public.fulfillment_switches.bill_import_max_days IS
  '账单导入时限（天）：账期/费用发生日早于 now()-N 天的行拒绝导入（进导入批次失败明细，不静默丢弃）。0=不限制。对齐店小秘"只能导 120 天内账单"。';

ALTER TABLE public.logistics_channels
  ADD COLUMN IF NOT EXISTS auto_fee_fetch boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.logistics_channels.auto_fee_fetch IS
  '该渠道是否支持系统自动拉取实际费用（能力位，非租户开关）。true 的渠道才进"自动费用白名单"，M4 的定时拉费用与 fw04 billing_lines 来源判定读这一列。';

-- =====================================================================
-- 本迁移对象清单
--   改造表 4：freight_forwarders(+17 列) / forwarder_catalog(+4 列) /
--             logistics_channels(+15 列, 含 auto_fee_fetch) / parcels,waybills,shipments,shipping_tasks(+FK 约束)
--   新建表 7：forwarder_auths, forwarder_warehouses, forwarder_sku_mappings,
--             warehouse_inventory, inventory_adjustments, fulfillment_switches, push_error_codes
--   新建函数 1：touch_forwarder_updated_at
--   新建触发器 6：各表 updated_at 维护
--   新建视图 1：v_forwarder_readiness
--   新建索引 14（含 4 个 GIN）
--   权限点 14（logistics.warehouse.* 4 / forwarder_auth.* 3 / sku_mapping.* 2 /
--              inventory.* 2 / switch.* 2 / forwarder.view 路由改指向 1）
--   字典数据 18 条 push_error_codes
--   数据修复 2 处（B1 i18n key 回填、B4 catalog 打标）
-- =====================================================================
