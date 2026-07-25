-- Run this in your EXISTING Supabase project's SQL Editor (the one already live).
-- Safe to run once — adds the two new tables (orders, events) needed for the
-- order-tracking and analytics features, without touching anything you already have.

create extension if not exists pgcrypto;

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

create table if not exists events (
  id bigint generated always as identity primary key,
  type text not null, -- 'page_view' | 'product_view' | 'offer_submitted' | 'tradein_submitted'
  path text,
  product_id uuid references products(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists events_type_created_idx on events (type, created_at);
create index if not exists events_product_idx on events (product_id);

alter table orders enable row level security;
alter table events enable row level security;
