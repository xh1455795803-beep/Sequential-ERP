-- =====================================================================
-- zz_20261116_oe01_order_events.sql
-- 订单事件时间线：修复「订单详情页时间线永远为空」
--
-- 现场证据（2026-11-16 运行时排查）：
--   src/routes/_layout.orders_.$id.tsx:97 查询 order_events，但该表在库里不存在；
--   代码写的是 `setTimeline((tl ?? []) ...)`，错误被吞 → 页面不报错，时间线恒空。
--   订单本身已能正常入库（sync-orders 已接通 WooCommerce / Ozon）。
--
-- 本迁移只做两件事：
--   1) 建表 order_events + RLS（与 orders 同权限口径：本人可见、admin 全可见）
--   2) 挂 AFTER INSERT / AFTER UPDATE 触发器，订单创建与状态变化自动写事件
--      —— 事件由数据库触发器写，任何写入路径（EF 同步、手工建单、页面编辑、发货）都会留下轨迹
--
-- 幂等：全部 IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS，可重复执行。
-- 事件文案：message 存中文明细（金额/店铺/状态流转），前端 orderEvent.<type> 有 i18n 时优先用 i18n，
--           否则回落到 message（现网暂无 orderEvent.* 词条，回落生效）。
-- =====================================================================

SET search_path = public;

-- ─── 1. 表 ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.order_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    text NOT NULL,
  user_id     uuid,
  event_type  text NOT NULL,
  message     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 外键：订单删除时事件一并清理（IF NOT EXISTS 通过 constraint 名重复执行安全）
DO $q$ BEGIN
  ALTER TABLE public.order_events
    ADD CONSTRAINT order_events_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] orders 表不存在';
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.order_events
    ADD CONSTRAINT order_events_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $q$;

CREATE INDEX IF NOT EXISTS order_events_order_created_idx
  ON public.order_events (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS order_events_user_created_idx
  ON public.order_events (user_id, created_at DESC);

COMMENT ON TABLE public.order_events IS '订单事件时间线（触发器自动写入：入库、状态流转）';

-- ─── 2. RLS（口径与 orders 一致） ────────────────────────────────────
ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select_order_events ON public.order_events;
CREATE POLICY users_select_order_events ON public.order_events
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS admins_select_order_events ON public.order_events;
CREATE POLICY admins_select_order_events ON public.order_events
  FOR SELECT USING (has_role(auth.uid(), 'admin'::text));

-- ─── 3. 事件写入函数 + 触发器 ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_order_event()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.order_events (order_id, user_id, event_type, message)
    VALUES (
      NEW.id,
      NEW.user_id,
      'created',
      format('订单入库：%s ｜ %s ｜ %s %s',
        COALESCE(NULLIF(NEW.channel, ''), '未知渠道'),
        COALESCE(NULLIF(NEW.shop_name, ''), '无店铺'),
        COALESCE(NEW.amount::text, '0'),
        COALESCE(NEW.currency, '')
      )
    );
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.order_events (order_id, user_id, event_type, message)
    VALUES (
      NEW.id,
      COALESCE(NEW.user_id, OLD.user_id),
      'status',
      format('状态变化：%s → %s', OLD.status, NEW.status)
    );
  END IF;

  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_order_event_created ON public.orders;
CREATE TRIGGER trg_order_event_created
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.log_order_event();

DROP TRIGGER IF EXISTS trg_order_event_status ON public.orders;
CREATE TRIGGER trg_order_event_status
  AFTER UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.log_order_event();

-- ─── 4. 历史订单回填（一次性，可重复执行：已有 created 事件的单不重复补） ──
INSERT INTO public.order_events (order_id, user_id, event_type, message, created_at)
SELECT
  o.id,
  o.user_id,
  'created',
  format('订单入库（历史回填）：%s ｜ %s ｜ %s %s',
    COALESCE(NULLIF(o.channel, ''), '未知渠道'),
    COALESCE(NULLIF(o.shop_name, ''), '无店铺'),
    COALESCE(o.amount::text, '0'),
    COALESCE(o.currency, '')
  ),
  o.created_at
FROM public.orders o
WHERE NOT EXISTS (
  SELECT 1 FROM public.order_events e WHERE e.order_id = o.id AND e.event_type = 'created'
);
