-- Migration 004: checkout, delivery & payment-gateway readiness.
-- Run this once in Supabase SQL Editor (Database > SQL Editor > New query) on the
-- already-live database. Safe to re-run (uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

-- Orders gain everything a real checkout + Courier Guy handover needs, plus
-- payment-gateway bookkeeping so Yoco / PayJustNow / Happy Pay can be switched on
-- later without another schema change.
alter table orders add column if not exists customer_email text default '';
alter table orders add column if not exists delivery_address jsonb default '{}'::jsonb;
alter table orders add column if not exists fulfillment_method text default 'delivery'; -- 'delivery' | 'collection'
alter table orders add column if not exists courier text default 'Courier Guy';
alter table orders add column if not exists tracking_number text default '';
alter table orders add column if not exists payment_method text default 'manual'; -- 'yoco' | 'payjustnow' | 'happypay' | 'manual'
alter table orders add column if not exists payment_status text default 'pending'; -- 'pending' | 'paid' | 'failed' | 'not_required'
alter table orders add column if not exists payment_ref text default '';
alter table orders add column if not exists checkout_channel text default 'whatsapp'; -- 'whatsapp' | 'email'

create index if not exists orders_payment_status_idx on orders (payment_status);

-- Config gains a JSON blob describing which payment gateways are switched on,
-- so the checkout page can show live gateways vs "coming soon" without a
-- redeploy — the admin flips these on from Settings once real API keys are in.
alter table config add column if not exists payment_settings jsonb default '{
  "yoco": {"enabled": false},
  "payjustnow": {"enabled": false},
  "happypay": {"enabled": false}
}'::jsonb;

alter table config add column if not exists contact_email text default 'thetechmart2020@gmail.com';
