-- ============================================================
-- Thalvior ERP 发票模块重构迁移（2026-10-13）
-- 目标：开票与真实支付订单强制关联，金额服务端计算，前端不可篡改
-- 前置：trg_guard_invoice_status 止血触发器已上线（保留）
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;

-- ---------- 1. invoices 增加 void_reason ----------
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS void_reason text;
UPDATE public.invoices SET void_reason = reject_reason
 WHERE status = 'void' AND void_reason IS NULL AND reject_reason IS NOT NULL;

-- ---------- 2. invoice_links（发票↔支付单 关联表） ----------
CREATE TABLE IF NOT EXISTS public.invoice_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  payment_order_no text NOT NULL REFERENCES public.payment_orders(order_no) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_order_no)
);
CREATE INDEX IF NOT EXISTS idx_invoice_links_invoice ON public.invoice_links(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_links_user ON public.invoice_links(user_id);

ALTER TABLE public.invoice_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_own_invoice_links ON public.invoice_links;
CREATE POLICY users_select_own_invoice_links ON public.invoice_links
  FOR SELECT USING (user_id = auth.uid());
-- 写入仅经 SECURITY DEFINER 函数/运维角色，不建 INSERT/UPDATE/DELETE 策略

-- ---------- 3. 视图 invoice_paid_sources：本人可开票支付单 ----------
-- paid 且未被活动（pending/issued）发票引用；usage_kind 供前端映射文案
CREATE OR REPLACE VIEW public.invoice_paid_sources WITH (security_invoker = true) AS
SELECT
  po.id,
  po.user_id,
  po.order_no,
  po.amount,
  po.status,
  po.plan_id,
  po.credits_granted,
  po.package_code,
  po.platform_code,
  po.paid_at,
  po.created_at,
  CASE
    WHEN po.plan_id IS NOT NULL THEN 'subscription'
    WHEN po.package_code LIKE 'credits%' OR (po.package_code IS NULL AND po.credits_granted IS NOT NULL) THEN 'credits'
    WHEN po.package_code IS NOT NULL THEN 'platform'
    ELSE 'other'
  END AS usage_kind,
  (active.payment_order_no IS NOT NULL) AS is_used
FROM public.payment_orders po
LEFT JOIN (
  SELECT l.payment_order_no
  FROM public.invoice_links l
  JOIN public.invoices i ON i.id = l.invoice_id AND i.status IN ('pending','issued')
) active ON active.payment_order_no = po.order_no
WHERE po.status = 'paid';

GRANT SELECT ON public.invoice_paid_sources TO anon, authenticated;

-- ---------- 4. 替换视图 invoice_quota：占用口径改为 invoice_links ----------
CREATE OR REPLACE VIEW public.invoice_quota WITH (security_invoker = true) AS
SELECT
  COALESCE(paid.user_id, used.user_id) AS user_id,
  COALESCE(paid.total, 0::numeric) AS paid_total,
  COALESCE(used.total, 0::numeric) AS invoiced_total,
  GREATEST(COALESCE(paid.total, 0::numeric) - COALESCE(used.total, 0::numeric), 0::numeric) AS available_amount
FROM (
  SELECT po.user_id, sum(po.amount) AS total
  FROM public.payment_orders po
  WHERE po.status = 'paid'
  GROUP BY po.user_id
) paid
FULL JOIN (
  SELECT l.user_id, sum(l.amount) AS total
  FROM public.invoice_links l
  JOIN public.invoices i ON i.id = l.invoice_id AND i.status IN ('pending','issued')
  GROUP BY l.user_id
) used ON used.user_id = paid.user_id;

GRANT SELECT ON public.invoice_quota TO anon, authenticated;

-- ---------- 5. RPC request_invoice：服务端算钱、事务校验 ----------
CREATE OR REPLACE FUNCTION public.request_invoice(
  p_order_nos text[],
  p_invoice_type text DEFAULT 'normal',
  p_title_type text DEFAULT 'personal',
  p_title text DEFAULT NULL,
  p_tax_no text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_remark text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_amount numeric;
  v_content text;
  v_invoice_id uuid;
  v_valid_cnt int;
  v_orders text[];
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_order_nos IS NULL OR cardinality(p_order_nos) = 0 THEN
    RAISE EXCEPTION 'no payment orders selected';
  END IF;
  -- 去重，防同一单重复计费
  SELECT coalesce(array_agg(DISTINCT x), '{}') INTO v_orders FROM unnest(p_order_nos) AS x;
  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'invoice title is required';
  END IF;
  IF p_invoice_type NOT IN ('normal','special') THEN
    RAISE EXCEPTION 'invalid invoice type';
  END IF;
  IF p_title_type NOT IN ('personal','corporate') THEN
    RAISE EXCEPTION 'invalid title type';
  END IF;

  -- 校验：全部勾选单必须属于本人 + paid + 未被活动发票占用
  SELECT count(*) INTO v_valid_cnt
  FROM unnest(v_orders) AS w(order_no)
  JOIN public.payment_orders po
    ON po.order_no = w.order_no AND po.user_id = v_user AND po.status = 'paid'
  LEFT JOIN public.invoice_links l ON l.payment_order_no = po.order_no
  LEFT JOIN public.invoices i ON i.id = l.invoice_id AND i.status IN ('pending','issued')
  WHERE i.id IS NULL;
  IF v_valid_cnt <> cardinality(v_orders) THEN
    RAISE EXCEPTION 'some payment orders are invalid or already invoiced';
  END IF;

  -- 金额：服务端计算，不信任前端
  SELECT round(coalesce(sum(po.amount), 0), 2) INTO v_amount
  FROM unnest(v_orders) AS w(order_no)
  JOIN public.payment_orders po
    ON po.order_no = w.order_no AND po.user_id = v_user AND po.status = 'paid';
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'invoice amount must be positive';
  END IF;

  -- 开票内容：按用途自动映射（优先级 订阅 > 平台授权 > 积分 > 兜底）
  SELECT CASE
    WHEN bool_or(po.plan_id IS NOT NULL) THEN '软件订阅服务费'
    WHEN bool_or(po.package_code IS NOT NULL AND po.package_code NOT LIKE 'credits%') THEN '平台技术服务费'
    WHEN bool_or(po.package_code LIKE 'credits%' OR po.credits_granted IS NOT NULL) THEN '平台积分充值'
    ELSE '信息技术服务费'
  END INTO v_content
  FROM unnest(v_orders) AS w(order_no)
  JOIN public.payment_orders po
    ON po.order_no = w.order_no AND po.user_id = v_user AND po.status = 'paid';

  -- 写入发票（pending，票号/开票状态由管理员后续操作）
  INSERT INTO public.invoices
    (user_id, invoice_type, title_type, title, tax_no, amount, content, email, remark, status, order_nos)
  VALUES (
    v_user, p_invoice_type, p_title_type, btrim(p_title),
    nullif(btrim(coalesce(p_tax_no, '')), ''),
    v_amount, v_content,
    nullif(btrim(coalesce(p_email, '')), ''),
    nullif(btrim(coalesce(p_remark, '')), ''),
    'pending', to_jsonb(v_orders)
  ) RETURNING id INTO v_invoice_id;

  -- 写入关联（UNIQUE(payment_order_no) 兜底并发重复占用）
  INSERT INTO public.invoice_links (invoice_id, payment_order_no, user_id, amount)
  SELECT v_invoice_id, po.order_no, v_user, po.amount
  FROM unnest(v_orders) AS w(order_no)
  JOIN public.payment_orders po
    ON po.order_no = w.order_no AND po.user_id = v_user AND po.status = 'paid';

  RETURN v_invoice_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_invoice(text[],text,text,text,text,text,text) TO authenticated;

-- ---------- 6a. INSERT 守卫：发票只能经 request_invoice 创建 ----------
CREATE OR REPLACE FUNCTION public.fn_invoice_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
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

DROP TRIGGER IF EXISTS trg_invoice_insert_guard ON public.invoices;
CREATE TRIGGER trg_invoice_insert_guard
BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.fn_invoice_insert_guard();

-- ---------- 6b. UPDATE 守卫：非特权角色仅可改 pending 的抬头类字段 ----------
CREATE OR REPLACE FUNCTION public.fn_invoice_guard_columns()
RETURNS trigger
LANGUAGE plpgsql
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

DROP TRIGGER IF EXISTS trg_invoice_guard ON public.invoices;
CREATE TRIGGER trg_invoice_guard
BEFORE UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.fn_invoice_guard_columns();

-- ---------- 6c. 升级止血触发器：放行 service_role/运维角色 ----------
CREATE OR REPLACE FUNCTION public.fn_guard_invoice_status()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status = 'issued' AND OLD.status <> 'issued'
     AND current_user NOT IN ('service_role','supabase_admin','postgres')
     AND NOT has_role(uid(), 'admin'::text) THEN
    RAISE EXCEPTION 'only admins can issue invoices';
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------- 6d. 作废/驳回时级联清空 invoice_links（双保险） ----------
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

DROP TRIGGER IF EXISTS trg_invoice_links_cleanup ON public.invoices;
CREATE TRIGGER trg_invoice_links_cleanup
AFTER UPDATE OF status ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.fn_invoice_links_cleanup();

-- ---------- 7/8/9. 存量数据已止血为 void（4 条）；RLS invoices 既有策略保持不变 ----------
COMMIT;

-- ---------- 验证 ----------
SELECT 'invoice_links' AS object, count(*) FROM public.invoice_links
UNION ALL
SELECT 'void invoices', count(*) FROM public.invoices WHERE status = 'void';
SELECT * FROM public.invoice_quota;
SELECT 'MIGRATION-OK' AS result;
