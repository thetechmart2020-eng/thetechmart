# TheTechMart redesign: notes for maintainers

## Deploy
1. On GitHub, upload the contents of this folder over the repo (same file paths replace the old ones).
2. Delete these stray files from the repo root: `index.html`, `product.html`, `dashboard.html` (unused leftovers).
3. Vercel redeploys automatically. `vercel.json` now sets `"regions": ["sin1"]` (next to the Singapore database). If Vercel rejects it, delete that one line.
4. Optional but recommended: run `supabase/migration_007_ensure_category.sql` in the Supabase SQL Editor (adds the missing `products.category` column). The site works without it.

## Where things live
- `views/*.html` page templates, `views/partials/` header and footer, `public/css/site.css` styles (tokens at the top), `public/js/site.js` shared script.
- `lib/deals.js` the October deals list (edit, commit, redeploy). Matched against live stock; hides itself if nothing matches.
- Pages are rendered by `server.js` with the data embedded (`window.__BOOT__`) and cached at the Vercel edge (30s), so pages draw without waiting on the API.
- Admin pages and `public/css/style.css`, `public/js/common.js` are unchanged.

## Placeholders still to fill (marked yellow on the site)
Return policy, trading hours, Courier Guy delivery fee. Search for `PLACEHOLDER` in `views/`.

## Facts shown on the site
Grade A-B (Like new / Good), New shown as New, Fair/damaged show their real condition; 3-month warranty, 21-day on special offers; 2-day Courier Guy delivery; R300 per sales referral; payments: Card (Yoco), EFT, Cash on collection; online / WhatsApp only.
