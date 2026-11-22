-- =====================================================================
-- zz_20261117_fw03_rate_tracking.sql   （M3 · 报价 + 轨迹）
--
-- 本迁移解决什么问题：
--   1) 报价存不下真实价卡。现网 public.shipping_quotes 只有
--      carrier/channel/price/currency/days/features/recommended，一行一个价，
--      连"首重 100g 5 元、续重每 100g 3 元"这种最基础的挂号+续重结构都表达不了
--      （设计稿 §3.3）。改为版本化三表：
--      rate_cards（卡 + version + 生效区间 + 计泡/计费重规则）
--      → rate_zones（国家 / 国家+邮编 / 国家+城市 / 邮编前缀 / 固定 五类分区）
--      → rate_bands（重量段：首重+续重、阶梯一口价、最低消费）。
--   2) 轨迹没有订阅主体。现网轨迹只有 shipments.tracking_events(jsonb) +
--      tracking_status + tracking_last_check 三个字段，无法表达设计稿 §3.5
--      照抄领星的停止规则：签收成功停止、可能异常超 48h 停止自动更新、
--      "已添加不可重复添加"、下次该查谁（next_check_at）、查了几次（check_count）。
--      新增 tracking_subscriptions（订阅主体 + 调度游标）与 tracking_events（轨迹明细）。
--   3) 平台标发缺映射。出口要回填平台 Carrier + 单号类型（final/logistics/none），
--      库里没有任何映射表 → 新增 platform_carrier_mappings。
--
-- 现场证据（2026-11-17，全部为只读查询 information_schema / pg_tables）：
--   - public.shipments 现有 13 列（id, user_id, tracking_no, carrier, destination, status,
--     tracking_events, origin, created_at, updated_at, order_id, tracking_status,
--     tracking_last_check）；不存在任何轨迹订阅表。
--   - pg_tables 中不存在 rate_cards / rate_zones / rate_bands / tracking_subscriptions /
--     tracking_events / platform_carrier_mappings → 本文件只新建，不动任何既有表。
--   - public.logistics_channels 已存在（id uuid pk, name, carrier, status）→ 可直接作
--     rate_cards.channel_id 的外键目标。
--   - public.forwarder_warehouses 尚未创建（由 fw01 建）→ rate_cards.warehouse_id 外键走
--     DO 块，fw01 缺席时打 [跳过外键] NOTICE，不中断整条迁移。
--
-- 本文件只做这六件事：
--   A 报价三表（rate_cards / rate_zones / rate_bands）+ 版本化铁律触发器
--   B 邮编匹配函数 postal_pattern_match() + 试算函数 calc_freight_quote()
--   C 轨迹两表（tracking_subscriptions / tracking_events）+ 停止更新字段
--   D 平台承运商映射表 platform_carrier_mappings
--   E 视图 v_tracking_stale（供 cron 捞"未停止且到期"的订阅）
--   F 上述 6 张表的 RLS 策略 + logistics.rate/tracking/carrier_mapping 权限点 seed
--
-- 明确不做：不改 shipping_quotes / shipments / parcels / logistics_channels 的任何一列
--   （那些属 fw01/fw02 职责）；不写任何 UPDATE / DELETE / TRUNCATE 数据修复语句；
--   不接 17track / track123 / aftership 外部 API（属应用层 EF）。
--
-- 铁律（设计稿 §3.3，落地在触发器里，见 §2/§4/§5）：
--   报价卡一旦 active，禁止原地改价：channel/warehouse/calc_mode/计费重规则/currency/
--   min_fee/effective_from/effective_to/version 一律不可改，分区与重量段不可增删改，
--   改价必须新建 version+1 并给新的 effective_from；只允许改 status 做 supersede/retire。
--   历史货件靠 shipments.rate_snapshot_id（fw02）指向当时那一版，不受新版本影响。
--
-- 幂等性：CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE FUNCTION /
--   CREATE INDEX IF NOT EXISTS / DROP POLICY IF EXISTS + CREATE POLICY /
--   DROP TRIGGER IF EXISTS + CREATE TRIGGER；外键与 CHECK/UNIQUE 约束全部用 DO 块
--   吞 duplicate_object（外键另吞 undefined_table）。可整文件重复执行且不产生重复对象。
-- =====================================================================

SET search_path = public;

-- ─── 1. rate_cards 报价卡（版本化 + 生效区间） ───────────────────────
CREATE TABLE IF NOT EXISTS public.rate_cards (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL,
  channel_id           uuid NOT NULL,
  warehouse_id         uuid,
  name                 text NOT NULL,
  version              integer NOT NULL DEFAULT 1,
  currency             text NOT NULL DEFAULT 'CNY',
  calc_mode            text NOT NULL DEFAULT 'first_increment',
  volumetric_divisor   numeric(8,4),
  weight_unit          text NOT NULL DEFAULT 'g',
  billing_weight_rule  text NOT NULL DEFAULT 'max_actual_volumetric',
  effective_from       date NOT NULL,
  effective_to         date,
  status               text NOT NULL DEFAULT 'draft',
  min_fee              numeric(14,4) NOT NULL DEFAULT 0,
  notes                text,
  created_by           uuid,
  approved_by          uuid,
  approved_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- 外键：channel 必填（报价卡隶属渠道）；warehouse 可空（空=该渠道全局价，非空=仓级价）
DO $q$ BEGIN
  ALTER TABLE public.rate_cards
    ADD CONSTRAINT rate_cards_channel_id_fkey
    FOREIGN KEY (channel_id) REFERENCES public.logistics_channels(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] logistics_channels 表不存在';
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.rate_cards
    ADD CONSTRAINT rate_cards_warehouse_id_fkey
    FOREIGN KEY (warehouse_id) REFERENCES public.forwarder_warehouses(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] forwarder_warehouses 表不存在（fw01 未执行）';
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.rate_cards
    ADD CONSTRAINT rate_cards_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] profiles 表不存在';
END $q$;

-- created_by / approved_by 不建外键：子账号操作人可能只存在于 auth.users，
-- 强行指向 profiles（租户根表）会把合法的操作人写死；仅作展示与审计用。

