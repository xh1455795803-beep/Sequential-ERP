-- ========================================================
-- 重建修复后的 tlv_audit_trigger + 所有 33 个 triggers
-- 修复点：删除时正确访问 OLD.xxx，新增列存在性检查
-- ========================================================

-- 1. 创建函数
CREATE FUNCTION public.tlv_audit_trigger()
RETURNS trigger AS $$
DECLARE
  v_row_id uuid;
  v_merchant_id uuid := NULL;
  v_warehouse_id uuid := NULL;
  v_old_data jsonb;
  v_new_data jsonb;
BEGIN
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

  -- merchant_id: 有些表没有这列
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name=TG_TABLE_NAME AND column_name='merchant_id') THEN
    v_merchant_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.merchant_id ELSE NEW.merchant_id END;
  END IF;

  -- warehouse_id
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name=TG_TABLE_NAME AND column_name='warehouse_id') THEN
    v_warehouse_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.warehouse_id ELSE NEW.warehouse_id END;
  END IF;

  INSERT INTO public.tlv_audit_logs (table_name, operation, row_id, merchant_id, warehouse_id,
    operator_id, operator_email, old_data, new_data)
  VALUES (TG_TABLE_NAME, TG_OP, v_row_id, v_merchant_id, v_warehouse_id,
    current_setting('app.operator_id', true),
    current_setting('app.operator_email', true),
    v_old_data, v_new_data);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 2. 在所有有 merchant_id 的 public 表上建 trigger
DO $$
DECLARE t RECORD;
BEGIN
  FOR t IN SELECT DISTINCT table_name FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'merchant_id' AND data_type = 'uuid'
  LOOP
    EXECUTE format($f$
      DROP TRIGGER IF EXISTS tlv_audit_%I ON public.%I;
      CREATE TRIGGER tlv_audit_%I
        AFTER INSERT OR UPDATE OR DELETE ON public.%I
        FOR EACH ROW EXECUTE FUNCTION public.tlv_audit_trigger();
    $f$, t.table_name, t.table_name, t.table_name, t.table_name);
  END LOOP;
END $$;

-- 3. 在 merchant 表上也建（它没有 merchant_id 列，函数里已处理）
DO $$
BEGIN
  EXECUTE $f$
    DROP TRIGGER IF EXISTS tlv_audit_merchants ON public.tlv_merchants;
    CREATE TRIGGER tlv_audit_merchants
      AFTER INSERT OR UPDATE OR DELETE ON public.tlv_merchants
      FOR EACH ROW EXECUTE FUNCTION public.tlv_audit_trigger();
  $f$;

  EXECUTE $f$
    DROP TRIGGER IF EXISTS tlv_audit_warehouses ON public.tlv_warehouses;
    CREATE TRIGGER tlv_audit_warehouses
      AFTER INSERT OR UPDATE OR DELETE ON public.tlv_warehouses
      FOR EACH ROW EXECUTE FUNCTION public.tlv_audit_trigger();
  $f$;

  EXECUTE $f$
    DROP TRIGGER IF EXISTS tlv_audit_package_logs ON public.tlv_package_logs;
    CREATE TRIGGER tlv_audit_package_logs
      AFTER INSERT OR UPDATE OR DELETE ON public.tlv_package_logs
      FOR EACH ROW EXECUTE FUNCTION public.tlv_audit_trigger();
  $f$;

  EXECUTE $f$
    DROP TRIGGER IF EXISTS tlv_audit_platform_sync_logs ON public.tlv_platform_sync_logs;
    CREATE TRIGGER tlv_audit_platform_sync_logs
      AFTER INSERT OR UPDATE OR DELETE ON public.tlv_platform_sync_logs
      FOR EACH ROW EXECUTE FUNCTION public.tlv_audit_trigger();
  $f$;

  EXECUTE $f$
    DROP TRIGGER IF EXISTS tlv_audit_label_templates ON public.tlv_label_templates;
    CREATE TRIGGER tlv_audit_label_templates
      AFTER INSERT OR UPDATE OR DELETE ON public.tlv_label_templates
      FOR EACH ROW EXECUTE FUNCTION public.tlv_audit_trigger();
  $f$;

  EXECUTE $f$
    DROP TRIGGER IF EXISTS tlv_audit_platforms ON public.tlv_platforms;
    CREATE TRIGGER tlv_audit_platforms
      AFTER INSERT OR UPDATE OR DELETE ON public.tlv_platforms
      FOR EACH ROW EXECUTE FUNCTION public.tlv_audit_trigger();
  $f$;

  EXECUTE $f$
    DROP TRIGGER IF EXISTS tlv_audit_warehouse_flows ON public.tlv_warehouse_flows;
    CREATE TRIGGER tlv_audit_warehouse_flows
      AFTER INSERT OR UPDATE OR DELETE ON public.tlv_warehouse_flows
      FOR EACH ROW EXECUTE FUNCTION public.tlv_audit_trigger();
  $f$;

  EXECUTE $f$
    DROP TRIGGER IF EXISTS tlv_audit_warehouse_settlements ON public.tlv_warehouse_settlements;
    CREATE TRIGGER tlv_audit_warehouse_settlements
      AFTER INSERT OR UPDATE OR DELETE ON public.tlv_warehouse_settlements
      FOR EACH ROW EXECUTE FUNCTION public.tlv_audit_trigger();
  $f$;

  EXECUTE $f$
    DROP TRIGGER IF EXISTS tlv_audit_employees ON public.tlv_employees;
    CREATE TRIGGER tlv_audit_employees
      AFTER INSERT OR UPDATE OR DELETE ON public.tlv_employees
      FOR EACH ROW EXECUTE FUNCTION public.tlv_audit_trigger();
  $f$;

  EXECUTE $f$
    DROP TRIGGER IF EXISTS tlv_audit_flow_nodes ON public.tlv_flow_nodes;
    CREATE TRIGGER tlv_audit_flow_nodes
      AFTER INSERT OR UPDATE OR DELETE ON public.tlv_flow_nodes
      FOR EACH ROW EXECUTE FUNCTION public.tlv_audit_trigger();
  $f$;
END $$;

SELECT 'triggers_rebuilt' AS done;
