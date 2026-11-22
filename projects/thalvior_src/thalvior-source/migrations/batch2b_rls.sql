alter table order_settings enable row level security;
alter table purchase_orders enable row level security;
alter table purchase_returns enable row level security;
alter table shipping_tasks enable row level security;
alter table waybills enable row level security;
alter table parcels enable row level security;

drop policy if exists order_settings_owner on order_settings;
create policy order_settings_owner on order_settings for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists purchase_orders_owner on purchase_orders;
create policy purchase_orders_owner on purchase_orders for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists purchase_returns_owner on purchase_returns;
create policy purchase_returns_owner on purchase_returns for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists shipping_tasks_owner on shipping_tasks;
create policy shipping_tasks_owner on shipping_tasks for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists waybills_owner on waybills;
create policy waybills_owner on waybills for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists parcels_owner on parcels;
create policy parcels_owner on parcels for all using (user_id = auth.uid()) with check (user_id = auth.uid());
