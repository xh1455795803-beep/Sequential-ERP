-- 商品刊登任务表：记录商品一键刊登到多平台的任务
CREATE TABLE IF NOT EXISTS public.listing_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  product TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  target_platforms TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '待刊登',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.listing_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_own_listing_tasks ON public.listing_tasks
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY users_insert_own_listing_tasks ON public.listing_tasks
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY users_update_own_listing_tasks ON public.listing_tasks
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY users_delete_own_listing_tasks ON public.listing_tasks
  FOR DELETE USING (user_id = auth.uid());