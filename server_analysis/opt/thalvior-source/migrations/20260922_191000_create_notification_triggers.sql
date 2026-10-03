-- 订单异常自动通知：新增订单状态为「售后中」时，自动生成站内通知
CREATE OR REPLACE FUNCTION public.notify_order_abnormal()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = '售后中' THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (
      NEW.user_id,
      '订单异常提醒',
      '订单 ' || NEW.id || '（买家：' || NEW.buyer || '）进入售后中状态，请及时处理',
      '订单'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_order_abnormal_trigger ON public.orders;
CREATE TRIGGER notify_order_abnormal_trigger
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_order_abnormal();

-- 库存预警自动通知：库存可用量低于安全库存时，自动生成站内通知
CREATE OR REPLACE FUNCTION public.notify_inventory_low()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.available < NEW.safety_stock THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (
      NEW.user_id,
      '库存预警',
      '商品 ' || NEW.name || '（SKU：' || NEW.sku || '）可用库存 ' || NEW.available || ' 低于安全库存 ' || NEW.safety_stock || '，请及时补货',
      '库存'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_inventory_low_trigger ON public.inventory;
CREATE TRIGGER notify_inventory_low_trigger
  AFTER INSERT OR UPDATE OF available, safety_stock ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public.notify_inventory_low();