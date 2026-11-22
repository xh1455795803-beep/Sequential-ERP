-- 关税税率表 RLS：多租户隔离
ALTER TABLE public.country_tax_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_country_tax_rates ON public.country_tax_rates FOR SELECT USING (user_id = auth.uid());
CREATE POLICY users_insert_country_tax_rates ON public.country_tax_rates FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY users_update_country_tax_rates ON public.country_tax_rates FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY users_delete_country_tax_rates ON public.country_tax_rates FOR DELETE USING (user_id = auth.uid());