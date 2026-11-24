-- 修复：过滤 views，只在 base tables 上建 trigger
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
             AND cls.relkind = 'r'  -- base table only, skip views
  LOOP
    EXECUTE format($f$
      DROP TRIGGER IF EXISTS tlv_audit_%I ON public.%I;
      CREATE TRIGGER tlv_audit_%I
        AFTER INSERT OR UPDATE OR DELETE ON public.%I
        FOR EACH ROW EXECUTE FUNCTION public.tlv_audit_trigger();
    $f$, t.table_name, t.table_name, t.table_name, t.table_name);
    RAISE NOTICE 'Trigger on %', t.table_name;
  END LOOP;

  -- 其他没有 merchant_id 的重要表
  FOR t IN (VALUES
    ('tlv_merchants'), ('tlv_warehouses'), ('tlv_package_logs'),
    ('tlv_platform_sync_logs'), ('tlv_label_templates'), ('tlv_platforms'),
    ('tlv_warehouse_flows'), ('tlv_warehouse_settlements'),
    ('tlv_employees'), ('tlv_flow_nodes')
  ) AS v(table_name)
  LOOP
    EXECUTE format($f$
      DROP TRIGGER IF EXISTS tlv_audit_%I ON public.%I;
      CREATE TRIGGER tlv_audit_%I
        AFTER INSERT OR UPDATE OR DELETE ON public.%I
        FOR EACH ROW EXECUTE FUNCTION public.tlv_audit_trigger();
    $f$, t.table_name, t.table_name, t.table_name, t.table_name);
    RAISE NOTICE 'Trigger on %', t.table_name;
  END LOOP;
END $$;

SELECT 'triggers_rebuilt' AS done;
