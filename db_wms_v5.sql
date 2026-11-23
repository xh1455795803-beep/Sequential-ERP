-- ============================================
-- WMS v5 DB Migration
-- Phase 0: Cleanup ALL seed data
-- Phase 1: P0 features (FBA退货换标, 工单, 截单, Dashboard新结构)
-- Phase 2: P1 features (入库预约, 拆合包裹, 盘点冻结, 波次策略, 动销报表)
-- Phase 3: Schema improvements
-- ============================================

BEGIN;

-- ============================================
-- PHASE 0: CLEANUP ALL SEED DATA (保留结构)
-- ============================================

TRUNCATE TABLE wms_pick_tasks CASCADE;
TRUNCATE TABLE wms_package_items CASCADE;
TRUNCATE TABLE wms_packages CASCADE;
TRUNCATE TABLE wms_shipment_items CASCADE;
TRUNCATE TABLE wms_shipments CASCADE;
TRUNCATE TABLE wms_wave_items CASCADE;
TRUNCATE TABLE wms_wave_tasks CASCADE;
TRUNCATE TABLE wms_putaway_tasks CASCADE;
TRUNCATE TABLE wms_receipt_scans CASCADE;
TRUNCATE TABLE wms_asn_items CASCADE;
TRUNCATE TABLE wms_asns CASCADE;
TRUNCATE TABLE wms_inventory_logs CASCADE;
TRUNCATE TABLE wms_inventory CASCADE;
TRUNCATE TABLE wms_return_items CASCADE;
TRUNCATE TABLE wms_returns CASCADE;
TRUNCATE TABLE wms_stocktaking_items CASCADE;
TRUNCATE TABLE wms_stocktaking CASCADE;
TRUNCATE TABLE wms_transfer_items CASCADE;
TRUNCATE TABLE wms_transfers CASCADE;
TRUNCATE TABLE wms_bom_items CASCADE;
TRUNCATE TABLE wms_bom CASCADE;
TRUNCATE TABLE wms_kitting_orders CASCADE;
TRUNCATE TABLE wms_bill_items CASCADE;
TRUNCATE TABLE wms_bills CASCADE;
TRUNCATE TABLE wms_billing_rates CASCADE;
TRUNCATE TABLE wms_carrier_api_logs CASCADE;
TRUNCATE TABLE wms_staff_performance CASCADE;
TRUNCATE TABLE wms_staff_tasks CASCADE;
TRUNCATE TABLE inventory_adjustments CASCADE;
TRUNCATE TABLE stock_adjustments CASCADE;
TRUNCATE TABLE wms_locations CASCADE;
TRUNCATE TABLE wms_zones CASCADE;
TRUNCATE TABLE wms_warehouses CASCADE;
TRUNCATE TABLE wms_carriers CASCADE;
TRUNCATE TABLE wms_skus CASCADE;
TRUNCATE TABLE wms_user_roles CASCADE;
TRUNCATE TABLE wms_customers CASCADE;
TRUNCATE TABLE wms_sync_status CASCADE;
TRUNCATE TABLE wms_audit_log CASCADE;
TRUNCATE TABLE wms_settings CASCADE;
TRUNCATE TABLE wms_webhook_deliveries CASCADE;
TRUNCATE TABLE wms_work_orders CASCADE;
TRUNCATE TABLE wms_fba_returns CASCADE;
TRUNCATE TABLE wms_fba_relabels CASCADE;
TRUNCATE TABLE wms_shipment_cancellations CASCADE;
TRUNCATE TABLE wms_supplies CASCADE;
TRUNCATE TABLE wms_supply_usage CASCADE;
TRUNCATE TABLE wms_shipment_cancellation_items CASCADE;

-- Reset sequences
SELECT setval(pg_get_serial_sequence('wms_inventory_logs','id'),1,false);
SELECT setval(pg_get_serial_sequence('wms_carrier_api_logs','id'),1,false);

-- ============================================
-- PHASE 1: P0 NEW TABLES
-- ============================================

