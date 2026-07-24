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

## Getting it running

Requires [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm start
```

Then open `http://localhost:3000`. Admin panel is at `http://localhost:3000/admin` — default password is
`admin123`. **Change this immediately** under Admin → Settings, and also set your real WhatsApp number there
(country code + number, digits only, e.g. `27821234567` for a South African number).

## Uploading your price list

Go to Admin → Stock → upload a CSV with these columns:

```
brand,model,price,condition,storage,color,stock,imageUrl
Apple,iPhone 13,8400,Good,128GB,Midnight,3,
```

- `imageUrl` is optional — leave it blank and the listing shows a clean placeholder card until you add a
  real photo (Admin → Stock → Photo button, or fill in the column with a URL to a photo you have the rights to use).
- Re-uploading a CSV updates matching rows (same brand+model+storage+condition) instead of duplicating them,
  so you can just re-upload your whole list whenever prices change.
- A sample file is included: `sample-price-list.csv`.

## About the "stock images"

I didn't wire this up to scrape manufacturer or stock-photo sites — those images are copyrighted, and
pulling them in automatically isn't something I can do. Two real options if you want photos without
photographing every unit yourself:
1. **Best for trust**: photograph your own stock (even a phone-camera shot on a plain background works
   well) and upload it per listing.
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

Everything (products, offers, trade-in submissions, settings) is stored in `data/db.json` — a simple file,
no database server needed. Fine for getting started; if you outgrow it, the `db.js` file is the only place
that would need to change to move to a real database (e.g. Postgres).

## Deploying it live

This is a standard Node/Express app, so it runs on any host that supports Node: Render, Railway, Fly.io,
a VPS, etc. Two things to set before going live:
- Change the `secret` in `server.js`'s session config to something random.
- Make sure `data/`, `public/uploads/images/`, and `public/uploads/tradeins/` are writable and, ideally,
  on persistent storage (some hosts wipe the filesystem on redeploy — if so, point these at a mounted volume).
