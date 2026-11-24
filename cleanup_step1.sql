-- ========================================================
-- 1) 修复 tlv_audit_trigger() 函数
--    有些表（tlv_merchants, tlv_warehouses, tlv_employees）
--    根本没有 merchant_id / warehouse_id 列，
--    原函数无条件访问 NEW.merchant_id 会报错
-- ========================================================
CREATE OR REPLACE FUNCTION public.tlv_audit_trigger()
RETURNS trigger AS $$
DECLARE
  v_row_id       uuid;
  v_merchant_id  uuid := NULL;
  v_warehouse_id uuid := NULL;
  v_old_data     jsonb;
  v_new_data     jsonb;
BEGIN
  -- 1. row_id: 所有表都有 id 列
  IF TG_OP = 'DELETE' THEN
    v_row_id := OLD.id;
    v_old_data := to_jsonb(OLD);
    v_new_data := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    v_row_id := NEW.id;
    v_old_data := to_jsonb(OLD);
    v_new_data := to_jsonb(NEW);
  ELSE
    v_row_id := NEW.id;
    v_old_data := NULL;
    v_new_data := to_jsonb(NEW);
  END IF;

  -- 2. merchant_id: 先查列是否存在，再取值
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name=TG_TABLE_NAME AND column_name='merchant_id') THEN
    v_merchant_id := CASE
      WHEN TG_OP = 'DELETE' THEN OLD.merchant_id
      ELSE NEW.merchant_id
    END;
  END IF;

  -- 3. warehouse_id
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name=TG_TABLE_NAME AND column_name='warehouse_id') THEN
    v_warehouse_id := CASE
      WHEN TG_OP = 'DELETE' THEN OLD.warehouse_id
      ELSE NEW.warehouse_id
    END;
  END IF;

  INSERT INTO public.tlv_audit_logs
    (table_name, operation, row_id, merchant_id, warehouse_id,
     operator_id, operator_email, old_data, new_data)
  VALUES
    (TG_TABLE_NAME, TG_OP, v_row_id, v_merchant_id, v_warehouse_id,
     current_setting('app.operator_id', true),
     current_setting('app.operator_email', true),
     v_old_data, v_new_data);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================================
-- 2) 清理垃圾数据
-- ========================================================
BEGIN;

-- 垃圾 merchant_id
DELETE FROM public.tlv_outbound_orders   WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_inbound_orders    WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_outbound_items    WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_inventory_logs    WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_issue_items       WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_packages          WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_pick_list_items   WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_pick_lists        WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_stock_take_items  WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_stock_takes       WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_merchant_inventory WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_merchant_wallets   WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_merchant_products  WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_merchant_shops     WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_logistics_tracking WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_customer_profiles  WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_customer_followups  WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_cod_settlements     WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_billing_rules      WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_billings           WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_wallet_topup_orders WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_audit_logs          WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';

-- 最后删 merchant 主表
DELETE FROM public.tlv_merchants WHERE id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';

COMMIT;
SELECT 'business data cleaned' AS done;
