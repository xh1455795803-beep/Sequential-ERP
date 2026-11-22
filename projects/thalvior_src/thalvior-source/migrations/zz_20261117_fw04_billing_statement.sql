-- =====================================================================
-- zz_20261117_fw04_billing_statement.sql   （M4 · 计费 + 对账）
--
-- 本迁移解决什么问题：
--   设计稿 §2 的【钱】链路（费用行 → 对账单 → 审核 → 差异 → 争议 → 应付确认）
--   在库里完全没有落点：现网只有 finance 侧的 bills/fees/reconciliations（平台订阅费/
--   充值口径），没有"货代向我们要钱"的应付侧模型，于是
--     · 货代回传的运费/操作费/增值服务费无处存（§3.4 billing_lines）
--     · 店小秘那套对账规则（自动取费白名单 + 手动导入、导入优先于自动、
--       已自动取到不再重复取、物流称重 vs 自称重差异、待审核→已审核→打回重审）
--       没有承载体（§3.4 statements / statement_disputes）
--     · "手动导入账单"没有幂等与可观测（重复导入会翻倍计费）
--   本文件把上述对象一次建齐。D2 已定：**只做账本，不碰真钱**——没有任何资金账户、
--   余额扣减、支付动作，全部是应计与核对凭证。
--
-- 现场证据（2026-11-17，均为只读查询 information_schema / pg_tables / \d）：
--   - pg_tables 中不存在 billing_lines / statements / statement_lines /
--     statement_disputes / statement_import_batches → 本文件只新建，不改任何既有表。
--   - public.shipments(id uuid pk)、public.parcels(id uuid pk, user_id uuid not null)
--     已存在，可直接作费用行的外键目标。
--   - public.freight_forwarders(id uuid pk) 已存在 → statements.forwarder_id 可建外键；
--     public.forwarder_warehouses 由 fw01 建 → 该外键走 DO 块，缺席时跳过。
--   - public.work_orders 尚未创建（fw02 建）→ billing_lines.work_order_id 只留列，
--     外键用 DO 块 + WHEN undefined_table 跳过（fw02 之后可重放本文件补挂）。
--   - public.operation_logs 实测列结构（\d）：id uuid / user_id uuid / action text NOT NULL
--     / module text / detail text / created_at timestamptz —— statement_finalize 的审计
--     写入严格按这 6 列，不猜列名。
--
-- 本文件只做这九件事：
--   A billing_lines 费用行（12 类费用 × 6 种计费单位 × 4 种来源 + 审核状态机）
--   B statements 对账单（期间 + 币种 + 状态机 + 合计回写位）
--   C statement_lines 显式关联表（落实"导入优先于自动""已取到不重复取"）
--   D statement_disputes 争议单 · E statement_import_batches 导入批次（幂等可观测）
--   F statement_recalc() 合计重算 RPC · G statement_finalize() 审核通过 RPC
--   H 触发器：已审核行金额锁定 + 称重差异 5% 自动标红 + updated_at
--   I 视图 v_forwarder_fee_summary + 5 张表 RLS + logistics.billing/statement 权限点
--
-- 铁律（写进触发器，见 §2）：
--   费用行 status 一旦 approved，amount / unit_price / charge_qty 不可再改；
--   要改必须先 reject（打回重审）再重新提审。审核动作只能经 RPC 流转，不可绕过。
--
-- 明确不做：不做任何资金/余额/支付；不写任何顶层 UPDATE/DELETE/TRUNCATE 数据修复语句
--   （文件内仅有的 UPDATE 都在 SECURITY DEFINER RPC 内部，用于回写合计与状态）；
--   不动 shipments/parcels/freight_forwarders 的列（属 fw01/fw02）；不建 work_orders。
--
-- 幂等性：CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE FUNCTION /
--   CREATE INDEX IF NOT EXISTS / DROP POLICY IF EXISTS + CREATE POLICY /
--   DROP TRIGGER IF EXISTS + CREATE TRIGGER；外键与 CHECK/UNIQUE 全部用 DO 块吞
--   duplicate_object（外键另吞 undefined_table）。RPC 内所有写入都是按 id 定位的
--   状态回写，重复调用结果一致（合计重算天然幂等）。可整文件重复执行。
-- =====================================================================

SET search_path = public;

-- ─── 1. billing_lines 费用行 ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.billing_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL,
  shipment_id         uuid,
  parcel_id           uuid,
  work_order_id       uuid,
  owner_code          text,
  fee_type            text NOT NULL,
  charge_type         text,
  charge_unit         text,
  charge_qty          numeric(12,3),
  unit_price          numeric(14,4),
  amount              numeric(14,4) NOT NULL,
  currency            text NOT NULL DEFAULT 'CNY',
  weight_charged_g    numeric(12,3),
  weight_declared_g   numeric(12,3),
  diff_flag           boolean NOT NULL DEFAULT false,
  source              text NOT NULL,
  external_ref        text,
  period              date,
  statement_id        uuid,
  status              text NOT NULL DEFAULT 'pending_audit',
  audited_by          uuid,
  audited_at          timestamptz,
  voided_reason       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

DO $q$ BEGIN
  ALTER TABLE public.billing_lines
    ADD CONSTRAINT billing_lines_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] profiles 表不存在';
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.billing_lines
    ADD CONSTRAINT billing_lines_shipment_id_fkey
    FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] shipments 表不存在';
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.billing_lines
    ADD CONSTRAINT billing_lines_parcel_id_fkey
    FOREIGN KEY (parcel_id) REFERENCES public.parcels(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] parcels 表不存在';
END $q$;

