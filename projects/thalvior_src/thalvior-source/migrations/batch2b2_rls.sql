alter table warehouses enable row level security;
alter table locations enable row level security;
alter table stock_adjustments enable row level security;
alter table stock_takes enable row level security;
alter table stock_logs enable row level security;
alter table stock_alerts enable row level security;
alter table stock_strategies enable row level security;
alter table listing_templates enable row level security;
alter table listing_mappings enable row level security;
alter table listing_logs enable row level security;

do $$
declare t text;
begin
  foreach t in array array['warehouses','locations','stock_adjustments','stock_takes','stock_logs','stock_alerts','stock_strategies','listing_templates','listing_mappings','listing_logs'] loop
    execute format('drop policy if exists %I on %I', t || '_owner', t);
    execute format('create policy %I on %I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_owner', t);
  end loop;
end $$;