-- 1.1 FBA 退货换标 (领星独立模块)
CREATE TABLE IF NOT EXISTS wms_fba_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES wms_warehouses(id) ON DELETE RESTRICT,
  fba_return_no text NOT NULL UNIQUE,
  order_id text,
  amazon_return_id text,
  reason text,
  status text NOT NULL DEFAULT 'pending',  -- pending → received → inspected → restocked → disposed → completed
  qty_total integer DEFAULT 0,
  qty_good integer DEFAULT 0,
  qty_bad integer DEFAULT 0,
  qty_disposed integer DEFAULT 0,
  received_at timestamptz,
  inspected_at timestamptz,
  operator text,
  remark text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wms_fba_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fba_return_id uuid NOT NULL REFERENCES wms_fba_returns(id) ON DELETE CASCADE,
  sku text,
  sku_name text,
  amazon_asin text,
  sku_condition text DEFAULT 'new',
  qty_expected integer DEFAULT 0,
  qty_received integer DEFAULT 0,
  qty_good integer DEFAULT 0,
  qty_bad integer DEFAULT 0,
  disposition text,
  disposition_location_id uuid REFERENCES wms_locations(id),
  remark text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 1.2 FBA 换标出库
CREATE TABLE IF NOT EXISTS wms_fba_relabels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES wms_warehouses(id) ON DELETE RESTRICT,
  relabel_no text NOT NULL UNIQUE,
  source_shipment_id uuid REFERENCES wms_shipments(id),
  carrier_id uuid REFERENCES wms_carriers(id),
  tracking_no text,
  status text NOT NULL DEFAULT 'pending',
  total_skus integer DEFAULT 0,
  total_qty integer DEFAULT 0,
  shipped_at timestamptz,
  remark text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wms_fba_relabel_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  relabel_id uuid NOT NULL REFERENCES wms_fba_relabels(id) ON DELETE CASCADE,
  sku text,
  new_sku text,
  amazon_asin text,
  qty integer DEFAULT 0,
  label_status text DEFAULT 'pending',  -- pending → generated → applied → shipped
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 1.3 工单系统 (仓库内部问题追踪)
CREATE TABLE IF NOT EXISTS wms_work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  warehouse_id uuid REFERENCES wms_warehouses(id) ON DELETE SET NULL,
  work_order_no text NOT NULL UNIQUE,
  type text NOT NULL,  -- picking_issue, location_issue, inventory_discrepancy, damage, equipment, other
  priority text DEFAULT 'normal',  -- low, normal, high, urgent
  title text NOT NULL,
  description text,
  related_entity_type text,  -- shipment, asn, inventory, location
  related_entity_id uuid,
  reporter text,
  assignee text,
  status text NOT NULL DEFAULT 'pending',  -- pending → assigned → in_progress → resolved → closed
  resolution text,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 1.4 截单/取消发货 (万里牛防资损拦截)
CREATE TABLE IF NOT EXISTS wms_shipment_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shipment_id uuid NOT NULL UNIQUE REFERENCES wms_shipments(id) ON DELETE CASCADE,
  cancellation_no text NOT NULL UNIQUE,
  reason text NOT NULL,  -- customer_request, address_change, duplicate_order, pricing_error, other
  status text NOT NULL DEFAULT 'pending',  -- pending → approved → processing → completed → rejected
  cancelled_at timestamptz,
  approved_by text,
  rollback_inventory boolean DEFAULT true,
  remark text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wms_shipment_cancellation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cancellation_id uuid NOT NULL REFERENCES wms_shipment_cancellations(id) ON DELETE CASCADE,
  shipment_item_id uuid REFERENCES wms_shipment_items(id),
  sku text,
  qty_picked_back integer DEFAULT 0,
  qty_returned_to_stock integer DEFAULT 0,
  rollback_status text DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- PHASE 2: P1 NEW TABLES
-- ============================================

-- 2.1 耗材管理
CREATE TABLE IF NOT EXISTS wms_supplies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES wms_warehouses(id) ON DELETE CASCADE,
  sku text NOT NULL,
  name text NOT NULL,
  category text,  -- box, polybag, envelope, label, tape, dunnage, fragile, custom
  unit text DEFAULT '个',
  qty_on_hand integer DEFAULT 0,
  qty_reserved integer DEFAULT 0,
  min_stock_warning integer DEFAULT 100,
  cost_per_unit numeric DEFAULT 0,
  status text DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(warehouse_id, sku)
);

CREATE TABLE IF NOT EXISTS wms_supply_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  supply_id uuid NOT NULL REFERENCES wms_supplies(id) ON DELETE CASCADE,
  shipment_id uuid REFERENCES wms_shipments(id),
  qty_used integer NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2.2 入库预约 (ASN 扩展)
ALTER TABLE wms_asns ADD COLUMN IF NOT EXISTS appointment_date date;
ALTER TABLE wms_asns ADD COLUMN IF NOT EXISTS appointment_slot text;  -- AM/PM or HH:MM-HH:MM
ALTER TABLE wms_asns ADD COLUMN IF NOT EXISTS appointment_confirmed boolean DEFAULT false;

