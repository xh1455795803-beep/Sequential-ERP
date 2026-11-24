-- ============================================================
-- Thalvior 代打包核心链路补齐 v2
-- 1. outbound_operations 扩展（pack/weigh/verify/ship 每个环节自动写）
-- 2. 出库订单扣费时机：创建时预扣
-- 3. 库存预警字段 + 低库存 view
-- 4. 面单模板表（支持多平台）
-- 5. 拣货单表
-- ============================================================

-- 1. 出库订单状态枚举扩展
ALTER TABLE tlv_outbound_orders DROP CONSTRAINT IF EXISTS tlv_outbound_orders_status_check;
ALTER TABLE tlv_outbound_orders ADD CONSTRAINT tlv_outbound_orders_status_check
  CHECK (status IN ('pending','balance_hold','picking','picked','packing','packed','qc','weighed','verified','shipped','returned','cancelled'));

-- 补列: outbound_orders
ALTER TABLE tlv_outbound_orders ADD COLUMN IF NOT EXISTS order_no text;
ALTER TABLE tlv_outbound_orders ADD COLUMN IF NOT EXISTS cod_amount numeric(10,2);
ALTER TABLE tlv_outbound_orders ADD COLUMN IF NOT EXISTS weight_g numeric(10,2);
ALTER TABLE tlv_outbound_orders ADD COLUMN IF NOT EXISTS merchant_note text;
ALTER TABLE tlv_outbound_orders ADD COLUMN IF NOT EXISTS balance_deducted boolean DEFAULT false;
ALTER TABLE tlv_outbound_orders ADD COLUMN IF NOT EXISTS estimated_fee numeric(10,2) DEFAULT 0;
ALTER TABLE tlv_outbound_orders ADD COLUMN IF NOT EXISTS package_count int DEFAULT 0;
ALTER TABLE tlv_outbound_orders ADD COLUMN IF NOT EXISTS operator_name text;
ALTER TABLE tlv_outbound_orders ADD COLUMN IF NOT EXISTS picked_at timestamptz;
ALTER TABLE tlv_outbound_orders ADD COLUMN IF NOT EXISTS packed_at timestamptz;
ALTER TABLE tlv_outbound_orders ADD COLUMN IF NOT EXISTS shipped_at timestamptz;
ALTER TABLE tlv_outbound_orders ADD COLUMN IF NOT EXISTS tracking_no text;

-- 补列: outbound_operations
ALTER TABLE tlv_outbound_operations ADD COLUMN IF NOT EXISTS operation_type text; -- pick/pack/qc/weigh/verify/ship
ALTER TABLE tlv_outbound_operations ADD COLUMN IF NOT EXISTS operator_email text;
ALTER TABLE tlv_outbound_operations ADD COLUMN IF NOT EXISTS order_id uuid;
ALTER TABLE tlv_outbound_operations ADD COLUMN IF NOT EXISTS package_count int DEFAULT 0;
ALTER TABLE tlv_outbound_operations ADD COLUMN IF NOT EXISTS item_count int DEFAULT 0;
ALTER TABLE tlv_outbound_operations ADD COLUMN IF NOT EXISTS revenue numeric(10,2) DEFAULT 0;

-- 补列: merchant_inventory 库存预警
ALTER TABLE tlv_merchant_inventory ADD COLUMN IF NOT EXISTS min_stock int DEFAULT 0;
ALTER TABLE tlv_merchant_inventory ADD COLUMN IF NOT EXISTS low_stock_warn boolean DEFAULT false;

-- 2. 面单模板 (每个平台 1-2 套模板)
CREATE TABLE IF NOT EXISTS tlv_label_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_code text NOT NULL,          -- tiktok/shopee/lazada/ozon/mercado
  name text NOT NULL,                    -- 模板名
  paper_size text DEFAULT '100x150mm',   -- 纸张尺寸
  format text DEFAULT 'pdf' CHECK (format IN ('pdf','zpl','thermal')),
  is_default boolean DEFAULT false,
  template_config jsonb DEFAULT '{}',    -- 模板配置: 打印字段、位置、字体
  created_at timestamptz DEFAULT now(),
  UNIQUE(platform_code, name)
);

-- 3. 拣货单
CREATE TABLE IF NOT EXISTS tlv_pick_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid REFERENCES tlv_warehouses(id) ON DELETE CASCADE NOT NULL,
  order_ids uuid[] DEFAULT '{}',         -- 包含的出库订单
  merchant_id uuid REFERENCES tlv_merchants(id),
  picker_id uuid,
  picker_name text,
  status text DEFAULT 'pending' CHECK (status IN ('pending','picking','picked','cancelled')),
  total_items int DEFAULT 0,
  picked_items int DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now(),
  picked_at timestamptz,
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS tlv_pick_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_list_id uuid REFERENCES tlv_pick_lists(id) ON DELETE CASCADE NOT NULL,
  order_id uuid REFERENCES tlv_outbound_orders(id) ON DELETE CASCADE,
  merchant_id uuid,
  sku text NOT NULL,
  location text,
  qty int NOT NULL,
  picked_qty int DEFAULT 0,
  status text DEFAULT 'pending' CHECK (status IN ('pending','picked','skipped')),
  created_at timestamptz DEFAULT now()
);

