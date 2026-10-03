require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { uploadBuffer, uploadProductPhoto } = require('./lib/storage');
const { setAdminCookie, clearAdminCookie, isAdminRequest } = require('./lib/auth');
const payments = require('./lib/payments');
const { generateQuotePdf, generateInvoicePdf, generatePriceListPdf } = require('./lib/documents');
const deals = require('./lib/deals');
const V = require('./lib/validate');

// Flat Courier Guy delivery fee in rand. Collection is R0. This is the ONE place the fee is set:
// checkout, the saved order, the WhatsApp/email message, the Yoco amount and the site text all use it.
const DELIVERY_FEE = 100;
const MAX_PHOTOS = 5;

const app = express();
const PORT = process.env.PORT || 3000;

// Behind Vercel's proxy: lets req.protocol be 'https' (needed for correct share links,
// canonical URLs and the sitemap).
app.set('trust proxy', true);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Uploads (memory — files go straight to Supabase Storage, never to disk) ----------
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });
// Product photos are shrunk in the admin page first (about 200 KB), so anything big is rejected.
const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 600 * 1024 } });
const tradeinUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const bulkImageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 600 * 1024, files: 120 } });

// ---------- Helpers ----------
function requireAdmin(req, res, next) {
  if (isAdminRequest(req)) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

function waLink(number, message) {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

function mailtoLink(email, subject, body) {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// Customers type their number in local SA format (0821234567); wa.me needs the
// international form with no leading 0. Store-facing links already store the
// number with a country code, but this normalizes customer-entered numbers
// when the admin is the one sending a message TO them.
function toIntlPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return '27' + digits.slice(1);
  return digits;
}

// Tells Vercel's edge network it may serve a stored copy of this response for `s`
// seconds, and keep serving a slightly stale copy for up to `swr` seconds while it
// refreshes in the background. This is what makes repeat page loads feel instant
// instead of waiting on the database every time.
function edgeCache(res, s = 30, swr = 600) {
  res.set('Cache-Control', `public, max-age=0, s-maxage=${s}, stale-while-revalidate=${swr}`);
}

// "27716623565" -> "071 662 3565" (for display on the site and in the price list PDF)
function waDisplay(number) {
  const d = String(number || '').replace(/\D/g, '');
  if (d.startsWith('27') && d.length === 11) {
    const l = '0' + d.slice(2);
    return `${l.slice(0, 3)} ${l.slice(3, 6)} ${l.slice(6)}`;
  }
  return d;
}

// ---------- Reference photos (public/images/products, built by scripts/build-product-photos.py) ----------
// Used only when a product has no photo of its own. They are indicative, not the exact unit.
let PRODUCT_PHOTOS = {};
try { PRODUCT_PHOTOS = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'product-photos.json'), 'utf8')); } catch (e) { PRODUCT_PHOTOS = {}; }

const ICECAT_NOTICE = 'Product images: Database Right data-sheet 2026 Icecat. All rights reserved. Product content provided by Icecat "as is" under the Open Content License (https://iceclog.com/open-content-license/), with no warranty of any kind. Product images remain the property of their respective brand owners.';

// Files are named like the shot list (device, storage and sometimes a colour). Products are
// matched on brand + model + storage ("key") so a missing colour does not stop a match.
const PHOTO_BY_KEY = {};
for (const [slug, e] of Object.entries(PRODUCT_PHOTOS)) PHOTO_BY_KEY[e.key || slug] = slug;

function repoPhoto(p) {
  const keys = [productFullKey(p), slugify([p.brand, p.model, p.storage].filter(Boolean).join('-'))];
  for (const k0 of keys) {
    const k = PRODUCT_PHOTOS[k0] ? k0 : PHOTO_BY_KEY[k0];
    const e = k && PRODUCT_PHOTOS[k];
    if (e) {
      let credit = null;
      if (e.kind === 'icecat') credit = 'Product image: Icecat, Open Content License';
      else if (e.credit) credit = `Photo: ${e.credit.author}, ${e.credit.licence}`;
      return { src: `/images/products/web/${k}-1200.webp`, credit };
    }
  }
  return null;
}

// Public shape of a product (adds the "negotiated device" flag used for the 21-day warranty badge).
function publicProduct(p) {
  let images = (p.images && p.images.length ? p.images : (p.imageUrl ? [p.imageUrl] : [])).filter(Boolean);
  let extra = {};
  if (!images.length) {
    const ref = repoPhoto(p);
    if (ref) { images = [ref.src]; extra = { indicative: true, photoCredit: ref.credit }; }
  }
  return { ...p, ...extra, images, imageUrl: p.imageUrl || images[0] || null, thumbs: images.map(thumbOf), deal: deals.isDeal(p) };
}

// Small card version of a product photo. Photos uploaded through the admin come as
// "<id>-1200.webp" (main) and "<id>-480.webp" (card); older photos have no small version.
function thumbOf(url) {
  return /-1200\.(webp|jpg)$/.test(url || '') ? url.replace(/-1200\.(webp|jpg)$/, '-480.$1') : url;
}

// Only what the browser needs to draw a product card (keeps the page payload small).
function cardProduct(p) {
  if (!p.imageUrl && !(p.images && p.images.length)) {
    const ref = repoPhoto(p);
    if (ref) p = { ...p, imageUrl: ref.src };
  }
  return {
    id: p.id, brand: p.brand, model: p.model, category: p.category, price: p.price, condition: p.condition,
    storage: p.storage, color: p.color, stock: p.stock, imageUrl: p.imageUrl || null,
    thumbUrl: p.imageUrl ? thumbOf(p.imageUrl) : null, deal: deals.isDeal(p)
  };
}

function publicConfig(cfg) {
  return {
    storeName: cfg.storeName, whatsapp: cfg.whatsappNumber, whatsappDisplay: waDisplay(cfg.whatsappNumber),
    email: cfg.contactEmail, deliveryFee: DELIVERY_FEE
  };
}

