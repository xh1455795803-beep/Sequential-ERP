-- ============================================================
-- Thalvior v7 P0 Gap Fill — 仓库端 4 大缺失模块
-- 1. 仓库流程配置 (打包流程 + 备库流程)
-- 2. 包裹管理
-- 3. 问题件管理
-- 4. 客户跟进/画像
-- + 补列: tlv_outbound_operations.issue_count
-- + RLS 全部 USING (true) WITH CHECK (true) (dev 模式)
-- ============================================================

-- ──────────────────────────────────────────────
-- 补列: outbound_operations 加 issue_count / issue_ids
-- ──────────────────────────────────────────────
ALTER TABLE tlv_outbound_operations ADD COLUMN IF NOT EXISTS issue_count int DEFAULT 0;
ALTER TABLE tlv_outbound_operations ADD COLUMN IF NOT EXISTS issue_ids uuid[] DEFAULT '{}';

-- ──────────────────────────────────────────────
-- 模块 1: 仓库流程配置
-- ──────────────────────────────────────────────
-- 每个仓库可配置两套流程: 'packing'(打包出库) + 'stocking'(备库入库)
CREATE TABLE IF NOT EXISTS tlv_warehouse_flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid REFERENCES tlv_warehouses(id) ON DELETE CASCADE NOT NULL,
  flow_type text NOT NULL CHECK (flow_type IN ('packing','stocking')),
  name text NOT NULL,
  mode text DEFAULT 'standard' CHECK (mode IN ('standard','quick')),
  is_default boolean DEFAULT false,
  status text DEFAULT 'active' CHECK (status IN ('active','inactive')),
  description text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(warehouse_id, flow_type)
);

CREATE TABLE IF NOT EXISTS tlv_flow_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id uuid REFERENCES tlv_warehouse_flows(id) ON DELETE CASCADE NOT NULL,
  node_code text NOT NULL,   -- receive, split, qc, shelve, pick, pack, weigh, verify, ship
  node_name text NOT NULL,
  sequence int NOT NULL,
  required boolean DEFAULT true,
  assign_to text DEFAULT 'any', -- any, employee, machine
  config jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  UNIQUE(flow_id, node_code)
);

-- 默认流程数据 (深圳前海云仓 57ae8979...)
INSERT INTO tlv_warehouse_flows (warehouse_id, flow_type, name, mode, is_default, description)
VALUES
  ('57ae8979-c77f-4a88-b80a-113f01b5cbee', 'packing', '标准打包流程', 'standard', true, '质检→称重→核验→出库'),
  ('57ae8979-c77f-4a88-b80a-113f01b5cbee', 'stocking', '标准备库流程', 'standard', true, '签收→拆包→质检→上架')
ON CONFLICT DO NOTHING;

-- 打包流程节点
WITH f AS (SELECT id FROM tlv_warehouse_flows WHERE flow_type='packing' LIMIT 1)
INSERT INTO tlv_flow_nodes (flow_id, node_code, node_name, sequence, required)
SELECT f.id, n.code, n.name, n.seq, n.req
FROM f, (VALUES
  ('pick',  '拣货',   1, true),
  ('pack',  '打包',   2, true),
  ('qc',    '质检',   3, false),
  ('weigh', '称重',   4, true),
  ('verify','核验',   5, true),
  ('ship',  '出库',   6, true)
) AS n(code, name, seq, req)
ON CONFLICT DO NOTHING;

-- 备库流程节点
WITH f AS (SELECT id FROM tlv_warehouse_flows WHERE flow_type='stocking' LIMIT 1)
INSERT INTO tlv_flow_nodes (flow_id, node_code, node_name, sequence, required)
SELECT f.id, n.code, n.name, n.seq, n.req
FROM f, (VALUES
  ('receive','签收', 1, true),
  ('split',  '拆包', 2, true),
  ('qc',     '质检', 3, false),
  ('shelve', '上架', 4, true)
) AS n(code, name, seq, req)
ON CONFLICT DO NOTHING;

