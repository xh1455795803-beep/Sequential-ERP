-- ========================================
-- thalvior WMS v1.1 数据库增强
-- 在 Supabase SQL Editor 里整体执行一遍
-- ========================================

-- 1. 供应商表
CREATE TABLE IF NOT EXISTS public.wms_suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  name text not null,
  contact text,
  phone text,
  email text,
  address text,
  remark text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. 采购订单表
CREATE TABLE IF NOT EXISTS public.wms_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  po_no text not null unique,
  supplier_id uuid references public.wms_suppliers(id),
  status int default 1,  -- 1 草稿 2 已下单 3 部分到货 4 已完成 5 已取消
  expected_date date,
  total_amount numeric(12,2) default 0,
  remark text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 3. 给 wms_products 加 safety_stock 字段（库存告警需要）
ALTER TABLE public.wms_products ADD COLUMN IF NOT EXISTS safety_stock int default 0;

-- 4. 给 wms_inventory 加 qty_on_hand 列（DashboardPage 用 qty_onhand，InventoryPage 用 qty_on_hand）
--    如果已存在用哪个字段取决于实际表结构，这里保持兼容性
--    如果你们表里有 qty_onhand 没有 qty_on_hand，运行下面这行：
-- ALTER TABLE public.wms_inventory ADD COLUMN IF NOT EXISTS qty_on_hand int default 0;

-- 5. 给 wms_inventory_txn 加 remark 字段（库存调整需要）
ALTER TABLE public.wms_inventory_txn ADD COLUMN IF NOT EXISTS remark text;

-- 6. 自动生成 po_no 触发器（可选，没有也能跑）
CREATE OR REPLACE FUNCTION public.set_po_no() RETURNS trigger AS $$
BEGIN
  IF NEW.po_no IS NULL THEN
    NEW.po_no := 'PO' || to_char(now(), 'YYYYMMDDHH24MI') || LPAD(extract(epoch from now())::int % 10000::text, 4, '0');
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_set_po_no ON public.wms_purchase_orders;
CREATE TRIGGER trg_set_po_no BEFORE INSERT ON public.wms_purchase_orders FOR EACH ROW EXECUTE FUNCTION public.set_po_no();

-- 7. RLS：允许通过认证的用户读写
ALTER TABLE public.wms_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_purchase_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow all suppliers" ON public.wms_suppliers;
DROP POLICY IF EXISTS "allow all po" ON public.wms_purchase_orders;
CREATE POLICY "allow all suppliers" ON public.wms_suppliers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "allow all po" ON public.wms_purchase_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
