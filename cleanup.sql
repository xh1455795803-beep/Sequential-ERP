-- 1. DROP 所有 public schema 里的 triggers（先保留业务 trigger 不动）
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT t.tgname, c.relname, p.proname
           FROM pg_trigger t
           JOIN pg_class c ON c.oid = t.tgrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
           LEFT JOIN pg_proc p ON p.oid = t.tgfoid
           WHERE NOT t.tgisinternal AND n.nspname = 'public'
             AND p.proname = 'tlv_audit_trigger'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', r.tgname, r.relname);
  END LOOP;
END $$;

-- 2. DROP 旧函数
DROP FUNCTION IF EXISTS public.tlv_audit_trigger();

-- 3. 清理垃圾业务数据
BEGIN;
DELETE FROM public.tlv_outbound_orders WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_inbound_orders WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_inventory_logs WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_packages WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_merchant_inventory WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_merchant_wallets WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_merchant_products WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_merchant_shops WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_logistics_tracking WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_billings WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_customer_profiles WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_audit_logs WHERE merchant_id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
DELETE FROM public.tlv_merchants WHERE id = '7e3bf09f-3937-4891-a6f6-75941f39d1b2';
COMMIT;

SELECT 'cleanup_done' AS status;
