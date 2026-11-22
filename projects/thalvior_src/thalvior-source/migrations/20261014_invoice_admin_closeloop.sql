-- ============================================================
-- Thalvior 发票全链路补齐（管理员侧 + 通知闭环 + 申请人邮箱视图）
-- 2026-10-14
-- 1) v_admin_invoices 视图：admin 查全部发票 + 申请人账号邮箱（definer 绕 RLS，内部 has_role 过滤）
-- 2) RPC request_invoice_issue：仅 admin/service_role，pending→issued，幂等防重票号，通知用户+邮件
-- 3) RPC request_invoice_reject：仅 admin/service_role，pending→rejected，原因必填≤200，通知用户+邮件
-- 4) request_invoice 重写：申请后给所有 admin 发站内通知
-- 5) 邮件模板 invoice_issued / invoice_rejected（zh/en）
-- ============================================================

-- ---------- 1. admin 发票总览视图（含申请人账号邮箱） ----------
CREATE OR REPLACE VIEW public.v_admin_invoices AS
SELECT i.*, u.email AS applicant_email
FROM public.invoices i
JOIN auth.users u ON u.id = i.user_id
WHERE has_role(auth.uid(), 'admin'::text);

GRANT SELECT ON public.v_admin_invoices TO authenticated;

-- ---------- 2. admin 开票 ----------
CREATE OR REPLACE FUNCTION public.request_invoice_issue(
  p_invoice_id uuid,
  p_invoice_no text,
  p_file_url text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user uuid := auth.uid();
  -- SECURITY DEFINER 下 current_user 已是函数 owner，不能用 current_user 判断调用者；
  -- 必须凭 JWT claims 的 role 区分真实调用方（用户 JWT=authenticated，服务端=service_role）
  v_caller_role text := coalesce(auth.jwt() ->> 'role', '');
  v_owner uuid;
  v_email text;
  v_title text;
  v_amount numeric;
  v_status text;
  v_no text := btrim(coalesce(p_invoice_no, ''));
  v_url text := nullif(btrim(coalesce(p_file_url, '')), '');
  v_secret text;
BEGIN
  -- 仅管理员：admin 角色 JWT 或 service_role
  IF (v_user IS NULL OR NOT has_role(v_user, 'admin'::text))
     AND v_caller_role <> 'service_role' THEN
    RAISE EXCEPTION '只有管理员可以执行开票操作';
  END IF;
  IF v_no = '' THEN
    RAISE EXCEPTION '发票号不能为空';
  END IF;
  IF length(v_no) > 100 THEN
    RAISE EXCEPTION '发票号不能超过100字';
  END IF;
  IF v_url IS NOT NULL AND v_url !~ '^https?://' THEN
    RAISE EXCEPTION '发票文件链接必须以 http(s):// 开头';
  END IF;

  SELECT user_id, email, title, amount, status
    INTO v_owner, v_email, v_title, v_amount, v_status
  FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '发票不存在';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION '只有待开票状态的发票可以执行开票';
  END IF;

  -- 幂等防重：同号发票（非本票）已存在则拒绝
  IF EXISTS (SELECT 1 FROM public.invoices WHERE invoice_no = v_no AND id <> p_invoice_id) THEN
    RAISE EXCEPTION '发票号 % 已存在，请更换发票号', v_no;
  END IF;

  UPDATE public.invoices
  SET status = 'issued',
      invoice_no = v_no,
      file_url = v_url,
      issued_at = now(),
      updated_at = now()
  WHERE id = p_invoice_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION '发票状态已变化，请刷新后重试';
  END IF;

  -- 站内通知申请用户
  INSERT INTO public.notifications (user_id, title, content, type)
  VALUES (
    v_owner,
    '发票已开具',
    format('您的开票申请已完成：发票号 %s，金额 ¥%s，抬头「%s」。电子发票将发送至接收邮箱 %s，也可在「财务中心-发票管理」查看详情。',
           v_no, to_char(v_amount, 'FM999999990.00'), coalesce(v_title, ''), coalesce(v_email, '—')),
    '发票'
  );

  -- 邮件通知（pg_net 异步，失败不阻塞开票事务）
  v_secret := nullif(current_setting('app.mailer_secret', true), '');
  IF v_email IS NOT NULL AND v_secret IS NOT NULL THEN
    PERFORM net.http_post(
      url := 'http://kong:8000/functions/v1/mailer',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-mailer-secret', v_secret
      ),
      body := jsonb_build_object(
        'action', 'send',
        'scene', 'invoice_issued',
        'email', v_email,
        'lang', 'zh',
        'vars', jsonb_build_object(
          'invoiceNo', v_no,
          'amount', to_char(v_amount, 'FM999999990.00'),
          'title', coalesce(v_title, '')
        )
      )
    );
  END IF;

  RETURN v_no;
