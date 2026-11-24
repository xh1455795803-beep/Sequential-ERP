-- ── 1. 库龄列 ─────────────────────────────────────────────
ALTER TABLE tlv_merchant_inventory ADD COLUMN IF NOT EXISTS first_in_at timestamptz;

UPDATE tlv_merchant_inventory inv
SET first_in_at = COALESCE(inv.last_updated, now())
WHERE first_in_at IS NULL;

-- ── 2. 库存日志表 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tlv_inventory_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES tlv_warehouses(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES tlv_merchants(id) ON DELETE CASCADE,
  product_id uuid REFERENCES tlv_merchant_products(id) ON DELETE SET NULL,
  sku text NOT NULL,
  location text NOT NULL,
  change_type text NOT NULL CHECK (change_type IN ('inbound_received','outbound_picked','stock_take_adjust','manual_adjust','defective_write_off')),
  qty_change integer NOT NULL,
  qty_before integer NOT NULL,
  qty_after integer NOT NULL,
  ref_id uuid,
  ref_no text,
  operator_note text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_logs_wh ON tlv_inventory_logs(warehouse_id, sku, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_logs_merchant ON tlv_inventory_logs(merchant_id, created_at DESC);

CREATE OR REPLACE FUNCTION tlv_log_inventory_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO tlv_inventory_logs(warehouse_id, merchant_id, product_id, sku, location, change_type, qty_change, qty_before, qty_after, operator_note)
    VALUES (NEW.warehouse_id, NEW.merchant_id, NEW.product_id, NEW.sku, NEW.location, 'manual_adjust', NEW.qty_on_hand, 0, NEW.qty_on_hand, 'INIT');
    RETURN NEW;
  END IF;
  IF OLD.qty_on_hand <> NEW.qty_on_hand THEN
    INSERT INTO tlv_inventory_logs(warehouse_id, merchant_id, product_id, sku, location, change_type, qty_change, qty_before, qty_after, operator_note)
    VALUES (NEW.warehouse_id, NEW.merchant_id, NEW.product_id, NEW.sku, NEW.location, 'manual_adjust', NEW.qty_on_hand - OLD.qty_on_hand, OLD.qty_on_hand, NEW.qty_on_hand, 'auto-log');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tlv_inventory_log_trigger ON tlv_merchant_inventory;
CREATE TRIGGER tlv_inventory_log_trigger
  AFTER INSERT OR UPDATE ON tlv_merchant_inventory
  FOR EACH ROW EXECUTE FUNCTION tlv_log_inventory_change();

-- ── 3. 库存盘点 ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tlv_stock_takes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES tlv_warehouses(id) ON DELETE CASCADE,
  merchant_id uuid REFERENCES tlv_merchants(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('dynamic','static','sku')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_progress','completed','cancelled')),
  total_rows integer DEFAULT 0,
  matched_rows integer DEFAULT 0,
  diff_rows integer DEFAULT 0,
  adjusted_qty integer DEFAULT 0,
  operator_id uuid,
  operator_name text,
  note text,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_stock_takes_wh ON tlv_stock_takes(warehouse_id, status);

CREATE TABLE IF NOT EXISTS tlv_stock_take_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_take_id uuid NOT NULL REFERENCES tlv_stock_takes(id) ON DELETE CASCADE,
  product_id uuid REFERENCES tlv_merchant_products(id) ON DELETE SET NULL,
  merchant_id uuid NOT NULL REFERENCES tlv_merchants(id) ON DELETE CASCADE,
  sku text NOT NULL,
  location text NOT NULL,
  system_qty integer NOT NULL,
  counted_qty integer NOT NULL,
  diff_qty integer GENERATED ALWAYS AS (counted_qty - system_qty) STORED,
  adjusted boolean DEFAULT false,
  adjusted_qty integer,
  note text,
  row_no integer
);
CREATE INDEX IF NOT EXISTS idx_stock_take_items_parent ON tlv_stock_take_items(stock_take_id);

-- ── 4. 员工 ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tlv_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES tlv_warehouses(id) ON DELETE CASCADE,
  name text NOT NULL,
  username text,
  role text NOT NULL DEFAULT 'picker' CHECK (role IN ('picker','packer','inspector','shipper','manager')),
  phone text,
  email text,
  status text DEFAULT 'active' CHECK (status IN ('active','inactive')),
  auth_user_id uuid,
  hired_at date,
  target_orders_per_day integer DEFAULT 50,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employees_wh ON tlv_employees(warehouse_id, role, status);

-- ── 5. 利润核算 ───────────────────────────────────────────
ALTER TABLE tlv_merchant_products
  ADD COLUMN IF NOT EXISTS cost_price numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sale_price numeric(10,2) DEFAULT 0;

-- ── 6. 利润 RPC ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION tlv_calc_profit(
  p_merchant_id uuid,
  p_start_date date DEFAULT (now() - interval '30 days')::date,
  p_end_date date DEFAULT now()::date
)
RETURNS TABLE (
  sku text,
  product_name text,
  qty_sold bigint,
  revenue numeric(12,2),
  total_cost numeric(12,2),
  shipping_fee numeric(12,2),
  packing_fee numeric(12,2),
  net_profit numeric(12,2),
  margin_pct numeric(5,2)
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    oi.sku,
    oi.product_name,
    SUM(oi.qty) AS qty_sold,
    SUM(oi.qty * COALESCE(NULLIF(oi.unit_price, 0), p.sale_price, 0)) AS revenue,
    SUM(oi.qty * COALESCE(p.cost_price, 0)) AS total_cost,
    SUM(o.weight_fee + o.cod_fee) AS shipping_fee,
    SUM(o.packaging_fee + o.material_fee) AS packing_fee,
    SUM(oi.qty * COALESCE(NULLIF(oi.unit_price, 0), p.sale_price, 0))
      - SUM(oi.qty * COALESCE(p.cost_price, 0))
      - SUM(o.weight_fee + o.cod_fee + o.packaging_fee + o.material_fee) AS net_profit,
    CASE WHEN SUM(oi.qty * COALESCE(NULLIF(oi.unit_price, 0), p.sale_price, 0)) = 0 THEN 0
         ELSE ROUND(
           (SUM(oi.qty * COALESCE(NULLIF(oi.unit_price, 0), p.sale_price, 0))
            - SUM(oi.qty * COALESCE(p.cost_price, 0))
            - SUM(o.weight_fee + o.cod_fee + o.packaging_fee + o.material_fee))
           / SUM(oi.qty * COALESCE(NULLIF(oi.unit_price, 0), p.sale_price, 0)) * 100, 2)
    END AS margin_pct
  FROM tlv_outbound_items oi
  JOIN tlv_outbound_orders o ON o.id = oi.outbound_id
  LEFT JOIN tlv_merchant_products p ON p.id = oi.product_id
  WHERE o.merchant_id = p_merchant_id
    AND o.status IN ('shipped','completed')
    AND o.created_at::date BETWEEN p_start_date AND p_end_date
  GROUP BY oi.sku, oi.product_name
  ORDER BY net_profit DESC NULLS LAST;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION tlv_calc_profit(uuid, date, date) TO authenticated, anon;

-- ── 7. 绩效 RPC ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION tlv_calc_employee_performance(
  p_warehouse_id uuid,
  p_start_date date DEFAULT (now() - interval '30 days')::date,
  p_end_date date DEFAULT now()::date
)
RETURNS TABLE (
  employee_id uuid,
  employee_name text,
  role text,
  total_ops bigint,
  picked bigint,
  packed bigint,
  weighed bigint,
  shipped bigint,
  problem_count bigint,
  revenue numeric(12,2),
  period text
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.name,
    e.role,
    COUNT(o.id) FILTER (WHERE o.created_at::date BETWEEN p_start_date AND p_end_date) AS total_ops,
    COUNT(*) FILTER (WHERE o.operation_type = 'pick') AS picked,
    COUNT(*) FILTER (WHERE o.operation_type = 'pack') AS packed,
    COUNT(*) FILTER (WHERE o.operation_type = 'weigh') AS weighed,
    COUNT(*) FILTER (WHERE o.operation_type = 'ship') AS shipped,
    COUNT(*) FILTER (WHERE o.operation_type = 'problem_report') AS problem_count,
    SUM(o.charge_amount) FILTER (WHERE o.created_at::date BETWEEN p_start_date AND p_end_date) AS revenue,
    CONCAT(p_start_date, ' → ', p_end_date) AS period
  FROM tlv_employees e
  LEFT JOIN tlv_outbound_operations o ON o.operator_id = e.id AND o.warehouse_id = p_warehouse_id
  WHERE e.warehouse_id = p_warehouse_id
  GROUP BY e.id, e.name, e.role
  ORDER BY total_ops DESC NULLS LAST;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION tlv_calc_employee_performance(uuid, date, date) TO authenticated, anon;

-- ── 8. RLS ────────────────────────────────────────────────
DO $$ BEGIN EXECUTE 'CREATE POLICY tlv_inventory_logs_all ON tlv_inventory_logs FOR ALL USING (true) WITH CHECK (true)'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY tlv_stock_takes_all ON tlv_stock_takes FOR ALL USING (true) WITH CHECK (true)'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY tlv_stock_take_items_all ON tlv_stock_take_items FOR ALL USING (true) WITH CHECK (true)'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY tlv_employees_all ON tlv_employees FOR ALL USING (true) WITH CHECK (true)'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 9. 刷 schema cache ────────────────────────────────────
SELECT 'DB patch complete' AS result;
