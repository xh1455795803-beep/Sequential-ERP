-- ============================================================
-- Thalvior 跨境代打包 SaaS — 干净重建 v7
-- 无 BEGIN/COMMIT，无 seed 数据，字段名与前端对齐
-- ============================================================

-- 清理旧表 + 旧类型
DO $$
DECLARE rec record;
BEGIN
  FOR rec IN (SELECT table_name FROM information_schema.tables
              WHERE table_schema='public'
              AND (table_name LIKE 'tlv_%' OR table_name LIKE 'wms_%')) LOOP
    EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(rec.table_name) || ' CASCADE';
  END LOOP;
  FOR rec IN (SELECT typtname FROM pg_type
              WHERE typtnamespace='public'::regnamespace AND typtname LIKE 'tlv_%') LOOP
    EXECUTE 'DROP TYPE IF EXISTS public.' || quote_ident(rec.typtname) || ' CASCADE';
  END LOOP;
END $$;

-- 清理旧 demo 账号（可选，不影响）
DELETE FROM auth.users WHERE email LIKE '%thalvior%demo%';

-- ============================================================
-- 平台层（platform admin 管）
-- ============================================================

CREATE TABLE tlv_platforms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  api_endpoint text,
  auth_type text DEFAULT 'oauth2',
  max_rate_per_minute int DEFAULT 60,
  status text DEFAULT 'active' CHECK (status IN ('active','inactive','beta')),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE tlv_logistics_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  tracking_url_template text,
  api_endpoint text,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE tlv_warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text UNIQUE NOT NULL,
  country text NOT NULL,
  city text,
  address text,
  contact_name text,
  contact_phone text,
  contact_email text,
  api_key text DEFAULT gen_random_uuid()::text,
  api_secret text DEFAULT gen_random_uuid()::text,
  billing_mode text DEFAULT 'per_pkg' CHECK (billing_mode IN ('per_pkg','per_sku','per_weight','per_volume')),
  default_timezone text DEFAULT 'Asia/Shanghai',
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- 商家层（merchant 自己管，warehouse 只读）
-- ============================================================

