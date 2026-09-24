-- Migration 006: quotes (at sale inquiry) and invoices (after payment).
-- Run once in Supabase SQL Editor. Safe to re-run.

alter table offers add column if not exists email text default '';
alter table offers add column if not exists quote_number text default '';
alter table offers add column if not exists quote_url text default '';

alter table orders add column if not exists quote_number text default '';
alter table orders add column if not exists quote_url text default '';
alter table orders add column if not exists invoice_number text default '';
alter table orders add column if not exists invoice_url text default '';

-- Generated PDFs are stored the same way product/trade-in photos already are —
-- create one more public Storage bucket for them:
--   Supabase → Storage → New bucket → name it "documents" → Public bucket: on
