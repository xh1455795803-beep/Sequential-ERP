-- ================================================================
-- Thalvior WMS v4 — DB 补全
-- 补全新表 + 补全 FK + 触发器 + inventory.qty_available
-- ================================================================

BEGIN;

-- =====================================================
-- 1. wms_skus — SKU 主数据表（独立于 inventory）
-- =====================================================
CREATE TABLE IF NOT EXISTS wms_skus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id text,                    -- ERP Product 关联
  sku text NOT NULL,                  -- WMS 内部 SKU 编码
  sku_name text NOT NULL,             -- SKU 名称
  barcode text,                       -- 主条码
  barcode_alt text[],                 -- 备用条码数组
  upc text,
  ean text,
  brand text,
  category text,
  sub_category text,
  unit text DEFAULT '件',
  weight_kg numeric(10,3) DEFAULT 0,
  length_cm numeric(10,2) DEFAULT 0,
  width_cm numeric(10,2) DEFAULT 0,
  height_cm numeric(10,2) DEFAULT 0,
  volume_cm3 numeric(12,2) DEFAULT 0,
  unit_cost numeric(12,2) DEFAULT 0,
  sale_price numeric(12,2) DEFAULT 0,
  currency text DEFAULT 'CNY',
  image_url text,
  abc_class text DEFAULT 'C',         -- ABC 分类：A/B/C
  fifo_enabled boolean DEFAULT true,  -- 是否 FIFO
  expiry_enabled boolean DEFAULT false, -- 是否效期管理
  min_stock_qty integer DEFAULT 0,
  max_stock_qty integer DEFAULT 0,
  status text DEFAULT 'active',
  remark text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_wms_skus_user ON wms_skus(user_id);
CREATE INDEX IF NOT EXISTS idx_wms_skus_barcode ON wms_skus(barcode);
CREATE INDEX IF NOT EXISTS idx_wms_skus_product ON wms_skus(product_id);

-- RLS
ALTER TABLE wms_skus ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wms_skus_select ON wms_skus;
DROP POLICY IF EXISTS wms_skus_insert ON wms_skus;
DROP POLICY IF EXISTS wms_skus_update ON wms_skus;
DROP POLICY IF EXISTS wms_skus_delete ON wms_skus;
CREATE POLICY wms_skus_select ON wms_skus FOR SELECT USING (user_id = auth.uid());
CREATE POLICY wms_skus_insert ON wms_skus FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY wms_skus_update ON wms_skus FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY wms_skus_delete ON wms_skus FOR DELETE USING (user_id = auth.uid());

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_skus_updated ON wms_skus;
CREATE TRIGGER trg_skus_updated BEFORE UPDATE ON wms_skus
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================
-- 2. wms_packages — 包裹/打包记录（Shipment 打包步骤）
-- =====================================================
CREATE TABLE IF NOT EXISTS wms_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shipment_id uuid NOT NULL REFERENCES wms_shipments(id) ON DELETE CASCADE,
  package_no text NOT NULL,           -- 包裹编号 PK-001
  package_type text DEFAULT 'standard', -- standard/express/oversize
  length_cm numeric(10,2) DEFAULT 0,
  width_cm numeric(10,2) DEFAULT 0,
  height_cm numeric(10,2) DEFAULT 0,
  weight_kg numeric(10,3) DEFAULT 0,
  carrier_id uuid REFERENCES wms_carriers(id),
  tracking_no text,
  label_pdf_url text,
  label_status text DEFAULT 'pending', -- pending/generated/failed
  shipping_cost numeric(10,2) DEFAULT 0,
  status text DEFAULT 'packed',        -- packed/labeled/shipped
  packed_by text,
  packed_at timestamptz,
  labeled_at timestamptz,
  shipped_at timestamptz,
  remark text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wms_packages_shipment ON wms_packages(shipment_id);