-- ──────────────────────────────────────────────
-- 模块 2: 包裹管理
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tlv_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid REFERENCES tlv_warehouses(id) ON DELETE CASCADE NOT NULL,
  merchant_id uuid REFERENCES tlv_merchants(id) ON DELETE SET NULL,
  tracking_no text,           -- 物流运单号 (出库后回写)
  inbound_order_id uuid REFERENCES tlv_inbound_orders(id) ON DELETE SET NULL,
  outbound_order_id uuid REFERENCES tlv_outbound_orders(id) ON DELETE SET NULL,
  supplier text,              -- 供应商/采购来源 (入库)
  weight numeric(10,2),
  dimensions jsonb,           -- {length, width, height}
  package_type text DEFAULT 'standard', -- standard, fragile, cod
  status text DEFAULT 'received' CHECK (status IN (
    'received','opened','qc_passed','qc_failed','shelved',
    'picked','packed','weighed','verified','shipped','returned','lost'
  )),
  location text,              -- 当前库位
  operator_id uuid,
  operator_name text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_packages_wh ON tlv_packages(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_packages_status ON tlv_packages(status);
CREATE INDEX IF NOT EXISTS idx_packages_tracking ON tlv_packages(tracking_no);

-- 包裹状态变更历史
CREATE TABLE IF NOT EXISTS tlv_package_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid REFERENCES tlv_packages(id) ON DELETE CASCADE NOT NULL,
  from_status text,
  to_status text NOT NULL,
  operator_id uuid,
  operator_name text,
  node_code text,    -- 哪个流程节点触发的
  note text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pkg_logs ON tlv_package_logs(package_id);

-- ──────────────────────────────────────────────
-- 模块 3: 问题件管理
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tlv_issue_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid REFERENCES tlv_warehouses(id) ON DELETE CASCADE NOT NULL,
  merchant_id uuid REFERENCES tlv_merchants(id) ON DELETE SET NULL,
  package_id uuid REFERENCES tlv_packages(id) ON DELETE SET NULL,
  outbound_order_id uuid REFERENCES tlv_outbound_orders(id) ON DELETE SET NULL,
  sku text,
  location text,
  issue_type text NOT NULL CHECK (issue_type IN (
    'missing','damaged','wrong_sku','wrong_qty','label_mismatch',
    'packaging_failed','weight_mismatch','qc_failed','other'
  )),
  severity text DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  description text,
  photo_urls text[] DEFAULT '{}',
  status text DEFAULT 'open' CHECK (status IN ('open','assigned','processing','resolved','closed','disputed')),
  assigned_to uuid,     -- 分配的员工
  assigned_name text,
  resolution text,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_issue_wh ON tlv_issue_items(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_issue_status ON tlv_issue_items(status);
CREATE INDEX IF NOT EXISTS idx_issue_type ON tlv_issue_items(issue_type);

-- ──────────────────────────────────────────────
-- 模块 4: 客户跟进/画像
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tlv_customer_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid REFERENCES tlv_warehouses(id) ON DELETE CASCADE NOT NULL,
  merchant_id uuid REFERENCES tlv_merchants(id) ON DELETE CASCADE NOT NULL,
  followup_type text NOT NULL CHECK (followup_type IN ('phone','wechat','email','visit','note','reminder')),
  content text NOT NULL,
  sentiment text DEFAULT 'neutral' CHECK (sentiment IN ('positive','neutral','negative','urgent')),
  next_followup_at timestamptz,
  followup_by uuid,
  followup_name text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_followup_merchant ON tlv_customer_followups(merchant_id);
CREATE INDEX IF NOT EXISTS idx_followup_wh ON tlv_customer_followups(warehouse_id);

-- 客户画像 (merchant 汇总指标)
CREATE OR REPLACE VIEW tlv_customer_profiles AS
SELECT
  m.id AS merchant_id,
  m.warehouse_id,
  m.business_name,
  m.contact_name,
  m.contact_email,
  m.contact_phone,
  -- 订单活跃度
  (SELECT COUNT(*) FROM tlv_outbound_orders o
   WHERE o.merchant_id = m.id AND o.created_at > now() - interval '30 days') AS orders_30d,
  (SELECT COUNT(*) FROM tlv_outbound_orders o
   WHERE o.merchant_id = m.id) AS orders_total,
  -- 库存
  (SELECT COUNT(*) FROM tlv_merchant_inventory i
   WHERE i.merchant_id = m.id AND i.qty_on_hand > 0) AS sku_active,
  (SELECT COALESCE(SUM(i.qty_on_hand),0) FROM tlv_merchant_inventory i
   WHERE i.merchant_id = m.id) AS inventory_qty,
  -- 钱包余额
  (SELECT w.balance_after FROM tlv_merchant_wallets w
   WHERE w.merchant_id = m.id ORDER BY w.created_at DESC LIMIT 1) AS wallet_balance,
  -- 问题件
  (SELECT COUNT(*) FROM tlv_issue_items it
   WHERE it.merchant_id = m.id AND it.status IN ('open','assigned','processing')) AS issue_open,
  -- 跟进次数
  (SELECT COUNT(*) FROM tlv_customer_followups f
   WHERE f.merchant_id = m.id) AS followup_count,
  (SELECT MAX(f.created_at) FROM tlv_customer_followups f
   WHERE f.merchant_id = m.id) AS last_followup,
  m.created_at AS merchant_since
FROM tlv_merchants m;

-- ──────────────────────────────────────────────
-- 员工绩效: 补问题件统计 RPC
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tlv_calc_employee_performance(
  p_warehouse_id uuid,
  p_start_date date,
  p_end_date date
) RETURNS TABLE(
  employee_id uuid,
  employee_name text,
  total_packages bigint,
  total_orders bigint,
  total_items bigint,
  issue_handled bigint,
  issue_open bigint,
  revenue numeric,
  period text
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.name,
    COALESCE(SUM(op.package_count), 0)::bigint,
    COUNT(DISTINCT op.order_id)::bigint,
    COALESCE(SUM(op.item_count), 0)::bigint,
    COALESCE(SUM(op.issue_count), 0)::bigint,
    (SELECT COUNT(*) FROM tlv_issue_items ii
     WHERE ii.warehouse_id = p_warehouse_id
       AND ii.assigned_to = e.id
       AND ii.status IN ('open','assigned','processing'))::bigint,
    COALESCE(SUM(op.revenue), 0),
    p_start_date::text || '~' || p_end_date::text
  FROM tlv_employees e
  LEFT JOIN tlv_outbound_operations op
    ON op.warehouse_id = p_warehouse_id
    AND op.operator_id = e.id
    AND op.created_at BETWEEN p_start_date AND p_end_date + 1
  WHERE e.warehouse_id = p_warehouse_id
  GROUP BY e.id, e.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ──────────────────────────────────────────────
-- RLS: dev 模式全开放
-- ──────────────────────────────────────────────
ALTER TABLE tlv_warehouse_flows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "flows_all" ON tlv_warehouse_flows;
CREATE POLICY "flows_all" ON tlv_warehouse_flows USING (true) WITH CHECK (true);

ALTER TABLE tlv_flow_nodes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "nodes_all" ON tlv_flow_nodes;
CREATE POLICY "nodes_all" ON tlv_flow_nodes USING (true) WITH CHECK (true);

ALTER TABLE tlv_packages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "packages_all" ON tlv_packages;
CREATE POLICY "packages_all" ON tlv_packages USING (true) WITH CHECK (true);

ALTER TABLE tlv_package_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pkg_logs_all" ON tlv_package_logs;
CREATE POLICY "pkg_logs_all" ON tlv_package_logs USING (true) WITH CHECK (true);

ALTER TABLE tlv_issue_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "issue_all" ON tlv_issue_items;
CREATE POLICY "issue_all" ON tlv_issue_items USING (true) WITH CHECK (true);

ALTER TABLE tlv_customer_followups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "followup_all" ON tlv_customer_followups;
CREATE POLICY "followup_all" ON tlv_customer_followups USING (true) WITH CHECK (true);