-- 4. 低库存预警 view
CREATE OR REPLACE VIEW tlv_low_stock_alerts AS
SELECT
  i.id AS inventory_id,
  i.warehouse_id,
  i.merchant_id,
  m.business_name AS merchant_name,
  i.product_id,
  i.sku,
  i.location,
  i.qty_on_hand,
  i.min_stock,
  i.first_in_at,
  CASE
    WHEN i.qty_on_hand = 0 THEN 'out_of_stock'
    WHEN i.qty_on_hand <= i.min_stock THEN 'low'
    ELSE 'normal'
  END AS alert_level
FROM tlv_merchant_inventory i
LEFT JOIN tlv_merchants m ON m.id = i.merchant_id
WHERE i.qty_on_hand <= COALESCE(i.min_stock, 5) OR i.qty_on_hand = 0;

-- 5. 出库时自动扣费 trigger function
CREATE OR REPLACE FUNCTION tlv_deduct_balance_on_create() RETURNS TRIGGER AS $$
DECLARE
  merchant_bal numeric;
  item_cnt int;
  weight_val numeric;
  fee numeric;
BEGIN
  -- 查 merchant 当前余额
  SELECT COALESCE((SELECT balance_after FROM tlv_merchant_wallets WHERE merchant_id = NEW.merchant_id ORDER BY created_at DESC LIMIT 1), 0)
  INTO merchant_bal;
  
  -- 预计扣费 (简化: 按订单 items × 打包费 + 按重量)
  SELECT COUNT(*) FROM tlv_outbound_items WHERE outbound_order_id = NEW.id INTO item_cnt;
  SELECT COALESCE(SUM(weight_g), 0) FROM tlv_outbound_items WHERE outbound_order_id = NEW.id INTO weight_val;
  fee := COALESCE(item_cnt, 0) * 3.00 + GREATEST(COALESCE(weight_val, 0) / 1000.0, 0.5) * 4.00;
  
  NEW.estimated_fee := fee;
  
  IF merchant_bal < fee THEN
    NEW.status := 'balance_hold';
    NEW.merchant_note := '⚠ 余额不足，订单已暂存，需充值后处理';
    NEW.balance_deducted := false;
  ELSE
    NEW.status := 'pending';
    NEW.balance_deducted := true;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tlv_outbound_balance_trigger ON tlv_outbound_orders;
CREATE TRIGGER tlv_outbound_balance_trigger BEFORE INSERT ON tlv_outbound_orders
  FOR EACH ROW EXECUTE FUNCTION tlv_deduct_balance_on_create();

-- 6. RLS
ALTER TABLE tlv_label_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lbl_all" ON tlv_label_templates;
CREATE POLICY "lbl_all" ON tlv_label_templates USING (true) WITH CHECK (true);

ALTER TABLE tlv_pick_lists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pl_all" ON tlv_pick_lists;
CREATE POLICY "pl_all" ON tlv_pick_lists USING (true) WITH CHECK (true);

ALTER TABLE tlv_pick_list_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pli_all" ON tlv_pick_list_items;
CREATE POLICY "pli_all" ON tlv_pick_list_items USING (true) WITH CHECK (true);

-- 7. 种子数据: 面单模板
INSERT INTO tlv_label_templates (platform_code, name, paper_size, format, is_default, template_config) VALUES
  ('tiktok',  'TikTok Shop 标准面单', '100x150mm', 'pdf',    true,  '{"fields":["order_no","tracking_no","sku_list","weight","sender_addr","recipient_addr","barcode"]}'::jsonb),
  ('shopee',  'Shopee 标准面单',      '100x150mm', 'pdf',    true,  '{"fields":["order_no","tracking_no","sku_list","weight","sender_addr","recipient_addr","qr_code"]}'::jsonb),
  ('shopee',  'Shopee A6 热敏单',     '100x100mm', 'thermal',false, '{"fields":["order_no","tracking_no","barcode"]}'::jsonb),
  ('lazada',  'Lazada 标准面单',      '100x150mm', 'pdf',    true,  '{"fields":["order_no","tracking_no","sku_list","weight"]}'::jsonb),
  ('ozon',    'Ozon 标准面单',        '100x150mm', 'pdf',    true,  '{"fields":["order_no","tracking_no","sku_list","weight"]}'::jsonb),
  ('mercado', 'Mercado Libre 面单',   '100x150mm', 'pdf',    true,  '{"fields":["order_no","tracking_no","sku_list","weight"]}'::jsonb),
ON CONFLICT DO NOTHING;

-- 为 merchant_inventory 设合理 min_stock
UPDATE tlv_merchant_inventory SET min_stock = 10 WHERE min_stock = 0;