-- CHECK（显式命名 + DO 块，保证重复执行与后续补列都幂等）
DO $q$ BEGIN
  ALTER TABLE public.rate_cards
    ADD CONSTRAINT rate_cards_calc_mode_ck
    CHECK (calc_mode IN ('first_increment','tiered','flat','volumetric'));
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.rate_cards
    ADD CONSTRAINT rate_cards_billing_weight_rule_ck
    CHECK (billing_weight_rule IN ('max_actual_volumetric','actual','volumetric'));
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.rate_cards
    ADD CONSTRAINT rate_cards_status_ck
    CHECK (status IN ('draft','active','superseded','retired'));
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.rate_cards
    ADD CONSTRAINT rate_cards_weight_unit_ck
    CHECK (weight_unit IN ('g','kg','lb'));
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.rate_cards
    ADD CONSTRAINT rate_cards_effective_ck
    CHECK (effective_to IS NULL OR effective_to >= effective_from);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.rate_cards
    ADD CONSTRAINT rate_cards_version_ck
    CHECK (version >= 1);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.rate_cards
    ADD CONSTRAINT rate_cards_divisor_ck
    CHECK (volumetric_divisor IS NULL OR volumetric_divisor > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.rate_cards
    ADD CONSTRAINT rate_cards_min_fee_ck
    CHECK (min_fee >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

-- 同一渠道、同一生效日、同一版本号唯一（版本化落库的天然去重键）
DO $q$ BEGIN
  ALTER TABLE public.rate_cards
    ADD CONSTRAINT rate_cards_channel_period_version_uk
    UNIQUE (channel_id, effective_from, version);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

CREATE INDEX IF NOT EXISTS rate_cards_user_created_idx
  ON public.rate_cards (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rate_cards_channel_status_idx
  ON public.rate_cards (channel_id, status, effective_from DESC);
CREATE INDEX IF NOT EXISTS rate_cards_warehouse_idx
  ON public.rate_cards (warehouse_id) WHERE warehouse_id IS NOT NULL;

COMMENT ON TABLE public.rate_cards IS '报价卡（版本化）：渠道×仓库维度的价卡主体，active 后不可原地改价，改价走 version+1 新版本';
COMMENT ON COLUMN public.rate_cards.channel_id IS '所属渠道 logistics_channels.id；一张卡只服务一个渠道';
COMMENT ON COLUMN public.rate_cards.warehouse_id IS '货代仓库 forwarder_warehouses.id；NULL=渠道全局价，非空=仓级报价（fw01 建表）';
COMMENT ON COLUMN public.rate_cards.version IS '版本号，改价必新建 version+1；与 (channel_id, effective_from) 共同构成唯一键';
COMMENT ON COLUMN public.rate_cards.calc_mode IS '计费模式：first_increment 首重+续重 / tiered 阶梯一口价 / flat 统一价 / volumetric 计泡（体积重走首重续重公式）';
COMMENT ON COLUMN public.rate_cards.volumetric_divisor IS '计泡除数，口径 cm³/kg（常见 5000/6000/8000）；为空表示不计泡';
COMMENT ON COLUMN public.rate_cards.weight_unit IS '录入口径标注（g/kg/lb）；库内重量一律以克存储，试算入参 p_weight_g 恒为克';
COMMENT ON COLUMN public.rate_cards.billing_weight_rule IS '计费重取法：max_actual_volumetric 实重与体积重取大 / actual 只看实重 / volumetric 只看体积重';
COMMENT ON COLUMN public.rate_cards.effective_from IS '生效起始日（含）；新版本靠它切时间轴，历史单仍指向旧版';
COMMENT ON COLUMN public.rate_cards.effective_to IS '失效日（含），NULL 表示长期有效；必须 >= effective_from';
COMMENT ON COLUMN public.rate_cards.status IS 'draft 草稿 / active 生效中（锁定不可改价）/ superseded 被新版取代 / retired 停用';
COMMENT ON COLUMN public.rate_cards.min_fee IS '卡级最低消费（flat 模式与 flat_price 取大；首重续重模式作为总价下限）';
COMMENT ON COLUMN public.rate_cards.created_by IS '建卡人（可为子账号，不建外键：可能只存在于 auth.users）';
COMMENT ON COLUMN public.rate_cards.approved_by IS '审批人；改价(logistics.rate.edit) 与审批(logistics.rate.approve) 权限分离';

-- ─── 2. 报价卡 active 后不可原地改价（铁律触发器） ───────────────────
CREATE OR REPLACE FUNCTION public.fn_rate_card_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth, extensions
AS $fn$
BEGIN
  -- 运维/服务端角色放行（口径照抄 20261013_invoice_refactor / fix_trigger_searchpath）
  -- 现场发现（2026-11-17 clone 审计）：本项目所有 Edge Function 都用
  -- SUPABASE_SERVICE_ROLE_KEY 建 client（functions/*/index.ts 实测），
  -- 即应用侧写入在数据库里看到的 current_user 恒为 'service_role'。
  -- 一旦把 service_role 放进放行名单，这条铁律守卫在 100% 的应用写入上都是空转，
  -- 只剩"DBA 手工改库"能触发它 —— 等于没有守卫。
  -- 因此守卫只放行真正的库内管理角色；改价/改历史费用行必须走"新建版本 / 打回重审"。
  IF current_user IN ('supabase_admin','postgres') THEN
    RETURN NEW;
  END IF;
  -- 草稿卡随便改；非 active 状态（superseded/retired）也放行，便于纠错
  IF OLD.status <> 'active' THEN
    RETURN NEW;
  END IF;
  -- active 卡：价格结构字段全部冻结，只允许改 status（supersede/retire）与 name/notes/审批列
  IF NEW.channel_id          IS DISTINCT FROM OLD.channel_id
     OR NEW.warehouse_id     IS DISTINCT FROM OLD.warehouse_id
     OR NEW.version          IS DISTINCT FROM OLD.version
     OR NEW.currency         IS DISTINCT FROM OLD.currency
     OR NEW.calc_mode        IS DISTINCT FROM OLD.calc_mode
     OR NEW.volumetric_divisor IS DISTINCT FROM OLD.volumetric_divisor
     OR NEW.weight_unit       IS DISTINCT FROM OLD.weight_unit
     OR NEW.billing_weight_rule IS DISTINCT FROM OLD.billing_weight_rule
     OR NEW.effective_from   IS DISTINCT FROM OLD.effective_from
     OR NEW.effective_to     IS DISTINCT FROM OLD.effective_to
     OR NEW.min_fee          IS DISTINCT FROM OLD.min_fee THEN
    RAISE EXCEPTION '报价卡「%」(id=%, v%) 已生效，禁止原地改价：请新建 version=% 并设置新的 effective_from',
      OLD.name, OLD.id, OLD.version, OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_rate_card_immutable ON public.rate_cards;
CREATE TRIGGER trg_rate_card_immutable
  BEFORE UPDATE ON public.rate_cards
  FOR EACH ROW EXECUTE FUNCTION public.fn_rate_card_immutable();

-- updated_at 自动维护（口径照抄基线 listings_touch_updated_at）
CREATE OR REPLACE FUNCTION public.rate_cards_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth, extensions
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_rate_cards_updated_at ON public.rate_cards;
CREATE TRIGGER trg_rate_cards_updated_at
  BEFORE UPDATE ON public.rate_cards
  FOR EACH ROW EXECUTE FUNCTION public.rate_cards_touch_updated_at();

-- ─── 3. rate_zones 报价分区 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rate_zones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_card_id    uuid NOT NULL,
  user_id         uuid NOT NULL,
  name            text NOT NULL,
  countries       text[],
  postal_patterns text[],
  cities          text[],
  zone_type       text NOT NULL DEFAULT 'country',
  priority        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

DO $q$ BEGIN
  ALTER TABLE public.rate_zones
    ADD CONSTRAINT rate_zones_rate_card_id_fkey
    FOREIGN KEY (rate_card_id) REFERENCES public.rate_cards(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] rate_cards 表不存在';
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.rate_zones
    ADD CONSTRAINT rate_zones_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] profiles 表不存在';
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.rate_zones
    ADD CONSTRAINT rate_zones_zone_type_ck
    CHECK (zone_type IN ('country','country_postal','country_city','postal_prefix','fixed'));
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.rate_zones
    ADD CONSTRAINT rate_zones_priority_ck
    CHECK (priority >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

CREATE INDEX IF NOT EXISTS rate_zones_card_priority_idx
  ON public.rate_zones (rate_card_id, zone_type, priority DESC);
CREATE INDEX IF NOT EXISTS rate_zones_user_created_idx
  ON public.rate_zones (user_id, created_at DESC);

COMMENT ON TABLE public.rate_zones IS '报价分区：按 国家 / 国家+邮编 / 国家+城市 / 邮编前缀 / 固定 五种维度圈定适用范围';
COMMENT ON COLUMN public.rate_zones.countries IS '国家码数组（ISO-2，如 {CN,TH,BR}）；匹配时大小写不敏感';
COMMENT ON COLUMN public.rate_zones.postal_patterns IS '邮编规则数组，支持三种写法：纯前缀（"500"、"SW1A"）、通配（"0100*"）、数字区间（"01000-05999"）';
COMMENT ON COLUMN public.rate_zones.cities IS '城市名数组；仅 country_city 维度参与匹配，大小写不敏感';
COMMENT ON COLUMN public.rate_zones.zone_type IS '分区维度；命中优先级 country_city > country_postal > postal_prefix > country > fixed';
COMMENT ON COLUMN public.rate_zones.priority IS '同维度内的手工优先级，数值大者优先；用于覆盖式特例分区';
COMMENT ON COLUMN public.rate_zones.user_id IS '冗余租户列（与父卡一致），RLS 与列表过滤用';

-- ─── 4. rate_bands 重量段 ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rate_bands (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id        uuid NOT NULL,
  user_id        uuid NOT NULL,
  weight_from_g  numeric(12,3) NOT NULL,
  weight_to_g    numeric(12,3) NOT NULL,
  reg_fee        numeric(14,4),
  inc_fee        numeric(14,4),
  inc_unit_g     numeric(12,3) NOT NULL DEFAULT 1000,
  flat_price     numeric(14,4),
  min_fee        numeric(14,4),
  currency       text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

DO $q$ BEGIN
  ALTER TABLE public.rate_bands
    ADD CONSTRAINT rate_bands_zone_id_fkey
    FOREIGN KEY (zone_id) REFERENCES public.rate_zones(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] rate_zones 表不存在';
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.rate_bands
    ADD CONSTRAINT rate_bands_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] profiles 表不存在';
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.rate_bands
    ADD CONSTRAINT rate_bands_weight_range_ck
    CHECK (weight_to_g > weight_from_g AND weight_from_g >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.rate_bands
    ADD CONSTRAINT rate_bands_inc_unit_ck
    CHECK (inc_unit_g > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.rate_bands
    ADD CONSTRAINT rate_bands_fee_nonneg_ck
    CHECK ((reg_fee IS NULL OR reg_fee >= 0)
           AND (inc_fee IS NULL OR inc_fee >= 0)
           AND (flat_price IS NULL OR flat_price >= 0)
           AND (min_fee IS NULL OR min_fee >= 0));
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.rate_bands
    ADD CONSTRAINT rate_bands_zone_weight_uk
    UNIQUE (zone_id, weight_from_g);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

CREATE INDEX IF NOT EXISTS rate_bands_zone_weight_idx
  ON public.rate_bands (zone_id, weight_to_g);
CREATE INDEX IF NOT EXISTS rate_bands_user_created_idx
  ON public.rate_bands (user_id, created_at DESC);

COMMENT ON TABLE public.rate_bands IS '重量段：一条 = 一个计费重量区间，承载 首重+续重 / 阶梯一口价 / 最低消费 三类价格';
COMMENT ON COLUMN public.rate_bands.weight_from_g IS '区间下界（不含，克）；首重段一般填首重克数（如 100），不足首重的计费重也按本段算（见 calc_freight_quote 注释）';
COMMENT ON COLUMN public.rate_bands.weight_to_g IS '区间上界（含，克）；必须 > weight_from_g';
COMMENT ON COLUMN public.rate_bands.reg_fee IS '首重费（first_increment/volumetric 模式用）';
COMMENT ON COLUMN public.rate_bands.inc_fee IS '续重单价（每 inc_unit_g 克收一次）';
COMMENT ON COLUMN public.rate_bands.inc_unit_g IS '续重单位（克），默认 1000；必须 > 0 以免除零';
COMMENT ON COLUMN public.rate_bands.flat_price IS '一口价（tiered/flat 模式用）';
COMMENT ON COLUMN public.rate_bands.min_fee IS '段级最低消费，优先于卡级 min_fee';
COMMENT ON COLUMN public.rate_bands.currency IS '币种覆盖，NULL 表示沿用卡级 currency';

-- ─── 5. active 卡的分区/重量段不可增删改（铁律触发器） ───────────────
CREATE OR REPLACE FUNCTION public.fn_rate_zones_locked()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth, extensions
AS $fn$
DECLARE
  v_status text;
  v_card   uuid;
BEGIN
  -- 现场发现（2026-11-17 clone 审计）：本项目所有 Edge Function 都用
  -- SUPABASE_SERVICE_ROLE_KEY 建 client（functions/*/index.ts 实测），
  -- 即应用侧写入在数据库里看到的 current_user 恒为 'service_role'。
  -- 一旦把 service_role 放进放行名单，这条铁律守卫在 100% 的应用写入上都是空转，
  -- 只剩"DBA 手工改库"能触发它 —— 等于没有守卫。
  -- 因此守卫只放行真正的库内管理角色；改价/改历史费用行必须走"新建版本 / 打回重审"。
  IF current_user IN ('supabase_admin','postgres') THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  -- DELETE 时 NEW 是空记录，取字段必须按 TG_OP 分支，不能 COALESCE(NEW.x, OLD.x)
  IF TG_OP = 'DELETE' THEN
    v_card := OLD.rate_card_id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_card := NEW.rate_card_id;
    -- 也要阻止把分区从已生效的卡里"搬走"
    SELECT rc.status INTO v_status
      FROM public.rate_cards rc WHERE rc.id = OLD.rate_card_id;
    IF v_status = 'active' THEN
      RAISE EXCEPTION '报价卡已生效（status=active），分区不可改挂到别的报价卡：请新建 version+1';
    END IF;
  ELSE
    v_card := NEW.rate_card_id;
  END IF;

  SELECT rc.status INTO v_status
    FROM public.rate_cards rc WHERE rc.id = v_card;
  IF v_status = 'active' THEN
    RAISE EXCEPTION '报价卡已生效（status=active），分区不可增删改；改价请新建 version+1（先建 draft 卡再配分区）';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_rate_zones_locked ON public.rate_zones;
CREATE TRIGGER trg_rate_zones_locked
  BEFORE INSERT OR UPDATE OR DELETE ON public.rate_zones
  FOR EACH ROW EXECUTE FUNCTION public.fn_rate_zones_locked();

CREATE OR REPLACE FUNCTION public.fn_rate_bands_locked()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth, extensions
AS $fn$
DECLARE
  v_status text;
  v_zone   uuid;
BEGIN
  -- 现场发现（2026-11-17 clone 审计）：本项目所有 Edge Function 都用
  -- SUPABASE_SERVICE_ROLE_KEY 建 client（functions/*/index.ts 实测），
  -- 即应用侧写入在数据库里看到的 current_user 恒为 'service_role'。
  -- 一旦把 service_role 放进放行名单，这条铁律守卫在 100% 的应用写入上都是空转，
  -- 只剩"DBA 手工改库"能触发它 —— 等于没有守卫。
  -- 因此守卫只放行真正的库内管理角色；改价/改历史费用行必须走"新建版本 / 打回重审"。
  IF current_user IN ('supabase_admin','postgres') THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  -- DELETE 时 NEW 为空记录，必须按 TG_OP 取值，不能 COALESCE(NEW.x, OLD.x)
  IF TG_OP = 'DELETE' THEN
    v_zone := OLD.zone_id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_zone := NEW.zone_id;
    -- 也要阻止把段从已生效的卡里"搬走"
    SELECT rc.status INTO v_status
      FROM public.rate_zones z
      JOIN public.rate_cards rc ON rc.id = z.rate_card_id
     WHERE z.id = OLD.zone_id;
    IF v_status = 'active' THEN
      RAISE EXCEPTION '报价卡已生效（status=active），重量段不可改挂到别的分区：请新建 version+1';
    END IF;
  ELSE
    v_zone := NEW.zone_id;
  END IF;

  SELECT rc.status INTO v_status
    FROM public.rate_zones z
    JOIN public.rate_cards rc ON rc.id = z.rate_card_id
   WHERE z.id = v_zone;
  IF v_status = 'active' THEN
    RAISE EXCEPTION '报价卡已生效（status=active），重量段不可增删改；改价请新建 version+1（导入只能改价、不能改国家与重量段——设计稿 §3.3）';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_rate_bands_locked ON public.rate_bands;
CREATE TRIGGER trg_rate_bands_locked
  BEFORE INSERT OR UPDATE OR DELETE ON public.rate_bands
  FOR EACH ROW EXECUTE FUNCTION public.fn_rate_bands_locked();

-- ─── 6. 邮编规则匹配函数 ────────────────────────────────────────────
-- 支持三种写法（设计稿 §3.3 店小秘口径：纯数字 / 区间 / 含字母固定前缀）：
--   前缀      "500"        → 邮编以 500 开头（"500000"、"5001" 命中）
--   通配      "0100*"      → 去掉尾部 * 后按前缀匹配
--   数字区间  "01000-05999"→ 取邮编前导数字段，双方右补 0 对齐到 5 位后做数值 BETWEEN
-- 含字母的区间（如英国 "M1-M20"）本期不支持，会退化成前缀匹配，已在注释中说明。
CREATE OR REPLACE FUNCTION public.postal_pattern_match(p_pattern text, p_postal text)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, auth, extensions
AS $fn$
DECLARE
  v_pat    text;
  v_post   text;
  v_digits text;
  v_lo     text;
  v_hi     text;
BEGIN
  IF p_pattern IS NULL OR p_postal IS NULL THEN
    RETURN false;
  END IF;
  v_pat  := upper(regexp_replace(p_pattern, '\s+', '', 'g'));
  v_post := upper(regexp_replace(p_postal,  '\s+', '', 'g'));
  IF v_pat = '' OR v_post = '' THEN
    RETURN false;
  END IF;

  -- ① 数字区间：01000-05999
  IF v_pat ~ '^[0-9]+-[0-9]+$' THEN
    v_lo := split_part(v_pat, '-', 1);
    v_hi := split_part(v_pat, '-', 2);
    v_digits := (regexp_match(v_post, '^[0-9]+'))[1];
    IF v_digits IS NULL THEN
      RETURN false;
    END IF;
    -- 对齐到 5 位（右补 0）后按数值比较：'500' → 50000，邮编 '05123' → 5123
    v_digits := rpad(left(v_digits, 5), 5, '0');
    v_lo := rpad(left(v_lo, 5), 5, '0');
    v_hi := rpad(left(v_hi, 5), 5, '0');
    RETURN v_digits::numeric BETWEEN v_lo::numeric AND v_hi::numeric;
  END IF;

  -- ② 通配前缀：0100* / 0100%
  IF v_pat ~ '[*%]$' THEN
    v_pat := rtrim(v_pat, '*%');
    IF v_pat = '' THEN
      RETURN true;
    END IF;
    RETURN left(v_post, length(v_pat)) = v_pat;
  END IF;

  -- ③ 固定前缀（纯数字或含字母）：500 / SW1A / 100000
  RETURN left(v_post, length(v_pat)) = v_pat;
END;
$fn$;

COMMENT ON FUNCTION public.postal_pattern_match(text, text) IS '邮编规则匹配：前缀 / 通配* / 数字区间三种写法；报价分区 rate_zones.postal_patterns 使用';

-- ─── 7. 试算函数 calc_freight_quote（只读、SECURITY INVOKER、STABLE） ─
-- 单位换算（务必按此录价）：
--   * p_weight_g：实际重量，单位克（rate_cards.weight_unit 只是录入口径标注，库内一律克）。
--   * p_length / p_width / p_height：边长，单位厘米 cm（现网 parcels.length/width/height 为整型 cm）。
--   * volumetric_divisor：计泡除数，口径 cm³/kg（行业常见 5000/6000/8000）。
--       体积重(kg) = 长(cm) × 宽(cm) × 高(cm) ÷ divisor
--       体积重(g)  = 体积重(kg) × 1000         ← 本函数返回的 charged_weight_g 为克
--   * 计费重 charged_weight_g：按 billing_weight_rule 取
--       max_actual_volumetric → GREATEST(实重, 体积重)（缺 divisor 或尺寸则退化为实重）
--       actual                → 实重
--       volumetric            → 体积重
--     calc_mode='volumetric' 时强制使用体积重（并走首重+续重公式）。
-- 分区命中优先级：country_city > country_postal > postal_prefix > country > fixed，
--   同维度内按 rate_zones.priority DESC，再按 id 保证结果稳定。
-- 重量段命中：取「weight_to_g >= 计费重」中最小的那一段（右闭）。
--   计费重不足最小段下界时也落到该段，公式 max(0, 计费重 - weight_from_g) 使续重为 0
--   → 自然实现"不足首重按首重计"。计费重超出所有段上限 → matched=false。
-- 费用公式：
--   first_increment / volumetric：base = reg_fee
--                                 inc  = CEIL(max(0, 计费重 - weight_from_g) / inc_unit_g) * inc_fee
--                                 total = GREATEST(base + inc, COALESCE(段级 min_fee, 卡级 min_fee, 0))
--   tiered：total = GREATEST(flat_price, 段级 min_fee)
--   flat  ：total = GREATEST(flat_price, 卡级 min_fee)
-- 匹配不到分区 → fail_reason 以「无匹配分区」开头（设计稿 §4.4 失败码表要求可判定）。
-- 本函数只读：不 INSERT/UPDATE/DELETE 任何表；SECURITY INVOKER 让调用者的 RLS 生效，
--   跨租户拿不到别人的卡；STABLE 标记供查询规划器在单语句内复用。
CREATE OR REPLACE FUNCTION public.calc_freight_quote(
  p_rate_card_id uuid,
  p_country      text,
  p_postal       text   DEFAULT NULL,
  p_city         text   DEFAULT NULL,
  p_weight_g     numeric DEFAULT NULL,
  p_length       numeric DEFAULT NULL,
  p_width        numeric DEFAULT NULL,
  p_height       numeric DEFAULT NULL
)
RETURNS TABLE(
  channel_id        uuid,
  channel_name      text,
  carrier           text,
  zone_name         text,
  charged_weight_g  numeric,
  base_fee          numeric,
  inc_fee           numeric,
  total_fee         numeric,
  currency          text,
  rate_card_version integer,
  matched           boolean,
  fail_reason       text
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, auth, extensions
AS $fn$
DECLARE
  v_card        public.rate_cards%ROWTYPE;
  v_band        public.rate_bands%ROWTYPE;
  v_country     text := lower(btrim(coalesce(p_country, '')));
  v_postal      text := upper(regexp_replace(coalesce(p_postal, ''), '\s+', '', 'g'));
  v_city        text := lower(btrim(coalesce(p_city, '')));
  v_vol_g       numeric := 0;
  v_charge_g    numeric;
  v_zone_id     uuid;
  v_zone_name   text;
  v_zone_type   text;
  v_channel_id  uuid;
  v_channel_name text;
  v_carrier     text;
  v_currency    text;
  v_unit        numeric;
  v_floor       numeric;
  v_base        numeric;
  v_inc         numeric;
  v_total       numeric;
  v_reason      text;
BEGIN
  SELECT * INTO v_card
    FROM public.rate_cards
   WHERE id = p_rate_card_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      CAST(NULL AS uuid), CAST(NULL AS text), CAST(NULL AS text), CAST(NULL AS text),
      CAST(NULL AS numeric), CAST(NULL AS numeric), CAST(NULL AS numeric), CAST(NULL AS numeric),
      CAST(NULL AS text), CAST(NULL AS integer), CAST(false AS boolean),
      CAST('报价卡不存在（rate_cards.id=' || coalesce(p_rate_card_id::text, 'NULL') || '）' AS text);
    RETURN;
  END IF;

  v_channel_id := v_card.channel_id;
  v_currency   := v_card.currency;

  SELECT lc.name, lc.carrier INTO v_channel_name, v_carrier
    FROM public.logistics_channels lc
   WHERE lc.id = v_card.channel_id;

  -- ① 状态与生效期
  IF v_card.status IN ('superseded','retired') THEN
    v_reason := '报价卡已失效（status=' || v_card.status || '），请改用新版本';
  ELSIF current_date < v_card.effective_from
     OR (v_card.effective_to IS NOT NULL AND current_date > v_card.effective_to) THEN
    v_reason := '报价卡不在生效区间（' || v_card.effective_from::text
                || ' ~ ' || coalesce(v_card.effective_to::text, '长期') || '，今天 '
                || current_date::text || '）';
  END IF;

  -- ② 体积重与计费重
  IF v_reason IS NULL THEN
    IF coalesce(p_weight_g, 0) <= 0 THEN
      v_reason := '计费重量缺失（p_weight_g 必须 > 0，单位克）';
    ELSIF v_card.calc_mode = 'volumetric'
      AND coalesce(v_card.volumetric_divisor, 0) <= 0 THEN
      v_reason := '报价卡 calc_mode=volumetric 但未配置 volumetric_divisor，无法计泡';
    END IF;
  END IF;

  IF v_reason IS NULL THEN
    IF coalesce(p_length, 0) > 0 AND coalesce(p_width, 0) > 0 AND coalesce(p_height, 0) > 0
       AND coalesce(v_card.volumetric_divisor, 0) > 0 THEN
      v_vol_g := ROUND(p_length * p_width * p_height / v_card.volumetric_divisor * 1000, 3);
    END IF;

    IF v_card.calc_mode = 'volumetric' THEN
      v_charge_g := v_vol_g;
    ELSIF v_card.billing_weight_rule = 'actual' THEN
      v_charge_g := p_weight_g;
    ELSIF v_card.billing_weight_rule = 'volumetric' THEN
      v_charge_g := v_vol_g;
    ELSE
      v_charge_g := GREATEST(coalesce(p_weight_g, 0), v_vol_g);
    END IF;

    IF coalesce(v_charge_g, 0) <= 0 THEN
      v_reason := '计费重为 0（体积重未算出且实重为 0），请检查尺寸或 volumetric_divisor';
    END IF;
  END IF;

  -- ③ 分区命中（先算三个布尔，再按维度优先级排序）
  IF v_reason IS NULL THEN
    WITH z AS (
      SELECT zz.id, zz.name, zz.zone_type, coalesce(zz.priority, 0) AS priority,
             EXISTS (SELECT 1 FROM unnest(zz.countries) AS c(code)
                      WHERE lower(btrim(c.code)) = v_country) AS country_ok,
             EXISTS (SELECT 1 FROM unnest(zz.postal_patterns) AS pp(pattern)
                      WHERE public.postal_pattern_match(pp.pattern, v_postal)) AS postal_ok,
             EXISTS (SELECT 1 FROM unnest(zz.cities) AS ct(name)
                      WHERE lower(btrim(ct.name)) = v_city) AS city_ok
        FROM public.rate_zones zz
       WHERE zz.rate_card_id = p_rate_card_id
    )
    SELECT z.id, z.name, z.zone_type INTO v_zone_id, v_zone_name, v_zone_type
      FROM z
     WHERE (z.zone_type = 'fixed')
        OR (z.zone_type = 'country'       AND v_country <> '' AND z.country_ok)
        OR (z.zone_type = 'country_city'  AND v_country <> '' AND z.country_ok AND v_city  <> '' AND z.city_ok)
        OR (z.zone_type = 'country_postal' AND v_country <> '' AND z.country_ok AND v_postal <> '' AND z.postal_ok)
        OR (z.zone_type = 'postal_prefix' AND v_postal <> '' AND z.postal_ok)
     ORDER BY (CASE z.zone_type
                 WHEN 'country_city'    THEN 5
                 WHEN 'country_postal'  THEN 4
                 WHEN 'postal_prefix'   THEN 3
                 WHEN 'country'         THEN 2
                 WHEN 'fixed'           THEN 1
                 ELSE 0
               END) DESC,
              z.priority DESC,
              z.id
     LIMIT 1;

    IF v_zone_id IS NULL THEN
      v_reason := '无匹配分区（国家=' || coalesce(nullif(v_country, ''), '空')
                  || '，邮编=' || coalesce(nullif(v_postal, ''), '空')
                  || '，城市=' || coalesce(nullif(v_city, ''), '空')
                  || '；请检查 rate_zones 配置）';
    END IF;
  END IF;

  -- ④ 重量段命中
  IF v_reason IS NULL THEN
    SELECT * INTO v_band
      FROM public.rate_bands b
     WHERE b.zone_id = v_zone_id
       AND v_charge_g <= b.weight_to_g
     ORDER BY b.weight_to_g ASC, b.weight_from_g ASC
     LIMIT 1;

    IF NOT FOUND THEN
      v_reason := '无匹配重量段（计费重 ' || ROUND(v_charge_g, 3)::text
                  || 'g 超出分区「' || v_zone_name || '」所有重量段上限）';
    ELSE
      v_currency := coalesce(nullif(v_band.currency, ''), v_card.currency);
    END IF;
  END IF;

  -- ⑤ 费用计算
  IF v_reason IS NULL THEN
    v_unit := coalesce(v_band.inc_unit_g, 1000);
    IF v_unit <= 0 THEN
      v_unit := 1000;
    END IF;
    v_floor := coalesce(v_band.min_fee, v_card.min_fee, 0);

    IF v_card.calc_mode = 'tiered' THEN
      v_base  := coalesce(v_band.flat_price, 0);
      v_inc   := 0;
      v_total := GREATEST(v_base, coalesce(v_band.min_fee, 0));
    ELSIF v_card.calc_mode = 'flat' THEN
      -- flat：卡级 min_fee 与 flat_price 取大
      v_base  := GREATEST(coalesce(v_band.flat_price, 0), coalesce(v_card.min_fee, 0));
      v_inc   := 0;
      v_total := v_base;
    ELSE
      -- first_increment / volumetric：首重 + 续重（不足首重按首重计）
      v_base  := coalesce(v_band.reg_fee, 0);
      v_inc   := CEIL(GREATEST(0, v_charge_g - coalesce(v_band.weight_from_g, 0)) / v_unit)
                 * coalesce(v_band.inc_fee, 0);
      v_total := GREATEST(v_base + v_inc, v_floor);
    END IF;

    v_base  := ROUND(v_base, 4);
    v_inc   := ROUND(v_inc, 4);
    v_total := ROUND(v_total, 4);
  END IF;

  RETURN QUERY SELECT
    CAST(v_channel_id AS uuid),
    CAST(v_channel_name AS text),
    CAST(v_carrier AS text),
    CAST(CASE WHEN v_reason IS NULL THEN v_zone_name END AS text),
    CAST(v_charge_g AS numeric),
    CAST(CASE WHEN v_reason IS NULL THEN v_base END AS numeric),
    CAST(CASE WHEN v_reason IS NULL THEN v_inc END AS numeric),
    CAST(CASE WHEN v_reason IS NULL THEN v_total END AS numeric),
    CAST(v_currency AS text),
    CAST(v_card.version AS integer),
    CAST(v_reason IS NULL AS boolean),
    CAST(v_reason AS text);
END;
$fn$;

COMMENT ON FUNCTION public.calc_freight_quote(uuid, text, text, text, numeric, numeric, numeric, numeric) IS '运费试算（只读 STABLE SECURITY INVOKER）：按报价卡分区+重量段算计费重/首重/续重/总价，返回 matched=false 时 fail_reason 必非空';

-- ─── 8. tracking_subscriptions 轨迹订阅 ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.tracking_subscriptions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL,
  shipment_id        uuid,
  provider           text NOT NULL DEFAULT '17track',
  tracking_no        text NOT NULL,
  carrier_code       text,
  carrier_confirmed  boolean NOT NULL DEFAULT false,
  status             text,
  sub_status         text NOT NULL DEFAULT 'pending',
  online_at          timestamptz,
  delivered_at       timestamptz,
  stop_reason        text NOT NULL DEFAULT 'none',
  last_check_at      timestamptz,
  next_check_at      timestamptz,
  check_count        integer NOT NULL DEFAULT 0,
  error_count        integer NOT NULL DEFAULT 0,
  raw                jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

DO $q$ BEGIN
  ALTER TABLE public.tracking_subscriptions
    ADD CONSTRAINT tracking_subscriptions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] profiles 表不存在';
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.tracking_subscriptions
    ADD CONSTRAINT tracking_subscriptions_shipment_id_fkey
    FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] shipments 表不存在';
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.tracking_subscriptions
    ADD CONSTRAINT tracking_subscriptions_provider_ck
    CHECK (provider IN ('17track','track123','aftership','manual'));
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.tracking_subscriptions
    ADD CONSTRAINT tracking_subscriptions_sub_status_ck
    CHECK (sub_status IN ('pending','subscribed','paused','stopped','removed'));
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.tracking_subscriptions
    ADD CONSTRAINT tracking_subscriptions_stop_reason_ck
    CHECK (stop_reason IN ('delivered','exception_timeout','no_info','removed','none'));
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.tracking_subscriptions
    ADD CONSTRAINT tracking_subscriptions_counter_ck
    CHECK (check_count >= 0 AND error_count >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

-- 「已添加不可重复添加」（设计稿 §3.5 照抄领星）
DO $q$ BEGIN
  ALTER TABLE public.tracking_subscriptions
    ADD CONSTRAINT tracking_subscriptions_user_no_provider_uk
    UNIQUE (user_id, tracking_no, provider);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

CREATE INDEX IF NOT EXISTS tracking_subscriptions_user_created_idx
  ON public.tracking_subscriptions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tracking_subscriptions_user_next_idx
  ON public.tracking_subscriptions (user_id, next_check_at);
-- cron 扫描主力：只索引"还没停止更新"的订阅
CREATE INDEX IF NOT EXISTS tracking_subscriptions_next_open_idx
  ON public.tracking_subscriptions (status, next_check_at)
  WHERE stop_reason = 'none';
CREATE INDEX IF NOT EXISTS tracking_subscriptions_shipment_idx
  ON public.tracking_subscriptions (shipment_id) WHERE shipment_id IS NOT NULL;

COMMENT ON TABLE public.tracking_subscriptions IS '轨迹订阅主体（外包聚合商，不自建轨迹库）：唯一键 (user_id, tracking_no, provider) 实现"已添加不可重复添加"，next_check_at/stop_reason 承载停止更新规则';
COMMENT ON COLUMN public.tracking_subscriptions.provider IS '轨迹来源：17track / track123 / aftership / manual（手工录入不做自动刷新）';
COMMENT ON COLUMN public.tracking_subscriptions.tracking_no IS '运单号；与 user_id+provider 组成唯一键';
COMMENT ON COLUMN public.tracking_subscriptions.carrier_code IS '聚合商识别的承运商 code';
COMMENT ON COLUMN public.tracking_subscriptions.carrier_confirmed IS 'true=承运商已确认（人工或自动），标发回填平台时以此为准';
COMMENT ON COLUMN public.tracking_subscriptions.status IS '聚合商回传的轨迹状态原文（不在库内做 CHECK 以免新状态写不进）；已知值 NotFound/InTransit/Available/Expired/DeliveryFailed 等';
COMMENT ON COLUMN public.tracking_subscriptions.sub_status IS '订阅生命周期：pending 待注册 / subscribed 已注册 / paused 暂停 / stopped 已停止 / removed 已移除';
COMMENT ON COLUMN public.tracking_subscriptions.online_at IS '首次上网时间（有第一条轨迹）';
COMMENT ON COLUMN public.tracking_subscriptions.delivered_at IS '妥投时间；写入后应把 stop_reason 置 delivered';
COMMENT ON COLUMN public.tracking_subscriptions.stop_reason IS '停止自动更新原因：delivered 签收 / exception_timeout 可能异常超 48h / no_info 空包平邮无上网信息 / removed 人工移除 / none 仍在更新';
COMMENT ON COLUMN public.tracking_subscriptions.next_check_at IS '下次该刷新时间（cron 依据）；NULL 视为立即可查';
COMMENT ON COLUMN public.tracking_subscriptions.check_count IS '累计查询次数（单次批量上限 200 单，由应用层控制）';
COMMENT ON COLUMN public.tracking_subscriptions.error_count IS '连续技术失败次数（查询异常，与业务异常区分：前者进 push_logs，后者开 work_orders）';
COMMENT ON COLUMN public.tracking_subscriptions.raw IS '聚合商最近一次响应原文，排障与重放用';

CREATE OR REPLACE FUNCTION public.tracking_subscriptions_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth, extensions
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_tracking_subscriptions_updated_at ON public.tracking_subscriptions;
CREATE TRIGGER trg_tracking_subscriptions_updated_at
  BEFORE UPDATE ON public.tracking_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.tracking_subscriptions_touch_updated_at();

-- ─── 9. tracking_events 轨迹明细 ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tracking_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL,
  user_id         uuid NOT NULL,
  event_desc      text,
  event_place     text,
  event_date      timestamptz,
  event_code      text,
  source          text NOT NULL DEFAULT 'provider',
  created_at      timestamptz NOT NULL DEFAULT now()
);

DO $q$ BEGIN
  ALTER TABLE public.tracking_events
    ADD CONSTRAINT tracking_events_subscription_id_fkey
    FOREIGN KEY (subscription_id) REFERENCES public.tracking_subscriptions(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] tracking_subscriptions 表不存在';
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.tracking_events
    ADD CONSTRAINT tracking_events_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] profiles 表不存在';
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.tracking_events
    ADD CONSTRAINT tracking_events_source_ck
    CHECK (source IN ('provider','manual','webhook','import'));
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

CREATE INDEX IF NOT EXISTS tracking_events_sub_date_idx
  ON public.tracking_events (subscription_id, event_date DESC);
CREATE INDEX IF NOT EXISTS tracking_events_user_created_idx
  ON public.tracking_events (user_id, created_at DESC);

COMMENT ON TABLE public.tracking_events IS '轨迹明细：随订阅级联删除；与 shipments.tracking_events(jsonb) 并存，本表是可查询可去重的正规来源';
COMMENT ON COLUMN public.tracking_events.event_desc IS '轨迹描述原文（保留聚合商文案，不做翻译）';
COMMENT ON COLUMN public.tracking_events.event_date IS '轨迹发生时间（带时区；聚合商只给日期时按 UTC 00:00 存）';
COMMENT ON COLUMN public.tracking_events.event_code IS '聚合商状态码（如 InTransit/Delivered），用于判妥投与异常';
COMMENT ON COLUMN public.tracking_events.source IS '来源：provider 拉取 / webhook 推送 / manual 手工补录 / import 导入';

-- ─── 10. platform_carrier_mappings 平台承运商映射 ───────────────────
CREATE TABLE IF NOT EXISTS public.platform_carrier_mappings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL,
  platform          text NOT NULL,
  site              text,
  carrier_code      text NOT NULL,
  carrier_name      text,
  tracking_no_type  text NOT NULL DEFAULT 'final',
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

DO $q$ BEGIN
  ALTER TABLE public.platform_carrier_mappings
    ADD CONSTRAINT platform_carrier_mappings_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] profiles 表不存在';
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.platform_carrier_mappings
    ADD CONSTRAINT platform_carrier_mappings_type_ck
    CHECK (tracking_no_type IN ('final','logistics','none'));
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

-- site 可空（空=全平台通用）。唯一键用表达式索引把 NULL 归一为 ''，
-- 否则普通 UNIQUE 约束下 NULLS DISTINCT 会允许重复插入"全站"映射。
CREATE UNIQUE INDEX IF NOT EXISTS platform_carrier_mappings_platform_site_code_uk
  ON public.platform_carrier_mappings (platform, coalesce(site, ''), carrier_code);
CREATE INDEX IF NOT EXISTS platform_carrier_mappings_user_created_idx
  ON public.platform_carrier_mappings (user_id, created_at DESC);

COMMENT ON TABLE public.platform_carrier_mappings IS '平台承运商映射：标发回填平台时把我们的 carrier_code 翻成平台认可的 Carrier + 单号类型（设计稿 §3.5 出口环节）';
COMMENT ON COLUMN public.platform_carrier_mappings.platform IS '平台标识（Shopee/Lazada/TikTok/Ozon…），大小写按前端约定存';
COMMENT ON COLUMN public.platform_carrier_mappings.site IS '站点（TH/MY/BR…），NULL=该平台全站通用映射';
COMMENT ON COLUMN public.platform_carrier_mappings.carrier_code IS '我方/聚合商承运商 code';
COMMENT ON COLUMN public.platform_carrier_mappings.carrier_name IS '平台侧 Carrier 名称原文（平台不接受未知值，必须逐字对齐）';
COMMENT ON COLUMN public.platform_carrier_mappings.tracking_no_type IS '单号类型：final 尾程妥投单号 / logistics 物流单号 / none 平台不接受单号（只回填状态）';
COMMENT ON COLUMN public.platform_carrier_mappings.is_active IS '停用而非删除：历史标发可追溯';

CREATE OR REPLACE FUNCTION public.platform_carrier_mappings_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth, extensions
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_platform_carrier_mappings_updated_at ON public.platform_carrier_mappings;
CREATE TRIGGER trg_platform_carrier_mappings_updated_at
  BEFORE UPDATE ON public.platform_carrier_mappings
  FOR EACH ROW EXECUTE FUNCTION public.platform_carrier_mappings_touch_updated_at();

-- ─── 11. 视图 v_tracking_stale（cron 取数） ─────────────────────────
-- 口径：仍在更新（stop_reason='none'）+ 业务上还需要刷新（5 个未妥投状态）+ 已到期。
-- next_check_at IS NULL 视为立即可查（新订阅尚未排期）。
-- security_invoker=true：以调用者身份走 RLS，cron 用 service_role 才看得到全租户数据。
CREATE OR REPLACE VIEW public.v_tracking_stale
WITH (security_invoker = true) AS
SELECT s.id                AS subscription_id,
       s.user_id,
       s.shipment_id,
       s.provider,
       s.tracking_no       AS sub_tracking_no,
       s.carrier_code,
       s.carrier_confirmed,
       s.status,
       s.sub_status,
       s.stop_reason,
       s.last_check_at,
       s.next_check_at,
       s.check_count,
       s.error_count,
       sh.tracking_no      AS shipment_tracking_no,
       sh.carrier          AS shipment_carrier
  FROM public.tracking_subscriptions s
  LEFT JOIN public.shipments sh ON sh.id = s.shipment_id
 WHERE s.stop_reason = 'none'
   AND s.status IN ('InTransit','DeliveryFailed','Available','NotDetected','Expired')
   AND (s.next_check_at IS NULL OR s.next_check_at < now());

COMMENT ON VIEW public.v_tracking_stale IS '待刷新轨迹订阅清单（cron 用）：未停止 + 未妥投 + 已到期；单次批量上限 200 单由应用层控制';

-- ─── 12. RLS（6 张表：本人四个动作 + admin 跨租户只读） ─────────────
-- 口径说明：admins_select_* 用项目既有的 public.has_role(auth.uid(), 'admin')
-- （见 20260923_140000_add_admin_cross_tenant_select.sql 与 zz_20261116_oe01_order_events.sql），
-- 不采用 exists(select 1 from profiles ...) 的自造写法。

ALTER TABLE public.rate_cards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_rate_cards ON public.rate_cards;
CREATE POLICY users_select_rate_cards ON public.rate_cards
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS users_insert_rate_cards ON public.rate_cards;
CREATE POLICY users_insert_rate_cards ON public.rate_cards
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_update_rate_cards ON public.rate_cards;
CREATE POLICY users_update_rate_cards ON public.rate_cards
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_delete_rate_cards ON public.rate_cards;
CREATE POLICY users_delete_rate_cards ON public.rate_cards
  FOR DELETE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS admins_select_rate_cards ON public.rate_cards;
CREATE POLICY admins_select_rate_cards ON public.rate_cards
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

ALTER TABLE public.rate_zones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_rate_zones ON public.rate_zones;
CREATE POLICY users_select_rate_zones ON public.rate_zones
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS users_insert_rate_zones ON public.rate_zones;
CREATE POLICY users_insert_rate_zones ON public.rate_zones
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_update_rate_zones ON public.rate_zones;
CREATE POLICY users_update_rate_zones ON public.rate_zones
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_delete_rate_zones ON public.rate_zones;
CREATE POLICY users_delete_rate_zones ON public.rate_zones
  FOR DELETE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS admins_select_rate_zones ON public.rate_zones;
CREATE POLICY admins_select_rate_zones ON public.rate_zones
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

ALTER TABLE public.rate_bands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_rate_bands ON public.rate_bands;
CREATE POLICY users_select_rate_bands ON public.rate_bands
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS users_insert_rate_bands ON public.rate_bands;
CREATE POLICY users_insert_rate_bands ON public.rate_bands
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_update_rate_bands ON public.rate_bands;
CREATE POLICY users_update_rate_bands ON public.rate_bands
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_delete_rate_bands ON public.rate_bands;
CREATE POLICY users_delete_rate_bands ON public.rate_bands
  FOR DELETE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS admins_select_rate_bands ON public.rate_bands;
CREATE POLICY admins_select_rate_bands ON public.rate_bands
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

ALTER TABLE public.tracking_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_tracking_subscriptions ON public.tracking_subscriptions;
CREATE POLICY users_select_tracking_subscriptions ON public.tracking_subscriptions
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS users_insert_tracking_subscriptions ON public.tracking_subscriptions;
CREATE POLICY users_insert_tracking_subscriptions ON public.tracking_subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_update_tracking_subscriptions ON public.tracking_subscriptions;
CREATE POLICY users_update_tracking_subscriptions ON public.tracking_subscriptions
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_delete_tracking_subscriptions ON public.tracking_subscriptions;
CREATE POLICY users_delete_tracking_subscriptions ON public.tracking_subscriptions
  FOR DELETE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS admins_select_tracking_subscriptions ON public.tracking_subscriptions;
CREATE POLICY admins_select_tracking_subscriptions ON public.tracking_subscriptions
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

ALTER TABLE public.tracking_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_tracking_events ON public.tracking_events;
CREATE POLICY users_select_tracking_events ON public.tracking_events
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS users_insert_tracking_events ON public.tracking_events;
CREATE POLICY users_insert_tracking_events ON public.tracking_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_update_tracking_events ON public.tracking_events;
CREATE POLICY users_update_tracking_events ON public.tracking_events
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_delete_tracking_events ON public.tracking_events;
CREATE POLICY users_delete_tracking_events ON public.tracking_events
  FOR DELETE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS admins_select_tracking_events ON public.tracking_events;
CREATE POLICY admins_select_tracking_events ON public.tracking_events
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

ALTER TABLE public.platform_carrier_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_platform_carrier_mappings ON public.platform_carrier_mappings;
CREATE POLICY users_select_platform_carrier_mappings ON public.platform_carrier_mappings
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS users_insert_platform_carrier_mappings ON public.platform_carrier_mappings;
CREATE POLICY users_insert_platform_carrier_mappings ON public.platform_carrier_mappings
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_update_platform_carrier_mappings ON public.platform_carrier_mappings;
CREATE POLICY users_update_platform_carrier_mappings ON public.platform_carrier_mappings
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_delete_platform_carrier_mappings ON public.platform_carrier_mappings;
CREATE POLICY users_delete_platform_carrier_mappings ON public.platform_carrier_mappings
  FOR DELETE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS admins_select_platform_carrier_mappings ON public.platform_carrier_mappings;
CREATE POLICY admins_select_platform_carrier_mappings ON public.platform_carrier_mappings
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

-- ─── 13. 试算与邮编函数授权 ─────────────────────────────────────────
-- calc_freight_quote 是 SECURITY INVOKER：调用者自己的 RLS 决定能看到哪些卡，
-- 因此只开放给 authenticated（anon 无租户上下文，给了也没数据）。
GRANT EXECUTE ON FUNCTION public.postal_pattern_match(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calc_freight_quote(uuid, text, text, text, numeric, numeric, numeric, numeric)
  TO authenticated, service_role;

-- ─── 14. 权限点 seed（写法照抄 20261025_rbac_s1.sql：module=logistics、group_code=G6、
--       view→scope_type=route、表级操作→scope_type=table、外部调用→scope_type=endpoint。
--       permissions.key 上确有唯一约束（key text not null unique）→ ON CONFLICT (key) DO NOTHING。
--       注意：logistics.tracking.view 在 rbac_s1 里已存在（risk_level=high、route=/logistics/tracking），
--       这里保留它是为了让清单完整；DO NOTHING 不会覆盖既有行的 risk_level。） ────────
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.rate.view','logistics','rate','view','报价查看','View rate card','G6','low','route','/logistics/rate',true) on conflict (key) do nothing;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.rate.create','logistics','rate','create','报价新建','Create rate card','G6','medium','table','rate_cards',true) on conflict (key) do nothing;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.rate.edit','logistics','rate','edit','报价改价','Edit rate card','G6','medium','table','rate_cards',true) on conflict (key) do nothing;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.rate.delete','logistics','rate','delete','报价删除','Delete rate card','G6','high','table','rate_cards',true) on conflict (key) do nothing;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.rate.approve','logistics','rate','approve','报价审批','Approve rate card','G6','high','table','rate_cards',true) on conflict (key) do nothing;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.tracking.view','logistics','tracking','view','物流跟踪查看','View logistics tracking','G6','low','route','/logistics/tracking',true) on conflict (key) do nothing;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.tracking.subscribe','logistics','tracking','subscribe','轨迹订阅','Subscribe tracking','G6','medium','table','tracking_subscriptions',true) on conflict (key) do nothing;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.tracking.refresh','logistics','tracking','refresh','轨迹刷新','Refresh tracking','G6','low','table','tracking_subscriptions',true) on conflict (key) do nothing;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.carrier_mapping.view','logistics','carrier_mapping','view','承运商映射查看','View carrier mapping','G6','low','route','/logistics/carrier-mappings',true) on conflict (key) do nothing;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.carrier_mapping.edit','logistics','carrier_mapping','edit','承运商映射编辑','Edit carrier mapping','G6','medium','table','platform_carrier_mappings',true) on conflict (key) do nothing;

-- ─── 15. 对象清单（本文件创建/声明的全部对象，重复执行不新增） ───────
-- 表 6：rate_cards, rate_zones, rate_bands,
--        tracking_subscriptions, tracking_events, platform_carrier_mappings
-- 函数 8：postal_pattern_match(text,text)（普通只读工具）
--          calc_freight_quote(uuid,text,text,text,numeric,numeric,numeric,numeric)（试算，STABLE/INVOKER）
--          fn_rate_card_immutable / fn_rate_zones_locked / fn_rate_bands_locked（铁律触发器函数）
--          rate_cards_touch_updated_at / tracking_subscriptions_touch_updated_at /
--          platform_carrier_mappings_touch_updated_at（updated_at 触发器函数）
-- 触发器 6：trg_rate_card_immutable(rate_cards BEFORE UPDATE),
--            trg_rate_zones_locked(rate_zones BEFORE I/U/D),
--            trg_rate_bands_locked(rate_bands BEFORE I/U/D),
--            trg_rate_cards_updated_at, trg_tracking_subscriptions_updated_at,
--            trg_platform_carrier_mappings_updated_at
-- 视图 1：v_tracking_stale
-- 约束：外键 12（rate_cards 3 / rate_zones 2 / rate_bands 2 /
--        tracking_subscriptions 2 / tracking_events 2 / platform_carrier_mappings 1；
--        其中 warehouse_id→forwarder_warehouses 依赖 fw01，缺席时打 NOTICE 跳过）,
--        CHECK 19, UNIQUE 约束 3（rate_cards / rate_bands / tracking_subscriptions）
-- 索引 15：14 个 CREATE INDEX + 1 个表达式唯一索引
--        （partial 索引 3：rate_cards_warehouse_idx、tracking_subscriptions_next_open_idx、
--          tracking_subscriptions_shipment_idx）
-- RLS 策略 30 = 6 表 × (users_select/insert/update/delete + admins_select)
-- COMMENT 59：表 6 + 列 50 + 函数 2 + 视图 1
-- GRANT 2（postal_pattern_match / calc_freight_quote → authenticated, service_role）
-- 权限点 10：logistics.rate.view/create/edit/delete/approve,
--             logistics.tracking.view/subscribe/refresh,
--             logistics.carrier_mapping.view/edit
-- 本文件不含任何 UPDATE / DELETE / TRUNCATE / DROP TABLE 数据操作语句。
