-- ============================================================
-- 2026-10-25 模板/预置资产 P0 补全（四棒合一）
-- 1) automation 种子双语：fn_automation_seed_defaults 规则名 → auto.seed.* key
-- 2) 通知 content 多语化：10 个 DB 函数 content → notif.c.*::[json vars]
--    automation runs result → notif.r.*::[json vars]
-- 3) 邮件新场景：order_shipped / stock_alert（email_templates 双语 + 触发接线）
--    - fn_automation_on_stock 低库存命中 → mailer(stock_alert, dedupe 24h)
--    - fn_notify_waybill_shipped（新，waybills INSERT）→ 站内 + mailer(order_shipped)
-- 红线：不碰 automation_rules 表现有数据；引擎匹配值 trigger='订单创建' 等保持原样
-- ============================================================

-- ---------- 1. 新租户种子（规则名 key 化；trigger/condition/action 为引擎匹配键保持不变） ----------
CREATE OR REPLACE FUNCTION public.fn_automation_seed_defaults()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO automation_rules(user_id, name, trigger, condition, action, workflow_def, enabled, status) VALUES
    (NEW.id, 'auto.seed.orderCreated',     '订单创建',     '',          '发送站内通知', '{"preset":true}'::jsonb, true, '启用'),
    (NEW.id, 'auto.seed.lowStock',         '库存低于阈值', '库存 < 10', '发送站内通知', '{"preset":true}'::jsonb, true, '启用'),
    (NEW.id, 'auto.seed.logistics',        '物流异常', '',     '发送站内通知', '{"preset":true}'::jsonb, true, '启用'),
    (NEW.id, 'auto.seed.auditRecipient',   '自动审单', '姓名/电话/地址非空',                  '拦截发货并通知', '{"preset":true,"audit_code":"recipient"}'::jsonb, true, '启用'),
    (NEW.id, 'auto.seed.auditInventory',   '自动审单', 'inventory.available ≥ 订单各 SKU 数量', '拦截发货并通知', '{"preset":true,"audit_code":"inventory"}'::jsonb, true, '启用'),
    (NEW.id, 'auto.seed.auditAmount',      '自动审单', 'order.amount > 0',                    '拦截发货并通知', '{"preset":true,"audit_code":"amount"}'::jsonb, true, '启用'),
    (NEW.id, 'auto.seed.auditDupShip',     '自动审单', '订单已存在未取消运单',              '拦截发货并通知', '{"preset":true,"audit_code":"dup_ship"}'::jsonb, true, '启用'),
    (NEW.id, 'auto.seed.auditShopAuth',    '自动审单', '店铺状态=已授权 且 token 未过期',       '拦截发货并通知', '{"preset":true,"audit_code":"shop_auth"}'::jsonb, true, '启用');
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW; -- 预置失败不阻断注册
END;
$function$;

-- ---------- 2. 自动化引擎：content / result key 化（content 带 ::json 数组参数） ----------
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
    v_shop := coalesce(nullif(NEW.shop_name, ''), '-');
    v_content := 'notif.c.autoOrder::' || jsonb_build_array(
      NEW.id, coalesce(nullif(NEW.buyer, ''), '-'), NEW.currency, NEW.amount::text, v_shop,
      coalesce(nullif(NEW.product, ''), '-'))::text;
    PERFORM public.fn_automation_execute(r, 'notif.gen.autoOrder', v_content,
      'notif.r.autoOrder::' || jsonb_build_array(NEW.id::text, NEW.currency, NEW.amount::text, v_shop)::text);
  END LOOP;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_automation_on_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  r automation_rules; v_uid uuid; v_threshold numeric; v_email text; v_secret text;
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
      'notif.c.autoStock::' || jsonb_build_array(NEW.sku, NEW.stock::text, coalesce(NEW.name, '-'))::text,
      'notif.r.autoStock::' || jsonb_build_array(NEW.sku, NEW.stock::text)::text);

    -- 邮件渠道补齐（pg_net 异步；24h 同场景去重由 mailer dedupeHours 保证，失败不阻塞）
    SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
    v_secret := nullif(current_setting('app.mailer_secret', true), '');
    IF v_email IS NOT NULL AND v_secret IS NOT NULL THEN
      BEGIN
        PERFORM net.http_post(
          url := 'http://kong:8000/functions/v1/mailer',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-mailer-secret', v_secret
          ),
          body := jsonb_build_object(
            'action', 'send',
            'scene', 'stock_alert',
            'email', v_email,
            'lang', 'zh',
            'dedupeHours', 24,
            'vars', jsonb_build_object(
              'sku', NEW.sku,
              'name', coalesce(NEW.name, '-'),
              'stock', NEW.stock::text
            )
          )
        );
      EXCEPTION WHEN OTHERS THEN NULL; -- 邮件失败不阻断库存事务
      END;
    END IF;
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
  v_no := coalesce(nullif(NEW.tracking_no, ''), nullif(NEW.waybill_no, ''), NEW.id::text);
  FOR r IN SELECT * FROM automation_rules
             WHERE user_id = NEW.user_id AND trigger = '物流异常'
               AND status = '启用' AND enabled = true
  LOOP
    PERFORM public.fn_automation_execute(r, 'notif.gen.autoWaybill',
      'notif.c.autoWaybill::' || jsonb_build_array(v_no, coalesce(nullif(NEW.carrier, ''), '-'), NEW.status)::text,
      'notif.r.autoWaybill::' || jsonb_build_array(v_no, NEW.status)::text);
  END LOOP;
  RETURN NEW;
