-- ============================================================
-- 订单全生命周期通知触发器补全 (2026-10-03)
-- 覆盖所有关键状态变更,保证每个订单节点都有站内通知
-- ============================================================

-- ---- [1] 订单新建通知 ----
CREATE OR REPLACE FUNCTION public.notify_order_created()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.notifications (user_id, title, content, type)
  VALUES (
    NEW.user_id,
    '您有一笔新订单请及时处理',
    '订单 ' || COALESCE(NEW.channel, '') || ' · ' || NEW.buyer || ' · ' || NEW.product || ' · ¥' || NEW.amount,
    '订单'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_order_created_trigger ON public.orders;
CREATE TRIGGER notify_order_created_trigger
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_order_created();

-- ---- [2] 订单状态流转通知(覆盖付款/发货/完成/取消/退款) ----
CREATE OR REPLACE FUNCTION public.notify_order_status_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- 只有 status 真正变了才发
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = '待发货' THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (NEW.user_id, '订单待发货', '订单 ' || NEW.id || '（' || NEW.buyer || '）已完成付款, 请尽快安排发货', '订单');
  ELSIF NEW.status = '已发货' OR NEW.status = '部分发货' THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (NEW.user_id, '订单已发货', '订单 ' || NEW.id || '（' || NEW.buyer || '）物流已发出', '订单');
  ELSIF NEW.status = '已完成' THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (NEW.user_id, '订单已完成', '订单 ' || NEW.id || '（' || NEW.buyer || '）交易完成, 共 ¥' || NEW.amount, '订单');
  ELSIF NEW.status = '已取消' THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (NEW.user_id, '订单已取消', '订单 ' || NEW.id || '（' || NEW.buyer || '）已取消', '订单');
  ELSIF NEW.status IN ('售后中', '退款中', '退款完成') THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (NEW.user_id, '订单售后提醒', '订单 ' || NEW.id || '（' || NEW.buyer || '）状态变更为「' || NEW.status || '」, 请及时处理', '订单');
  ELSIF NEW.status = '付款成功' THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (NEW.user_id, '订单已付款', '订单 ' || NEW.id || '（' || NEW.buyer || '）付款成功, 金额 ¥' || NEW.amount, '订单');
  ELSIF NEW.status = '已到仓' THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (NEW.user_id, '订单已到仓', '订单 ' || NEW.id || '（' || NEW.buyer || '）货品已到仓库, 等待分仓', '订单');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_order_status_change_trigger ON public.orders;
CREATE TRIGGER notify_order_status_change_trigger
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_order_status_change();

-- ---- [3] 合并旧的售后异常触发器(统一到上面的 status_change) ----
DROP TRIGGER IF EXISTS notify_order_abnormal_trigger ON public.orders;

-- ---- [4] 财务通知:待付款账单 ----
CREATE OR REPLACE FUNCTION public.notify_bill_due()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.due_date IS NOT NULL AND NEW.status = '待支付' AND NEW.amount > 0 THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (
      NEW.user_id,
      '账单到期提醒',
      '账单 ' || NEW.id || ' 金额 ¥' || NEW.amount || ', 将于 ' || NEW.due_date || ' 到期, 请及时付款',
      '财务'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_bill_due_trigger ON public.bills;
CREATE TRIGGER notify_bill_due_trigger
  AFTER INSERT ON public.bills
  FOR EACH ROW EXECUTE FUNCTION public.notify_bill_due();
