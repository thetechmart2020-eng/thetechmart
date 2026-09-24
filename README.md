# TheTechMart

A phone marketplace with negotiable pricing, WhatsApp-based offer negotiation, and a sell/trade-in
intake flow. Dark, sleek, minimal UI.

## What's included

- **Storefront** (`/`) — browse stock, search/filter by brand/condition/price, dark "trading floor" theme.
- **Product page** (`/product?id=...`) — full specs, "Make an offer" flow.
- **Offers & negotiation** — a customer's offer is saved to the store, and opens a pre-filled WhatsApp
  message to your business number so it lands in your chat instantly. You reply to accept, reject, or
  counter directly on WhatsApp; the admin panel also lets you mark it accepted/rejected for your own records.
- **Sell / trade-in page** (`/sell`) — customers submit a device (with photos) either to sell for cash or
  trade toward another device. Same WhatsApp handoff as offers.
- **Admin panel** (`/admin`) — password-protected. Upload your price list as a CSV to populate stock,
  attach a photo per device, review and accept/reject offers and trade-ins, tweak settings.

## Branding

The site now uses your actual logo (`public/img/logo.png`, with a matching favicon) and your brand green as
the accent color throughout. Default WhatsApp number is set to `27716623565` (071 662 3565 in international
format) — change it under Admin → Settings if it's ever wrong.

Footer links point to:
- WhatsApp: `wa.me/27716623565`
- Email: `thetechmart2020@gmail.com`
- Instagram: `instagram.com/the_tech_mart`
- Facebook: `facebook.com/TheTechMart`
- X: `x.com/The_Tech_Mart`

I guessed at the exact Facebook/X/Instagram page URLs from the handles you gave me — double-check these
resolve to your real pages and adjust the `href`s in the footer of `views/index.html`, `views/product.html`,
and `views/sell.html` if any are off.

## What's new: categories (Samsung, accessories, and beyond)

**If your site is already live**, run one more migration first — Supabase → SQL Editor → New query:

```sql
alter table products add column if not exists category text default 'Phones';
update products set category = 'Phones' where category is null;
```

