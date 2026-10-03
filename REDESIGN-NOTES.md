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

## Policy text
Trading hours, returns/warranty and delivery/payment wording lives in ONE file: `views/partials/policy.html` (used by the footer and the /policies page). Edit it there.

## Delivery fee
Flat R100 is set once: `DELIVERY_FEE` at the top of `server.js`. Collection is R0. The server works out the total and uses it for the saved order, the WhatsApp/email message and the Yoco amount.

## Product photos (for the shop owner)
Admin > Stock > the "Photos" button on a device > choose photos > Add photo(s). Up to 5 per device, the first is the main photo, "Make main" changes it. Photos are resized and compressed in your browser (max 1200px, about 200 KB, WebP) and a small 480px copy is made for the shop cards. Bulk: Admin > bulk photo upload, name files like `apple-iphone-13-128gb-blue.jpg`. Devices without a photo show "Photo coming soon".

## Facts shown on the site
Grade A-B (Like new / Good), New shown as New, Fair/damaged show their real condition; 3-month repair or replacement warranty (standard-price devices), 21-day replacement warranty (negotiated devices); Courier Guy delivery flat R100, about 2 days; R300 per sales referral; payments: Card (Yoco), EFT, Cash on collection; online / WhatsApp only.

## Update log (October 2026)
- Checkout summary: the "Photo coming soon" placeholder no longer spreads over the Delivery row (`.summary .thumb` is now positioned). File: `public/css/site.css`.
- Hero link "Rated by real customers" jumps to the reviews (hidden automatically if no reviews are set up). Reviews sit right under the trust strip.
- Reviews section on the home page: Elfsight Facebook widget, optional manual cards (WhatsApp screenshots, Google later), Facebook button and footer link. Files: `server.js`, `views/index.html`, `views/partials/footer.html`, `public/css/site.css`, `data/reviews.json`, `data/HOW-TO-ADD-REVIEWS.md`. The section is empty-safe: it hides if there is no widget id and no manual reviews.
- Rollback for any of these: promote the previous Vercel deployment.