ALTER TABLE wms_packages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wms_packages_select ON wms_packages;
DROP POLICY IF EXISTS wms_packages_insert ON wms_packages;
DROP POLICY IF EXISTS wms_packages_update ON wms_packages;
DROP POLICY IF EXISTS wms_packages_delete ON wms_packages;
CREATE POLICY wms_packages_select ON wms_packages FOR SELECT USING (user_id = auth.uid());
CREATE POLICY wms_packages_insert ON wms_packages FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY wms_packages_update ON wms_packages FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY wms_packages_delete ON wms_packages FOR DELETE USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS trg_packages_updated ON wms_packages;
CREATE TRIGGER trg_packages_updated BEFORE UPDATE ON wms_packages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================
-- 3. wms_packages_items — 包裹内 SKU 明细
-- =====================================================
CREATE TABLE IF NOT EXISTS wms_package_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES wms_packages(id) ON DELETE CASCADE,
  shipment_item_id uuid REFERENCES wms_shipment_items(id) ON DELETE SET NULL,
  sku text NOT NULL,
  sku_name text,
  qty integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wms_package_items_package ON wms_package_items(package_id);

ALTER TABLE wms_package_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wms_package_items_select ON wms_package_items;
DROP POLICY IF EXISTS wms_package_items_insert ON wms_package_items;
DROP POLICY IF EXISTS wms_package_items_update ON wms_package_items;
DROP POLICY IF EXISTS wms_package_items_delete ON wms_package_items;
CREATE POLICY wms_package_items_select ON wms_package_items FOR SELECT USING (user_id = auth.uid());
CREATE POLICY wms_package_items_insert ON wms_package_items FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY wms_package_items_update ON wms_package_items FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY wms_package_items_delete ON wms_package_items FOR DELETE USING (user_id = auth.uid());

-- =====================================================
-- 4. wms_sync_status — ERP/外部系统同步状态
-- =====================================================
CREATE TABLE IF NOT EXISTS wms_sync_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_system text NOT NULL,          -- 'erp'/'shopify'/'ozon'/'woocommerce'
  entity_type text NOT NULL,            -- 'order'/'product'/'inventory'/'shipment'
  entity_id text NOT NULL,              -- 外部系统的实体 ID
  wms_entity_type text,                 -- 对应的 WMS 表
  wms_entity_id uuid,                   -- 对应的 WMS 实体 ID
  direction text NOT NULL,              -- 'pull'/'push'
  status text NOT NULL DEFAULT 'pending', -- pending/success/failed/partial
  payload_in jsonb,
  payload_out jsonb,
  error_msg text,
  retry_count integer DEFAULT 0,
  last_attempt_at timestamptz,
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_system, entity_type, entity_id, direction)
);

CREATE INDEX IF NOT EXISTS idx_wms_sync_status_user ON wms_sync_status(user_id);
CREATE INDEX IF NOT EXISTS idx_wms_sync_status_status ON wms_sync_status(status);

ALTER TABLE wms_sync_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wms_sync_status_select ON wms_sync_status;
DROP POLICY IF EXISTS wms_sync_status_insert ON wms_sync_status;
DROP POLICY IF EXISTS wms_sync_status_update ON wms_sync_status;
DROP POLICY IF EXISTS wms_sync_status_delete ON wms_sync_status;
CREATE POLICY wms_sync_status_select ON wms_sync_status FOR SELECT USING (user_id = auth.uid());
CREATE POLICY wms_sync_status_insert ON wms_sync_status FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY wms_sync_status_update ON wms_sync_status FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY wms_sync_status_delete ON wms_sync_status FOR DELETE USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS trg_sync_status_updated ON wms_sync_status;
CREATE TRIGGER trg_sync_status_updated BEFORE UPDATE ON wms_sync_status
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================
-- 5. wms_webhook_deliveries — Webhook 投递日志
-- =====================================================
CREATE TABLE IF NOT EXISTS wms_webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  webhook_id uuid,                      -- 关联 webhooks 表
  event text NOT NULL,                  -- 'shipment.shipped'/'asn.received'/'inventory.low_stock'
  url text NOT NULL,
  request_body jsonb NOT NULL,
  response_code integer,
  response_body text,
  status text NOT NULL DEFAULT 'pending', -- pending/success/failed
  delivery_attempts integer DEFAULT 1,
  duration_ms integer,
  delivered_at timestamptz,
  error_msg text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wms_webhook_deliveries_user ON wms_webhook_deliveries(user_id);
CREATE INDEX IF NOT EXISTS idx_wms_webhook_deliveries_event ON wms_webhook_deliveries(event);
CREATE INDEX IF NOT EXISTS idx_wms_webhook_deliveries_status ON wms_webhook_deliveries(status);

