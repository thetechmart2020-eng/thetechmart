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