-- 2.3 波次策略表
CREATE TABLE IF NOT EXISTS wms_wave_strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES wms_warehouses(id) ON DELETE CASCADE,
  name text NOT NULL,
  strategy_type text NOT NULL,  -- manual, auto, cutoff, volume_based, zone_based
  order_by text,  -- weight, volume, qty, carrier, zone
  max_orders integer DEFAULT 50,
  max_weight_kg numeric DEFAULT 500,
  max_volume_cm3 numeric DEFAULT 100000,
  zone_filter text,
  carrier_filter text,
  is_default boolean DEFAULT false,
  status text DEFAULT 'active',
  remark text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2.4 盘点冻结库存标记
ALTER TABLE wms_stocktaking ADD COLUMN IF NOT EXISTS freeze_inventory boolean DEFAULT false;
ALTER TABLE wms_stocktaking ADD COLUMN IF NOT EXISTS frozen_zones text[];  -- 冻结的 zone_ids

-- 2.5 拆合包裹: shipment_items 已支持多个 shipment → package 关联
-- wms_package_items 已存在，加个拆合标记
ALTER TABLE wms_packages ADD COLUMN IF NOT EXISTS is_split boolean DEFAULT false;
ALTER TABLE wms_packages ADD COLUMN IF NOT EXISTS split_from_package_id uuid REFERENCES wms_packages(id);
ALTER TABLE wms_packages ADD COLUMN IF NOT EXISTS is_merged boolean DEFAULT false;
ALTER TABLE wms_packages ADD COLUMN IF NOT EXISTS merged_package_ids text[];

-- 2.6 Lock strategy (锁库策略)
ALTER TABLE wms_settings ADD COLUMN IF NOT EXISTS lock_strategy text DEFAULT 'fifo';  -- fifo, fefo, path_priority, efficiency_priority, expiry_priority
ALTER TABLE wms_settings ADD COLUMN IF NOT EXISTS pick_strategy text DEFAULT 'zone_by_zone';  -- zone_by_zone, fastest, min_zones
ALTER TABLE wms_settings ADD COLUMN IF NOT EXISTS auto_publish_wave boolean DEFAULT false;
ALTER TABLE wms_settings ADD COLUMN IF NOT EXISTS auto_generate_labels boolean DEFAULT true;

-- 2.7 动销报表需要的额外字段
ALTER TABLE wms_inventory ADD COLUMN IF NOT EXISTS first_in_at timestamptz;  -- 首次入库时间（库龄计算）
ALTER TABLE wms_inventory ADD COLUMN IF NOT EXISTS last_out_at timestamptz;  -- 最近出库时间

-- ============================================
-- PHASE 3: RLS + TRIGGERS
-- ============================================

-- Enable RLS on all new tables
ALTER TABLE wms_fba_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE wms_fba_return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE wms_fba_relabels ENABLE ROW LEVEL SECURITY;
ALTER TABLE wms_fba_relabel_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE wms_work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE wms_shipment_cancellations ENABLE ROW LEVEL SECURITY;
ALTER TABLE wms_shipment_cancellation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE wms_supplies ENABLE ROW LEVEL SECURITY;
ALTER TABLE wms_supply_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE wms_wave_strategies ENABLE ROW LEVEL SECURITY;

