-- Run this in your EXISTING Supabase project's SQL Editor.
-- Adds a "category" column so accessories, tablets, etc. don't have to pretend
-- to be phones (no forced "storage" field, cleaner filtering on the storefront).
-- Existing rows are set to 'Phones' automatically, so nothing you already have changes.

alter table products add column if not exists category text default 'Phones';
update products set category = 'Phones' where category is null;