-- work_orders 由 fw02 创建；缺席时打 NOTICE 跳过，fw02 之后重放本文件即可补挂。
DO $q$ BEGIN
  ALTER TABLE public.billing_lines
    ADD CONSTRAINT billing_lines_work_order_id_fkey
    FOREIGN KEY (work_order_id) REFERENCES public.work_orders(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] work_orders 表不存在（fw02 未执行）';
END $q$;

-- statement_id 指向 §3 的 statements，故在 statements 建完后统一补挂（见 §3 末尾）。

DO $q$ BEGIN
  ALTER TABLE public.billing_lines
    ADD CONSTRAINT billing_lines_fee_type_ck
    CHECK (fee_type IN ('handling','domestic_freight','intl_freight','packaging','storage',
                        'duty','volumetric_diff','surcharge','vas','return_fee','insurance',
                        'adjustment'));
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.billing_lines
    ADD CONSTRAINT billing_lines_charge_unit_ck
    CHECK (charge_unit IS NULL OR charge_unit IN ('piece','order','kg','cbm','manhour','flat'));
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.billing_lines
    ADD CONSTRAINT billing_lines_source_ck
    CHECK (source IN ('rate_card','wms_returned','auto_fetch','manual_import'));
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.billing_lines
    ADD CONSTRAINT billing_lines_status_ck
    CHECK (status IN ('pending_audit','approved','rejected','voided'));
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.billing_lines
    ADD CONSTRAINT billing_lines_qty_ck
    CHECK (charge_qty IS NULL OR charge_qty >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.billing_lines
    ADD CONSTRAINT billing_lines_weight_ck
    CHECK ((weight_charged_g IS NULL OR weight_charged_g >= 0)
           AND (weight_declared_g IS NULL OR weight_declared_g >= 0));
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

CREATE INDEX IF NOT EXISTS billing_lines_user_period_idx
  ON public.billing_lines (user_id, period DESC);
CREATE INDEX IF NOT EXISTS billing_lines_user_created_idx
  ON public.billing_lines (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS billing_lines_shipment_idx
  ON public.billing_lines (shipment_id) WHERE shipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS billing_lines_parcel_idx
  ON public.billing_lines (parcel_id) WHERE parcel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS billing_lines_statement_status_idx
  ON public.billing_lines (statement_id, status) WHERE statement_id IS NOT NULL;
-- 待审队列（工作台首页/审核页主力索引）
CREATE INDEX IF NOT EXISTS billing_lines_pending_idx
  ON public.billing_lines (user_id, created_at) WHERE status = 'pending_audit';
CREATE INDEX IF NOT EXISTS billing_lines_diff_idx
  ON public.billing_lines (user_id, period DESC) WHERE diff_flag;

COMMENT ON TABLE public.billing_lines IS '费用行（应付侧账本，不碰真钱）：货代回传/自动取费/手动导入的每条费用，含称重差异与审核状态机';
COMMENT ON COLUMN public.billing_lines.owner_code IS '货主码，预留多货主（设计稿 §3.6：当前单货主单租户，user_id 仍是隔离键）';
COMMENT ON COLUMN public.billing_lines.fee_type IS '费用类型：handling 操作费 / domestic_freight 国内段 / intl_freight 国际段 / packaging 包材 / storage 仓储 / duty 关税 / volumetric_diff 计泡差 / surcharge 附加费 / vas 增值服务费 / return_fee 退货费 / insurance 保险 / adjustment 调整（可为负）';
COMMENT ON COLUMN public.billing_lines.charge_type IS '货代侧计费项目原名（自由文本，便于逐字核对货代账单条目）';
COMMENT ON COLUMN public.billing_lines.charge_unit IS '计费单位：piece 件 / order 单 / kg 公斤 / cbm 立方 / manhour 工时 / flat 一口价';
COMMENT ON COLUMN public.billing_lines.amount IS '金额（原币）；adjustment/冲账允许为负，其余应为正';
COMMENT ON COLUMN public.billing_lines.weight_charged_g IS '物流称重（克）——货代实测';
COMMENT ON COLUMN public.billing_lines.weight_declared_g IS '自称重（克）——我方申报；与物流称重差异超 5% 由触发器自动置 diff_flag';
COMMENT ON COLUMN public.billing_lines.diff_flag IS '估实差异标记（触发器自动维护，勿手工置位）';
COMMENT ON COLUMN public.billing_lines.source IS '来源：rate_card 报价卡试算 / wms_returned 货代回传 / auto_fetch 自动取费 / manual_import 手动导入（导入优先于自动）';
COMMENT ON COLUMN public.billing_lines.external_ref IS '货代侧单据号/费用 id，用于回溯与去重';
COMMENT ON COLUMN public.billing_lines.period IS '费用归属日（按发货时间统计口径由应用层写入发货日）';
COMMENT ON COLUMN public.billing_lines.statement_id IS '当前归属对账单（冗余快查列）；权威关联见 statement_lines';
COMMENT ON COLUMN public.billing_lines.status IS 'pending_audit 待审核 / approved 已审核（金额锁定）/ rejected 打回重审 / voided 作废（可恢复由应用层控制）';
COMMENT ON COLUMN public.billing_lines.voided_reason IS '作废原因；status=voided 时应填';

-- ─── 2. 费用行铁律触发器：已审核锁定 + 称重差异自动标红 ─────────────
-- RAISE 风格照抄项目现网口径，两种都有先例，按场景分开用：
--   · 表内守卫触发器 → 纯中文业务提示，不带 ERRCODE
--     （20261014_invoice_admin_closeloop.sql:71 / 20261013_invoice_refactor.sql:196 同款）
--   · 对外 RPC → 'MACHINE_CODE: 说明' + USING ERRCODE
--     （20261025_rbac_s1.sql:449/453/482 同款：42501 权限、P0002 未找到）
--   项目里没有任何迁移使用裸 SQLSTATE 45000，故本文件不引入 45000。
CREATE OR REPLACE FUNCTION public.fn_billing_lines_approved_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth, extensions
AS $fn$
BEGIN
  -- 现场发现（2026-11-17 clone 审计）：本项目所有 Edge Function 都用
  -- SUPABASE_SERVICE_ROLE_KEY 建 client（functions/*/index.ts 实测），
  -- 即应用侧写入在数据库里看到的 current_user 恒为 'service_role'。
  -- 一旦把 service_role 放进放行名单，这条铁律守卫在 100% 的应用写入上都是空转，
  -- 只剩"DBA 手工改库"能触发它 —— 等于没有守卫。
  -- 因此守卫只放行真正的库内管理角色；改价/改历史费用行必须走"新建版本 / 打回重审"。
  IF current_user IN ('supabase_admin','postgres') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'approved'
     AND (NEW.amount         IS DISTINCT FROM OLD.amount
          OR NEW.unit_price  IS DISTINCT FROM OLD.unit_price
          OR NEW.charge_qty  IS DISTINCT FROM OLD.charge_qty) THEN
    RAISE EXCEPTION '费用行 % 已审核通过，金额/单价/数量不可修改；要改请先打回（rejected）再重新提审', OLD.id;
  END IF;
  -- 已审核行也不允许悄悄改称重与差异标记
  IF OLD.status = 'approved'
     AND (NEW.weight_charged_g  IS DISTINCT FROM OLD.weight_charged_g
          OR NEW.weight_declared_g IS DISTINCT FROM OLD.weight_declared_g) THEN
    RAISE EXCEPTION '费用行 % 已审核通过，称重数据不可修改；要改请先打回（rejected）再重新提审', OLD.id;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_billing_lines_approved_lock ON public.billing_lines;
CREATE TRIGGER trg_billing_lines_approved_lock
  BEFORE UPDATE ON public.billing_lines
  FOR EACH ROW EXECUTE FUNCTION public.fn_billing_lines_approved_lock();

-- 物流称重 vs 自称重：差异超过 5% 自动标红（设计稿 §3.4 店小秘对账规则）
-- 阈值 0.05，分母取自称重；自称重为 0 时按"物流称重非 0 即差异"处理。
-- 差异回到阈值内会自动复位 false，避免修数后残留红标。
CREATE OR REPLACE FUNCTION public.fn_billing_lines_diff_flag()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth, extensions
AS $fn$
BEGIN
  IF NEW.weight_charged_g IS NOT NULL AND NEW.weight_declared_g IS NOT NULL THEN
    IF NEW.weight_declared_g = 0 THEN
      NEW.diff_flag := (NEW.weight_charged_g <> 0);
    ELSIF abs(NEW.weight_charged_g - NEW.weight_declared_g) / NEW.weight_declared_g > 0.05 THEN
      NEW.diff_flag := true;
    ELSE
      NEW.diff_flag := false;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_billing_lines_diff_flag ON public.billing_lines;
CREATE TRIGGER trg_billing_lines_diff_flag
  BEFORE INSERT OR UPDATE ON public.billing_lines
  FOR EACH ROW EXECUTE FUNCTION public.fn_billing_lines_diff_flag();

CREATE OR REPLACE FUNCTION public.billing_lines_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth, extensions
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_billing_lines_updated_at ON public.billing_lines;
CREATE TRIGGER trg_billing_lines_updated_at
  BEFORE UPDATE ON public.billing_lines
  FOR EACH ROW EXECUTE FUNCTION public.billing_lines_touch_updated_at();

-- ─── 3. statements 对账单 ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.statements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  forwarder_id   uuid NOT NULL,
  warehouse_id   uuid,
  period_from    date NOT NULL,
  period_to      date NOT NULL,
  currency       text NOT NULL DEFAULT 'CNY',
  total_amount   numeric(14,4) NOT NULL DEFAULT 0,
  line_count     integer NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'draft',
  source         text,
  imported_at    timestamptz,
  imported_by    uuid,
  file_ref       text,
  audited_by     uuid,
  audited_at     timestamptz,
  closed_at      timestamptz,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

DO $q$ BEGIN
  ALTER TABLE public.statements
    ADD CONSTRAINT statements_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] profiles 表不存在';
END $q$;

-- 账单是财务凭据：货代档案被删时应拦住删除，而不是把账单连带删掉
DO $q$ BEGIN
  ALTER TABLE public.statements
    ADD CONSTRAINT statements_forwarder_id_fkey
    FOREIGN KEY (forwarder_id) REFERENCES public.freight_forwarders(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] freight_forwarders 表不存在';
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.statements
    ADD CONSTRAINT statements_warehouse_id_fkey
    FOREIGN KEY (warehouse_id) REFERENCES public.forwarder_warehouses(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] forwarder_warehouses 表不存在（fw01 未执行）';
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.statements
    ADD CONSTRAINT statements_period_ck
    CHECK (period_to >= period_from);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.statements
    ADD CONSTRAINT statements_status_ck
    CHECK (status IN ('draft','pending_audit','approved','rejected','closed','voided'));
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.statements
    ADD CONSTRAINT statements_source_ck
    CHECK (source IS NULL OR source IN ('auto','import'));
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.statements
    ADD CONSTRAINT statements_counter_ck
    CHECK (line_count >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.statements
    ADD CONSTRAINT statements_tenant_period_uk
    UNIQUE (user_id, forwarder_id, period_from, period_to, currency);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

CREATE INDEX IF NOT EXISTS statements_user_created_idx
  ON public.statements (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS statements_user_status_idx
  ON public.statements (user_id, status);
CREATE INDEX IF NOT EXISTS statements_forwarder_period_idx
  ON public.statements (forwarder_id, period_from DESC);

COMMENT ON TABLE public.statements IS '对账单（应付侧）：一个 租户×货代×期间×币种 一张账单，合计与行数由 statement_recalc() 回写';
COMMENT ON COLUMN public.statements.forwarder_id IS '货代 freight_forwarders.id；外键 ON DELETE RESTRICT（账单不可随货代消失）';
COMMENT ON COLUMN public.statements.period_from IS '账期起（含），按发货时间统计（店小秘对账口径）';
COMMENT ON COLUMN public.statements.total_amount IS '合计金额（原币），由 statement_recalc() 重算回写，排除 voided 行';
COMMENT ON COLUMN public.statements.line_count IS '有效行数（排除 voided），由 statement_recalc() 回写';
COMMENT ON COLUMN public.statements.status IS 'draft 草稿 / pending_audit 待审核 / approved 已审核 / rejected 打回重审 / closed 已关账 / voided 作废';
COMMENT ON COLUMN public.statements.source IS 'auto 自动取费生成 / import 手动导入货代账单；导入优先于自动';
COMMENT ON COLUMN public.statements.file_ref IS '导入原件引用（storage 路径或对象名），争议回溯用';
COMMENT ON COLUMN public.statements.closed_at IS '关账时间；关账后金额视为定稿';

-- 补挂 §1 预留的 billing_lines.statement_id 外键（statements 现已存在）
DO $q$ BEGIN
  ALTER TABLE public.billing_lines
    ADD CONSTRAINT billing_lines_statement_id_fkey
    FOREIGN KEY (statement_id) REFERENCES public.statements(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] statements 表不存在';
END $q$;

CREATE OR REPLACE FUNCTION public.statements_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth, extensions
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_statements_updated_at ON public.statements;
CREATE TRIGGER trg_statements_updated_at
  BEFORE UPDATE ON public.statements
  FOR EACH ROW EXECUTE FUNCTION public.statements_touch_updated_at();

-- ─── 4. statement_lines 账单↔费用行 显式关联 ────────────────────────
-- 做成显式关联表而不是只靠 billing_lines.statement_id，是为了落实两条店小秘规则：
--   ① 导入优先于自动：同一行费用既被自动取费又被导入命中时，关联只有一条，
--      把 source 从 auto 更新为 import 即可，不新增重复计费；
--   ② 已自动取到不再重复取：写入前先查本表存在性（应用层 EXISTS 判定）。
CREATE TABLE IF NOT EXISTS public.statement_lines (
  statement_id    uuid NOT NULL,
  billing_line_id uuid NOT NULL,
  user_id         uuid NOT NULL,
  source          text NOT NULL DEFAULT 'auto',
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (statement_id, billing_line_id)
);

DO $q$ BEGIN
  ALTER TABLE public.statement_lines
    ADD CONSTRAINT statement_lines_statement_id_fkey
    FOREIGN KEY (statement_id) REFERENCES public.statements(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] statements 表不存在';
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.statement_lines
    ADD CONSTRAINT statement_lines_billing_line_id_fkey
    FOREIGN KEY (billing_line_id) REFERENCES public.billing_lines(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] billing_lines 表不存在';
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.statement_lines
    ADD CONSTRAINT statement_lines_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] profiles 表不存在';
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.statement_lines
    ADD CONSTRAINT statement_lines_source_ck
    CHECK (source IN ('auto','import'));
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

CREATE INDEX IF NOT EXISTS statement_lines_line_idx
  ON public.statement_lines (billing_line_id);
CREATE INDEX IF NOT EXISTS statement_lines_user_created_idx
  ON public.statement_lines (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS statement_lines_statement_source_idx
  ON public.statement_lines (statement_id, source);

COMMENT ON TABLE public.statement_lines IS '账单与费用行的权威关联表：主键 (statement_id, billing_line_id) 天然去重，source 标记该关联来自自动取费还是导入（导入优先）';
COMMENT ON COLUMN public.statement_lines.source IS 'auto 自动取费挂入 / import 手动导入挂入；同键只保留一条，import 覆盖 auto';

-- ─── 5. statement_disputes 争议单 ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.statement_disputes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id    uuid NOT NULL,
  billing_line_id uuid NOT NULL,
  user_id         uuid NOT NULL,
  reason          text NOT NULL,
  claimed_amount  numeric(14,4),
  evidence        jsonb NOT NULL DEFAULT '[]'::jsonb,
  status          text NOT NULL DEFAULT 'open',
  resolved_amount numeric(14,4),
  resolved_by     uuid,
  resolved_at     timestamptz,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DO $q$ BEGIN
  ALTER TABLE public.statement_disputes
    ADD CONSTRAINT statement_disputes_statement_id_fkey
    FOREIGN KEY (statement_id) REFERENCES public.statements(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] statements 表不存在';
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.statement_disputes
    ADD CONSTRAINT statement_disputes_billing_line_id_fkey
    FOREIGN KEY (billing_line_id) REFERENCES public.billing_lines(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] billing_lines 表不存在';
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.statement_disputes
    ADD CONSTRAINT statement_disputes_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] profiles 表不存在';
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.statement_disputes
    ADD CONSTRAINT statement_disputes_status_ck
    CHECK (status IN ('open','processing','accepted','rejected','closed'));
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.statement_disputes
    ADD CONSTRAINT statement_disputes_evidence_ck
    CHECK (jsonb_typeof(evidence) = 'array');
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

CREATE INDEX IF NOT EXISTS statement_disputes_statement_idx
  ON public.statement_disputes (statement_id, status);
CREATE INDEX IF NOT EXISTS statement_disputes_user_created_idx
  ON public.statement_disputes (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS statement_disputes_line_idx
  ON public.statement_disputes (billing_line_id);

COMMENT ON TABLE public.statement_disputes IS '对账争议单：逐行提争议（称重差异、拆单运费分批返回、重复计费），带证据、索赔额与最终认定额';
COMMENT ON COLUMN public.statement_disputes.reason IS '争议理由（必填，货代沟通留痕）';
COMMENT ON COLUMN public.statement_disputes.claimed_amount IS '我方主张（应减）金额';
COMMENT ON COLUMN public.statement_disputes.evidence IS '证据数组（图片 storage 路径 / 轨迹截图 / 单号），jsonb 且必须是 array';
COMMENT ON COLUMN public.statement_disputes.resolved_amount IS '货代最终认定金额；accepted 时等于减让额';

CREATE OR REPLACE FUNCTION public.statement_disputes_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth, extensions
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_statement_disputes_updated_at ON public.statement_disputes;
CREATE TRIGGER trg_statement_disputes_updated_at
  BEFORE UPDATE ON public.statement_disputes
  FOR EACH ROW EXECUTE FUNCTION public.statement_disputes_touch_updated_at();

-- ─── 6. statement_import_batches 手动导入批次（幂等 + 可观测） ──────
CREATE TABLE IF NOT EXISTS public.statement_import_batches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  statement_id  uuid,
  batch_no      text NOT NULL,
  file_name     text,
  row_count     integer,
  ok_count      integer,
  fail_count    integer,
  error_detail  jsonb,
  imported_by   uuid,
  imported_at   timestamptz NOT NULL DEFAULT now()
);

DO $q$ BEGIN
  ALTER TABLE public.statement_import_batches
    ADD CONSTRAINT statement_import_batches_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] profiles 表不存在';
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.statement_import_batches
    ADD CONSTRAINT statement_import_batches_statement_id_fkey
    FOREIGN KEY (statement_id) REFERENCES public.statements(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] statements 表不存在';
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.statement_import_batches
    ADD CONSTRAINT statement_import_batches_batch_no_uk
    UNIQUE (batch_no);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.statement_import_batches
    ADD CONSTRAINT statement_import_batches_counter_ck
    CHECK ((row_count IS NULL OR row_count >= 0)
           AND (ok_count IS NULL OR ok_count >= 0)
           AND (fail_count IS NULL OR fail_count >= 0));
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $q$;

CREATE INDEX IF NOT EXISTS statement_import_batches_user_created_idx
  ON public.statement_import_batches (user_id, imported_at DESC);
CREATE INDEX IF NOT EXISTS statement_import_batches_statement_idx
  ON public.statement_import_batches (statement_id) WHERE statement_id IS NOT NULL;

COMMENT ON TABLE public.statement_import_batches IS '账单导入批次：batch_no 全局唯一 = 重复导入的幂等闸门；成功/失败行数与 error_detail 让导入结果可观测';
COMMENT ON COLUMN public.statement_import_batches.batch_no IS '导入批次号（前端生成或文件名+哈希）；已存在即视为重复提交，整批拒绝';
COMMENT ON COLUMN public.statement_import_batches.error_detail IS '逐行错误明细 jsonb（行号、原始内容、失败原因），供下载回看';

-- ─── 7. statement_recalc() 合计重算 RPC ────────────────────────────
-- SECURITY DEFINER 的理由：本函数要跨 RLS 聚合某张账单的全部费用行并回写合计。
--   若写成 INVOKER，子账号（受 RLS 行可见范围限制）重算会得到偏小的合计，
--   账就永远对不平；因此走 DEFINER，并同时做三件事兜底：
--     ① SET search_path = public（口径照抄 20261025_rbac_s1.sql，防调用者用 search_path 劫持对象）
--     ② 用 session_user 判服务端角色放行（注意：SECURITY DEFINER 内 current_user 是函数属主
--        postgres，不能用来判调用者，必须用 session_user + auth.uid()）
--     ③ 非服务端调用必须证明自己是该账单租户（本人或 admin），否则 42501 拒绝
--   只回写 total_amount / line_count，不改状态、不改费用行金额。
--    volatility：本函数带 UPDATE 回写，故保持默认 VOLATILE，绝不能标 STABLE/IMMUTABLE。
CREATE OR REPLACE FUNCTION public.statement_recalc(p_statement_id uuid)
RETURNS TABLE(total_amount numeric, line_count integer)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid      uuid;
  v_owner    uuid;
  v_status   text;
  v_total    numeric;
  v_cnt      integer;
  v_priv     boolean;
BEGIN
  -- 现场发现：PostgREST 会话里 session_user 恒为 'authenticator'（它 SET LOCAL ROLE 到
  -- service_role/authenticated），用 session_user 判定会让本 RPC 对应用侧流量**永远拒绝**，
  -- 而且拒绝信息是 AUTH_REQUIRED，排查时极易误判成"用户没登录"。判定必须用 current_user。
  -- service_role 在这里放行是本项目 EF 架构的必然（EF 已用 checkPerm 做过权限判定，
  -- 数据库这层拿不到用户身份），但**要求调用方必须显式传 p_auditor**，否则审计留痕是空的。
  v_priv := current_user IN ('service_role','supabase_admin','postgres');

  SELECT s.user_id, s.status INTO v_owner, v_status
    FROM public.statements s
   WHERE s.id = p_statement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'STATEMENT_NOT_FOUND: %', p_statement_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_priv THEN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'AUTH_REQUIRED: statement_recalc requires login' USING ERRCODE = '42501';
    END IF;
    IF NOT (v_owner = v_uid OR public.has_role(v_uid, 'admin')) THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: logistics.statement.audit' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 关联口径：statement_lines 为权威，billing_lines.statement_id 作为兼容路径，
  -- 两者取并集后按费用行去重（UNION 天然去重），voided 行不计入合计。
  WITH src AS (
    SELECT bl.id, bl.amount
      FROM public.billing_lines bl
      JOIN public.statement_lines sl ON sl.billing_line_id = bl.id
     WHERE sl.statement_id = p_statement_id
       AND bl.status <> 'voided'
    UNION
    SELECT bl.id, bl.amount
      FROM public.billing_lines bl
     WHERE bl.statement_id = p_statement_id
       AND bl.status <> 'voided'
  )
  SELECT COALESCE(SUM(src.amount), 0)::numeric(14,4), COUNT(*)::integer
    INTO v_total, v_cnt
    FROM src;

  UPDATE public.statements
     SET total_amount = v_total,
         line_count   = v_cnt
   WHERE id = p_statement_id;

  RETURN QUERY SELECT v_total, v_cnt;
END;
$fn$;

COMMENT ON FUNCTION public.statement_recalc(uuid) IS '重算对账单合计与行数（排除 voided 行）并回写 statements；SECURITY DEFINER + 租户自证，只动合计列';

-- ─── 8. statement_finalize() 审核通过 RPC ──────────────────────────
-- 无 pending_audit 行 → 账单置 approved，同时把关联费用行批量置 approved，
-- 并写一条 operation_logs 审计；仍有待审行 → 不改状态，返回 'PENDING_AUDIT:<行数>'。
CREATE OR REPLACE FUNCTION public.statement_finalize(p_statement_id uuid, p_auditor uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid        uuid;
  v_owner      uuid;
  v_st_status  text;
  v_cur        text;
  v_pending    integer;
  v_total      numeric;
  v_cnt        integer;
  v_priv       boolean;
  v_result     text;
BEGIN
  -- 现场发现：PostgREST 会话里 session_user 恒为 'authenticator'（它 SET LOCAL ROLE 到
  -- service_role/authenticated），用 session_user 判定会让本 RPC 对应用侧流量**永远拒绝**，
  -- 而且拒绝信息是 AUTH_REQUIRED，排查时极易误判成"用户没登录"。判定必须用 current_user。
  -- service_role 在这里放行是本项目 EF 架构的必然（EF 已用 checkPerm 做过权限判定，
  -- 数据库这层拿不到用户身份），但**要求调用方必须显式传 p_auditor**，否则审计留痕是空的。
  v_priv := current_user IN ('service_role','supabase_admin','postgres');

  SELECT s.user_id, s.status, s.currency INTO v_owner, v_st_status, v_cur
    FROM public.statements s
   WHERE s.id = p_statement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'STATEMENT_NOT_FOUND: %', p_statement_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_priv THEN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'AUTH_REQUIRED: statement_finalize requires login' USING ERRCODE = '42501';
    END IF;
    IF NOT (v_owner = v_uid OR public.has_role(v_uid, 'admin')) THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: logistics.statement.audit' USING ERRCODE = '42501';
    END IF;
    -- p_auditor 只能是自己（admin 可代签，便于运营闭环）
    IF p_auditor IS NOT NULL AND p_auditor <> v_uid AND NOT public.has_role(v_uid, 'admin') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: p_auditor must be the caller' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 服务端调用（EF 用 service_role，数据库里拿不到用户身份）必须显式署名，
  -- 否则 audited_by 为空、"谁批的账"这条审计链就断了，D2「账本要真」不成立。
  IF v_priv AND p_auditor IS NULL THEN
    RAISE EXCEPTION 'AUDITOR_REQUIRED: 经服务端调用必须显式传 p_auditor（实际审核人 uuid）'
      USING ERRCODE = '42501';
  END IF;

  IF v_st_status = 'closed' THEN
    RAISE EXCEPTION '对账单已关账（closed），不可重复审核';
  END IF;
  IF v_st_status = 'voided' THEN
    RAISE EXCEPTION '对账单已作废（voided），不可审核';
  END IF;

  SELECT COUNT(*) INTO v_pending
    FROM public.billing_lines bl
   WHERE bl.status = 'pending_audit'
     AND (bl.statement_id = p_statement_id
          OR EXISTS (SELECT 1 FROM public.statement_lines sl
                      WHERE sl.statement_id = p_statement_id
                        AND sl.billing_line_id = bl.id));

  IF v_pending > 0 THEN
    RETURN 'PENDING_AUDIT:' || v_pending::text;
  END IF;

  UPDATE public.statements
     SET status     = 'approved',
         audited_by = p_auditor,
         audited_at = now()
   WHERE id = p_statement_id;

  -- 关联费用行批量定稿（pending_audit → approved；已 approved/rejected/voided 不动）
  UPDATE public.billing_lines bl
     SET status     = 'approved',
         audited_by = COALESCE(bl.audited_by, p_auditor),
         audited_at = COALESCE(bl.audited_at, now())
   WHERE bl.status = 'pending_audit'
     AND (bl.statement_id = p_statement_id
          OR EXISTS (SELECT 1 FROM public.statement_lines sl
                      WHERE sl.statement_id = p_statement_id
                        AND sl.billing_line_id = bl.id));

  SELECT s.total_amount, s.line_count INTO v_total, v_cnt
    FROM public.statements s WHERE s.id = p_statement_id;

  BEGIN
    INSERT INTO public.operation_logs (user_id, action, module, detail)
    VALUES (
      v_owner,
      'logistics.statement.audit',
      'logistics',
      format('对账单审核通过 id=%s ｜ 合计 %s %s ｜ 有效行 %s ｜ 审核人 %s',
             p_statement_id::text, COALESCE(v_total::text, '0'), COALESCE(v_cur, ''),
             COALESCE(v_cnt, 0)::text, COALESCE(p_auditor::text, 'system'))
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- 审计失败不阻断业务主流程（口径同 rbac_write_audit）
  END;

  v_result := 'APPROVED:' || COALESCE(v_total::text, '0');
  RETURN v_result;
END;
$fn$;

COMMENT ON FUNCTION public.statement_finalize(uuid, uuid) IS '对账单审核通过：无待审行则置 approved 并批量定稿费用行 + 写 operation_logs；有待审行返回 PENDING_AUDIT:<n> 不改状态';

-- ─── 9. RPC 授权（DEFINER 函数必须收窄，否则等于把跨租户合计/审核开给 anon） ──
REVOKE ALL ON FUNCTION public.statement_recalc(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.statement_finalize(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.statement_recalc(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.statement_finalize(uuid, uuid) TO authenticated, service_role;

-- ─── 10. RLS（5 张表：本人四个动作 + admin 跨租户只读） ─────────────
-- admins_select_* 用项目既有 public.has_role(auth.uid(), 'admin')，
-- 与 20260923_140000 / zz_20261116_oe01 完全一致，不自创 exists(select 1 from profiles) 写法。

ALTER TABLE public.billing_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_billing_lines ON public.billing_lines;
CREATE POLICY users_select_billing_lines ON public.billing_lines
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS users_insert_billing_lines ON public.billing_lines;
CREATE POLICY users_insert_billing_lines ON public.billing_lines
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_update_billing_lines ON public.billing_lines;
CREATE POLICY users_update_billing_lines ON public.billing_lines
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_delete_billing_lines ON public.billing_lines;
CREATE POLICY users_delete_billing_lines ON public.billing_lines
  FOR DELETE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS admins_select_billing_lines ON public.billing_lines;
CREATE POLICY admins_select_billing_lines ON public.billing_lines
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

ALTER TABLE public.statements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_statements ON public.statements;
CREATE POLICY users_select_statements ON public.statements
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS users_insert_statements ON public.statements;
CREATE POLICY users_insert_statements ON public.statements
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_update_statements ON public.statements;
CREATE POLICY users_update_statements ON public.statements
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_delete_statements ON public.statements;
CREATE POLICY users_delete_statements ON public.statements
  FOR DELETE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS admins_select_statements ON public.statements;
CREATE POLICY admins_select_statements ON public.statements
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

ALTER TABLE public.statement_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_statement_lines ON public.statement_lines;
CREATE POLICY users_select_statement_lines ON public.statement_lines
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS users_insert_statement_lines ON public.statement_lines;
CREATE POLICY users_insert_statement_lines ON public.statement_lines
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_update_statement_lines ON public.statement_lines;
CREATE POLICY users_update_statement_lines ON public.statement_lines
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_delete_statement_lines ON public.statement_lines;
CREATE POLICY users_delete_statement_lines ON public.statement_lines
  FOR DELETE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS admins_select_statement_lines ON public.statement_lines;
CREATE POLICY admins_select_statement_lines ON public.statement_lines
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

ALTER TABLE public.statement_disputes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_statement_disputes ON public.statement_disputes;
CREATE POLICY users_select_statement_disputes ON public.statement_disputes
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS users_insert_statement_disputes ON public.statement_disputes;
CREATE POLICY users_insert_statement_disputes ON public.statement_disputes
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_update_statement_disputes ON public.statement_disputes;
CREATE POLICY users_update_statement_disputes ON public.statement_disputes
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_delete_statement_disputes ON public.statement_disputes;
CREATE POLICY users_delete_statement_disputes ON public.statement_disputes
  FOR DELETE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS admins_select_statement_disputes ON public.statement_disputes;
CREATE POLICY admins_select_statement_disputes ON public.statement_disputes
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

ALTER TABLE public.statement_import_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_statement_import_batches ON public.statement_import_batches;
CREATE POLICY users_select_statement_import_batches ON public.statement_import_batches
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS users_insert_statement_import_batches ON public.statement_import_batches;
CREATE POLICY users_insert_statement_import_batches ON public.statement_import_batches
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_update_statement_import_batches ON public.statement_import_batches;
CREATE POLICY users_update_statement_import_batches ON public.statement_import_batches
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS users_delete_statement_import_batches ON public.statement_import_batches;
CREATE POLICY users_delete_statement_import_batches ON public.statement_import_batches
  FOR DELETE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS admins_select_statement_import_batches ON public.statement_import_batches;
CREATE POLICY admins_select_statement_import_batches ON public.statement_import_batches
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

-- ─── 11. 视图 v_forwarder_fee_summary（货代×月×费用类型汇总） ────────
-- 供利润分析与对账下钻。口径：
--   关联集合 = statement_lines ∪ billing_lines.statement_id（与 statement_recalc 一致），
--     去重按 (statement_id, billing_line_id) 这一对键做，绝不按业务属性去重——
--     两条金额/类型完全相同的费用行必须各算一行，否则 line_count 会偏小。
--   期间 = COALESCE(费用行 period, 账单 period_from) 的月初（按发货时间统计）；
--   排除 status='voided' 的费用行；同一行若挂到两张账单，会分别计入两个货代，
--     这是"按货代汇总"语义下的正确结果。
CREATE OR REPLACE VIEW public.v_forwarder_fee_summary
WITH (security_invoker = true) AS
WITH link AS (
  SELECT sl.statement_id, sl.billing_line_id
    FROM public.statement_lines sl
  UNION
  SELECT bl.statement_id, bl.id
    FROM public.billing_lines bl
   WHERE bl.statement_id IS NOT NULL
)
SELECT bl.user_id,
       st.forwarder_id,
       date_trunc('month', COALESCE(bl.period, st.period_from))::date AS period_month,
       bl.fee_type,
       bl.currency,
       SUM(bl.amount)::numeric(14,4)                                 AS total_amount,
       COUNT(*)::integer                                             AS line_count
  FROM link l
  JOIN public.billing_lines bl ON bl.id = l.billing_line_id
  JOIN public.statements st    ON st.id = l.statement_id
 WHERE bl.status <> 'voided'
   AND COALESCE(bl.period, st.period_from) IS NOT NULL
 GROUP BY bl.user_id, st.forwarder_id,
          date_trunc('month', COALESCE(bl.period, st.period_from))::date,
          bl.fee_type, bl.currency;

COMMENT ON VIEW public.v_forwarder_fee_summary IS '货代×月度×费用类型应付汇总（排除作废行）：利润分析与对账下钻入口';

-- ─── 12. 权限点 seed（写法照抄 20261025_rbac_s1.sql：module=logistics、group_code=G6、
--       view→scope_type=route、表级操作→scope_type=table、RPC→scope_type=rpc；
--       permissions.key 有唯一约束（key text not null unique）→ ON CONFLICT (key) DO NOTHING；
--       risk_level 口径：view=low，create/edit/import/export=medium，
--                        audit/dispute/void/delete/close=high） ──────────
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.billing.view','logistics','billing','view','费用行查看','View billing line','G6','low','route','/logistics/billing',true) on conflict (key) do nothing;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.billing.import','logistics','billing','import','费用行导入','Import billing lines','G6','medium','table','billing_lines',true) on conflict (key) do nothing;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.billing.audit','logistics','billing','audit','费用行审核','Audit billing line','G6','high','rpc','statement_finalize',true) on conflict (key) do nothing;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.billing.dispute','logistics','billing','dispute','费用行争议','Dispute billing line','G6','high','table','statement_disputes',true) on conflict (key) do nothing;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.billing.void','logistics','billing','void','费用行作废','Void billing line','G6','high','table','billing_lines',true) on conflict (key) do nothing;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.statement.view','logistics','statement','view','对账单查看','View statement','G6','low','route','/logistics/statements',true) on conflict (key) do nothing;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.statement.create','logistics','statement','create','对账单新建','Create statement','G6','medium','table','statements',true) on conflict (key) do nothing;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.statement.export','logistics','statement','export','对账单导出','Export statement','G6','medium','table','DataListPage',true) on conflict (key) do nothing;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.statement.audit','logistics','statement','audit','对账单审核','Audit statement','G6','high','rpc','statement_finalize',true) on conflict (key) do nothing;
insert into public.permissions (key, module, resource, action, name, name_en, group_code, risk_level, scope_type, scope_ref, is_active) values ('logistics.statement.close','logistics','statement','close','对账单关账','Close statement','G6','high','table','statements',true) on conflict (key) do nothing;

-- ─── 13. 对象清单（本文件创建/声明的全部对象，重复执行不新增） ───────
-- 表 5：billing_lines, statements, statement_lines, statement_disputes,
--        statement_import_batches
-- 函数 7：statement_recalc(uuid)（DEFINER 合计重算）
--          statement_finalize(uuid,uuid)（DEFINER 审核通过 + operation_logs 审计）
--          fn_billing_lines_approved_lock / fn_billing_lines_diff_flag（业务触发器函数）
--          billing_lines_touch_updated_at / statements_touch_updated_at /
--          statement_disputes_touch_updated_at（updated_at 触发器函数）
-- 触发器 5：trg_billing_lines_approved_lock, trg_billing_lines_diff_flag(I/U),
--            trg_billing_lines_updated_at, trg_statements_updated_at,
--            trg_statement_disputes_updated_at
-- 视图 1：v_forwarder_fee_summary
-- 外键 16：billing_lines 5（user / shipment / parcel / work_order→依赖 fw02 可跳过 /
--           statement 在 §3 末尾补挂）,
--           statements 3（user / forwarder / warehouse→依赖 fw01 可跳过）,
--           statement_lines 3, statement_disputes 3, statement_import_batches 2
--           其中 2 个目标表（work_orders、forwarder_warehouses）由 fw02/fw01 创建，
--           缺席时打 [跳过外键] NOTICE，重放本文件即可补挂。
-- CHECK 14 · UNIQUE 约束 2（statements_tenant_period_uk, statement_import_batches_batch_no_uk）
-- 索引 18：billing_lines 7 / statements 3 / statement_lines 3 / statement_disputes 3 /
--           statement_import_batches 2；其中 partial 6 个
-- RLS 策略 25 = 5 表 × (users_select/insert/update/delete + admins_select)
-- COMMENT 37：表 5 + 列 29 + 函数 2 + 视图 1
-- GRANT/REVOKE 4：2 个 DEFINER RPC 各 1 条 REVOKE ... FROM PUBLIC + 1 条
--                 GRANT EXECUTE TO authenticated, service_role
-- 权限点 10：logistics.billing.view/import/audit/dispute/void,
--             logistics.statement.view/create/export/audit/close
-- 本文件顶层无任何 UPDATE / DELETE / TRUNCATE / DROP TABLE 语句；
-- 仅有的 UPDATE 出现在 statement_recalc / statement_finalize 两个 RPC 内部。