-- Standard user_id=uid() RLS policies for all new tables
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN (
    'wms_fba_returns','wms_fba_return_items','wms_fba_relabels','wms_fba_relabel_items',
    'wms_work_orders','wms_shipment_cancellations','wms_shipment_cancellation_items',
    'wms_supplies','wms_supply_usage','wms_wave_strategies'
  ) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %s_select ON %I', tbl, tbl);
    EXECUTE format('CREATE POLICY %s_select ON %I FOR SELECT USING (auth.uid() = user_id)', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS %s_insert ON %I', tbl, tbl);
    EXECUTE format('CREATE POLICY %s_insert ON %I FOR INSERT WITH CHECK (auth.uid() = user_id)', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS %s_update ON %I', tbl, tbl);
    EXECUTE format('CREATE POLICY %s_update ON %I FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS %s_delete ON %I', tbl, tbl);
    EXECUTE format('CREATE POLICY %s_delete ON %I FOR DELETE USING (auth.uid() = user_id)', tbl, tbl);
  END LOOP;
END $$;

-- updated_at triggers on new tables
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fba_returns_updated ON wms_fba_returns;
CREATE TRIGGER trg_fba_returns_updated BEFORE UPDATE ON wms_fba_returns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_fba_relabels_updated ON wms_fba_relabels;
CREATE TRIGGER trg_fba_relabels_updated BEFORE UPDATE ON wms_fba_relabels
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_work_orders_updated ON wms_work_orders;
CREATE TRIGGER trg_work_orders_updated BEFORE UPDATE ON wms_work_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_cancellations_updated ON wms_shipment_cancellations;
CREATE TRIGGER trg_cancellations_updated BEFORE UPDATE ON wms_shipment_cancellations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_supplies_updated ON wms_supplies;
CREATE TRIGGER trg_supplies_updated BEFORE UPDATE ON wms_supplies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_wave_strategies_updated ON wms_wave_strategies;
CREATE TRIGGER trg_wave_strategies_updated BEFORE UPDATE ON wms_wave_strategies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================
-- INDICES for performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_fba_returns_wh ON wms_fba_returns(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_fba_returns_status ON wms_fba_returns(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_wh ON wms_work_orders(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON wms_work_orders(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_priority ON wms_work_orders(priority);
CREATE INDEX IF NOT EXISTS idx_cancellations_shipment ON wms_shipment_cancellations(shipment_id);
CREATE INDEX IF NOT EXISTS idx_supplies_wh ON wms_supplies(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_first_in ON wms_inventory(first_in_at);
CREATE INDEX IF NOT EXISTS idx_inventory_last_out ON wms_inventory(last_out_at);

-- ============================================
-- DB FUNCTION: 截单库存回滚逻辑 (TRIGGER)
-- ============================================
CREATE OR REPLACE FUNCTION trg_cancellation_inventory_rollback() RETURNS TRIGGER AS $$
BEGIN
  -- When cancellation status → 'completed', roll back picked inventory
  IF NEW.status = 'completed' AND OLD.status != 'completed' AND NEW.rollback_inventory THEN
    -- For each pick_task of this shipment that is still done/processing
    -- Set pick_tasks.status back to pending OR cancel + release inventory
    UPDATE wms_pick_tasks 
    SET status = 'cancelled', updated_at = now()
    WHERE shipment_id = NEW.shipment_id AND status IN ('done', 'in_progress');
    
    -- Release reserved inventory (qty_reserved → 0)
    UPDATE wms_inventory 
    SET qty_reserved = GREATEST(0, qty_reserved - (
      SELECT COALESCE(SUM(qty), 0) FROM wms_pick_tasks 
      WHERE shipment_id = NEW.shipment_id AND status = 'cancelled'
    ))
    WHERE warehouse_id = (SELECT warehouse_id FROM wms_shipments WHERE id = NEW.shipment_id);
    
    -- Write inventory_log for rollback
    INSERT INTO wms_inventory_logs (user_id, warehouse_id, sku, qty_change, qty_after, type, ref_type, ref_id, operator)
    SELECT NEW.user_id, s.warehouse_id, p.sku, p.qty, 
      inv.qty_on_hand - (SELECT COALESCE(SUM(pi.qty),0) FROM wms_pick_tasks pi WHERE pi.shipment_id = NEW.shipment_id AND pi.status = 'cancelled'),
      'cancellation_rollback', 'shipment_cancellation', NEW.id, NEW.user_id::text
    FROM wms_pick_tasks p
    JOIN wms_shipments s ON s.id = p.shipment_id
    JOIN wms_inventory inv ON inv.sku = p.sku AND inv.warehouse_id = s.warehouse_id
    WHERE p.shipment_id = NEW.shipment_id AND p.status = 'cancelled';
    
    -- Update shipment status back to draft
    UPDATE wms_shipments SET status = 'cancelled', updated_at = now() WHERE id = NEW.shipment_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cancellation_rollback ON wms_shipment_cancellations;
CREATE TRIGGER trg_cancellation_rollback 
  AFTER UPDATE OF status ON wms_shipment_cancellations
  FOR EACH ROW EXECUTE FUNCTION trg_cancellation_inventory_rollback();

COMMIT;

-- ============================================
-- FINAL VERIFICATION
-- ============================================
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'wms_%';
  RAISE NOTICE 'Total wms_ tables: %', v_count;
  SELECT count(*) INTO v_count FROM wms_roles;
  RAISE NOTICE 'wms_roles (should be 7): %', v_count;
  SELECT count(*) INTO v_count FROM wms_inventory;
  RAISE NOTICE 'wms_inventory (should be 0 after cleanup): %', v_count;
END $$;
