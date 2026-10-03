-- V2 批次2A：商品域新表 RLS 多租户隔离策略（user_id = auth.uid()）
alter table public.categories enable row level security;
drop policy if exists "categories owner" on public.categories;
create policy "categories owner" on public.categories
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.brands enable row level security;
drop policy if exists "brands owner" on public.brands;
create policy "brands owner" on public.brands
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.collect_rules enable row level security;
drop policy if exists "collect_rules owner" on public.collect_rules;
create policy "collect_rules owner" on public.collect_rules
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