ALTER TABLE wms_webhook_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wms_webhook_deliveries_select ON wms_webhook_deliveries;
DROP POLICY IF EXISTS wms_webhook_deliveries_insert ON wms_webhook_deliveries;
DROP POLICY IF EXISTS wms_webhook_deliveries_update ON wms_webhook_deliveries;
DROP POLICY IF EXISTS wms_webhook_deliveries_delete ON wms_webhook_deliveries;
CREATE POLICY wms_webhook_deliveries_select ON wms_webhook_deliveries FOR SELECT USING (user_id = auth.uid());
CREATE POLICY wms_webhook_deliveries_insert ON wms_webhook_deliveries FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY wms_webhook_deliveries_update ON wms_webhook_deliveries FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY wms_webhook_deliveries_delete ON wms_webhook_deliveries FOR DELETE USING (user_id = auth.uid());

-- =====================================================
-- 6. wms_settings — WMS 用户设置
-- =====================================================
CREATE TABLE IF NOT EXISTS wms_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  default_warehouse_id uuid REFERENCES wms_warehouses(id),
  putaway_strategy text DEFAULT 'fifo', -- fifo/fefo/abc/manual
  pick_strategy text DEFAULT 'fifo',
  auto_release_pick boolean DEFAULT true,
  auto_create_packages boolean DEFAULT true,
  low_stock_warning_pct integer DEFAULT 20,
  expiry_warning_days integer DEFAULT 60,
  weight_unit text DEFAULT 'kg',
  dimension_unit text DEFAULT 'cm',
  currency text DEFAULT 'CNY',
  notify_on_low_stock boolean DEFAULT true,
  notify_on_overdue boolean DEFAULT true,
  notify_on_sync_failure boolean DEFAULT true,
  remark text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE wms_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wms_settings_select ON wms_settings;
DROP POLICY IF EXISTS wms_settings_insert ON wms_settings;
DROP POLICY IF EXISTS wms_settings_update ON wms_settings;
CREATE POLICY wms_settings_select ON wms_settings FOR SELECT USING (user_id = auth.uid());
CREATE POLICY wms_settings_insert ON wms_settings FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY wms_settings_update ON wms_settings FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP TRIGGER IF EXISTS trg_settings_updated ON wms_settings;
CREATE TRIGGER trg_settings_updated BEFORE UPDATE ON wms_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================
-- 7. wms_staff_tasks — 作业员任务记录（用于绩效统计）
-- =====================================================
CREATE TABLE IF NOT EXISTS wms_staff_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES wms_warehouses(id) ON DELETE CASCADE,
  staff_email text NOT NULL,
  task_type text NOT NULL,               -- 'putaway'/'pick'/'stocktaking'/'receive'
  task_id uuid,                          -- 关联的业务单 ID
  sku text,
  qty integer DEFAULT 0,
  location_id uuid,
  duration_sec integer,                  -- 耗时秒数
  accuracy numeric(5,2) DEFAULT 100,    -- 准确率百分比
  status text DEFAULT 'completed',       -- pending/completed/corrected
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wms_staff_tasks_user ON wms_staff_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_wms_staff_tasks_staff ON wms_staff_tasks(staff_email);
CREATE INDEX IF NOT EXISTS idx_wms_staff_tasks_type ON wms_staff_tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_wms_staff_tasks_date ON wms_staff_tasks(created_at);

ALTER TABLE wms_staff_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wms_staff_tasks_select ON wms_staff_tasks;
DROP POLICY IF EXISTS wms_staff_tasks_insert ON wms_staff_tasks;
DROP POLICY IF EXISTS wms_staff_tasks_update ON wms_staff_tasks;
DROP POLICY IF EXISTS wms_staff_tasks_delete ON wms_staff_tasks;
CREATE POLICY wms_staff_tasks_select ON wms_staff_tasks FOR SELECT USING (user_id = auth.uid());
CREATE POLICY wms_staff_tasks_insert ON wms_staff_tasks FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY wms_staff_tasks_update ON wms_staff_tasks FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY wms_staff_tasks_delete ON wms_staff_tasks FOR DELETE USING (user_id = auth.uid());

