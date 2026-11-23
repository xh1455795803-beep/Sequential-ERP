-- ============================================================
-- 📦 WMS Smart Operations Extension: BOM / Kitting / Transfers
-- ============================================================
-- Dependencies: wms_warehouses, wms_locations, wms_shipments, wms_carriers, set_updated_at()
-- ============================================================

-- ========== 1. BOM (Bill of Materials) ==========
CREATE TABLE IF NOT EXISTS wms_bom (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sku text NOT NULL,                     -- 成品 SKU
  sku_name text,
  bom_no text NOT NULL UNIQUE,
  status text DEFAULT 'active',          -- active / inactive
  remark text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wms_bom_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bom_id uuid NOT NULL REFERENCES wms_bom(id) ON DELETE CASCADE,
  component_sku text NOT NULL,
  component_name text,
  qty_per_unit integer NOT NULL DEFAULT 1 CHECK (qty_per_unit > 0),
  required boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bom_items_bom ON wms_bom_items(bom_id);
CREATE INDEX IF NOT EXISTS idx_bom_items_sku ON wms_bom_items(component_sku);

-- ========== 2. Kitting Orders ==========
CREATE TABLE IF NOT EXISTS wms_kitting_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_no text NOT NULL UNIQUE,
  bom_id uuid NOT NULL REFERENCES wms_bom(id),
  warehouse_id uuid NOT NULL REFERENCES wms_warehouses(id),
  output_qty integer NOT NULL DEFAULT 1 CHECK (output_qty > 0),
  output_sku text,
  output_sku_name text,
  source_shipment_id uuid REFERENCES wms_shipments(id) ON DELETE SET NULL,
  status text DEFAULT 'draft',           -- draft / released / picking / kitting / completed / cancelled
  total_components integer DEFAULT 0,
  remark text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kitting_bom ON wms_kitting_orders(bom_id);
CREATE INDEX IF NOT EXISTS idx_kitting_wh ON wms_kitting_orders(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_kitting_status ON wms_kitting_orders(status);

-- ========== 3. Cross-Warehouse Transfers ==========
CREATE TABLE IF NOT EXISTS wms_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transfer_no text NOT NULL UNIQUE,
  from_warehouse_id uuid NOT NULL REFERENCES wms_warehouses(id),
  to_warehouse_id uuid NOT NULL REFERENCES wms_warehouses(id),
  carrier_id uuid REFERENCES wms_carriers(id) ON DELETE SET NULL,
  tracking_no text,
  status text DEFAULT 'draft',           -- draft / released / shipped / in_transit / received / completed / cancelled
  total_skus integer DEFAULT 0,
  total_qty integer DEFAULT 0,
  shipped_at timestamptz,
  received_at timestamptz,
  remark text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_warehouse_id != to_warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_transfers_from_wh ON wms_transfers(from_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_transfers_to_wh ON wms_transfers(to_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_transfers_status ON wms_transfers(status);

CREATE TABLE IF NOT EXISTS wms_transfer_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transfer_id uuid NOT NULL REFERENCES wms_transfers(id) ON DELETE CASCADE,
  sku text NOT NULL,
  sku_name text,
  from_location_id uuid REFERENCES wms_locations(id) ON DELETE SET NULL,
  to_location_id uuid REFERENCES wms_locations(id) ON DELETE SET NULL,
  qty integer NOT NULL CHECK (qty > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transfer_items_transfer ON wms_transfer_items(transfer_id);

-- ========== 4. RLS Policies ==========

-- wms_bom
ALTER TABLE wms_bom ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wms_bom_sel" ON wms_bom FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "wms_bom_ins" ON wms_bom FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "wms_bom_upd" ON wms_bom FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "wms_bom_del" ON wms_bom FOR DELETE USING (user_id = auth.uid());

-- wms_bom_items
ALTER TABLE wms_bom_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wms_bom_items_sel" ON wms_bom_items FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "wms_bom_items_ins" ON wms_bom_items FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "wms_bom_items_upd" ON wms_bom_items FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "wms_bom_items_del" ON wms_bom_items FOR DELETE USING (user_id = auth.uid());

-- wms_kitting_orders
ALTER TABLE wms_kitting_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wms_kitting_sel" ON wms_kitting_orders FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "wms_kitting_ins" ON wms_kitting_orders FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "wms_kitting_upd" ON wms_kitting_orders FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "wms_kitting_del" ON wms_kitting_orders FOR DELETE USING (user_id = auth.uid());

-- wms_transfers
ALTER TABLE wms_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wms_transfers_sel" ON wms_transfers FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "wms_transfers_ins" ON wms_transfers FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "wms_transfers_upd" ON wms_transfers FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "wms_transfers_del" ON wms_transfers FOR DELETE USING (user_id = auth.uid());

-- wms_transfer_items
ALTER TABLE wms_transfer_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wms_transfer_items_sel" ON wms_transfer_items FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "wms_transfer_items_ins" ON wms_transfer_items FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "wms_transfer_items_upd" ON wms_transfer_items FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "wms_transfer_items_del" ON wms_transfer_items FOR DELETE USING (user_id = auth.uid());

-- ========== 5. updated_at Triggers ==========
CREATE TRIGGER trg_bom_updated BEFORE UPDATE ON wms_bom
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_bom_items_updated BEFORE UPDATE ON wms_bom_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_kitting_updated BEFORE UPDATE ON wms_kitting_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_transfers_updated BEFORE UPDATE ON wms_transfers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_transfer_items_updated BEFORE UPDATE ON wms_transfer_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ========== 6. Grant permissions ==========
GRANT ALL ON wms_bom TO authenticated;
GRANT ALL ON wms_bom_items TO authenticated;
GRANT ALL ON wms_kitting_orders TO authenticated;
GRANT ALL ON wms_transfers TO authenticated;
GRANT ALL ON wms_transfer_items TO authenticated;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