CREATE TABLE tlv_merchants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid REFERENCES tlv_warehouses(id) ON DELETE CASCADE,
  business_name text NOT NULL,
  contact_name text,
  contact_email text,
  contact_phone text,
  country text,
  business_address text,
  registration_number text,
  balance numeric(12,2) DEFAULT 0,
  frozen_balance numeric(12,2) DEFAULT 0,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE tlv_merchant_shops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES tlv_merchants(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES tlv_warehouses(id) ON DELETE CASCADE,
  platform_id uuid REFERENCES tlv_platforms(id) ON DELETE SET NULL,
  platform text,          -- 冗余: Shopify/TikTok Shop/Shopee...
  shop_name text NOT NULL,
  shop_id text,
  platform_shop_id text,
  api_token text,          -- 手动录入的 API Token（可选）
  oauth_token text,
  oauth_refresh_token text,
  token_expires_at timestamptz,
  last_synced_at timestamptz,
  status text DEFAULT 'connected',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE tlv_merchant_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES tlv_merchants(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES tlv_warehouses(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('recharge','consume','refund','withdraw','adjustment')),
  amount numeric(12,2) NOT NULL,
  balance_after numeric(12,2) NOT NULL,
  transaction_id text,     -- 对外交易号
  ref_table text,
  ref_id uuid,
  note text,
  operator_id uuid,
  operator_name text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- SKU + 库存
-- ============================================================

CREATE TABLE tlv_merchant_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES tlv_merchants(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES tlv_warehouses(id) ON DELETE CASCADE,
  sku text NOT NULL,
  name text NOT NULL,
  barcode text,
  weight_kg numeric(8,3) DEFAULT 0.5,
  length_cm numeric(6,2) DEFAULT 15,
  width_cm numeric(6,2) DEFAULT 10,
  height_cm numeric(6,2) DEFAULT 5,
  photo_url text,
  hs_code text,
  customs_description text,
  customs_value numeric(10,2),
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  UNIQUE(merchant_id, warehouse_id, sku)
);

CREATE TABLE tlv_merchant_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES tlv_warehouses(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES tlv_merchants(id) ON DELETE CASCADE,
  product_id uuid REFERENCES tlv_merchant_products(id) ON DELETE SET NULL,
  sku text NOT NULL,              -- 冗余，方便直接查
  product_name text,              -- 冗余，方便直接查
  location text NOT NULL,         -- 库位编码
  qty_on_hand int DEFAULT 0,     -- 在库数量
  qty_reserved int DEFAULT 0,    -- 预留数量（被出库单锁定）
  inbound_qty int DEFAULT 0,     -- 在途数量（已下单未到达）
  last_updated timestamptz DEFAULT now(),
  UNIQUE(warehouse_id, merchant_id, sku, location)
);

-- ============================================================
-- 入库单
-- ============================================================

CREATE TABLE tlv_inbound_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES tlv_warehouses(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES tlv_merchants(id) ON DELETE CASCADE,
  inbound_no text NOT NULL,       -- 入库单号（前端展示用）
  merchant_name text,             -- 冗余: 商家名
  source text DEFAULT 'manual',
  status text DEFAULT 'pending',  -- pending / received / inspecting / stocked / completed
  tracking_no text,
  carrier text,
  eta timestamptz,                -- 预计到达
  sku_count int DEFAULT 0,        -- 冗余: SKU 种类数
  total_qty int DEFAULT 0,
  inspected_qty int DEFAULT 0,
  defective_qty int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  received_at timestamptz,
  inspecting_at timestamptz,
  completed_at timestamptz
);

CREATE TABLE tlv_inbound_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_id uuid NOT NULL REFERENCES tlv_inbound_orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES tlv_merchant_products(id) ON DELETE SET NULL,
  sku text NOT NULL,              -- 冗余
  product_name text,              -- 冗余
  expected_qty int NOT NULL,
  actual_qty int DEFAULT 0,
  inspected_qty int DEFAULT 0,
  defective_qty int DEFAULT 0,
  location text,                  -- 上架库位
  status text DEFAULT 'pending',
  note text
);

-- ============================================================
-- 代打包订单（核心）
-- ============================================================

CREATE TABLE tlv_outbound_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES tlv_warehouses(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES tlv_merchants(id) ON DELETE CASCADE,
  order_no text NOT NULL,         -- 订单号（前端展示用）
  merchant_name text,             -- 冗余
  source text NOT NULL,           -- manual / platform
  platform text,                  -- 冗余: 平台名（Shopify/TikTok...）
  platform_id uuid REFERENCES tlv_platforms(id) ON DELETE SET NULL,
  platform_order_id text,

  receiver_name text NOT NULL,
  receiver_phone text,
  receiver_email text,
  receiver_address text NOT NULL,
  receiver_address2 text,
  receiver_city text NOT NULL,
  receiver_state text,
  receiver_postal_code text,
  receiver_country text NOT NULL,

  logistics_provider_id uuid REFERENCES tlv_logistics_providers(id) ON DELETE SET NULL,
  carrier text,                   -- 冗余: 承运商名
  service_level text,
  is_cod boolean DEFAULT false,
  cod_amount numeric(12,2) DEFAULT 0,

  status text DEFAULT 'pending',  -- pending→picking→packing→weighed→label_printed→shipped→completed

  weight_kg numeric(8,3) DEFAULT 0,
  package_length_cm numeric(6,2),
  package_width_cm numeric(6,2),
  package_height_cm numeric(6,2),

  tracking_no text,
  label_pdf_url text,

  packaging_fee numeric(10,2) DEFAULT 0,
  weight_fee numeric(10,2) DEFAULT 0,
  material_fee numeric(10,2) DEFAULT 0,
  cod_fee numeric(10,2) DEFAULT 0,
  total_charge numeric(10,2) DEFAULT 0,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  picked_at timestamptz,
  packed_at timestamptz,
  weighed_at timestamptz,
  labeled_at timestamptz,
  shipped_at timestamptz,
  completed_at timestamptz
);

CREATE TABLE tlv_outbound_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbound_id uuid NOT NULL REFERENCES tlv_outbound_orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES tlv_merchant_products(id) ON DELETE SET NULL,
  sku text NOT NULL,              -- 下单时的 SKU
  product_name text,              -- 冗余
  location text,                  -- 拣货库位
  qty int NOT NULL,
  unit_price numeric(10,2) DEFAULT 0,
  material_sku text,
  material_qty int DEFAULT 0,
  pick_status text DEFAULT 'pending',
  picked_qty int DEFAULT 0
);