END;
$function$;

-- ---------- 3. 业务通知 content key 化（标题 notif.gen.* 保持 10-24 方案） ----------
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
      'notif.c.invLow::' || jsonb_build_array(
        coalesce(NEW.name, '-'), coalesce(NEW.sku, '-'),
        NEW.available::text, NEW.safety_stock::text)::text,
      '库存');
  END IF;
  RETURN NEW;
END; $function$;

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
      'notif.c.billDue::' || jsonb_build_array(
        NEW.id::text, NEW.amount::text, to_char(NEW.due_date, 'YYYY-MM-DD'))::text,
      '财务'
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
    'notif.c.orderCreated::' || jsonb_build_array(
      coalesce(nullif(NEW.channel, ''), '-'),
      coalesce(nullif(NEW.shop_name, ''), '-'),
      coalesce(nullif(NEW.buyer, ''), '-'),
      coalesce(nullif(NEW.product, ''), '-'),
      coalesce(NEW.currency, '-'),
      NEW.amount::text)::text,
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
    VALUES (NEW.user_id, 'notif.gen.orderPendingShipment',
      'notif.c.orderPay::' || jsonb_build_array(NEW.id::text, coalesce(nullif(NEW.buyer, ''), '-'))::text, '订单');
  ELSIF NEW.status = '已发货' OR NEW.status = '部分发货' THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (NEW.user_id, 'notif.gen.orderShipped',
      'notif.c.orderShipped::' || jsonb_build_array(NEW.id::text, coalesce(nullif(NEW.buyer, ''), '-'))::text, '订单');
  ELSIF NEW.status = '已完成' THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (NEW.user_id, 'notif.gen.orderCompleted',
      'notif.c.orderDone::' || jsonb_build_array(NEW.id::text, coalesce(nullif(NEW.buyer, ''), '-'), NEW.amount::text)::text, '订单');
  ELSIF NEW.status = '已取消' THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (NEW.user_id, 'notif.gen.orderCancelled',
      'notif.c.orderCancel::' || jsonb_build_array(NEW.id::text, coalesce(nullif(NEW.buyer, ''), '-'))::text, '订单');
  ELSIF NEW.status IN ('售后中', '退款中', '退款完成') THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (NEW.user_id, 'notif.gen.orderAfterSale',
      'notif.c.orderAfterSaleSt::' || jsonb_build_array(NEW.id::text, coalesce(nullif(NEW.buyer, ''), '-'), NEW.status)::text, '订单');
  ELSIF NEW.status = '付款成功' THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (NEW.user_id, 'notif.gen.orderPaid',
      'notif.c.orderPaid::' || jsonb_build_array(NEW.id::text, coalesce(nullif(NEW.buyer, ''), '-'), NEW.amount::text)::text, '订单');
  ELSIF NEW.status = '已到仓' THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (NEW.user_id, 'notif.gen.orderArrived',
      'notif.c.orderArrived::' || jsonb_build_array(NEW.id::text, coalesce(nullif(NEW.buyer, ''), '-'))::text, '订单');
  END IF;

  RETURN NEW;
END;
$function$;

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
      'notif.c.orderAftersale::' || jsonb_build_array(NEW.id::text, coalesce(nullif(NEW.buyer, ''), '-'))::text,
      '订单'
    );
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
    'notif.c.poInbound::' || jsonb_build_array(
      v_order.po_no, v_stock_updated::text, v_cost_updated::text)::text,
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
      'notif.c.stockNoMap::' || jsonb_build_array(
        coalesce(NEW.name, '-'), coalesce(NEW.sku, '-'),
        OLD.available::text, NEW.available::text)::text,
      '库存'
    );
  END IF;

  RETURN NEW;
