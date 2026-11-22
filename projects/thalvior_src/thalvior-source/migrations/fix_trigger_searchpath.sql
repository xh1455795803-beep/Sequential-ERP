-- 修复：触发器函数全限定 + 显式 search_path（裸 uid() 在 PostgREST 会话下解析失败）
\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_guard_invoice_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth, extensions
AS $function$
BEGIN
  IF NEW.status = 'issued' AND OLD.status <> 'issued'
     AND current_user NOT IN ('service_role','supabase_admin','postgres')
     AND NOT has_role(auth.uid(), 'admin'::text) THEN
    RAISE EXCEPTION 'only admins can issue invoices';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_invoice_guard_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth, extensions
AS $$
BEGIN
  IF current_user IN ('service_role','supabase_admin','postgres') THEN
    RETURN NEW;
  END IF;
  IF has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'pending' AND NEW.status = 'pending' THEN
    NEW.amount := OLD.amount;
    NEW.content := OLD.content;
    NEW.order_nos := OLD.order_nos;
    NEW.invoice_no := OLD.invoice_no;
    NEW.issued_at := OLD.issued_at;
    NEW.file_url := OLD.file_url;
    NEW.user_id := OLD.user_id;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invoice update not allowed for current role';
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_invoice_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth, extensions
AS $$
BEGIN
  IF current_user IN ('service_role','supabase_admin','postgres') THEN
    RETURN NEW;
  END IF;
  IF has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invoices must be created via request_invoice rpc';
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_invoice_links_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
BEGIN
  IF NEW.status IN ('void','rejected') AND OLD.status NOT IN ('void','rejected') THEN
    DELETE FROM public.invoice_links WHERE invoice_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
SELECT 'TRIGGER-FIX-OK' AS result;