-- =====================================================
-- 8. wms_audit_log — WMS 操作审计日志（比 admin_audit_log 更聚焦）
-- =====================================================
CREATE TABLE IF NOT EXISTS wms_audit_log (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_email text NOT NULL,
  action text NOT NULL,                  -- 'create'/'update'/'delete'/'login'/'ship'/'receive'/'pick'/'putaway'
  entity_type text NOT NULL,             -- 'wms_shipments'/'wms_inventory'/'wms_asns'/...
  entity_id uuid,
  entity_no text,                        -- 业务单号 shipment_no/asn_no 等
  before_data jsonb,
  after_data jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wms_audit_log_user ON wms_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_wms_audit_log_action ON wms_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_wms_audit_log_entity ON wms_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_wms_audit_log_time ON wms_audit_log(created_at);

ALTER TABLE wms_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wms_audit_log_select ON wms_audit_log;
DROP POLICY IF EXISTS wms_audit_log_insert ON wms_audit_log;
-- 审计日志只允许自己读，前端不直接 insert（由触发器或 Edge Function 写）
CREATE POLICY wms_audit_log_select ON wms_audit_log FOR SELECT USING (user_id = auth.uid());
CREATE POLICY wms_audit_log_insert ON wms_audit_log FOR INSERT WITH CHECK (user_id = auth.uid());

-- =====================================================
-- 9. 补全所有缺失的 FK 约束
-- =====================================================

-- wms_inventory.location_id → wms_locations.id
DO $$ BEGIN
  ALTER TABLE wms_inventory ADD CONSTRAINT wms_inventory_location_id_fkey
    FOREIGN KEY (location_id) REFERENCES wms_locations(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- wms_inventory.warehouse_id → wms_warehouses.id
DO $$ BEGIN
  ALTER TABLE wms_inventory ADD CONSTRAINT wms_inventory_warehouse_id_fkey
    FOREIGN KEY (warehouse_id) REFERENCES wms_warehouses(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- wms_inventory.zone_id (if added later)

-- wms_asns.warehouse_id → wms_warehouses.id
DO $$ BEGIN
  ALTER TABLE wms_asns ADD CONSTRAINT wms_asns_warehouse_id_fkey
    FOREIGN KEY (warehouse_id) REFERENCES wms_warehouses(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- wms_asns.carrier_id → wms_carriers.id
DO $$ BEGIN
  ALTER TABLE wms_asns ADD CONSTRAINT wms_asns_carrier_id_fkey
    FOREIGN KEY (carrier_id) REFERENCES wms_carriers(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- wms_asn_items.asn_id → wms_asns.id
DO $$ BEGIN
  ALTER TABLE wms_asn_items ADD CONSTRAINT wms_asn_items_asn_id_fkey
    FOREIGN KEY (asn_id) REFERENCES wms_asns(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- wms_shipments.warehouse_id → wms_warehouses.id
DO $$ BEGIN
  ALTER TABLE wms_shipments ADD CONSTRAINT wms_shipments_warehouse_id_fkey
    FOREIGN KEY (warehouse_id) REFERENCES wms_warehouses(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- wms_shipments.carrier_id → wms_carriers.id
DO $$ BEGIN
  ALTER TABLE wms_shipments ADD CONSTRAINT wms_shipments_carrier_id_fkey
    FOREIGN KEY (carrier_id) REFERENCES wms_carriers(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- wms_shipment_items.shipment_id → wms_shipments.id
DO $$ BEGIN
  ALTER TABLE wms_shipment_items ADD CONSTRAINT wms_shipment_items_shipment_id_fkey
    FOREIGN KEY (shipment_id) REFERENCES wms_shipments(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- wms_locations.warehouse_id → wms_warehouses.id
DO $$ BEGIN
  ALTER TABLE wms_locations ADD CONSTRAINT wms_locations_warehouse_id_fkey
    FOREIGN KEY (warehouse_id) REFERENCES wms_warehouses(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- wms_locations.zone_id → wms_zones.id
DO $$ BEGIN
  ALTER TABLE wms_locations ADD CONSTRAINT wms_locations_zone_id_fkey
    FOREIGN KEY (zone_id) REFERENCES wms_zones(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- wms_zones.warehouse_id → wms_warehouses.id
DO $$ BEGIN
  ALTER TABLE wms_zones ADD CONSTRAINT wms_zones_warehouse_id_fkey
    FOREIGN KEY (warehouse_id) REFERENCES wms_warehouses(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- wms_receipt_scans.asn_id → wms_asns.id
DO $$ BEGIN
  ALTER TABLE wms_receipt_scans ADD CONSTRAINT wms_receipt_scans_asn_id_fkey
    FOREIGN KEY (asn_id) REFERENCES wms_asns(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- wms_putaway_tasks.target_location_id → wms_locations.id
DO $$ BEGIN
  ALTER TABLE wms_putaway_tasks ADD CONSTRAINT wms_putaway_tasks_loc_fkey
    FOREIGN KEY (target_location_id) REFERENCES wms_locations(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- wms_pick_tasks.from_location_id → wms_locations.id
DO $$ BEGIN
  ALTER TABLE wms_pick_tasks ADD CONSTRAINT wms_pick_tasks_loc_fkey
    FOREIGN KEY (from_location_id) REFERENCES wms_locations(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- wms_wave_tasks.warehouse_id → wms_warehouses.id
DO $$ BEGIN
  ALTER TABLE wms_wave_tasks ADD CONSTRAINT wms_wave_tasks_warehouse_fkey
    FOREIGN KEY (warehouse_id) REFERENCES wms_warehouses(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- wms_wave_items.wave_id → wms_wave_tasks.id
DO $$ BEGIN
  ALTER TABLE wms_wave_items ADD CONSTRAINT wms_wave_items_wave_fkey
    FOREIGN KEY (wave_id) REFERENCES wms_wave_tasks(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- wms_wave_items.shipment_id → wms_shipments.id
DO $$ BEGIN
  ALTER TABLE wms_wave_items ADD CONSTRAINT wms_wave_items_shipment_fkey
    FOREIGN KEY (shipment_id) REFERENCES wms_shipments(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- wms_stocktaking.warehouse_id → wms_warehouses.id
DO $$ BEGIN
  ALTER TABLE wms_stocktaking ADD CONSTRAINT wms_stocktaking_warehouse_fkey
    FOREIGN KEY (warehouse_id) REFERENCES wms_warehouses(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- wms_stocktaking_items.stocktaking_id → wms_stocktaking.id
DO $$ BEGIN
  ALTER TABLE wms_stocktaking_items ADD CONSTRAINT wms_stocktaking_items_st_fkey
    FOREIGN KEY (stocktaking_id) REFERENCES wms_stocktaking(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- wms_returns.warehouse_id → wms_warehouses.id
DO $$ BEGIN
  ALTER TABLE wms_returns ADD CONSTRAINT wms_returns_warehouse_fkey
    FOREIGN KEY (warehouse_id) REFERENCES wms_warehouses(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- wms_returns.shipment_id → wms_shipments.id
DO $$ BEGIN
  ALTER TABLE wms_returns ADD CONSTRAINT wms_returns_shipment_fkey
    FOREIGN KEY (shipment_id) REFERENCES wms_shipments(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- wms_return_items.return_id → wms_returns.id
DO $$ BEGIN
  ALTER TABLE wms_return_items ADD CONSTRAINT wms_return_items_return_fkey
    FOREIGN KEY (return_id) REFERENCES wms_returns(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- wms_bill_items.bill_id → wms_bills.id
DO $$ BEGIN
  ALTER TABLE wms_bill_items ADD CONSTRAINT wms_bill_items_bill_fkey
    FOREIGN KEY (bill_id) REFERENCES wms_bills(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- wms_carrier_api_logs.carrier_id → wms_carriers.id
DO $$ BEGIN
  ALTER TABLE wms_carrier_api_logs ADD CONSTRAINT wms_carrier_logs_carrier_fkey
    FOREIGN KEY (carrier_id) REFERENCES wms_carriers(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- wms_staff_performance.warehouse_id → wms_warehouses.id
DO $$ BEGIN
  ALTER TABLE wms_staff_performance ADD CONSTRAINT wms_staff_perf_warehouse_fkey
    FOREIGN KEY (warehouse_id) REFERENCES wms_warehouses(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- wms_carrier_integrations.carrier_id → wms_carriers.id
DO $$ BEGIN
  ALTER TABLE wms_carrier_integrations ADD CONSTRAINT wms_carrier_int_carrier_fkey
    FOREIGN KEY (carrier_id) REFERENCES wms_carriers(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- =====================================================
-- 10. inventory.qty_available — 改为真正的 generated column
-- =====================================================
ALTER TABLE wms_inventory DROP COLUMN IF EXISTS qty_available;
ALTER TABLE wms_inventory ADD COLUMN qty_available integer
  GENERATED ALWAYS AS (qty_on_hand - qty_reserved) STORED;

CREATE INDEX IF NOT EXISTS idx_wms_inventory_available ON wms_inventory(qty_available)
  WHERE qty_available < 0;

COMMIT;

SELECT '✅ WMS v4 DB migration complete' as result;