CREATE TABLE tlv_outbound_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbound_id uuid NOT NULL REFERENCES tlv_outbound_orders(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES tlv_warehouses(id) ON DELETE CASCADE,
  operation_type text NOT NULL,   -- pick / pack / weigh / label / ship / cancel
  status_from text,
  status_to text,
  weight_kg numeric(8,3),
  charge_amount numeric(10,2),
  operator_id uuid,
  operator_note text,
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- 计费 + 财务
-- ============================================================

CREATE TABLE tlv_billing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES tlv_warehouses(id) ON DELETE CASCADE,
  merchant_id uuid REFERENCES tlv_merchants(id) ON DELETE CASCADE,
  rule_type text NOT NULL,        -- packaging / weight / material / cod / storage / inbound
  rule_name text NOT NULL,
  unit text NOT NULL,             -- pcs / kg / m3 / order / pct
  rate numeric(12,4) NOT NULL,
  condition jsonb DEFAULT '{}'::jsonb,
  priority int DEFAULT 100,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE tlv_billings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES tlv_warehouses(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES tlv_merchants(id) ON DELETE CASCADE,
  outbound_id uuid REFERENCES tlv_outbound_orders(id) ON DELETE SET NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  total numeric(12,2) NOT NULL,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  paid_at timestamptz
);

CREATE TABLE tlv_warehouse_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES tlv_warehouses(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  total_billings int DEFAULT 0,
  total_amount numeric(14,2) DEFAULT 0,
  platform_fee numeric(14,2) DEFAULT 0,
  net_amount numeric(14,2) DEFAULT 0,
  status text DEFAULT 'pending',
  confirmed_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- 物流
-- ============================================================

CREATE TABLE tlv_logistics_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbound_id uuid NOT NULL REFERENCES tlv_outbound_orders(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES tlv_merchants(id) ON DELETE CASCADE,
  logistics_provider_id uuid REFERENCES tlv_logistics_providers(id) ON DELETE SET NULL,
  tracking_no text NOT NULL,
  event_time timestamptz NOT NULL,
  event_code text,
  event_status text NOT NULL,
  event_location text,
  event_description text NOT NULL,
  raw_payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- 平台集成
-- ============================================================

CREATE TABLE tlv_platform_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid REFERENCES tlv_merchant_shops(id) ON DELETE SET NULL,
  platform_id uuid REFERENCES tlv_platforms(id) ON DELETE SET NULL,
  sync_type text NOT NULL,
  status text,
  records_fetched int DEFAULT 0,
  records_created int DEFAULT 0,
  records_updated int DEFAULT 0,
  records_failed int DEFAULT 0,
  error_message text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- 索引
-- ============================================================
CREATE INDEX idx_outbound_wh_status  ON tlv_outbound_orders(warehouse_id, status);
CREATE INDEX idx_outbound_merchant   ON tlv_outbound_orders(merchant_id, created_at DESC);
CREATE INDEX idx_outbound_tracking   ON tlv_outbound_orders(tracking_no);
CREATE INDEX idx_inbound_status       ON tlv_inbound_orders(warehouse_id, status);
CREATE INDEX idx_inventory_wh         ON tlv_merchant_inventory(warehouse_id, sku);
CREATE INDEX idx_wallets_merchant     ON tlv_merchant_wallets(merchant_id, created_at DESC);
CREATE INDEX idx_tracking_outbound    ON tlv_logistics_tracking(outbound_id, event_time DESC);
CREATE INDEX idx_ops_outbound         ON tlv_outbound_operations(outbound_id, created_at DESC);

-- ============================================================
-- calc_outbound_charge — 出库称重时自动计费
-- ============================================================
CREATE OR REPLACE FUNCTION calc_outbound_charge(p_outbound_id uuid, p_weight_kg numeric)
RETURNS numeric AS $$
DECLARE
  v_wh uuid;
  v_merchant uuid;
  v_fee_pkg numeric;
  v_fee_weight numeric;
  v_fee_cod numeric;
  v_total numeric := 0;
BEGIN
  SELECT warehouse_id, merchant_id INTO v_wh, v_merchant
  FROM tlv_outbound_orders WHERE id = p_outbound_id;

  -- 1. 基础打包费 (per_pkg 规则)
  SELECT COALESCE(rate, 0) INTO v_fee_pkg FROM tlv_billing_rules
  WHERE warehouse_id = v_wh AND (merchant_id = v_merchant OR merchant_id IS NULL)
    AND rule_type = 'packaging' AND status = 'active'
  ORDER BY merchant_id NULLS LAST, priority ASC LIMIT 1;

  -- 2. 重计费
  SELECT COALESCE(rate, 0) * p_weight_kg INTO v_fee_weight FROM tlv_billing_rules
  WHERE warehouse_id = v_wh AND (merchant_id = v_merchant OR merchant_id IS NULL)
    AND rule_type = 'weight' AND status = 'active'
  ORDER BY merchant_id NULLS LAST, priority ASC LIMIT 1;

  -- 3. COD 手续费（如果是 COD 单）
  SELECT COALESCE(rate, 0) INTO v_fee_cod FROM tlv_billing_rules
  WHERE warehouse_id = v_wh AND (merchant_id = v_merchant OR merchant_id IS NULL)
    AND rule_type = 'cod' AND status = 'active'
  ORDER BY merchant_id NULLS LAST, priority ASC LIMIT 1;

  -- COD 费 = cod_amount * rate / 100 (rate 存的是百分比如 3.00 = 3%)
  IF v_fee_cod > 0 THEN
    SELECT COALESCE(cod_amount, 0) * v_fee_cod / 100 INTO v_fee_cod
    FROM tlv_outbound_orders WHERE id = p_outbound_id AND is_cod = true;
    v_fee_cod := COALESCE(v_fee_cod, 0);
  END IF;

  v_total := COALESCE(v_fee_pkg, 0) + COALESCE(v_fee_weight, 0) + COALESCE(v_fee_cod, 0);

  -- 更新出库单
  UPDATE tlv_outbound_orders SET
    weight_kg = p_weight_kg,
    packaging_fee = COALESCE(v_fee_pkg, 0),
    weight_fee = COALESCE(v_fee_weight, 0),
    cod_fee = COALESCE(v_fee_cod, 0),
    total_charge = v_total,
    updated_at = now()
  WHERE id = p_outbound_id;

  -- 自动扣款（从 merchant 余额）
  UPDATE tlv_merchants
  SET balance = balance - v_total,
      updated_at = now()
  WHERE id = v_merchant;

  -- 记钱包流水
  INSERT INTO tlv_merchant_wallets
    (merchant_id, warehouse_id, type, amount, balance_after, ref_table, ref_id, note)
  SELECT
    v_merchant, v_wh, 'consume', -v_total, balance,
    'tlv_outbound_orders', p_outbound_id, '出库单计费扣款'
  FROM tlv_merchants WHERE id = v_merchant;

  RETURN v_total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION calc_outbound_charge(uuid, numeric) TO authenticated, anon;

-- ============================================================
-- RLS 全部启用 + 开发期 permissive
-- 上线前改为严格策略
-- ============================================================
DO $$
  DECLARE tbl record;
BEGIN
  FOR tbl IN SELECT tablename FROM pg_tables
             WHERE schemaname='public' AND tablename LIKE 'tlv_%' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl.tablename);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (true) WITH CHECK (true)',
      tbl.tablename || '_all', tbl.tablename
    );
  END LOOP;
END $$;
