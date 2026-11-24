DO $$
DECLARE t RECORD;
BEGIN
  -- 先在所有有 merchant_id 的 BASE TABLE 上建 trigger
  FOR t IN SELECT DISTINCT c.relname AS table_name
           FROM information_schema.columns c
           JOIN pg_class cls ON cls.relname = c.table_name
           JOIN pg_namespace n ON n.oid = cls.relnamespace
           WHERE c.table_schema = 'public'
             AND c.column_name = 'merchant_id'
             AND c.data_type = 'uuid'
             AND cls.relkind = 'r'
  LOOP
    EXECUTE format($f$
      DROP TRIGGER IF EXISTS tlv_audit_%I ON public.%I;
      CREATE TRIGGER tlv_audit_%I
        AFTER INSERT OR UPDATE OR DELETE ON public.%I
        FOR EACH ROW EXECUTE FUNCTION public.tlv_audit_trigger();
    $f$, t.table_name, t.table_name, t.table_name, t.table_name);
    RAISE NOTICE 'trigger on %', t.table_name;
  END LOOP;

  -- 没有 merchant_id 的重要表（硬编码）
  EXECUTE $f$DROP TRIGGER IF EXISTS tlv_audit_merchants ON public.tlv_merchants;
    CREATE TRIGGER tlv_audit_merchants AFTER INSERT OR UPDATE OR DELETE
    ON public.tlv_merchants FOR EACH ROW EXECUTE FUNCTION public.tlv_audit_trigger();$f$;

  EXECUTE $f$DROP TRIGGER IF EXISTS tlv_audit_warehouses ON public.tlv_warehouses;
    CREATE TRIGGER tlv_audit_warehouses AFTER INSERT OR UPDATE OR DELETE
    ON public.tlv_warehouses FOR EACH ROW EXECUTE FUNCTION public.tlv_audit_trigger();$f$;

  EXECUTE $f$DROP TRIGGER IF EXISTS tlv_audit_package_logs ON public.tlv_package_logs;
    CREATE TRIGGER tlv_audit_package_logs AFTER INSERT OR UPDATE OR DELETE
    ON public.tlv_package_logs FOR EACH ROW EXECUTE FUNCTION public.tlv_audit_trigger();$f$;

  EXECUTE $f$DROP TRIGGER IF EXISTS tlv_audit_platform_sync_logs ON public.tlv_platform_sync_logs;
    CREATE TRIGGER tlv_audit_platform_sync_logs AFTER INSERT OR UPDATE OR DELETE
    ON public.tlv_platform_sync_logs FOR EACH ROW EXECUTE FUNCTION public.tlv_audit_trigger();$f$;

  EXECUTE $f$DROP TRIGGER IF EXISTS tlv_audit_label_templates ON public.tlv_label_templates;
    CREATE TRIGGER tlv_audit_label_templates AFTER INSERT OR UPDATE OR DELETE
    ON public.tlv_label_templates FOR EACH ROW EXECUTE FUNCTION public.tlv_audit_trigger();$f$;

  EXECUTE $f$DROP TRIGGER IF EXISTS tlv_audit_platforms ON public.tlv_platforms;
    CREATE TRIGGER tlv_audit_platforms AFTER INSERT OR UPDATE OR DELETE
    ON public.tlv_platforms FOR EACH ROW EXECUTE FUNCTION public.tlv_audit_trigger();$f$;

  EXECUTE $f$DROP TRIGGER IF EXISTS tlv_audit_warehouse_flows ON public.tlv_warehouse_flows;
    CREATE TRIGGER tlv_audit_warehouse_flows AFTER INSERT OR UPDATE OR DELETE
    ON public.tlv_warehouse_flows FOR EACH ROW EXECUTE FUNCTION public.tlv_audit_trigger();$f$;

  EXECUTE $f$DROP TRIGGER IF EXISTS tlv_audit_warehouse_settlements ON public.tlv_warehouse_settlements;
    CREATE TRIGGER tlv_audit_warehouse_settlements AFTER INSERT OR UPDATE OR DELETE
    ON public.tlv_warehouse_settlements FOR EACH ROW EXECUTE FUNCTION public.tlv_audit_trigger();$f$;

  EXECUTE $f$DROP TRIGGER IF EXISTS tlv_audit_employees ON public.tlv_employees;
    CREATE TRIGGER tlv_audit_employees AFTER INSERT OR UPDATE OR DELETE
    ON public.tlv_employees FOR EACH ROW EXECUTE FUNCTION public.tlv_audit_trigger();$f$;

  EXECUTE $f$DROP TRIGGER IF EXISTS tlv_audit_flow_nodes ON public.tlv_flow_nodes;
    CREATE TRIGGER tlv_audit_flow_nodes AFTER INSERT OR UPDATE OR DELETE
    ON public.tlv_flow_nodes FOR EACH ROW EXECUTE FUNCTION public.tlv_audit_trigger();$f$;

  RAISE NOTICE 'all audit triggers rebuilt';
END $$;

SELECT 'done' AS status;
