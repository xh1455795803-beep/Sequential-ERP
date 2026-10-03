-- FBA 费率表 RLS：多租户隔离
ALTER TABLE public.fba_fee_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_fba_fee_tiers ON public.fba_fee_tiers FOR SELECT USING (user_id = auth.uid());
CREATE POLICY users_insert_fba_fee_tiers ON public.fba_fee_tiers FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY users_update_fba_fee_tiers ON public.fba_fee_tiers FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY users_delete_fba_fee_tiers ON public.fba_fee_tiers FOR DELETE USING (user_id = auth.uid());