END $function$;

-- ---------- 4. 发票三函数 content key 化（邮件 pg_net 逻辑保持原样） ----------
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
         'notif.c.invReq::' || jsonb_build_array(
            coalesce((SELECT username FROM public.profiles WHERE id = v_user), v_user::text),
            coalesce(v_user_email, '-'),
            to_char(v_amount, 'FM999999990.00'),
            btrim(p_title),
            cardinality(v_orders)::text)::text,
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
    'notif.c.invIssued::' || jsonb_build_array(
      v_no, to_char(v_amount, 'FM999999990.00'), coalesce(v_title, '-'), coalesce(v_email, '-'))::text,
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
    'notif.c.invRejected::' || jsonb_build_array(coalesce(v_title, '-'), v_reason)::text,
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

-- ---------- 5. 新增：运单发货通知（站内 + order_shipped 邮件） ----------
CREATE OR REPLACE FUNCTION public.fn_notify_waybill_shipped()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_email text; v_secret text; v_no text; v_carrier text;
BEGIN
  v_no := coalesce(nullif(NEW.tracking_no, ''), nullif(NEW.waybill_no, ''), NEW.id::text);
  v_carrier := coalesce(nullif(NEW.carrier, ''), '-');
  -- 站内通知
  INSERT INTO notifications(user_id, title, content, type)
  VALUES (NEW.user_id, 'notif.gen.waybillShipped',
    'notif.c.waybillShipped::' || jsonb_build_array(v_no, v_carrier, NEW.status)::text, '物流');
  -- 邮件（pg_net 异步，失败不阻塞发货事务）
  SELECT email INTO v_email FROM auth.users WHERE id = NEW.user_id;
  v_secret := nullif(current_setting('app.mailer_secret', true), '');
  IF v_email IS NOT NULL AND v_secret IS NOT NULL THEN
    BEGIN
      PERFORM net.http_post(
        url := 'http://kong:8000/functions/v1/mailer',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-mailer-secret', v_secret
        ),
        body := jsonb_build_object(
          'action', 'send',
          'scene', 'order_shipped',
          'email', v_email,
          'lang', 'zh',
          'vars', jsonb_build_object(
            'waybillNo', v_no,
            'carrier', v_carrier,
            'status', NEW.status
          )
        )
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW; -- 通知失败不阻断运单写入
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_waybill_shipped ON public.waybills;
CREATE TRIGGER trg_notify_waybill_shipped
  AFTER INSERT ON public.waybills
  FOR EACH ROW EXECUTE FUNCTION public.fn_notify_waybill_shipped();

-- ---------- 6. 邮件模板：order_shipped / stock_alert（zh/en 双语） ----------
INSERT INTO email_templates(scene, lang, name, subject, body, enabled) VALUES
('order_shipped', 'zh', '运单发货通知',
 E'【Thalvior】运单 ${waybillNo} 已发货',
 E'尊敬的用户：\n\n您的运单已生成并交付承运商。\n运单号：${waybillNo}\n承运商：${carrier}\n当前状态：${status}\n\n可登录系统在「物流发货」查看跟踪详情：${systemUrl}\n\n—— Thalvior 跨境ERP', true),
('order_shipped', 'en', 'Shipment Dispatched',
 E'[Thalvior] Waybill ${waybillNo} dispatched',
 E'Dear user,\n\nYour waybill has been created and handed to the carrier.\nWaybill: ${waybillNo}\nCarrier: ${carrier}\nStatus: ${status}\n\nTrack it in the Shipping module after signing in: ${systemUrl}\n\n— Thalvior Cross-border ERP', true),
('stock_alert', 'zh', '库存告警通知',
 E'【Thalvior】库存告警：${sku} 剩余 ${stock}',
 E'尊敬的用户：\n\n以下商品库存已低于阈值，请及时补货：\n商品：${name}\nSKU：${sku}\n当前库存：${stock}\n\n可登录系统在「仓储库存」处理：${systemUrl}\n\n—— Thalvior 跨境ERP', true),
('stock_alert', 'en', 'Low Stock Alert',
 E'[Thalvior] Low stock: ${sku} has ${stock} left',
 E'Dear user,\n\nThe following product is below the stock threshold:\nProduct: ${name}\nSKU: ${sku}\nCurrent stock: ${stock}\n\nHandle it in the Inventory module after signing in: ${systemUrl}\n\n— Thalvior Cross-border ERP', true)
ON CONFLICT (scene, lang) DO UPDATE
SET name = EXCLUDED.name, subject = EXCLUDED.subject, body = EXCLUDED.body,
    enabled = EXCLUDED.enabled, updated_at = now();
