-- Migration 005: multi-photo galleries + a proper "Sold" state.
-- Run once in Supabase SQL Editor. Safe to re-run.

-- Products can now hold a full photo gallery, not just one cover image.
alter table products add column if not exists images text[] default '{}';

-- Note on "Sold": this migration doesn't need a new column for it — it's a
-- behavior change (stock = 0 now shows a "Sold" badge instead of the listing
-- disappearing), driven entirely by the existing `stock` column. `active`
-- stays reserved for the admin's own manual show/hide toggle.
--
-- One thing worth doing by hand if you want it: any product that got hidden
-- automatically by the OLD behavior (stock hit 0 → active was set to false)
-- can be brought back as a visible "Sold" listing by re-checking it under
-- Admin → Stock → Unhide. New sales won't auto-hide going forward.
