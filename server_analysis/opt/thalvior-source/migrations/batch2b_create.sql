create extension if not exists pgcrypto;

create table if not exists order_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value text,
  description text,
  status text not null default '启用',
  created_at timestamptz not null default now()
);

create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  po_no text,
  supplier_id uuid references suppliers(id) on delete set null,
  sku text,
  name text,
  qty integer not null default 0,
  price numeric not null default 0,
  amount numeric not null default 0,
  status text not null default '待审核',
  expect_date text,
  created_at timestamptz not null default now()
);

create table if not exists purchase_returns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  return_no text,
  po_no text,
  supplier_id uuid references suppliers(id) on delete set null,
  sku text,
  qty integer not null default 0,
  reason text,
  status text not null default '待处理',
  created_at timestamptz not null default now()
);

create table if not exists shipping_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id text,
  sku text,
  qty integer not null default 0,
  warehouse text,
  carrier text,
  status text not null default '待拣货',
  picked_at timestamptz,
  packed_at timestamptz,
  shipped_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists waybills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  waybill_no text,
  shipment_id uuid references shipments(id) on delete set null,
  carrier text,
  tracking_no text,
  weight numeric not null default 0,
  fee numeric not null default 0,
  status text not null default '已生成',
  created_at timestamptz not null default now()
);

create table if not exists parcels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  parcel_no text,
  waybill_no text,
  order_id text,
  weight numeric not null default 0,
  length integer not null default 0,
  width integer not null default 0,
  height integer not null default 0,
  status text not null default '待打包',
  created_at timestamptz not null default now()
);
