# TheTechMart

thetechmart.co.za: a South African pre-owned electronics shop. Online and WhatsApp only. Buy now, make an offer, sell or trade in, earn R300 per sales referral.

Stack: Node/Express 5 on Vercel (serverless), Supabase Postgres + Storage, pdfkit for quotes/invoices. Repo: github.com/thetechmart2020-eng/thetechmart.

## What the site does
- Home (`/`): hero, October deals, shop with search/filters, reviews, how it works, sell/trade-in, referral, FAQ.
- Product (`/product?id=...`): photos (up to 5), condition, warranty, Buy now, Make an offer.
- Checkout (`/checkout?id=...`): delivery or collection, details, payment, confirm.
- Sell / trade-in (`/sell`), Policies (`/policies`), `/sitemap.xml`, `/robots.txt`, `/price-list.pdf`.
- Admin (`/admin`): stock (CSV upload, photos, bulk photos), offers, trade-ins, orders, quotes and invoices (PDF), analytics, settings.

## Business rules on the site
- Condition: Grade A-B (Like new / Good). New shown as New.
- Warranty: 3-month repair or replacement (standard-price devices). 21-day replacement warranty for negotiated devices (`lib/deals.js` flags them).
- Delivery: The Courier Guy, flat R100, about 2 days. Collection R0 (arranged on WhatsApp).
- Payment: Card (Yoco), EFT, Cash on collection only.
- Referral: R300 per sales referral.
- Contact: WhatsApp 071 662 3565, thetechmart2020@gmail.com, Instagram @the_tech_mart, Facebook /TheTechMart.

## Where things live
- `views/*.html` page templates; `views/partials/` header, footer, `policy.html`.
- `public/css/site.css` styles (tokens at top); `public/js/site.js` shared script (`window.TTM`).
- `server.js` routes, rendering, checkout, admin API. `db.js` data layer. `lib/` documents, deals, payments, storage, auth.
- Pages are server-rendered with data embedded (`window.__BOOT__`) and edge-cached (about 30 s).
- `data/reviews.json` reviews section. `supabase/` schema and migrations 002 to 007.

## Environment variables (Vercel > Project Settings)
Required: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SESSION_SECRET`.
Payments: `YOCO_SECRET_KEY` (switch on in Admin > Settings > Payment gateways). Optional, not live: `PAYJUSTNOW_API_KEY`, `PAYJUSTNOW_MERCHANT_ID`, `HAPPYPAY_MERCHANT_KEY`.
Optional: `PUBLIC_BASE_URL`.

## Everyday tasks
**Change policy wording** (trading hours, returns, delivery): edit `views/partials/policy.html` only. Footer and /policies both use it.

**Change the delivery fee:** `DELIVERY_FEE` at the top of `server.js`. The server computes the total used by the order, the WhatsApp/email message and the Yoco amount.

**Product photos:** Admin > Stock > Photos on a device. Up to 5; first is main; "Make main" changes it. Photos are resized in the browser (1200 px WebP, plus a 480 px card copy). Bulk: name files like `apple-iphone-13-128gb-blue.jpg`; extra photos add `-2` to `-5`. Devices with no photo show "Photo coming soon".

**Deals list:** edit `lib/deals.js`, commit, redeploy.

**Reviews:** the slideshow is an Elfsight widget (id in `data/reviews.json` as `elfsightId`). Edit reviews in the Elfsight dashboard. `facebookUrl` adds the button and footer link; `googleUrl` adds a Google button once your Business Profile is verified. The `reviews` list in the same file shows extra manual cards below the widget. See `data/HOW-TO-ADD-REVIEWS.md`. Elfsight loads its own script, lazily, only on the home page.

## Deploy and roll back
1. Upload changed files to GitHub at the same paths (the repo is not pushable from the assistant sandbox).
2. Vercel redeploys on its own.
3. Roll back: Vercel > Deployments > pick the previous deployment > Promote to Production.

## One-time setup (already done on the live site)
Supabase: run `supabase/schema.sql`, then migrations 002 to 007 as needed. Storage buckets (public): `product-images`, `tradein-photos`, `documents`. Note: the live database still lacks `products.category`; run `migration_007_ensure_category.sql` when ready (the site works without it).

## Local run
Node 18+. `cp .env.example .env`, fill the three required variables, `npm install`, `npm start`, open http://localhost:3000.

## Open items and cautions
- Admin password: the seed default is `admin123`. Change it under Admin > Settings.
- Delete stray files from the repo root: `index.html`, `product.html`, `dashboard.html`.
- 82 of 117 products have no photo yet.
- Google Business Profile: not yet verified. Facebook page: facebook.com/TheTechMart.
- Not built yet: Yoco webhook payment confirmation, order/offer alerts, admin password hashing and rate limiting, POPIA privacy page, order tracking page.
- Quote/invoice numbers come from the record ID, not a strict sequence. Check SARS rules if you are VAT registered.
