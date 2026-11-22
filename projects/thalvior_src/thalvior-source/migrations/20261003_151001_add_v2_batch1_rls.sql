-- V2 批次1：新表 RLS 多租户隔离策略（user_id = auth.uid()）
-- 每张新表开启 RLS 并加 owner 策略，确保 insertRow/select/update/delete 仅作用于当前租户数据

alter table public.exceptions enable row level security;
drop policy if exists "exceptions owner" on public.exceptions;
create policy "exceptions owner" on public.exceptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.automation_rules enable row level security;
drop policy if exists "automation_rules owner" on public.automation_rules;
create policy "automation_rules owner" on public.automation_rules
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.automation_runs enable row level security;
drop policy if exists "automation_runs owner" on public.automation_runs;
create policy "automation_runs owner" on public.automation_runs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.automation_failures enable row level security;
drop policy if exists "automation_failures owner" on public.automation_failures;
create policy "automation_failures owner" on public.automation_failures
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.api_keys enable row level security;
drop policy if exists "api_keys owner" on public.api_keys;
create policy "api_keys owner" on public.api_keys
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.oauth_apps enable row level security;
drop policy if exists "oauth_apps owner" on public.oauth_apps;
create policy "oauth_apps owner" on public.oauth_apps
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.webhooks enable row level security;
drop policy if exists "webhooks owner" on public.webhooks;
create policy "webhooks owner" on public.webhooks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.api_logs enable row level security;
drop policy if exists "api_logs owner" on public.api_logs;
create policy "api_logs owner" on public.api_logs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
