-- ============================================================
-- Thalvior 跨境电商代打包 SaaS — 完整多租户 DB Schema
-- 版本: v6.0 (货小易/妙手ERP 级别)
-- 架构: merchant_id + warehouse_id 双租户隔离
-- ============================================================

BEGIN;

-- ════════════════════════════════════════════════════════════
-- 1. SAAS 平台层（Thalvior 运营方）
-- ════════════════════════════════════════════════════════════

-- 商家（跨境电商卖家）
CREATE TABLE IF NOT EXISTS tlv_merchants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','banned')),
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','basic','pro','enterprise')),
  balance DECIMAL(14,2) NOT NULL DEFAULT 0,
  frozen_balance DECIMAL(14,2) NOT NULL DEFAULT 0,
  warehouse_id UUID,  -- 默认合作仓库
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 商家关联平台店铺（TikTok Shop / Shopee / Amazon / Lazada / Temu / Shopify）
CREATE TABLE IF NOT EXISTS tlv_merchant_shops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES tlv_merchants(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('tiktok','shopee','amazon','lazada','temu','shopify','manual')),
  shop_name TEXT NOT NULL,
  shop_id TEXT,          -- 平台侧店铺ID
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','expired')),
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 仓库（代打包服务商）
CREATE TABLE IF NOT EXISTS tlv_warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  country TEXT NOT NULL,
  address TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  api_key TEXT UNIQUE DEFAULT gen_random_uuid(),
  billing_mode TEXT NOT NULL DEFAULT 'per_order' CHECK (billing_mode IN ('per_order','per_kg','per_package','hybrid')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════
-- 2. 计费 & 资金层
-- ════════════════════════════════════════════════════════════

-- 计费规则（仓库给商家的报价）
CREATE TABLE IF NOT EXISTS tlv_billing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES tlv_warehouses(id) ON DELETE CASCADE,
  merchant_id UUID REFERENCES tlv_merchants(id) ON DELETE SET NULL,  -- NULL=默认规则
  rule_name TEXT NOT NULL,
  charge_type TEXT NOT NULL CHECK (charge_type IN ('packing','storage','consumable','weight','asns','inspection')),
  unit TEXT NOT NULL,        -- '个' / 'kg' / 'cbm' / '天' / '单'
  rate DECIMAL(10,4) NOT NULL,
  min_charge DECIMAL(10,2),
  condition JSONB,           -- 例: {"min_weight": 0.5, "max_weight": 2}
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 商家钱包流水
CREATE TABLE IF NOT EXISTS tlv_merchant_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES tlv_merchants(id) ON DELETE CASCADE,
  warehouse_id UUID REFERENCES tlv_warehouses(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('recharge','consume','refund','adjust','withdraw')),
  amount DECIMAL(14,2) NOT NULL,
  balance_after DECIMAL(14,2) NOT NULL,
  ref_id UUID,               -- 关联订单/账单
  remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 仓库结算流水
CREATE TABLE IF NOT EXISTS tlv_warehouse_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES tlv_warehouses(id) ON DELETE CASCADE,
  merchant_id UUID REFERENCES tlv_merchants(id) ON DELETE SET NULL,
  amount DECIMAL(14,2) NOT NULL,
  settlement_type TEXT NOT NULL,  -- 'packing','storage','consumable'
  period_start DATE,
  period_end DATE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','paid')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════
-- 3. 商家商品 & 库存
-- ════════════════════════════════════════════════════════════

-- 商家商品（SKU）
CREATE TABLE IF NOT EXISTS tlv_merchant_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES tlv_merchants(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES tlv_warehouses(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  name TEXT,
  barcode TEXT,
  image_url TEXT,
  weight_kg DECIMAL(10,3),
  length_cm DECIMAL(8,2),
  width_cm DECIMAL(8,2),
  height_cm DECIMAL(8,2),
  stackable BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(merchant_id, warehouse_id, sku)
);

-- 商品库存（商家视角）
CREATE TABLE IF NOT EXISTS tlv_merchant_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES tlv_merchants(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES tlv_warehouses(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES tlv_merchant_products(id) ON DELETE CASCADE,
  location_code TEXT,        -- 仓库内部库位
  qty INTEGER NOT NULL DEFAULT 0,
  reserved_qty INTEGER NOT NULL DEFAULT 0,   -- 已被订单占用
  inbound_qty INTEGER NOT NULL DEFAULT 0,    -- 在途
  last_restocked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(merchant_id, warehouse_id, product_id, location_code)
);

-- ════════════════════════════════════════════════════════════
-- 4. 入库流程（商家备货 → 仓库收货）
-- ════════════════════════════════════════════════════════════

-- 商家入库单（商家创建 → 仓库收到后处理）
CREATE TABLE IF NOT EXISTS tlv_inbound_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES tlv_merchants(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES tlv_warehouses(id) ON DELETE CASCADE,
  inbound_no TEXT UNIQUE NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual','erp','purchase')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending','received','inspecting','stocking','completed','cancelled')
  ),
  tracking_no TEXT,          -- 国内快递单号
  carrier TEXT,
  total_items INTEGER DEFAULT 0,
  remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 入库商品明细
CREATE TABLE IF NOT EXISTS tlv_inbound_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_id UUID NOT NULL REFERENCES tlv_inbound_orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES tlv_merchant_products(id) ON DELETE SET NULL,
  sku TEXT NOT NULL,
  name TEXT,
  expected_qty INTEGER NOT NULL,
  received_qty INTEGER NOT NULL DEFAULT 0,
  inspected_qty INTEGER NOT NULL DEFAULT 0,
  defective_qty INTEGER NOT NULL DEFAULT 0,
  location_code TEXT,
  photo_urls TEXT[],
  remark TEXT
);

-- ════════════════════════════════════════════════════════════
-- 5. 代打包订单核心
-- ════════════════════════════════════════════════════════════

-- 代打包订单（= 商家销售订单 + 代打包请求）
CREATE TABLE IF NOT EXISTS tlv_outbound_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES tlv_merchants(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES tlv_warehouses(id) ON DELETE CASCADE,
  order_no TEXT UNIQUE NOT NULL,
  platform TEXT CHECK (platform IN ('tiktok','shopee','amazon','lazada','temu','shopify','manual')),
  platform_order_id TEXT,    -- 平台原订单号
  shop_id UUID REFERENCES tlv_merchant_shops(id),
  order_source TEXT NOT NULL DEFAULT 'manual' CHECK (order_source IN ('platform_push','manual','erp_api')),
  
  -- 收件人
  receiver_name TEXT NOT NULL,
  receiver_phone TEXT,
  receiver_address1 TEXT NOT NULL,
  receiver_address2 TEXT,
  receiver_city TEXT,
  receiver_state TEXT,
  receiver_postal TEXT,
  receiver_country TEXT NOT NULL,
  
  -- 物流
  logistics_channel TEXT,
  tracking_no TEXT,          -- 最终单号（出库后填）
  is_cod BOOLEAN DEFAULT FALSE,  -- 是否货到付款
  
  -- 状态机
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending','confirmed','picking','packing','weighed','shipped','completed','cancelled','exception')
  ),
  
  -- 重量 & 计费
  charged_weight_kg DECIMAL(10,3),
  total_charge DECIMAL(14,2),
  charge_breakdown JSONB,    -- [{type:"packing", amount:1.5}, ...]
  
  COD_amount DECIMAL(14,2),  -- COD 代收金额
  COD_status TEXT,           -- 'pending','collected','remitted'
  
  exception_reason TEXT,
  remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 代打包订单明细
CREATE TABLE IF NOT EXISTS tlv_outbound_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbound_id UUID NOT NULL REFERENCES tlv_outbound_orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES tlv_merchant_products(id) ON DELETE SET NULL,
  sku TEXT NOT NULL,
  name TEXT,
  qty INTEGER NOT NULL,
  picked_qty INTEGER NOT NULL DEFAULT 0,
  location_code TEXT         -- 实际拣货库位
);

