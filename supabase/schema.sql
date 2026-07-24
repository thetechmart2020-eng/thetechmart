-- Run this once in your Supabase project's SQL Editor (Database > SQL Editor > New query).
-- It creates the four tables the app needs and seeds one config row.

create extension if not exists pgcrypto;

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  model text not null,
  price numeric not null,
  condition text default 'New',
  storage text default '',
  color text default '',
  stock integer default 1,
  image_url text,
  active boolean default true,
  created_at timestamptz default now()
);

create table if not exists offers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id) on delete set null,
  product_name text,
  list_price numeric,
  amount numeric not null,
  name text not null,
  phone text not null,
  message text default '',
  status text default 'pending',
  created_at timestamptz default now()
);

create table if not exists tradeins (
  id uuid primary key default gen_random_uuid(),
  type text default 'sell',
  brand text not null,
  model text not null,
  storage text default '',
  condition text default '',
  asking_price numeric,
  name text not null,
  phone text not null,
  notes text default '',
  photos text[] default '{}',
  status text default 'pending',
  created_at timestamptz default now()
);

create table if not exists config (
  id integer primary key default 1,
  store_name text default 'TheTechMart',
  whatsapp_number text default '27716623565',
  admin_password text default 'admin123'
);

insert into config (id, store_name, whatsapp_number, admin_password)
values (1, 'TheTechMart', '27716623565', 'admin123')
on conflict (id) do nothing;

-- Row Level Security: the app only ever talks to Supabase using the SERVICE ROLE
-- key from the server, which bypasses RLS entirely — so RLS is enabled here purely
-- as a safety net in case the anon/public key is ever used against these tables
-- (e.g. from a browser). No policies are added, which means the anon key can't
-- read or write anything.
alter table products enable row level security;
alter table offers enable row level security;
alter table tradeins enable row level security;
alter table config enable row level security;
