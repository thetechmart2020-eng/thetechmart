-- Run once in the Supabase SQL Editor (safe to run more than once).
-- The live database never received migration_003, so the products table has no
-- "category" column. The site works without it (it guesses the category from the
-- brand and model), but adding the column lets the admin panel and CSV imports
-- store a category properly.
alter table products add column if not exists category text default 'Phones';

-- Fill in sensible categories for existing rows (only rows still on the default).
update products set category = 'Accessories'
  where category = 'Phones' and (lower(brand) = 'generic' or lower(model) ~ 'charger|cable|case\y|cover|dock|controller|hdmi|earphone|adapter|screen protector');
update products set category = 'Audio'
  where category = 'Phones' and lower(model) ~ 'airpods|earbuds|buds|headphone|speaker|soundbar|\yjbl\y|beats';
update products set category = 'Tablets'
  where category = 'Phones' and lower(model) ~ 'ipad|galaxy tab|matepad';
update products set category = 'Laptops'
  where category = 'Phones' and (lower(model) ~ 'macbook|thinkpad|ideapad|inspiron|latitude|elitebook|pavilion|probook|vivobook|zenbook|legion|chromebook|laptop|notebook|\yxps\y'
    or lower(brand) in ('hp','dell','lenovo','acer','msi'));
update products set category = 'Consoles'
  where category = 'Phones' and (lower(brand) = 'nintendo' or lower(model) ~ 'playstation|\yps[2-5]\y|xbox|steam deck');
