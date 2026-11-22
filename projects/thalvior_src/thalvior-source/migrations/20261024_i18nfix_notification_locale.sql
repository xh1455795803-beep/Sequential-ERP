CREATE OR REPLACE FUNCTION public.fn_automation_on_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r automation_rules; v_uid uuid; v_min numeric; v_shop text; v_content text;
BEGIN
  v_uid := NEW.user_id;
  IF v_uid IS NULL AND NEW.shop_id IS NOT NULL THEN
    SELECT user_id INTO v_uid FROM shops WHERE id = NEW.shop_id LIMIT 1;
  END IF;
  IF v_uid IS NULL THEN RETURN NEW; END IF;

  FOR r IN SELECT * FROM automation_rules
             WHERE user_id = v_uid AND trigger = '订单创建'
               AND status = '启用' AND enabled = true
  LOOP
    IF r.condition IS NOT NULL AND r.condition ~ '[0-9]' THEN
      v_min := (regexp_match(r.condition, '([0-9]+(\.[0-9]+)?'))[1]::numeric;
      IF NEW.amount < v_min THEN CONTINUE; END IF;
    END IF;
    v_shop := coalesce(nullif(NEW.shop_name, ''), '未知店铺');
    v_content := '订单 ' || NEW.id
      || '：买家 ' || coalesce(nullif(NEW.buyer, ''), '-')
      || '，金额 ' || NEW.currency || ' ' || NEW.amount::text
      || '，店铺 ' || v_shop
      || '，商品 ' || coalesce(nullif(NEW.product, ''), '-');
    PERFORM public.fn_automation_execute(r, 'notif.gen.autoOrder', v_content,
      '已发送站内通知：新订单 ' || NEW.id || '（' || NEW.currency || ' ' || NEW.amount::text || '，店铺 ' || v_shop || '）');
  END LOOP;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_automation_on_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r automation_rules; v_uid uuid; v_threshold numeric;
