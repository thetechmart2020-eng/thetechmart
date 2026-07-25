-- Run this once in your Supabase project's SQL Editor (Database > SQL Editor > New query).
-- It creates the four tables the app needs and seeds one config row.

create extension if not exists pgcrypto;

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  model text not null,
  category text default 'Phones', -- 'Phones' | 'Accessories' | 'Tablets' | 'Audio' | 'Other'
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

-- Orders: created automatically when an offer or trade-in is accepted, then tracked
-- through to completion. 'sale' = a device going out to a customer; 'purchase' = a
-- device coming in from a customer (via trade-in or straight sell-to-store).
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  type text not null, -- 'sale' | 'purchase'
  source text not null, -- 'offer' | 'tradein' | 'manual'
  source_id uuid,
  product_id uuid references products(id) on delete set null,
  customer_name text not null,
  customer_phone text not null,
  amount numeric not null default 0,
  status text default 'new', -- new -> paid -> completed (or cancelled)
  notes text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Lightweight first-party analytics — no third-party script/cookie needed.
create table if not exists events (
  id bigint generated always as identity primary key,
  type text not null, -- 'page_view' | 'product_view' | 'offer_submitted' | 'tradein_submitted'
  path text,
  product_id uuid references products(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists events_type_created_idx on events (type, created_at);
create index if not exists events_product_idx on events (product_id);

-- Row Level Security: the app only ever talks to Supabase using the SERVICE ROLE
-- key from the server, which bypasses RLS entirely — so RLS is enabled here purely
-- as a safety net in case the anon/public key is ever used against these tables
-- (e.g. from a browser). No policies are added, which means the anon key can't
-- read or write anything.
alter table products enable row level security;
alter table offers enable row level security;
alter table tradeins enable row level security;
alter table config enable row level security;
alter table orders enable row level security;
alter table events enable row level security;
