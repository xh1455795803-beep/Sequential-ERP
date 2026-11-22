-- 竞品监控表 RLS：多租户隔离
ALTER TABLE public.competitor_tracks ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_competitor_tracks ON public.competitor_tracks FOR SELECT USING (user_id = auth.uid());
CREATE POLICY users_insert_competitor_tracks ON public.competitor_tracks FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY users_update_competitor_tracks ON public.competitor_tracks FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY users_delete_competitor_tracks ON public.competitor_tracks FOR DELETE USING (user_id = auth.uid());