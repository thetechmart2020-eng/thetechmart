-- Migration 008: referrals. Run once in Supabase (SQL Editor > New query). Safe to re-run.
-- A referrer is anyone who signed up at /refer. Orders and offers carry the code of whoever sent the lead.
create table if not exists referrers (
  code text primary key,
  name text not null,
  phone text not null,
  created_at timestamptz default now()
);
alter table referrers enable row level security;

alter table offers add column if not exists referrer_code text default '';
alter table orders add column if not exists referrer_code text default '';
alter table orders add column if not exists referral_status text default '';          -- '' | 'confirmed' | 'paid'
alter table orders add column if not exists referral_confirmed_at timestamptz;
alter table orders add column if not exists referral_paid_at timestamptz;
create index if not exists orders_referrer_idx on orders (referrer_code);