// ---------- Bulk photo matching (filename → product) ----------
// Turns "Apple iPhone 13 128GB Blue" into "apple-iphone-13-128gb-blue" so a
// product and a photo filename can be compared the same way regardless of
// spacing/casing/punctuation.
function slugify(s) {
  // "+" becomes "plus" so "Galaxy S21+" and "Galaxy S21" get different file names.
  return String(s || '').toLowerCase().replace(/\+/g, ' plus ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function productFullKey(p) {
  return slugify([p.brand, p.model, p.storage, p.color].filter(Boolean).join('-'));
}
function productBrandModelKey(p) {
  return slugify([p.brand, p.model].filter(Boolean).join('-'));
}

// Matches an uploaded file's name (minus extension) against the product list.
// Tries an exact brand+model+storage+color match first (most specific), then
// falls back to brand+model alone if that's unambiguous. Returns
// { product } | { ambiguous: [...] } | {} (no match).
function matchFilenameToProduct(filename, products) {
  const base = filename.replace(/\.[a-z0-9]+$/i, '');
  const fileSlug = slugify(base);
  if (!fileSlug) return {};

  const exact = products.find((p) => productFullKey(p) === fileSlug);
  if (exact) return { product: exact };

  // A trailing -2 to -5 means "extra photo of the same device" (e.g. apple-iphone-13-128gb-2.jpg).
  const numbered = fileSlug.match(/^(.*)-[2-5]$/);
  if (numbered) {
    const base = products.find((p) => productFullKey(p) === numbered[1]);
    if (base) return { product: base };
  }

  const byBrandModel = products.filter((p) => {
    const key = productBrandModelKey(p);
    return key && (fileSlug === key || fileSlug.startsWith(key + '-') || fileSlug.includes(key));
  });
  if (byBrandModel.length === 1) return { product: byBrandModel[0] };
  if (byBrandModel.length > 1) return { ambiguous: byBrandModel.map((p) => `${p.brand} ${p.model} ${p.storage || ''}`.trim()) };

  return {};
}

function asyncRoute(fn) {
  return (req, res) => fn(req, res).catch((err) => {
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
  });
}

// ================= PUBLIC API =================

app.get('/api/config', asyncRoute(async (req, res) => {
  const cfg = await db.getConfig();
  edgeCache(res, 60, 600);
  res.json({
    storeName: cfg.storeName,
    whatsappNumber: cfg.whatsappNumber,
    contactEmail: cfg.contactEmail,
    paymentProviders: payments.listProviders(cfg.paymentSettings).map(({ key, label, description, live }) => ({ key, label, description, live }))
  });
}));

app.get('/api/products', asyncRoute(async (req, res) => {
  let list = await db.listProducts({ activeOnly: true });
  const { q, brand, condition, category, minPrice, maxPrice, sort } = req.query;
  if (q) {
    const s = q.toLowerCase();
    list = list.filter(p => (p.model + ' ' + p.brand).toLowerCase().includes(s));
  }
  if (brand) list = list.filter(p => p.brand.toLowerCase() === brand.toLowerCase());
  if (condition) list = list.filter(p => p.condition.toLowerCase() === condition.toLowerCase());
  if (category) list = list.filter(p => (p.category || 'Phones').toLowerCase() === category.toLowerCase());
  if (minPrice) list = list.filter(p => p.price >= Number(minPrice));
  if (maxPrice) list = list.filter(p => p.price <= Number(maxPrice));
  if (sort === 'price_asc') list = [...list].sort((a, b) => a.price - b.price);
  if (sort === 'price_desc') list = [...list].sort((a, b) => b.price - a.price);
  if (sort === 'newest') list = [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  edgeCache(res, 30, 600);
  res.json(list.map(publicProduct));
}));

app.get('/api/products/:id', asyncRoute(async (req, res) => {
  const p = await db.getProduct(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  edgeCache(res, 15, 120);
  res.json(publicProduct(p));
}));

app.post('/api/track', asyncRoute(async (req, res) => {
  const { type, path: p, productId } = req.body;
  // Browser-reported events. offer_submitted, tradein_submitted and order_completed are
  // also logged server-side when the real submission succeeds.
  const allowed = [
    'page_view', 'product_view', 'offer_submitted', 'tradein_submitted',
    'whatsapp_click', 'buy_now_click', 'checkout_started', 'order_completed', 'pricelist_download'
  ];
  if (!allowed.includes(type)) return res.status(400).json({ error: 'Invalid event type' });
  await db.logEvent({ type, path: typeof p === 'string' ? p.slice(0, 120) : undefined, productId });
  res.json({ ok: true });
}));

// Sends back plain-language errors, one per field, so the browser can show them next to the input.
function fieldErrors(res, fields) {
  return res.status(400).json({ error: Object.values(fields)[0], fields });
}
const MSG_NAME = 'Please enter your name.';
const MSG_PHONE = 'Please enter a valid South African number, like 082 123 4567 or +27 82 123 4567.';
const MSG_EMAIL = 'Please enter a valid email address, like name@example.com.';
const CONDITIONS = ['Like new', 'Good', 'Fair', 'Damaged / for parts'];

app.post('/api/offers', asyncRoute(async (req, res) => {
  const product = await db.getProduct(req.body.productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const fields = {};
  const name = V.oneLine(req.body.name, 80);
  if (name.length < 2) fields.name = MSG_NAME;
  const ph = V.phone(req.body.phone); if (!ph.ok) fields.phone = MSG_PHONE;
  let emailVal = '';
  if (String(req.body.email || '').trim()) { const em = V.email(req.body.email); if (em.ok) emailVal = em.value; else fields.email = MSG_EMAIL; }
  const amount = Math.round(Number(req.body.amount));
  const price = Number(product.price);
  if (!Number.isFinite(amount) || amount < 1) fields.amount = 'Please enter your offer in rand, more than R0.';
  else if (amount > price) fields.amount = `That is above the listed price of R${price}. Use Buy now, or lower your offer.`;
  else if (amount < Math.ceil(price * 0.5)) fields.amount = `Offers under R${Math.ceil(price * 0.5)} (half the price) are very unlikely to be accepted. Please try a higher amount.`;
  if (Object.keys(fields).length) return fieldErrors(res, fields);
  const message = V.clean(req.body.message, 500);

  const offer = await db.addOffer({
    productId: product.id, productName: `${product.brand} ${product.model}`, listPrice: product.price,
    amount, name, phone: ph.value, email: emailVal, message
  });
  await db.logEvent({ type: 'offer_submitted', productId: product.id }).catch(() => {});

  const cfg = await db.getConfig();
  const waMessage = `Hi TheTechMart! I'd like to make an offer.\n\nDevice: ${offer.productName}\nList price: R${offer.listPrice}\nMy offer: R${offer.amount}\nName: ${name}\nContact: ${ph.value}\n${message ? 'Note: ' + message : ''}\n\n(Offer ref: ${offer.id.slice(0, 8)})`;

  res.json({
    offer,
    whatsappUrl: waLink(cfg.whatsappNumber, waMessage),
    mailtoUrl: mailtoLink(cfg.contactEmail, `Offer on ${offer.productName} (ref ${offer.id.slice(0, 8)})`, waMessage)
  });
}));

// Runs the photo upload and turns upload problems into plain JSON errors instead of a server error page.
function tradeinPhotos(req, res, next) {
  tradeinUpload.array('photos', 6)(req, res, (err) => {
    if (!err) return next();
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'One of your photos is too big. Each photo must be under 8 MB.'
      : (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') ? 'You can add up to 6 photos.'
      : 'We could not read your photos. Please try again.';
    res.status(400).json({ error: msg, fields: { photos: msg } });
  });
}

app.post('/api/tradeins', tradeinPhotos, asyncRoute(async (req, res) => {
  const fields = {};
  const brand = V.oneLine(req.body.brand, 60), model = V.oneLine(req.body.model, 80), storage = V.oneLine(req.body.storage, 30);
  if (brand.length < 2) fields.brand = 'Please enter the brand, for example Apple.';
  if (model.length < 1) fields.model = 'Please enter the model, for example iPhone 13.';
  const condition = CONDITIONS.includes(req.body.condition) ? req.body.condition : '';
  if (!condition) fields.condition = 'Please choose the condition of your device.';
  const name = V.oneLine(req.body.name, 80); if (name.length < 2) fields.name = MSG_NAME;
  const ph = V.phone(req.body.phone); if (!ph.ok) fields.phone = MSG_PHONE;
  let askingPrice = null;
  if (String(req.body.askingPrice || '').trim()) {
    askingPrice = Math.round(Number(req.body.askingPrice));
    if (!Number.isFinite(askingPrice) || askingPrice < 1 || askingPrice > 1000000) fields.askingPrice = 'Please enter a price in rand between R1 and R1 000 000, or leave it empty.';
  }
  const files = req.files || [];
  if (files.length < 1) fields.photos = 'Please add at least 1 photo (up to 6).';
  else if (files.length > 6) fields.photos = 'You can add up to 6 photos.';
  else if (files.some((f) => V.imageKind(f.buffer) === null)) fields.photos = 'Photos must be JPG, PNG or WebP pictures.';
  if (Object.keys(fields).length) return fieldErrors(res, fields);
  const notes = V.clean(req.body.notes, 800);
  const type = req.body.type === 'trade' ? 'trade' : 'sell';

  const photos = [];
  for (const file of files) {
    photos.push(await uploadBuffer('tradein-photos', file));
  }

  const submission = await db.addTradein({
    type, brand, model, storage, condition,
    askingPrice, name, phone: ph.value, notes, photos
  });
  await db.logEvent({ type: 'tradein_submitted' }).catch(() => {});

  const cfg = await db.getConfig();
  const waMessage = `Hi TheTechMart! I'd like to ${submission.type === 'trade' ? 'trade in' : 'sell'} a device.\n\nDevice: ${brand} ${model}\nStorage: ${storage || 'N/A'}\nCondition: ${condition || 'N/A'}\n${askingPrice ? 'Asking price: R' + askingPrice : ''}\nName: ${name}\nContact: ${ph.value}\n${notes ? 'Notes: ' + notes : ''}\n\n(Ref: ${submission.id.slice(0, 8)})`;

  res.json({
    submission,
    whatsappUrl: waLink(cfg.whatsappNumber, waMessage),
    mailtoUrl: mailtoLink(cfg.contactEmail, `${submission.type === 'trade' ? 'Trade-in' : 'Sell'} request: ${brand} ${model} (ref ${submission.id.slice(0, 8)})`, waMessage)
  });
}));

// ================= CHECKOUT (Buy Now → order + delivery + payment) =================
//
// Ready for Yoco / PayJustNow / Happy Pay: pass paymentMethod as one of those keys
// and, once an admin has switched that gateway on with real credentials, this
// creates a real hosted-checkout redirect. Until then (or if paymentMethod is
// "manual"), the order is created as pending and the customer is handed off to
// WhatsApp or email to confirm payment/delivery — same conversational flow the
// business already runs on WhatsApp today.
app.post('/api/checkout', asyncRoute(async (req, res) => {
  const { productId, fulfillmentMethod, paymentMethod, paymentPreference } = req.body;

  const product = await db.getProduct(productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  if (!product.active) return res.status(400).json({ error: 'This device is no longer available' });

  // We source from a supplier network, so running out of on-hand units doesn't
  // mean we can't fulfil the order — it just means this one becomes a
  // pre-order instead of an immediate dispatch. We still take one unit off
  // stock (floor 0) so the listing shows "Pre-order" once depleted, but we
  // never block the purchase outright.
  const isPreOrder = product.stock < 1;

  // Three ways to get the device: Courier Guy delivery ('delivery'), collection, or a meetup by appointment.
  const method = ['collection', 'meetup'].includes(fulfillmentMethod) ? fulfillmentMethod : 'delivery';
  const fields = {};
  const name = V.oneLine(req.body.name, 80); if (name.length < 2) fields.name = MSG_NAME;
  const ph = V.phone(req.body.phone); if (!ph.ok) fields.phone = MSG_PHONE;
  const em = V.email(req.body.email); if (!em.ok) fields.email = MSG_EMAIL;
  const notes = V.clean(req.body.notes, 500);

  // Cash is never available for courier delivery: only on collection, at a meetup or at pickup.
  if (paymentPreference === 'cash' && method === 'delivery') {
    fields.pay = 'Cash is only available for collection or a meetup. Please choose Yoco (card) or EFT for courier delivery.';
  }

  let address = {}, meetup = null;
  if (method === 'delivery') {
    const a = req.body.address || {};
    address = {
      line1: V.oneLine(a.line1, 120), line2: V.oneLine(a.line2, 80), city: V.oneLine(a.city, 80),
      province: V.PROVINCES.includes(a.province) ? a.province : '', postalCode: String(a.postalCode || '').trim()
    };
    if (address.line1.length < 4) fields.line1 = 'Please enter your street address, with the street number.';
    if (address.line2.length < 2) fields.line2 = 'Please enter your suburb.';
    if (address.city.length < 2) fields.city = 'Please enter your city or town.';
    if (!address.province) fields.province = 'Please choose your province.';
    if (!V.postal(address.postalCode).ok) fields.postalCode = 'Please enter a 4-digit postal code, like 2196.';
  } else if (method === 'meetup') {
    const m = req.body.meetup || {};
    const r = V.meetupFields(m);
    Object.assign(fields, r.errors);
    meetup = r.value;
  }
  if (Object.keys(fields).length) return fieldErrors(res, fields);

  // One server-side total: device price + flat delivery (R0 for collection and meetups).
  const deliveryFee = method === 'delivery' ? DELIVERY_FEE : 0;
  const total = Number(product.price) + deliveryFee;
  const phone = ph.value, email = em.value;

  const cfg = await db.getConfig();
  const wantsGateway = ['yoco', 'payjustnow', 'happypay'].includes(paymentMethod) && paymentPreference !== 'cash';

  const order = await db.addOrder({
    type: 'sale', source: 'checkout', productId: product.id,
    customerName: name, customerPhone: phone, customerEmail: email,
    deliveryAddress: method === 'delivery' ? address : (meetup ? { meetup } : {}), fulfillmentMethod: method,
    courier: method === 'delivery' ? 'Courier Guy' : (method === 'meetup' ? 'Meetup' : 'Collection'), paymentMethod: wantsGateway ? paymentMethod : 'manual',
    paymentStatus: 'pending', amount: total,
    notes: (isPreOrder ? '[PRE-ORDER — source from supplier before dispatch] ' : '')
      + (meetup ? `[MEETUP ${meetup.date} ${meetup.slotLabel} at ${meetup.area}] ` : '')
      + (['card', 'eft', 'cash'].includes(paymentPreference) ? `[Payment preference: ${paymentPreference.toUpperCase()}] ` : '')
      + (notes || '')
  });
  await db.logEvent({ type: 'order_completed', productId: product.id }).catch(() => {});

  // Reserve a unit against this listing (floor 0) so the storefront reflects
  // it immediately — same "one unit off stock" rule as accepting an offer.
  await db.updateProduct(product.id, { stock: Math.max(0, (product.stock || 0) - 1) });

  const addressLine = method === 'delivery'
    ? `${address.line1}${address.line2 ? ', ' + address.line2 : ''}, ${address.city}, ${address.postalCode}${address.province ? ', ' + address.province : ''}`
    : (method === 'meetup' ? `Meetup on ${meetup.date}, ${meetup.slotLabel}, ${meetup.area}` : 'Collection (arranged on WhatsApp)');

  if (wantsGateway) {
    try {
      const result = await payments.createCheckout(paymentMethod, order, cfg.paymentSettings);
      await db.updateOrder(order.id, { paymentRef: result.providerRef || '' });
      return res.json({ order, redirectUrl: result.redirectUrl, preOrder: isPreOrder, deliveryFee, total });
    } catch (err) {
      // Gateway not actually live yet (or the call failed) — fall back to the
      // manual handoff rather than dead-ending the customer.
      console.warn(`[checkout] ${paymentMethod} unavailable, falling back to manual: ${err.message}`);
    }
  }

  const prefLabel = { card: 'Card (Yoco)', eft: 'EFT / bank transfer', cash: 'Cash on collection (meetup or pickup only)' }[paymentPreference] || '';
  const summary = `Hi TheTechMart! I'd like to buy this device.\n\nDevice: ${product.brand} ${product.model}${product.storage ? ' · ' + product.storage : ''}\nDevice price: R${product.price}\nDelivery: ${method === 'delivery' ? 'R' + deliveryFee + ' (flat, The Courier Guy, about 2 days)' : (method === 'meetup' ? 'R0 (meetup)' : 'R0 (collection)')}\nTotal: R${total}\nName: ${name}\nEmail: ${email}\nContact: ${phone}\nFulfillment: ${method === 'delivery' ? 'Courier Guy delivery to ' + addressLine : addressLine}\n${prefLabel ? 'Payment: ' + prefLabel + '\n' : ''}${isPreOrder ? 'Pre-order: yes\n' : ''}${notes ? 'Notes: ' + notes : ''}\n\n(Order ref: ${order.id.slice(0, 8)})`;

  res.json({
    order,
    preOrder: isPreOrder,
    deliveryFee, total, fulfillmentMethod: method,
    whatsappUrl: waLink(cfg.whatsappNumber, summary),
    mailtoUrl: mailtoLink(cfg.contactEmail, `Order: ${product.brand} ${product.model} (ref ${order.id.slice(0, 8)})`, summary)
  });
}));

// ================= MEETUP REQUESTS =================
// A meetup is booked at least 2 days ahead so the device can be released from the warehouse and
// sent to our sales agent. The request is saved as an order lead (source 'meetup'), then handed to
// WhatsApp (or email) with the details filled in.
app.post('/api/meetups', asyncRoute(async (req, res) => {
  const product = await db.getProduct(req.body.productId);
  const fields = {};
  if (!product || !product.active) fields.productId = 'Please choose the device you would like to see.';
  const name = V.oneLine(req.body.name, 80); if (name.length < 2) fields.name = MSG_NAME;
  const ph = V.phone(req.body.phone); if (!ph.ok) fields.phone = MSG_PHONE;
  let emailVal = '';
  if (String(req.body.email || '').trim()) { const em = V.email(req.body.email); if (em.ok) emailVal = em.value; else fields.email = MSG_EMAIL; }
  const r = V.meetupFields({ area: req.body.meetupArea, date: req.body.meetupDate, slot: req.body.meetupSlot });
  Object.assign(fields, r.errors);
  if (Object.keys(fields).length) return fieldErrors(res, fields);
  const meetup = r.value, notes = V.clean(req.body.notes, 500);

  const order = await db.addOrder({
    type: 'sale', source: 'meetup', productId: product.id,
    customerName: name, customerPhone: ph.value, customerEmail: emailVal,
    deliveryAddress: { meetup }, fulfillmentMethod: 'meetup', courier: 'Meetup',
    paymentMethod: 'manual', paymentStatus: 'pending', amount: Number(product.price),
    notes: `[MEETUP REQUEST ${meetup.date} ${meetup.slotLabel} at ${meetup.area}] ${notes}`.trim()
  });
  await db.logEvent({ type: 'offer_submitted', productId: product.id }).catch(() => {});

  const cfg = await db.getConfig();
  const dev = `${product.brand} ${product.model}${product.storage ? ' · ' + product.storage : ''}`;
  const msg = `Hi TheTechMart! I'd like to book a meetup.\n\nDevice: ${dev} (R${product.price})\nPreferred date: ${meetup.date}\nTime slot: ${meetup.slotLabel}\nMeetup area: ${meetup.area}\nName: ${name}\nContact: ${ph.value}\n${notes ? 'Note: ' + notes + '\n' : ''}\n(Meetup ref: ${order.id.slice(0, 8)})`;
  res.json({
    order, ref: order.id.slice(0, 8),
    whatsappUrl: waLink(cfg.whatsappNumber, msg),
    mailtoUrl: mailtoLink(cfg.contactEmail, `Meetup request: ${dev} (ref ${order.id.slice(0, 8)})`, msg)
  });
}));

app.get('/api/orders/:id', asyncRoute(async (req, res) => {
  const order = await db.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });
  // Public read-only slice — enough for the "order confirmed" page, nothing else.
  res.json({
    id: order.id, status: order.status, paymentStatus: order.paymentStatus,
    fulfillmentMethod: order.fulfillmentMethod, courier: order.courier, amount: order.amount
  });
}));

// ================= ADMIN AUTH =================

app.post('/api/admin/login', asyncRoute(async (req, res) => {
  const { password } = req.body;
  const cfg = await db.getConfig();
  if (password === cfg.adminPassword) {
    setAdminCookie(res);
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Incorrect password' });
}));

app.post('/api/admin/logout', (req, res) => {
  clearAdminCookie(res);
  res.json({ ok: true });
});

app.get('/api/admin/session', (req, res) => {
  res.json({ isAdmin: isAdminRequest(req) });
});

// ================= ADMIN: PRODUCTS =================

app.get('/api/admin/products', requireAdmin, asyncRoute(async (req, res) => {
  res.json(await db.listProducts());
}));

// Upload price list CSV. Expected columns:
// brand,model,price,condition,storage,color,stock,imageUrl(optional)
app.post('/api/admin/upload-csv', requireAdmin, csvUpload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let records;
  try {
    records = parse(req.file.buffer.toString('utf-8'), { columns: true, skip_empty_lines: true, trim: true });
  } catch (e) {
    return res.status(400).json({ error: 'Could not parse CSV: ' + e.message });
  }

  const rows = [];
  for (const row of records) {
    if (!row.brand || !row.model || !row.price) continue;
    const price = Number(String(row.price).replace(/[^0-9.]/g, ''));
    if (Number.isNaN(price)) continue;
    rows.push({
      brand: row.brand.trim(), model: row.model.trim(), price,
      category: row.category ? row.category.trim() : 'Phones',
      condition: row.condition ? row.condition.trim() : 'New',
      storage: row.storage ? row.storage.trim() : '',
      color: row.color ? row.color.trim() : '',
      stock: row.stock ? Number(row.stock) : 1,
      imageUrl: row.imageUrl ? row.imageUrl.trim() : ''
    });
  }

  const { added, updated } = await db.syncProductsFromRows(rows);
  res.json({ ok: true, added, updated, total: records.length });
}));

// Runs Icecat lookups server-side (on Vercel's real Node runtime, which has normal
// outbound networking — unlike browser-sandboxed dev environments such as
// StackBlitz's WebContainers, which can't complete this kind of request).
// Upload a price-list CSV, get back the same CSV with imageUrl filled in wherever
// Icecat found a match. Requires ICECAT_USERNAME / ICECAT_PASSWORD env vars.
app.post('/api/admin/enrich-images', requireAdmin, csvUpload.single('file'), asyncRoute(async (req, res) => {
  const { ICECAT_USERNAME, ICECAT_PASSWORD } = process.env;
  if (!ICECAT_USERNAME || !ICECAT_PASSWORD) {
    return res.status(400).json({ error: 'ICECAT_USERNAME / ICECAT_PASSWORD are not set in this deployment\'s environment variables.' });
  }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let rows;
  try {
    rows = parse(req.file.buffer.toString('utf-8'), { columns: true, skip_empty_lines: true, trim: true });
  } catch (e) {
    return res.status(400).json({ error: 'Could not parse CSV: ' + e.message });
  }

  const auth = Buffer.from(`${ICECAT_USERNAME}:${ICECAT_PASSWORD}`).toString('base64');
  const results = [];
  let matched = 0;

  for (const row of rows) {
    if (row.imageUrl && row.imageUrl.trim()) continue; // don't overwrite existing photos
    const url = `https://data.icecat.biz/xml_s3/xml_server3.cgi?lang=en&shopname=openIcecat-live&brand=${encodeURIComponent(row.brand)}&prod=${encodeURIComponent(row.model)}`;
    try {
      const icecatRes = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
      const text = await icecatRes.text();
      const highPicMatch = text.match(/HighPic="([^"]+)"/);
      const picMatch = text.match(/<Pic[^>]*>([^<]+)<\/Pic>/) || text.match(/Pic="([^"]+)"/);
      const imageUrl = (highPicMatch && highPicMatch[1]) || (picMatch && picMatch[1]) || null;
      if (icecatRes.ok && imageUrl) {
        row.imageUrl = imageUrl;
        matched++;
        results.push({ brand: row.brand, model: row.model, matched: true });
      } else {
        results.push({ brand: row.brand, model: row.model, matched: false, status: icecatRes.status });
      }
    } catch (err) {
      results.push({ brand: row.brand, model: row.model, matched: false, error: err.message });
    }
  }

  const headers = Object.keys(rows[0] || {});
  const escape = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n') + '\n';

  res.set('Content-Type', 'text/csv');
  res.set('Content-Disposition', 'attachment; filename="enriched.csv"');
  res.set('X-Enrich-Matched', String(matched));
  res.set('X-Enrich-Total', String(rows.length));
  res.set('X-Enrich-Details', encodeURIComponent(JSON.stringify(results.slice(0, 10))));
  res.send(csv);
}));

app.put('/api/admin/products/:id', requireAdmin, asyncRoute(async (req, res) => {
  const p = await db.updateProduct(req.params.id, req.body);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
}));

app.delete('/api/admin/products/:id', requireAdmin, asyncRoute(async (req, res) => {
  await db.deleteProduct(req.params.id);
  res.json({ ok: true });
}));

const PHOTO_TYPES = ['image/webp', 'image/jpeg'];
const TOO_BIG = 'That photo was not resized. Refresh the admin page (Ctrl+F5) and try again.';

// Single-product photo upload (the "Photos" button in Stock). The admin page sends the
// resized main image ("image") and the small card version ("thumb"). Max 5 per product.
// The first photo is the main one; use "Make main" to change it.
app.post('/api/admin/products/:id/image', requireAdmin, imageUpload.fields([{ name: 'image', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]), asyncRoute(async (req, res) => {
  const main = req.files && req.files.image && req.files.image[0];
  const thumb = req.files && req.files.thumb && req.files.thumb[0];
  if (!main) return res.status(400).json({ error: 'No image uploaded' });
  if (!PHOTO_TYPES.includes(main.mimetype)) return res.status(400).json({ error: TOO_BIG });
  const existing = await db.getProduct(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const current = (existing.images || []).filter(Boolean);
  if (current.length >= MAX_PHOTOS) return res.status(400).json({ error: `A product can have up to ${MAX_PHOTOS} photos. Remove one first.` });
  const url = await uploadProductPhoto(main, thumb);
  const images = [...current, url];
  const p = await db.updateProduct(req.params.id, { images, imageUrl: images[0] });
  res.json(p);
}));

// Removes one photo from a product's gallery. The first remaining photo becomes the main one.
app.delete('/api/admin/products/:id/image', requireAdmin, asyncRoute(async (req, res) => {
  const { url } = req.body;
  const existing = await db.getProduct(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const images = (existing.images || []).filter((u) => u && u !== url);
  const p = await db.updateProduct(req.params.id, { images, imageUrl: images[0] || null });
  res.json(p);
}));

// Makes one photo the main (first) photo.
app.put('/api/admin/products/:id/image/main', requireAdmin, asyncRoute(async (req, res) => {
  const { url } = req.body;
  const existing = await db.getProduct(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const rest = (existing.images || []).filter((u) => u && u !== url);
  if (rest.length === (existing.images || []).filter(Boolean).length) return res.status(400).json({ error: 'Photo not found on this product' });
  const images = [url, ...rest];
  res.json(await db.updateProduct(req.params.id, { images, imageUrl: url }));
}));

// Bulk photo upload: files named like "apple-iphone-13-128gb-blue.jpg" (spacing/casing/
// punctuation don't matter) are matched to the right product by brand+model(+storage+color)
// and added to its gallery. The admin page resizes each file and sends a small card version
// ("thumbs") in the same order as "images". Max 5 photos per product.
app.post('/api/admin/products/bulk-images', requireAdmin, bulkImageUpload.fields([{ name: 'images', maxCount: 60 }, { name: 'thumbs', maxCount: 60 }]), asyncRoute(async (req, res) => {
  const files = (req.files && req.files.images) || [];
  const thumbs = (req.files && req.files.thumbs) || [];
  if (!files.length) return res.status(400).json({ error: 'No images uploaded' });
  const products = await db.listProducts();

  const results = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!PHOTO_TYPES.includes(file.mimetype)) { results.push({ filename: file.originalname, matched: false, reason: TOO_BIG }); continue; }
    const { product, ambiguous } = matchFilenameToProduct(file.originalname, products);
    if (!product) {
      results.push({
        filename: file.originalname, matched: false,
        reason: ambiguous ? `Matches multiple products (${ambiguous.join(', ')}). Rename more specifically` : 'No matching product found'
      });
      continue;
    }
    try {
      const current = await db.getProduct(product.id);
      const have = (current.images || []).filter(Boolean);
      if (have.length >= MAX_PHOTOS) { results.push({ filename: file.originalname, matched: false, reason: `Already has ${MAX_PHOTOS} photos` }); continue; }
      const url = await uploadProductPhoto(file, thumbs[i]);
      const images = [...have, url];
      await db.updateProduct(product.id, { images, imageUrl: images[0] });
      results.push({ filename: file.originalname, matched: true, product: `${product.brand} ${product.model}` });
    } catch (err) {
      results.push({ filename: file.originalname, matched: false, reason: err.message });
    }
  }

  res.json({ results, matched: results.filter((r) => r.matched).length, total: results.length });
}));

// ================= ADMIN: OFFERS =================

app.get('/api/admin/offers', requireAdmin, asyncRoute(async (req, res) => {
  res.json(await db.listOffers());
}));

app.post('/api/admin/offers/:id/:action', requireAdmin, asyncRoute(async (req, res) => {
  const { id, action } = req.params;
  if (!['accept', 'reject'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
  if (action === 'reject') {
    const offer = await db.updateOfferStatus(id, 'rejected');
    if (!offer) return res.status(404).json({ error: 'Not found' });
    return res.json(offer);
  }
  const result = await db.acceptOffer(id);
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json(result.offer);
}));

// Quote at sale inquiry — an admin can generate one for an offer at any stage
// (pending or accepted). Saves the PDF to Storage and to the offer record, and
// hands back ready-to-click WhatsApp/email links addressed to the customer.
app.post('/api/admin/offers/:id/quote', requireAdmin, asyncRoute(async (req, res) => {
  const offer = await db.getOffer(req.params.id);
  if (!offer) return res.status(404).json({ error: 'Not found' });
  const cfg = await db.getConfig();

  const number = `Q-${offer.id.slice(0, 8).toUpperCase()}`;
  const pdf = await generateQuotePdf({
    number, cfg,
    customer: { name: offer.name, phone: offer.phone, email: offer.email },
    items: [{ label: `${offer.productName} — negotiated offer`, amount: offer.amount }],
    note: offer.message || ''
  });
  const url = await uploadBuffer('documents', { buffer: pdf, mimetype: 'application/pdf', originalname: `${number}.pdf` });
  await db.updateOfferDocs(offer.id, { quoteNumber: number, quoteUrl: url });

  const message = `Hi ${offer.name}, here's your quote from TheTechMart (ref ${number}):\n${url}\n\nDevice: ${offer.productName}\nYour offer: R${offer.amount}\n\nLet us know if you'd like to go ahead!`;
  res.json({
    number, url,
    whatsappUrl: waLink(toIntlPhone(offer.phone), message),
    mailtoUrl: offer.email ? mailtoLink(offer.email, `Your TheTechMart quote (${number})`, message) : null
  });
}));

// ================= ADMIN: TRADE-INS =================

app.get('/api/admin/tradeins', requireAdmin, asyncRoute(async (req, res) => {
  res.json(await db.listTradeins());
}));

app.post('/api/admin/tradeins/:id/:action', requireAdmin, asyncRoute(async (req, res) => {
  const { id, action } = req.params;
  if (!['accept', 'reject'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
  if (action === 'reject') {
    const t = await db.updateTradeinStatus(id, 'rejected');
    if (!t) return res.status(404).json({ error: 'Not found' });
    return res.json(t);
  }
  const result = await db.acceptTradein(id);
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json(result.tradein);
}));

// ================= ADMIN: ORDERS =================

app.get('/api/admin/orders', requireAdmin, asyncRoute(async (req, res) => {
  res.json(await db.listOrders());
}));

app.put('/api/admin/orders/:id', requireAdmin, asyncRoute(async (req, res) => {
  const o = await db.updateOrder(req.params.id, req.body);
  if (!o) return res.status(404).json({ error: 'Not found' });
  res.json(o);
}));

// Invoice/quote lines: the device at its listed price plus the delivery fee that was added at checkout.
function orderItems(order, product) {
  const label = product ? `${product.brand} ${product.model}` : (order.notes || 'Device');
  const price = product ? Number(product.price) : Number(order.amount);
  const delivery = Number(order.amount) - price;
  const items = [{ label, amount: delivery > 0 ? price : Number(order.amount) }];
  if (delivery > 0) items.push({ label: 'Courier Guy delivery (flat)', amount: delivery });
  return items;
}

function orderAddressLine(order) {
  const a = order.deliveryAddress || {};
  if (order.fulfillmentMethod !== 'delivery' || !a.line1) return null;
  return [a.line1, a.line2, a.city, a.postalCode, a.province].filter(Boolean).join(', ');
}

// Quote at sale inquiry — for a checkout order that hasn't been paid yet.
app.post('/api/admin/orders/:id/quote', requireAdmin, asyncRoute(async (req, res) => {
  const order = await db.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });
  const cfg = await db.getConfig();
  const product = order.productId ? await db.getProduct(order.productId).catch(() => null) : null;

  const number = `Q-${order.id.slice(0, 8).toUpperCase()}`;
  const pdf = await generateQuotePdf({
    number, cfg,
    customer: { name: order.customerName, phone: order.customerPhone, email: order.customerEmail, address: orderAddressLine(order) },
    items: orderItems(order, product),
    note: order.notes || ''
  });
  const url = await uploadBuffer('documents', { buffer: pdf, mimetype: 'application/pdf', originalname: `${number}.pdf` });
  await db.updateOrder(order.id, { quoteNumber: number, quoteUrl: url });

  const message = `Hi ${order.customerName}, here's your quote from TheTechMart (ref ${number}):\n${url}\n\nTotal: R${order.amount}\n\nLet us know if you'd like to go ahead!`;
  res.json({
    number, url,
    whatsappUrl: waLink(toIntlPhone(order.customerPhone), message),
    mailtoUrl: order.customerEmail ? mailtoLink(order.customerEmail, `Your TheTechMart quote (${number})`, message) : null
  });
}));

// Invoice after payment — admin triggers this once payment_status is 'paid'
// (or whenever they judge it's appropriate), same PDF pipeline as the quote.
app.post('/api/admin/orders/:id/invoice', requireAdmin, asyncRoute(async (req, res) => {
  const order = await db.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });
  const cfg = await db.getConfig();
  const product = order.productId ? await db.getProduct(order.productId).catch(() => null) : null;

  const number = `INV-${order.id.slice(0, 8).toUpperCase()}`;
  const addressLine = orderAddressLine(order);
  const pdf = await generateInvoicePdf({
    number, cfg,
    customer: { name: order.customerName, phone: order.customerPhone, email: order.customerEmail, address: addressLine },
    items: orderItems(order, product),
    paymentStatus: order.paymentStatus, paymentMethod: order.paymentMethod,
    fulfillment: order.fulfillmentMethod === 'collection' ? 'Collection' : order.fulfillmentMethod === 'meetup' ? 'Meetup' : `${order.courier || 'Courier Guy'} delivery${addressLine ? ' — ' + addressLine : ''}`,
    note: order.notes || ''
  });
  const url = await uploadBuffer('documents', { buffer: pdf, mimetype: 'application/pdf', originalname: `${number}.pdf` });
  await db.updateOrder(order.id, { invoiceNumber: number, invoiceUrl: url });

  const message = `Hi ${order.customerName}, here's your invoice from TheTechMart (ref ${number}):\n${url}\n\nTotal: R${order.amount}\nStatus: ${order.paymentStatus === 'paid' ? 'PAID' : order.paymentStatus}\n\nThanks for your business!`;
  res.json({
    number, url,
    whatsappUrl: waLink(toIntlPhone(order.customerPhone), message),
    mailtoUrl: order.customerEmail ? mailtoLink(order.customerEmail, `Your TheTechMart invoice (${number})`, message) : null
  });
}));

// ================= ADMIN: ANALYTICS =================

app.get('/api/admin/analytics', requireAdmin, asyncRoute(async (req, res) => {
  res.json(await db.getAnalyticsSummary());
}));

// ================= ADMIN: SETTINGS =================

app.get('/api/admin/config', requireAdmin, asyncRoute(async (req, res) => {
  const cfg = await db.getConfig();
  res.json({ ...cfg, paymentProviders: payments.listProviders(cfg.paymentSettings) });
}));

app.put('/api/admin/config', requireAdmin, asyncRoute(async (req, res) => {
  res.json(await db.updateConfig(req.body));
}));

// Toggle a single payment gateway on/off (the checkbox in Admin > Settings). Turning
// one "on" without its env vars set just means it stays shown as unconfigured — see
// GET /api/admin/config's paymentProviders[].configured.
app.put('/api/admin/config/payments/:key', requireAdmin, asyncRoute(async (req, res) => {
  const { key } = req.params;
  if (!['yoco', 'payjustnow', 'happypay'].includes(key)) return res.status(400).json({ error: 'Unknown provider' });
  const cfg = await db.getConfig();
  const nextSettings = { ...cfg.paymentSettings, [key]: { enabled: !!req.body.enabled } };
  const updated = await db.updateConfig({ paymentSettings: nextSettings });
  res.json({ ...updated, paymentProviders: payments.listProviders(updated.paymentSettings) });
}));

// ================= PAGES =================
//
// Public pages are assembled on the server and cached at Vercel's edge, with the data
// they need (products, config) already embedded in the HTML as window.__BOOT__. That
// means the browser has nothing to wait for before it can draw the page: no second
// round trip to the API, no blank "Loading..." state, and repeat visitors are served
// from the edge network instead of the database.

const VIEWS_DIR = path.join(__dirname, 'views');
const rawCache = new Map();
function readView(name) {
  if (!rawCache.has(name)) rawCache.set(name, fs.readFileSync(path.join(VIEWS_DIR, name), 'utf-8'));
  return rawCache.get(name);
}

function siteBase(req) {
  return (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

function absUrl(base, u) {
  if (!u) return `${base}/img/logo.png`;
  return /^https?:\/\//i.test(u) ? u : `${base}${u.startsWith('/') ? '' : '/'}${u}`;
}

function fmtR(n) { return 'R' + String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// JSON that is safe to place inside a <script> tag.
function safeJson(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}


// ---- Customer reviews (data/reviews.json). Real reviews only; section stays hidden while the list is empty. ----
const REVIEWS = (() => { try { return require('./data/reviews.json'); } catch (e) { return { reviews: [] }; } })();
const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//i.test(u.trim()) ? u.trim() : '');
const safeImg = (u) => (typeof u === 'string' && /^\/img\/reviews\/[\w.\-]+$/.test(u) ? u : '');
const REVIEW_SOURCES = { facebook: 'Facebook', whatsapp: 'WhatsApp', google: 'Google' };
function reviewsHtml() {
  const list = (REVIEWS.reviews || []).filter((r) => REVIEW_SOURCES[r.source] && (r.text || safeImg(r.image)));
  const g = safeUrl(REVIEWS.googleUrl), fb = safeUrl(REVIEWS.facebookUrl);
  const widgetId = /^[0-9a-f-]{36}$/i.test(REVIEWS.elfsightId || '') ? REVIEWS.elfsightId : '';
  const fbReviews = safeUrl(REVIEWS.facebookReviewsUrl) || (fb ? fb.replace(/\/+$/, '') + '/reviews' : '');
  if (!list.length && !widgetId && !fbReviews) return '';
  let manual = '';
  if (list.length) {
    const present = Object.keys(REVIEW_SOURCES).filter((k) => list.some((r) => r.source === k));
    const tabs = present.length > 1
      ? '<div class="rev-tabs" role="group" aria-label="Filter reviews"><button type="button" class="rev-tab on" data-src="all">All</button>' +
        present.map((k) => `<button type="button" class="rev-tab" data-src="${k}">${REVIEW_SOURCES[k]}</button>`).join('') + '</div>'
      : '';
    const cards = list.map((r) => {
      const img = safeImg(r.image), url = safeUrl(r.url), label = REVIEW_SOURCES[r.source];
      const who = [r.name ? escapeHtml(r.name) : '', r.date ? escapeHtml(r.date) : ''].filter(Boolean).join(' \u00b7 ');
      const stars = Number(r.rating) >= 1 && Number(r.rating) <= 5 ? `<p class="rev-stars" aria-label="${Number(r.rating)} out of 5 stars">${'\u2605'.repeat(Math.round(Number(r.rating)))}</p>` : '';
      return `<figure class="rev-card" data-src="${r.source}"><span class="rev-badge rev-${r.source}">${label}</span>` + stars +
        (img ? `<a class="rev-shot" href="${img}" target="_blank" rel="noopener"><img src="${img}" alt="${escapeHtml(r.alt || 'WhatsApp conversation with a customer')}" loading="lazy"></a>` : '') +
        (r.text ? `<blockquote>${escapeHtml(r.text)}</blockquote>` : '') +
        `<figcaption>${who}${url ? `${who ? ' \u00b7 ' : ''}<a href="${url}" target="_blank" rel="noopener">View on ${label}</a>` : ''}</figcaption></figure>`;
    }).join('');
    manual = `${tabs}<div class="rev-grid">${cards}</div>`;
  }
  const widget = widgetId
    ? `<div class="rev-widget"><script src="https://elfsightcdn.com/platform.js" async></script><div class="elfsight-app-${widgetId}" data-elfsight-app-lazy></div></div>`
    : '';
  const links = g ? `<a class="btn btn-ghost" href="${g}" target="_blank" rel="noopener">See our Google reviews</a>` : '';
  // The button is always there, so the section never looks empty even if the review widget is slow or blocked.
  const cta = fbReviews
    ? `<div class="rev-cta"><p>See what our customers say about their devices, delivery and service on our Facebook page.</p><a class="btn btn-primary" href="${fbReviews}" target="_blank" rel="noopener">Read our reviews</a></div>`
    : '';
  return `<section class="section section-alt" id="reviews"><div class="wrap"><div class="section-head"><div><p class="eyebrow">Reviews</p><h2>What customers say</h2><p>Real reviews from real customers.</p></div></div>${cta}${widget}${manual}${links ? `<div class="rev-links">${links}</div>` : ''}</div></section>`;
}
function footerSocial() {
  const fb = safeUrl(REVIEWS.facebookUrl);
  return fb ? `<li><a href="${fb}" target="_blank" rel="noopener">Facebook</a></li>` : '';
}

// Fills a view template. {{KEY}} tokens are HTML-escaped; JSON-LD and boot data are inserted raw.
function renderView(name, { title, description, canonical, ogImage, ogType = 'website', noindex = false, jsonld, boot } = {}, base = '') {
  let html = readView(name)
    .replace('<!--HEADER-->', readView('partials/header.html'))
    .replace('<!--FOOTER-->', readView('partials/footer.html').replace('<!--FBLINK-->', footerSocial()))
    .replace('<!--REVIEWS-->', () => reviewsHtml())
    .replace('<!--RATED-->', () => (reviewsHtml() ? '<p class="rated"><a href="#reviews">Rated by real customers. See their reviews</a></p>' : ''))
    // Trading hours / returns / delivery text lives in ONE partial, used by the footer and the /policies page.
    .split('<!--POLICY-->').join(readView('partials/policy.html'));
  const tokens = {
    TITLE: title || 'TheTechMart | Quality-checked pre-owned electronics',
    DESCRIPTION: description || 'Quality-checked pre-owned phones and electronics with a 3-month warranty and 2-day Courier Guy delivery.',
    CANONICAL: canonical || base || '',
    OGIMAGE: ogImage || (base ? `${base}/img/logo.png` : '/img/logo.png'),
    OGTYPE: ogType
  };
  for (const [k, v] of Object.entries(tokens)) html = html.split(`{{${k}}}`).join(escapeHtml(v));
  html = html.replace('<!--ROBOTS-->', noindex ? '<meta name="robots" content="noindex">' : '');
  html = html.replace('<!--JSONLD-->', (jsonld || []).map((j) => `<script type="application/ld+json">${safeJson(j)}</script>`).join('\n'));
  html = html.replace('<!--BOOT-->', `<script>window.__BOOT__=${safeJson(boot || null)};</script>`);
  return html;
}

app.get('/sitemap.xml', asyncRoute(async (req, res) => {
  const base = siteBase(req);
  const products = await db.listProducts({ activeOnly: true });
  const staticUrls = ['', '/sell', '/meetup', '/policies', '/photo-credits'];
  const urls = [
    ...staticUrls.map((p) => `<url><loc>${base}${p}</loc><changefreq>daily</changefreq></url>`),
    ...products.map((p) => `<url><loc>${base}/product?id=${p.id}</loc><changefreq>weekly</changefreq></url>`)
  ];
  edgeCache(res, 300, 3600);
  res.set('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`);
}));

// Homepage: the whole live catalogue is embedded so shop, categories and the October
// deals draw instantly with no extra requests.
app.get('/', asyncRoute(async (req, res) => {
  const base = siteBase(req);
  let boot = null;
  try {
    const [products, cfg] = await Promise.all([db.listProducts({ activeOnly: true }), db.getConfig()]);
    boot = {
      cfg: publicConfig(cfg),
      products: products.map(cardProduct),
      dealIds: deals.pickDeals(products).map((p) => p.id)
    };
  } catch (err) {
    // Database hiccup: still serve the page; the browser falls back to /api/products.
    console.error('[home] boot data unavailable:', err.message);
  }
  if (boot) edgeCache(res, 30, 600);
  res.send(renderView('index.html', {
    title: 'TheTechMart | Quality-checked phones & tech, 3-month warranty, 2-day delivery',
    description: 'Shop Grade A-B pre-owned phones, laptops and consoles with a 3-month warranty and 2-day Courier Guy delivery. Make an offer, trade in your device, or earn R300 per referral.',
    canonical: `${base}/`,
    jsonld: [
      {
        '@context': 'https://schema.org', '@type': 'ElectronicsStore', name: 'TheTechMart', url: `${base}/`,
        description: 'Quality-checked pre-owned electronics. Online, courier nationwide, and meetups by appointment.', image: `${base}/img/logo.png`,
        telephone: '+27716623565', areaServed: 'ZA', sameAs: ['https://instagram.com/the_tech_mart']
      },
      {
        '@context': 'https://schema.org', '@type': 'FAQPage',
        mainEntity: [
          ['What warranty do I get?', 'Standard-price devices come with a 3-month repair or replacement warranty. Negotiated devices (special-price devices) come with a 21-day replacement warranty.'],
          ['What condition are the devices in?', 'Our devices are Grade A-B pre-owned and quality checked.'],
          ['How long does delivery take?', 'The Courier Guy delivery: flat R100, about 2 days.'],
          ['Can I make an offer on a price?', 'Yes. Use "Make an offer" on any device and we reply on WhatsApp.'],
          ['How do I pay?', 'Pay by Yoco (card) or EFT. Cash is accepted on collection at a meetup or pickup only, never for courier delivery.'],
          ['What if there is a problem with my device?', 'WhatsApp us on 071 662 3565 with a photo or video showing the problem. We send a reference number and an estimated resolution. Most issues are resolved within about 7 days. This does not limit your statutory consumer rights.'],
          ['Do you buy or trade in devices?', 'Yes. Send us the details and photos of your device through the Sell / Trade-in form and we reply on WhatsApp.']
        ].map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }))
      }
    ],
    boot
  }, base));
}));

// Product page: this device (and a few similar ones) are embedded in the HTML, plus
// share-link tags and Product structured data for Google.
app.get('/product', asyncRoute(async (req, res) => {
  const id = req.query.id;
  const base = siteBase(req);
  let product = null;
  let similar = [];
  let cfg = null;
  try {
    const [p, all, c] = await Promise.all([
      id ? db.getProduct(id).catch(() => null) : null,
      db.listProducts({ activeOnly: true }),
      db.getConfig()
    ]);
    product = p;
    cfg = c;
    if (product) {
      similar = all
        .filter((x) => x.id !== product.id && x.category === product.category)
        .sort((a, b) => Math.abs(a.price - product.price) - Math.abs(b.price - product.price))
        .slice(0, 4).map(cardProduct);
    }
  } catch (err) {
    console.error('[product] boot data unavailable:', err.message);
  }

  if (!product) {
    // Unknown id, or a database hiccup: let the browser try the API before giving up.
    return res.status(id && cfg ? 404 : 200).send(renderView('product.html', {
      title: 'Device | TheTechMart', canonical: `${base}/product`, noindex: true, boot: { product: null, id: id || null, cfg: cfg ? publicConfig(cfg) : null }
    }, base));
  }

  const pub = publicProduct(product);
  const name = `${product.brand} ${product.model}`;
  const preOrder = product.stock < 1;
  const url = `${base}/product?id=${product.id}`;
  const image = absUrl(base, pub.imageUrl);
  const description = `${name}${product.storage ? ' ' + product.storage : ''}, ${product.condition}, ${fmtR(product.price)}. ${pub.deal ? '21-day replacement warranty (negotiated device)' : '3-month repair or replacement warranty'}, delivery R100 flat (The Courier Guy, about 2 days). Buy now or make an offer.`;

  edgeCache(res, 30, 600);
  res.send(renderView('product.html', {
    title: `${name}${product.storage ? ' ' + product.storage : ''} ${fmtR(product.price)} | TheTechMart`,
    description, canonical: url, ogImage: image, ogType: 'product',
    jsonld: [
      {
        '@context': 'https://schema.org', '@type': 'Product', name, sku: product.id,
        brand: { '@type': 'Brand', name: product.brand }, category: product.category,
        image: [image], description,
        itemCondition: product.condition === 'New' ? 'https://schema.org/NewCondition' : 'https://schema.org/UsedCondition',
        offers: {
          '@type': 'Offer', url, priceCurrency: 'ZAR', price: String(product.price),
          availability: preOrder ? 'https://schema.org/PreOrder' : 'https://schema.org/InStock',
          itemCondition: product.condition === 'New' ? 'https://schema.org/NewCondition' : 'https://schema.org/UsedCondition',
          seller: { '@type': 'Organization', name: 'TheTechMart' }
        }
      },
      {
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Shop', item: `${base}/` },
          { '@type': 'ListItem', position: 2, name: product.category, item: `${base}/?category=${encodeURIComponent(product.category)}` },
          { '@type': 'ListItem', position: 3, name, item: url }
        ]
      }
    ],
    boot: { product: pub, similar, cfg: publicConfig(cfg) }
  }, base));
}));

// Checkout: the device and the payment options are embedded, so the form appears
// immediately (the old checkout fetched them after load and showed an empty page
// until the server answered).
app.get('/checkout', asyncRoute(async (req, res) => {
  const id = req.query.id;
  const base = siteBase(req);
  let boot = { product: null, id: id || null, cfg: null, providers: [] };
  try {
    const [product, cfg] = await Promise.all([id ? db.getProduct(id).catch(() => null) : null, db.getConfig()]);
    boot = {
      product: product ? publicProduct(product) : null, id: id || null, cfg: publicConfig(cfg),
      providers: payments.listProviders(cfg.paymentSettings).map(({ key, label, description, live }) => ({ key, label, description, live }))
    };
    if (product) edgeCache(res, 20, 120);
  } catch (err) {
    console.error('[checkout] boot data unavailable:', err.message);
  }
  res.send(renderView('checkout.html', { title: 'Checkout | TheTechMart', canonical: `${base}/checkout`, noindex: true, boot }, base));
}));

app.get('/checkout/complete', (req, res) => {
  edgeCache(res, 300, 86400);
  res.send(renderView('checkout-complete.html', { title: 'Order status | TheTechMart', noindex: true }, siteBase(req)));
});

app.get('/policies', (req, res) => {
  const base = siteBase(req);
  edgeCache(res, 300, 86400);
  res.send(renderView('policies.html', {
    title: 'Returns, warranty, delivery and payment | TheTechMart',
    description: 'Trading hours, warranty and returns, Courier Guy delivery (flat R100, about 2 days) and payment options at TheTechMart.',
    canonical: `${base}/policies`
  }, base));
});


// Photo credits: Icecat notice plus the photographer, licence and link for each Wikimedia Commons photo in use.
function photoCreditsHtml() {
  const e = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const groups = new Map();
  for (const [slug, ph] of Object.entries(PRODUCT_PHOTOS)) {
    if (ph.kind !== 'commons' || !ph.credit) continue;
    const key = ph.credit.page;
    if (!groups.has(key)) groups.set(key, { c: ph.credit, slugs: [] });
    groups.get(key).slugs.push(slug);
  }
  const rows = [...groups.values()].sort((a, b) => a.c.title.localeCompare(b.c.title)).map(({ c, slugs }) =>
    `<li><strong>${e(c.title)}</strong> by ${e(c.author)}, <a href="${e(c.licence_url || c.page)}" target="_blank" rel="noopener">${e(c.licence)}</a>` +
    ` (<a href="${e(c.page)}" target="_blank" rel="noopener">source on Wikimedia Commons</a>)${c.note ? '. ' + e(c.note) : ''}` +
    `<br><span class="muted">Used for: ${slugs.map((x) => e(x.replace(/-/g, ' '))).join('; ')}</span></li>`).join('');
  return `<h2>Indicative images</h2>
<p>Where we do not yet have a photo of the exact device, the picture shown is an indicative image of the same model. Colour, storage size and condition of the unit you receive can differ. WhatsApp us on 071 662 3565 for photos of the actual device.</p>
<h2>Icecat product images</h2>
<p>${e(ICECAT_NOTICE.replace('(https://iceclog.com/open-content-license/)', '').replace('License ,', 'License,'))}
 Licence: <a href="https://iceclog.com/open-content-license/" target="_blank" rel="noopener">Icecat Open Content License</a>. These images are shown as supplied by Icecat and are not used for AI or machine learning.</p>
<h2>Wikimedia Commons photos</h2>
${rows ? `<ul class="credit-list">${rows}</ul>` : '<p>No Wikimedia Commons photos are in use at the moment.</p>'}
<h2>Other images</h2>
<p>Remaining device pictures are royalty-free stock images that do not require a credit.</p>`;
}

app.get('/photo-credits', (req, res) => {
  const base = siteBase(req);
  edgeCache(res, 300, 86400);
  res.send(renderView('photo-credits.html', {
    title: 'Photo credits | TheTechMart',
    description: 'Credits and licences for the product photos used on TheTechMart.',
    canonical: `${base}/photo-credits`
  }, base).replace('<!--CREDITS-->', () => photoCreditsHtml()));
});

app.get('/meetup', asyncRoute(async (req, res) => {
  const base = siteBase(req);
  let boot = null;
  try {
    const [list, cfg] = await Promise.all([db.listProducts({ activeOnly: true }), db.getConfig()]);
    boot = {
      cfg: publicConfig(cfg), id: String(req.query.id || ''),
      products: list.map((p) => ({ id: p.id, brand: p.brand, model: p.model, storage: p.storage, color: p.color, price: p.price, stock: p.stock, sold: p.sold }))
        .sort((a, b) => (`${a.brand} ${a.model}`).localeCompare(`${b.brand} ${b.model}`))
    };
  } catch (err) { console.error('[meetup] data unavailable:', err.message); }
  if (boot) edgeCache(res, 30, 600);
  res.send(renderView('meetup.html', {
    title: 'Book a meetup | TheTechMart',
    description: "Book a meetup to collect your device from our sales agent. Meetups need 2 days' notice.",
    canonical: `${base}/meetup`, boot
  }, base));
}));

app.get('/sell', asyncRoute(async (req, res) => {
  const base = siteBase(req);
  let boot = null;
  try { boot = { cfg: publicConfig(await db.getConfig()) }; } catch (err) { console.error('[sell] config unavailable:', err.message); }
  if (boot) edgeCache(res, 60, 3600);
  res.send(renderView('sell.html', {
    title: 'Sell or trade in your device | TheTechMart',
    description: 'Sell your phone or trade it in at TheTechMart. Tell us about your device, add photos, and we reply on WhatsApp with an offer.',
    canonical: `${base}/sell`, boot
  }, base));
}));

// Downloadable price list, generated from the live catalogue so it always matches the site.
app.get('/price-list.pdf', asyncRoute(async (req, res) => {
  const [products, cfg] = await Promise.all([db.listProducts({ activeOnly: true }), db.getConfig()]);
  const pdf = await generatePriceListPdf({
    products, cfg: { ...cfg, whatsappDisplay: waDisplay(cfg.whatsappNumber) }, isDeal: deals.isDeal
  });
  edgeCache(res, 300, 3600);
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'attachment; filename="TheTechMart-Price-List.pdf"',
    'Content-Length': pdf.length
  });
  res.send(pdf);
}));

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'views/admin/login.html')));
app.get('/admin/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'views/admin/dashboard.html')));

// Upload errors (file too big, too many files) come back as clear JSON instead of a server error page.
app.use((err, req, res, next) => {
  if (err && String(err.code || '').startsWith('LIMIT_')) {
    const admin = req.path.startsWith('/api/admin/products');
    return res.status(413).json({ error: admin ? TOO_BIG : 'That file is too large. Please use a smaller photo.' });
  }
  return next(err);
});

// Anything else: a friendly page instead of Express's bare "Cannot GET".
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).send(renderView('404.html', { title: 'Page not found | TheTechMart', noindex: true }, siteBase(req)));
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`TheTechMart running at http://localhost:${PORT}`));
}

module.exports = app;