END;
$$;

-- ---------- 3. admin 驳回 ----------
CREATE OR REPLACE FUNCTION public.request_invoice_reject(
  p_invoice_id uuid,
  p_reason text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user uuid := auth.uid();
  -- 同上：SECURITY DEFINER 下凭 JWT claims 判断调用方角色
  v_caller_role text := coalesce(auth.jwt() ->> 'role', '');
  v_owner uuid;
  v_email text;
  v_title text;
  v_status text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_secret text;
BEGIN
  IF (v_user IS NULL OR NOT has_role(v_user, 'admin'::text))
     AND v_caller_role <> 'service_role' THEN
    RAISE EXCEPTION '只有管理员可以执行驳回操作';
  END IF;
  IF v_reason = '' THEN
    RAISE EXCEPTION '驳回原因不能为空';
  END IF;
  IF length(v_reason) > 200 THEN
    RAISE EXCEPTION '驳回原因不能超过200字';
  END IF;

  SELECT user_id, email, title, status
    INTO v_owner, v_email, v_title, v_status
  FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '发票不存在';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION '只有待开票状态的发票可以驳回';
  END IF;

  UPDATE public.invoices
  SET status = 'rejected',
      reject_reason = v_reason,
      updated_at = now()
  WHERE id = p_invoice_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION '发票状态已变化，请刷新后重试';
  END IF;

  -- 站内通知申请用户（links_cleanup 触发器会解除支付订单占用，额度自动恢复）
  INSERT INTO public.notifications (user_id, title, content, type)
  VALUES (
    v_owner,
    '开票申请被驳回',
    format('您的开票申请未通过审核：抬头「%s」。驳回原因：%s。该申请关联的支付订单已解除占用，修正后可重新申请开票。',
           coalesce(v_title, ''), v_reason),
    '发票'
  );

  -- 邮件通知（pg_net 异步）
  v_secret := nullif(current_setting('app.mailer_secret', true), '');
  IF v_email IS NOT NULL AND v_secret IS NOT NULL THEN
    PERFORM net.http_post(
      url := 'http://kong:8000/functions/v1/mailer',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-mailer-secret', v_secret
      ),
      body := jsonb_build_object(
        'action', 'send',
        'scene', 'invoice_rejected',
        'email', v_email,
        'lang', 'zh',
        'vars', jsonb_build_object(
          'reason', v_reason,
          'title', coalesce(v_title, '')
        )
      )
    );
  END IF;

  RETURN v_reason;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_invoice_issue(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_invoice_reject(uuid, text) TO authenticated;

-- ---------- 4. request_invoice 重写：申请后通知所有 admin ----------
-- 函数体与 20261013_invoice_refactor.sql 版本一致（金额服务端算/四层校验），
-- 末尾新增：给全部 admin 发站内通知。admin 账号邮箱为测试域，不发邮件。
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
  v_user_email text;
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
  IF length(btrim(p_title)) > 200 THEN
    RAISE EXCEPTION '发票抬头不能超过200字';
  END IF;
  IF p_invoice_type NOT IN ('normal','special') THEN
    RAISE EXCEPTION 'invalid invoice type';
  END IF;
  IF p_title_type NOT IN ('personal','corporate') THEN
    RAISE EXCEPTION 'invalid title type';
  END IF;
  -- 企业抬头：税号必填，且须为 15/18/20 位统一社会信用代码（与前端 TAX_NO_RE 一致，18 位字符集已兼容 Q 开头老规则）
  IF p_title_type = 'corporate' THEN
    IF p_tax_no IS NULL OR btrim(p_tax_no) = '' THEN
      RAISE EXCEPTION '企业抬头必须填写税号';
    END IF;
    IF upper(btrim(p_tax_no)) !~ '^(?:[0-9A-Z]{15}|[0-9A-HJ-NPQRTUWXY]{18}|[0-9A-Z]{20})$' THEN
      RAISE EXCEPTION '税号格式不正确：统一社会信用代码为 15/18/20 位大写字母数字';
    END IF;
  END IF;
  -- 邮箱：电子发票交付通道，企业/个人抬头均必填且须符合邮箱格式
  IF p_email IS NULL OR btrim(p_email) = '' THEN
    RAISE EXCEPTION '请填写接收邮箱，电子发票将发送至该邮箱';
  END IF;
  IF btrim(p_email) !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION '邮箱格式不正确';
  END IF;
  -- 备注：选填，超长拒绝
  IF p_remark IS NOT NULL AND length(btrim(p_remark)) > 500 THEN
    RAISE EXCEPTION '备注不能超过500字';
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

  -- 写入发票（pending，票号/开票状态由管理员后续操作）；税号统一大写
  INSERT INTO public.invoices
    (user_id, invoice_type, title_type, title, tax_no, amount, content, email, remark, status, order_nos)
  VALUES (
    v_user, p_invoice_type, p_title_type, btrim(p_title),
    nullif(upper(btrim(coalesce(p_tax_no, ''))), ''),
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

  -- 通知所有管理员：收到新开票申请（站内；admin 账号邮箱为测试域，不发邮件）
  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user;
  INSERT INTO public.notifications (user_id, title, content, type)
  SELECT p.id,
         '收到新开票申请',
         format('用户 %s（%s）提交了开票申请：金额 ¥%s，抬头「%s」，关联 %s 笔支付订单，请到「开发者后台-发票管理」处理。',
                coalesce((SELECT username FROM public.profiles WHERE id = v_user), v_user::text),
                coalesce(v_user_email, '—'),
                to_char(v_amount, 'FM999999990.00'),
                btrim(p_title),
                cardinality(v_orders)),
         '发票'
  FROM public.profiles p
  WHERE p.role = 'admin';

  RETURN v_invoice_id;
END;
$$;

-- ---------- 5. 邮件模板（幂等 upsert） ----------
INSERT INTO public.email_templates (scene, lang, name, subject, body, enabled) VALUES
('invoice_issued', 'zh', '发票已开具通知',
 '【Thalvior】您的发票已开具',
 E'尊敬的 ${userName}：\n\n您好！\n您的开票申请已完成开具。\n\n发票号：${invoiceNo}\n发票金额：¥${amount}\n发票抬头：${title}\n\n电子发票已发送至本邮箱，请注意查收。您也可以登录 ERP，在「财务中心-发票管理」查看详情。\n\n如有疑问，请联系客服。\n\n—— Thalvior 团队', true),
('invoice_issued', 'en', 'Invoice issued notice',
 '[Thalvior] Your invoice has been issued',
 E'Dear ${userName},\n\nYour invoice request has been processed.\n\nInvoice No.: ${invoiceNo}\nAmount: CNY ${amount}\nInvoice Title: ${title}\n\nThe e-invoice has been sent to this email address. You can also log in to the ERP and check the details under "Finance - Invoicing".\n\nIf you have any questions, please contact support.\n\n— The Thalvior Team', true),
('invoice_rejected', 'zh', '开票申请驳回通知',
 '【Thalvior】您的开票申请被驳回',
 E'尊敬的 ${userName}：\n\n您好！\n很抱歉，您的开票申请未能通过审核。\n\n发票抬头：${title}\n驳回原因：${reason}\n\n该申请关联的支付订单已解除占用。您可以在修正问题后重新提交开票申请，或联系客服咨询。\n\n—— Thalvior 团队', true),
('invoice_rejected', 'en', 'Invoice request rejected notice',
 '[Thalvior] Your invoice request was rejected',
 E'Dear ${userName},\n\nUnfortunately, your invoice request was not approved.\n\nInvoice Title: ${title}\nReason: ${reason}\n\nThe linked paid orders have been released. You may fix the issue and submit a new request, or contact support for assistance.\n\n— The Thalvior Team', true)
ON CONFLICT (scene, lang) DO UPDATE
SET name = EXCLUDED.name, subject = EXCLUDED.subject, body = EXCLUDED.body,
    enabled = EXCLUDED.enabled, updated_at = now();