(Fresh installs don't need this — `schema.sql` already includes it.)

Products now have a `category` field (Phones, Accessories, Tablets, Audio, or anything else you want) —
so a phone case or charger doesn't have to awkwardly pretend to have "storage." The storefront now has a
category filter dropdown alongside brand and condition. A sample CSV with Samsung phones, tablets, earbuds,
and accessories is included: `sample-price-list-v2.csv`.

CSV columns are now: `brand,model,price,category,condition,storage,color,stock,imageUrl` — category is
optional and defaults to "Phones" if you leave it blank, so your existing CSVs still work unchanged.

## What's new: photo galleries, bulk photo upload, and a "Sold" state

**If your site is already live**, run one more migration — Supabase → SQL Editor → New query, paste in
the contents of `supabase/migration_005_gallery_and_sold.sql`, and run it. (Fresh installs: already in
`schema.sql`.)

- **Multiple photos per device** — the product page now shows a full gallery with clickable thumbnails,
  not just one cover shot. The single "Photo" button in Admin → Stock is now a small gallery manager: add
  as many photos as you like per device, remove any of them, and the first one you add becomes the cover
  shown on the storefront grid.
- **Bulk photo upload, matched by filename** — this is the real fix for "117 SKUs, one photo click each."
  Under Admin → Stock, drop in a folder of photos named like `apple-iphone-13-128gb-blue.jpg` and it
  matches and adds each one to the right device automatically (capitalization, spacing, dashes vs.
  underscores all get normalized, so you don't have to be exact). If the brand+model alone is unique, a
  shorter filename like `samsung-s22-ultra.jpg` works too. Anything that can't be matched is listed so you
  know what still needs a rename.
- **"Sold" instead of vanishing** — selling out a device (stock hits 0 via an accepted offer or a Buy Now
  checkout) now shows a **SOLD** badge on the listing instead of removing it from the shop entirely.
  Recently-sold devices are good social proof, and the buttons (Buy now/Make an offer) are disabled on a
  sold listing rather than the card disappearing. Admin's manual Hide/Unhide toggle is unaffected — that's
  still your own separate switch for taking something off the shop for any other reason.

## What's new: quotes & invoices

**If your site is already live**, run one more migration — Supabase → SQL Editor → New query, paste in
the contents of `supabase/migration_006_quotes_invoices.sql`, and run it. Then create one more Storage
bucket the same way you made `product-images` and `tradein-photos`: **Storage → New bucket → name it
`documents` → Public bucket: on**. (Fresh installs: `schema.sql` already includes the columns — just
remember to create the `documents` bucket during setup.)

- **Quote, at sale inquiry** — Admin → Offers now has a **Send quote** button on every offer (pending or
  accepted), and Admin → Orders has one for every checkout order. It generates a branded PDF (your logo,
  the device, the price, a 7-day validity note) and saves it — then gives you one-click **WhatsApp** and
  **Email** buttons addressed straight to that customer, plus a **View** link to the PDF itself.
- **Invoice, after payment** — Admin → Orders also has a **Send invoice** button, generating a PDF with
  the payment status, method, and delivery details, same one-click send.
- **No new account or API key needed** — the PDFs are generated on your own server (via `pdfkit`, a plain
  code library) and stored in your own Supabase Storage, so there's nothing extra to sign up for or pay
  for. "Sending" means opening WhatsApp or your email app pre-filled with a link to the PDF — the same
  pattern as offers and checkout already use, just with a document attached instead of a text summary.
- Every quote/invoice is saved on its offer/order record, so you (or the customer, if you forward the
  link) can always pull it back up later — nothing is generated and thrown away.
- The offer form now has an optional email field, so a customer inquiring about a device can be sent a
  quote by email too, not just WhatsApp.
- **Worth knowing**: quote/invoice numbers here (`Q-XXXXXXXX` / `INV-XXXXXXXX`) are derived from the
  order/offer ID for simplicity, not a strict sequential series. If you're VAT-registered, check with your
  accountant on SARS's numbering and content requirements for a valid tax invoice before relying on these
  for tax purposes — this covers the customer-facing quote/invoice, not necessarily every legal requirement.

## What's new: checkout, delivery & payment-gateway readiness

**If your site is already live**, run one more migration first — Supabase → SQL Editor → New query, paste
in the contents of `supabase/migration_004_checkout_payments.sql`, and run it. (Fresh installs don't need
this — `schema.sql` already includes everything.)

- **Buy Now / checkout** (`/checkout?id=...`) — a conversational, WhatsApp-style step-by-step flow: pick
  delivery or in-store collection, enter name/email/phone (+ full address for delivery), choose a payment
  method, then confirm — same as making an offer, just for an outright purchase. Every product card and the
  product page now has a **Buy now** button next to **Make an offer**.
- **Courier Guy delivery** — checkout collects everything Courier Guy needs (address, email, phone) and
  saves it on the order. Admin → Orders shows the full delivery address per order and lets you attach a
  tracking/waybill number once you've booked the courier.
- **Payment gateways, wired but not switched on** — the checkout page already shows Yoco, PayJustNow and
  Happy Pay as options. Each is a small adapter in `lib/payments/` (`yoco.js`, `payjustnow.js`,
  `happypay.js`) that's ready to call the real API the moment you have credentials:
  1. Add that gateway's API key(s) as environment variables in Vercel (see the comment at the top of each
     adapter file for the exact variable names it looks for, e.g. `YOCO_SECRET_KEY`).
  2. Flip it on in **Admin → Settings → Payment gateways**.
  3. It now appears as a real, selectable option at checkout instead of "Coming soon" — customers are sent
     to that gateway's hosted checkout page and redirected back to an order-status page when done.

  Until a gateway is live (or a customer picks "EFT / Cash / Arrange with us"), checkout works exactly like
  offers and trade-ins already do: it saves the order and hands the customer to **WhatsApp or email**
  (their choice) to confirm and arrange payment — nothing breaks or dead-ends if no gateway is switched on
  yet.
- **Web → WhatsApp or web → email, everywhere** — offers, trade-in/sell submissions, and checkout all now
  offer two buttons: "…via WhatsApp" and "…via Email" (to `thetechmart2020@gmail.com`, editable under
  Admin → Settings → Contact email). Email uses a plain `mailto:` link pre-filled with the same details as
  the WhatsApp message — no email-sending service or SMTP setup required, so there's nothing extra to break
  or pay for.
- **Landing page redesign** — new hero with a live-glow accent, a trust row, a shop-by-category strip
  (Phones/Laptops/Consoles/Tablets/Audio/Accessories), a "how it works" section that mirrors the real
  WhatsApp-style flow (find → negotiate & confirm → delivered), a bottom call-to-action banner for
  sell/trade-in, and a sticky mobile "Browse devices" bar. Product cards on the homepage now have inline
  **Buy now** / **Make an offer** buttons instead of only linking through.

## What's new: search/SEO, analytics, order tracking

**If your site is already live**, run one more migration before these work — open Supabase → SQL Editor →
New query, paste in the contents of `supabase/migration_002_orders_analytics.sql`, and run it. (Fresh
installs don't need this — `schema.sql` already includes everything.)

- **SEO**: product pages now render a real `<title>`, description, and Open Graph image server-side, so a
  link shared on WhatsApp/Facebook shows the actual device and price instead of generic text. There's also
  a `/sitemap.xml` (auto-generated from your live stock) and `/robots.txt` for search engines.
- **Analytics**: Admin → Analytics shows page views, product views, offers submitted, and trade-in
  submissions over the last 30 days, plus your most-viewed devices — no third-party account or cookie
  banner needed, since it's just a table in your own Supabase project.
- **Orders**: accepting an offer now automatically creates a "sale" order and takes one unit off that
  product's stock (hiding it once it hits zero). Accepting a trade-in creates a "purchase" order. Admin →
  Orders lets you move each through New → Paid → Completed (or Cancelled) as it happens for real.

## Stack

- **App**: Node + Express (same code runs locally and on Vercel)
- **Database**: Supabase (Postgres) — products, offers, trade-ins, settings
- **File storage**: Supabase Storage — product photos and trade-in photos
- **Hosting**: Vercel (serverless)
- **Editing in the browser**: StackBlitz, if you want to tweak things without installing anything locally

## One-time setup: Supabase

1. Create a project at [supabase.com](https://supabase.com) (free tier is enough to start).
2. Open **SQL Editor → New query**, paste in the contents of `supabase/schema.sql` from this project, and run it.
   This creates the `products`, `offers`, `tradeins`, and `config` tables and seeds one settings row.
3. Open **Storage** and create two buckets, both set to **public**:
   - `product-images`
   - `tradein-photos`
4. Open **Project Settings → API** and copy two values: the **Project URL** and the **service_role key**
   (not the `anon` key — the service role key is what lets the server read/write freely; it must never be
   exposed to the browser, which is why it only ever lives in server environment variables).

## Running it locally

Requires [Node.js](https://nodejs.org) 18+.

```bash
cp .env.example .env
# then edit .env and fill in SUPABASE_URL, SUPABASE_SERVICE_KEY, and a random SESSION_SECRET
npm install
npm start
```

Then open `http://localhost:3000`. Admin panel is at `http://localhost:3000/admin` — default password is
`admin123`, taken from the `config` row you seeded via `schema.sql`. **Change it immediately** under
Admin → Settings, along with your real WhatsApp number if it's ever wrong.

## Deploying to Vercel

1. Push this project to a GitHub repo (or use `vercel` CLI directly from the folder — `npm i -g vercel`, then `vercel`).
2. In the [Vercel dashboard](https://vercel.com/new), import the repo. Framework preset: "Other" — no build
   step is needed, Vercel will detect `api/index.js` automatically.
3. Under **Project Settings → Environment Variables**, add the same three variables from `.env`:
   `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SESSION_SECRET`.
4. Deploy. Vercel gives you a `*.vercel.app` URL immediately; add a custom domain under
   **Project Settings → Domains** whenever you're ready.

Every subsequent `git push` redeploys automatically.

## Editing in StackBlitz

Push the repo to GitHub, then open `https://stackblitz.com/github/YOUR-USERNAME/YOUR-REPO` to get a full
in-browser dev environment — handy for quick edits (copy, prices, colors) without installing Node locally.
Add the same three environment variables under StackBlitz's project settings (or a `.env` file in the
StackBlitz workspace) so it can reach your Supabase project.

## Sourcing product images (Icecat)

`scripts/enrich-images.js` looks up each row of a price-list CSV against Icecat's Open Catalog and
fills in the `imageUrl` column automatically, instead of you finding/uploading a photo per SKU.

**This is a one-off local tool, not part of the live site** — you run it on your computer against a CSV
before uploading via Admin → Stock, same as any other CSV.

Setup:
1. Register for a free account at icecat.biz (their "Open Icecat" / data-recipient signup).
2. `npm install` (if you haven't already)
3. Test on a handful of rows first — don't run the whole catalogue blind:
   ```bash
   ICECAT_USERNAME=you ICECAT_PASSWORD=yourpassword node scripts/enrich-images.js thetechmart-full-pricelist.csv --test 5
   ```
4. Check the console output and `scripts/icecat-raw-sample.json` it creates — this shows exactly what
   Icecat returned for a few products. Icecat matches on exact product codes/barcodes more reliably than
   plain names like "Galaxy S23," so some rows may come back empty or mismatched at first. If that
   happens, share the sample JSON and we'll tune the matching together — this is genuinely a first pass,
   not a guaranteed-working integration, since I can't test it against a live Icecat account myself.
5. Once you're happy with the match quality, run it on the full file (drop `--test 5`) — it writes a new
   file, `*.enriched.csv`, leaving your original untouched, and skips any row that already has an
   `imageUrl` so it won't overwrite photos you've already added.

## Uploading your price list

Go to Admin → Stock → upload a CSV with these columns:

```
brand,model,price,condition,storage,color,stock,imageUrl
Apple,iPhone 13,8400,Good,128GB,Midnight,3,
```

- `imageUrl` is optional — leave it blank and the listing shows a clean placeholder card until you add a
  real photo (Admin → Stock → Photo button, which uploads straight to Supabase Storage, or fill in the
  column with a URL to a photo you have the rights to use).
- Re-uploading a CSV updates matching rows (same brand+model+storage+condition) instead of duplicating them,
  so you can just re-upload your whole list whenever prices change.
- A sample file is included: `sample-price-list.csv`.

## About the "stock images"

I didn't wire this up to scrape manufacturer or stock-photo sites — those images are copyrighted, and
pulling them in automatically isn't something I can do. Two real options if you want photos without
photographing every unit yourself:
1. **Best for trust**: photograph your own stock (even a phone-camera shot on a plain background works
   well) and upload it per listing — it goes straight into Supabase Storage.
2. **Faster to scale**: use a licensed product-image API or dataset (e.g. a paid provider like Icecat,
   or your supplier's official press kit if their terms allow reuse) and put the URL straight in the
   `imageUrl` CSV column.

Until then, devices without a photo show a clean auto-generated placeholder card rather than a broken image.

## About WhatsApp

This uses `wa.me` deep links — zero setup, zero cost, and it works the moment you set your number in
Settings. The trade-off: the customer's device opens WhatsApp and they hit send themselves (can't be sent
silently from the server). If you later want the message to land automatically without the customer
tapping send, that needs Meta's WhatsApp Business Platform (developer account + approved message
templates + a paid provider like Twilio) — the code has a clear spot (`server.js`, the `waLink` calls in
the `/api/offers` and `/api/tradeins` routes) to swap in that API once you have it.

## Data storage

Everything (products, offers, trade-in submissions, settings) lives in Supabase Postgres; uploaded photos
live in Supabase Storage. `db.js` is the only file that talks to Supabase directly — if you ever want to
swap data providers, that's the one file to change.