BEGIN
  v_uid := NEW.user_id;
  IF v_uid IS NULL AND NEW.shop_id IS NOT NULL THEN
    SELECT user_id INTO v_uid FROM shops WHERE id = NEW.shop_id LIMIT 1;
  END IF;
  IF v_uid IS NULL THEN RETURN NEW; END IF;

  FOR r IN SELECT * FROM automation_rules
             WHERE user_id = v_uid AND trigger = '库存低于阈值'
               AND status = '启用' AND enabled = true
  LOOP
    v_threshold := 10;
    IF r.condition ~ '[0-9]' THEN
      v_threshold := (regexp_match(r.condition, '([0-9]+)'))[1]::numeric;
    END IF;
    IF TG_OP = 'INSERT' THEN
      CONTINUE WHEN NEW.stock >= v_threshold;
    ELSE
      CONTINUE WHEN NOT (coalesce(OLD.stock, 0) >= v_threshold AND NEW.stock < v_threshold);
    END IF;
    PERFORM public.fn_automation_execute(r, 'notif.gen.autoStock',
      '库存告警：' || NEW.sku || ' 剩 ' || NEW.stock || '（产品：' || NEW.name || '）',
      '已发送站内通知：库存告警 ' || NEW.sku || ' 剩 ' || NEW.stock);
  END LOOP;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_automation_on_waybill()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r automation_rules; v_no text;
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('异常','延误','退回','丢失','拒收','破损','清关异常','超时','投递失败') THEN RETURN NEW; END IF;

  v_no := coalesce(nullif(NEW.tracking_no, ''), nullif(NEW.waybill_no, ''), NEW.id::text);
  FOR r IN SELECT * FROM automation_rules
             WHERE user_id = NEW.user_id AND trigger = '物流异常'
               AND status = '启用' AND enabled = true
  LOOP
    PERFORM public.fn_automation_execute(r, 'notif.gen.autoWaybill',
      '运单 ' || v_no || '（承运商 ' || coalesce(nullif(NEW.carrier, ''), '未知') || '）状态变为「' || NEW.status || '」，请及时处理',
      '已发送站内通知：物流异常 ' || v_no || '（' || NEW.status || '）');
  END LOOP;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_bill_due()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.due_date IS NOT NULL AND NEW.status = '待支付' AND NEW.amount > 0 THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (
      NEW.user_id,
      'notif.gen.billDue',
      '账单 ' || NEW.id || ' 金额 ¥' || NEW.amount || ', 将于 ' || NEW.due_date || ' 到期, 请及时付款',
      '财务'
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_inventory_low()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.available < NEW.safety_stock)
     OR (TG_OP = 'UPDATE' AND NEW.available < NEW.safety_stock AND OLD.available >= OLD.safety_stock) THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (
      NEW.user_id,
      'notif.gen.inventoryLow',
      '商品 ' || NEW.name || '（SKU：' || NEW.sku || '）可用库存 ' || NEW.available ||
        ' 低于安全库存 ' || NEW.safety_stock || '，请及时补货',
      '库存');
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.notify_order_abnormal()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status = '售后中' THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (
      NEW.user_id,
      'notif.gen.orderAbnormal',
      '订单 ' || NEW.id || '（买家：' || NEW.buyer || '）进入售后中状态，请及时处理',
      '订单'
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_order_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.notifications (user_id, title, content, type)
  VALUES (
    NEW.user_id,
    'notif.gen.orderCreated',
    '订单 ' || COALESCE(NEW.channel, '') ||
      CASE WHEN COALESCE(NEW.shop_name, '') <> '' THEN ' · 店铺「' || NEW.shop_name || '」' ELSE '' END ||
      ' · ' || NEW.buyer || ' · ' || NEW.product || ' · ' || NEW.currency || ' ' || NEW.amount::text,
    '订单');
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.notify_order_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- 只有 status 真正变了才发
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = '待发货' THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (NEW.user_id, 'notif.gen.orderPendingShipment', '订单 ' || NEW.id || '（' || NEW.buyer || '）已完成付款, 请尽快安排发货', '订单');
  ELSIF NEW.status = '已发货' OR NEW.status = '部分发货' THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (NEW.user_id, 'notif.gen.orderShipped', '订单 ' || NEW.id || '（' || NEW.buyer || '）物流已发出', '订单');
  ELSIF NEW.status = '已完成' THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (NEW.user_id, 'notif.gen.orderCompleted', '订单 ' || NEW.id || '（' || NEW.buyer || '）交易完成, 共 ¥' || NEW.amount, '订单');
  ELSIF NEW.status = '已取消' THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (NEW.user_id, 'notif.gen.orderCancelled', '订单 ' || NEW.id || '（' || NEW.buyer || '）已取消', '订单');
  ELSIF NEW.status IN ('售后中', '退款中', '退款完成') THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (NEW.user_id, 'notif.gen.orderAfterSale', '订单 ' || NEW.id || '（' || NEW.buyer || '）状态变更为「' || NEW.status || '」, 请及时处理', '订单');
  ELSIF NEW.status = '付款成功' THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (NEW.user_id, 'notif.gen.orderPaid', '订单 ' || NEW.id || '（' || NEW.buyer || '）付款成功, 金额 ¥' || NEW.amount, '订单');
  ELSIF NEW.status = '已到仓' THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (NEW.user_id, 'notif.gen.orderArrived', '订单 ' || NEW.id || '（' || NEW.buyer || '）货品已到仓库, 等待分仓', '订单');
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.purchase_inbound(p_order_id uuid, p_items jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_order public.purchase_orders;
  v_item jsonb;
  v_item_id uuid;
  v_qty integer;
  v_price numeric;
  v_product_id text;
  v_stock_updated integer := 0;
  v_cost_updated integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION '未登录';
  END IF;

  SELECT * INTO v_order FROM public.purchase_orders
    WHERE id = p_order_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '采购单不存在';
  END IF;
  IF v_order.status IN ('已入库', '已取消') THEN
    RAISE EXCEPTION '采购单已是终态（%）', v_order.status;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_items) = 'array' THEN p_items ELSE '[]'::jsonb END)
  LOOP
    v_item_id := (v_item->>'item_id')::uuid;
    v_qty := COALESCE(NULLIF(v_item->>'received_qty', '')::integer, NULL);
    v_price := NULLIF(v_item->>'price', '')::numeric;
    IF v_item_id IS NULL THEN CONTINUE; END IF;

    UPDATE public.purchase_items
      SET received_qty = COALESCE(v_qty, received_qty, qty),
          price = COALESCE(v_price, price)
      WHERE id = v_item_id AND order_id = p_order_id AND user_id = v_user;
    IF NOT FOUND THEN CONTINUE; END IF;

    IF COALESCE(v_qty, 0) > 0 THEN
      SELECT product_id INTO v_product_id FROM public.purchase_items WHERE id = v_item_id;
      IF v_product_id IS NOT NULL THEN
        UPDATE public.products
          SET stock = stock + v_qty,
              cost = CASE WHEN COALESCE(v_price, 0) > 0 THEN v_price ELSE cost END,
              updated_at = now()
          WHERE id = v_product_id AND user_id = v_user;
        IF FOUND THEN
          v_stock_updated := v_stock_updated + 1;
          IF COALESCE(v_price, 0) > 0 THEN v_cost_updated := v_cost_updated + 1; END IF;
        END IF;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.purchase_orders
    SET status = '已入库', inbound_at = now(), updated_at = now()
    WHERE id = p_order_id AND user_id = v_user;

  INSERT INTO public.notifications (user_id, title, content, type)
  VALUES (
    v_user,
    'notif.gen.poInbound',
    '采购单 ' || v_order.po_no || ' 已入库' ||
      CASE WHEN v_stock_updated > 0 THEN '，已回填 ' || v_stock_updated || ' 个产品库存' ELSE '' END ||
      CASE WHEN v_cost_updated > 0 THEN '，' || v_cost_updated || ' 个产品成本已更新' ELSE '' END,
    '采购'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'po_no', v_order.po_no,
    'stock_updated', v_stock_updated,
    'cost_updated', v_cost_updated
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.request_invoice(p_order_nos text[], p_invoice_type text DEFAULT 'normal'::text, p_title_type text DEFAULT 'personal'::text, p_title text DEFAULT NULL::text, p_tax_no text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_remark text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
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
         'notif.gen.invoiceNewRequest',
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
$function$;

CREATE OR REPLACE FUNCTION public.request_invoice_issue(p_invoice_id uuid, p_invoice_no text, p_file_url text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
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
    'notif.gen.invoiceIssued',
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
$function$;

CREATE OR REPLACE FUNCTION public.request_invoice_reject(p_invoice_id uuid, p_reason text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
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
    'notif.gen.invoiceRejected',
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
$function$;

CREATE OR REPLACE FUNCTION public.stock_sync_enqueue_on_available_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m       record;
  matched integer := 0;
BEGIN
  -- 幂等：同值变更不入队、不告警
  IF NEW.available IS NOT DISTINCT FROM OLD.available THEN
    RETURN NEW;
  END IF;

  -- 该 SKU 的有效刊登映射（listing 成功 + 远程 ID 存在 + 店铺已授权 + WooCommerce）
  FOR m IN
    SELECT sm.id AS sku_mappings_id, l.shop_auth_id
    FROM public.sku_mappings sm
    JOIN public.listings    l  ON l.id = sm.listing_id
    JOIN public.shop_auths  sa ON sa.id = l.shop_auth_id
    WHERE sm.local_sku = NEW.sku
      AND l.status = '成功'
      AND COALESCE(l.wc_product_id, '') <> ''
      AND sa.status = '已授权'
      AND sa.platform ILIKE 'woocommerce'
  LOOP
    INSERT INTO public.stock_sync_queue
      (product_id, sku_mappings_id, user_id, shop_auth_id, local_sku, old_qty, new_qty, status)
    VALUES
      (NEW.id, m.sku_mappings_id, NEW.user_id, m.shop_auth_id, NEW.sku, OLD.available, NEW.available, '待推送');
    matched := matched + 1;
  END LOOP;

  -- 主人红线：库存变更但无任何生效映射 → 缺映射告警进通知模块
  IF matched = 0 THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (
      NEW.user_id,
      'notif.gen.stockNoMapping',
      '商品「' || NEW.name || '」（SKU：' || NEW.sku || '）可用库存由 ' || OLD.available ||
        ' 变更为 ' || NEW.available || '，但该 SKU 没有正在生效的刊登映射' ||
        '（无「成功」状态刊登，或对应店铺未授权），库存变更无法推送到店铺。请到「刊登管理」完成刊登后再改库存。',
      '库存'
    );
  END IF;

  RETURN NEW;
END $function$;

