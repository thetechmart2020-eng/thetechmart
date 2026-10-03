-- Migration 009: sliding referral payout. Run once in Supabase (SQL Editor > New query). Safe to re-run.
-- referral_profit = gross profit left on the sale (entered by admin at confirmation); referral_payout = rand owed.
alter table orders add column if not exists referral_profit numeric;
alter table orders add column if not exists referral_payout numeric;
-- referral_status can now also be 'nopayout' (confirmed, but profit under R500 so nothing is paid).