-- 打包包裹
CREATE TABLE IF NOT EXISTS tlv_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbound_id UUID NOT NULL REFERENCES tlv_outbound_orders(id) ON DELETE CASCADE,
  package_no TEXT UNIQUE NOT NULL,
  weight_kg DECIMAL(10,3),
  length_cm DECIMAL(8,2),
  width_cm DECIMAL(8,2),
  height_cm DECIMAL(8,2),
  consumables JSONB,         -- 使用的耗材: [{type:"box", spec:"30x20x15", qty:1}]
  waybill_url TEXT,          -- 面单 PDF URL
  tracking_no TEXT,
  status TEXT NOT NULL DEFAULT 'packed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════
-- 6. 平台对接 & 物流追踪
-- ════════════════════════════════════════════════════════════

-- 平台订单同步日志
CREATE TABLE IF NOT EXISTS tlv_platform_sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID REFERENCES tlv_merchants(id) ON DELETE SET NULL,
  shop_id UUID REFERENCES tlv_merchant_shops(id) ON DELETE SET NULL,
  platform TEXT NOT NULL,
  action TEXT NOT NULL,      -- 'pull_orders','push_tracking','cancel_order'
  external_id TEXT,          -- 平台订单号
  status TEXT NOT NULL CHECK (status IN ('success','failed','partial')),
  request_payload JSONB,
  response_payload JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 物流轨迹
