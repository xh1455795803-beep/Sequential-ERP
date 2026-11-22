-- 站内通知表：多租户隔离，user_id 关联 auth.uid()
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT '系统',
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_own_notifications ON public.notifications
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY users_insert_own_notifications ON public.notifications
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY users_update_own_notifications ON public.notifications
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY users_delete_own_notifications ON public.notifications
  FOR DELETE USING (user_id = auth.uid());