CREATE TABLE IF NOT EXISTS tlv_logistics_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbound_id UUID REFERENCES tlv_outbound_orders(id) ON DELETE CASCADE,
  tracking_no TEXT NOT NULL,
  event_time TIMESTAMPTZ NOT NULL,
  event_status TEXT NOT NULL,
  event_desc TEXT,
  location TEXT,
  carrier TEXT,
  raw_payload JSONB
);

-- ════════════════════════════════════════════════════════════
-- 7. 平台 SaaS 管理端辅助
-- ════════════════════════════════════════════════════════════

-- 通知/站内信
CREATE TABLE IF NOT EXISTS tlv_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID REFERENCES tlv_merchants(id) ON DELETE CASCADE,
  warehouse_id UUID REFERENCES tlv_warehouses(id) ON DELETE CASCADE,
  type TEXT NOT NULL,        -- 'order_status','billing','system','cod'
  title TEXT NOT NULL,
  content TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  ref_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════
-- 8. Indexes + RLS
-- ════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_inv_merch_wareh ON tlv_merchant_inventory(merchant_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inv_merch_prod ON tlv_merchant_inventory(merchant_id, product_id);
CREATE INDEX IF NOT EXISTS idx_ob_merch_status ON tlv_outbound_orders(merchant_id, warehouse_id, status);
CREATE INDEX IF NOT EXISTS idx_ob_wareh_status ON tlv_outbound_orders(warehouse_id, status);
CREATE INDEX IF NOT EXISTS idx_ob_platform ON tlv_outbound_orders(platform, platform_order_id);
CREATE INDEX IF NOT EXISTS idx_ob_created ON tlv_outbound_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_ib_merch_wareh ON tlv_inbound_orders(merchant_id, warehouse_id, status);
CREATE INDEX IF NOT EXISTS idx_wallet_merch ON tlv_merchant_wallets(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracking_no ON tlv_logistics_tracking(tracking_no, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_platform_sync ON tlv_platform_sync_logs(platform, external_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pkg_outbound ON tlv_packages(outbound_id);

-- RLS: 商家只能看自己的数据
ALTER TABLE tlv_merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tlv_merchant_shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE tlv_merchant_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE tlv_merchant_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE tlv_inbound_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE tlv_inbound_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE tlv_outbound_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE tlv_outbound_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE tlv_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE tlv_merchant_wallets ENABLE ROW LEVEL SECURITY;

-- 简单策略: 用 auth.jwt() 里的 merchant_id / warehouse_id
CREATE OR REPLACE FUNCTION current_merchant_id() RETURNS UUID AS $$
BEGIN
  RETURN (auth.jwt()->>'merchant_id')::UUID;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION current_warehouse_id() RETURNS UUID AS $$
BEGIN
  RETURN (auth.jwt()->>'warehouse_id')::UUID;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE POLICY merchant_isolation ON tlv_merchant_inventory
  FOR ALL USING (merchant_id = current_merchant_id() OR current_merchant_id() IS NULL);
CREATE POLICY merchant_isolation_prod ON tlv_merchant_products
  FOR ALL USING (merchant_id = current_merchant_id() OR current_merchant_id() IS NULL);
CREATE POLICY merchant_isolation_ob ON tlv_outbound_orders
  FOR ALL USING (merchant_id = current_merchant_id() OR warehouse_id = current_warehouse_id() OR current_merchant_id() IS NULL);
CREATE POLICY merchant_isolation_ib ON tlv_inbound_orders
  FOR ALL USING (merchant_id = current_merchant_id() OR warehouse_id = current_warehouse_id() OR current_merchant_id() IS NULL);
CREATE POLICY merchant_isolation_wallet ON tlv_merchant_wallets
  FOR ALL USING (merchant_id = current_merchant_id() OR current_merchant_id() IS NULL);

COMMIT;
