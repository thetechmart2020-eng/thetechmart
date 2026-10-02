require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { uploadBuffer } = require('./lib/storage');
const { setAdminCookie, clearAdminCookie, isAdminRequest } = require('./lib/auth');
const payments = require('./lib/payments');
const { generateQuotePdf, generateInvoicePdf, generatePriceListPdf } = require('./lib/documents');
const deals = require('./lib/deals');

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
const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const tradeinUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const bulkImageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 60 } });

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

// Public shape of a product (adds the "special offer" flag used for the 21-day warranty badge).
function publicProduct(p) {
  return { ...p, deal: deals.isDeal(p) };
}

// Only what the browser needs to draw a product card (keeps the page payload small).
function cardProduct(p) {
  return {
    id: p.id, brand: p.brand, model: p.model, category: p.category, price: p.price, condition: p.condition,
    storage: p.storage, color: p.color, stock: p.stock, imageUrl: p.imageUrl || null, deal: deals.isDeal(p)
  };
}

function publicConfig(cfg) {
  return {
    storeName: cfg.storeName, whatsapp: cfg.whatsappNumber, whatsappDisplay: waDisplay(cfg.whatsappNumber),
    email: cfg.contactEmail
  };
}

// ---------- Bulk photo matching (filename → product) ----------
// Turns "Apple iPhone 13 128GB Blue" into "apple-iphone-13-128gb-blue" so a
// product and a photo filename can be compared the same way regardless of
// spacing/casing/punctuation.
function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
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

app.post('/api/offers', asyncRoute(async (req, res) => {
  const { productId, amount, name, phone, email, message } = req.body;
  const product = await db.getProduct(productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  if (!amount || !name || !phone) return res.status(400).json({ error: 'Missing required fields' });

  const offer = await db.addOffer({
    productId, productName: `${product.brand} ${product.model}`, listPrice: product.price,
    amount: Number(amount), name, phone, email: email || '', message: message || ''
  });
  await db.logEvent({ type: 'offer_submitted', productId }).catch(() => {});

  const cfg = await db.getConfig();
  const waMessage = `Hi TheTechMart! I'd like to make an offer.\n\nDevice: ${offer.productName}\nList price: R${offer.listPrice}\nMy offer: R${offer.amount}\nName: ${name}\nContact: ${phone}\n${message ? 'Note: ' + message : ''}\n\n(Offer ref: ${offer.id.slice(0, 8)})`;

  res.json({
    offer,
    whatsappUrl: waLink(cfg.whatsappNumber, waMessage),
    mailtoUrl: mailtoLink(cfg.contactEmail, `Offer on ${offer.productName} (ref ${offer.id.slice(0, 8)})`, waMessage)
  });
}));

app.post('/api/tradeins', tradeinUpload.array('photos', 6), asyncRoute(async (req, res) => {
  const { brand, model, storage, condition, askingPrice, name, phone, notes, type } = req.body;
  if (!brand || !model || !name || !phone) return res.status(400).json({ error: 'Missing required fields' });

  const photos = [];
  for (const file of req.files || []) {
    photos.push(await uploadBuffer('tradein-photos', file));
  }

  const submission = await db.addTradein({
    type: type === 'trade' ? 'trade' : 'sell', brand, model, storage: storage || '', condition: condition || '',
    askingPrice: askingPrice ? Number(askingPrice) : null, name, phone, notes: notes || '', photos
  });
  await db.logEvent({ type: 'tradein_submitted' }).catch(() => {});

  const cfg = await db.getConfig();
  const waMessage = `Hi TheTechMart! I'd like to ${submission.type === 'trade' ? 'trade in' : 'sell'} a device.\n\nDevice: ${brand} ${model}\nStorage: ${storage || 'N/A'}\nCondition: ${condition || 'N/A'}\n${askingPrice ? 'Asking price: R' + askingPrice : ''}\nName: ${name}\nContact: ${phone}\n${notes ? 'Notes: ' + notes : ''}\n\n(Ref: ${submission.id.slice(0, 8)})`;

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
  const { productId, name, email, phone, address, fulfillmentMethod, paymentMethod, paymentPreference, notes } = req.body;
  if (!name || !phone || !email) return res.status(400).json({ error: 'Name, email and phone are required' });

  const product = await db.getProduct(productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  if (!product.active) return res.status(400).json({ error: 'This device is no longer available' });

  // We source from a supplier network, so running out of on-hand units doesn't
  // mean we can't fulfil the order — it just means this one becomes a
  // pre-order instead of an immediate dispatch. We still take one unit off
  // stock (floor 0) so the listing shows "Pre-order" once depleted, but we
  // never block the purchase outright.
  const isPreOrder = product.stock < 1;

  const method = fulfillmentMethod === 'collection' ? 'collection' : 'delivery';
  if (method === 'delivery') {
    if (!address || !address.line1 || !address.city || !address.postalCode) {
      return res.status(400).json({ error: 'Delivery address (address, city, postal code) is required for Courier Guy delivery' });
    }
  }

  const cfg = await db.getConfig();
  const wantsGateway = ['yoco', 'payjustnow', 'happypay'].includes(paymentMethod);

  const order = await db.addOrder({
    type: 'sale', source: 'checkout', productId: product.id,
    customerName: name, customerPhone: phone, customerEmail: email,
    deliveryAddress: method === 'delivery' ? address : {}, fulfillmentMethod: method,
    courier: 'Courier Guy', paymentMethod: wantsGateway ? paymentMethod : 'manual',
    paymentStatus: 'pending', amount: product.price,
    notes: (isPreOrder ? '[PRE-ORDER — source from supplier before dispatch] ' : '')
      + (['card', 'eft', 'cash'].includes(paymentPreference) ? `[Payment preference: ${paymentPreference.toUpperCase()}] ` : '')
      + (notes || '')
  });
  await db.logEvent({ type: 'order_completed', productId: product.id }).catch(() => {});

  // Reserve a unit against this listing (floor 0) so the storefront reflects
  // it immediately — same "one unit off stock" rule as accepting an offer.
  await db.updateProduct(product.id, { stock: Math.max(0, (product.stock || 0) - 1) });

  const addressLine = method === 'delivery'
    ? `${address.line1}${address.line2 ? ', ' + address.line2 : ''}, ${address.city}, ${address.postalCode}${address.province ? ', ' + address.province : ''}`
    : 'Collection (arranged on WhatsApp)';

  if (wantsGateway) {
    try {
      const result = await payments.createCheckout(paymentMethod, order, cfg.paymentSettings);
      await db.updateOrder(order.id, { paymentRef: result.providerRef || '' });
      return res.json({ order, redirectUrl: result.redirectUrl, preOrder: isPreOrder });
    } catch (err) {
      // Gateway not actually live yet (or the call failed) — fall back to the
      // manual handoff rather than dead-ending the customer.
      console.warn(`[checkout] ${paymentMethod} unavailable, falling back to manual: ${err.message}`);
    }
  }

  const prefLabel = { card: 'Card', eft: 'EFT / bank transfer', cash: 'Cash on collection' }[paymentPreference] || '';
  const summary = `Hi TheTechMart! I'd like to buy this device.\n\nDevice: ${product.brand} ${product.model}${product.storage ? ' · ' + product.storage : ''}\nPrice: R${product.price}\nName: ${name}\nEmail: ${email}\nContact: ${phone}\nFulfillment: ${method === 'delivery' ? 'Courier Guy delivery to ' + addressLine : 'Collection (arranged on WhatsApp)'}\n${prefLabel ? 'Payment: ' + prefLabel + '\n' : ''}${isPreOrder ? 'Pre-order: yes\n' : ''}${notes ? 'Notes: ' + notes : ''}\n\n(Order ref: ${order.id.slice(0, 8)})`;

  res.json({
    order,
    preOrder: isPreOrder,
    whatsappUrl: waLink(cfg.whatsappNumber, summary),
    mailtoUrl: mailtoLink(cfg.contactEmail, `Order: ${product.brand} ${product.model} (ref ${order.id.slice(0, 8)})`, summary)
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

// Single-product photo upload (from the "Photo" button in Stock). Adds to that
// product's gallery, and sets it as the cover shot only if there isn't one yet.
app.post('/api/admin/products/:id/image', requireAdmin, imageUpload.single('image'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  const existing = await db.getProduct(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const url = await uploadBuffer('product-images', req.file);
  const images = [...(existing.images || []), url];
  const patch = { images };
  if (!existing.imageUrl) patch.imageUrl = url;
  const p = await db.updateProduct(req.params.id, patch);
  res.json(p);
}));

// Removes one photo from a product's gallery. If it was the cover shot, the
// next remaining photo (if any) becomes the new cover.
app.delete('/api/admin/products/:id/image', requireAdmin, asyncRoute(async (req, res) => {
  const { url } = req.body;
  const existing = await db.getProduct(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const images = (existing.images || []).filter((u) => u !== url);
  const patch = { images };
  if (existing.imageUrl === url) patch.imageUrl = images[0] || null;
  const p = await db.updateProduct(req.params.id, patch);
  res.json(p);
}));

// Bulk photo upload: drop in a folder of files named like
// "apple-iphone-13-128gb-blue.jpg" (spacing/casing/punctuation don't matter)
// and each one gets matched to the right product by brand+model(+storage+color)
// and added to its gallery — no per-SKU clicking through the admin panel.
app.post('/api/admin/products/bulk-images', requireAdmin, bulkImageUpload.array('images', 60), asyncRoute(async (req, res) => {
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'No images uploaded' });
  const products = await db.listProducts();

  const results = [];
  for (const file of req.files) {
    const { product, ambiguous } = matchFilenameToProduct(file.originalname, products);
    if (!product) {
      results.push({
        filename: file.originalname, matched: false,
        reason: ambiguous ? `Matches multiple products (${ambiguous.join(', ')}) — rename more specifically` : 'No matching product found'
      });
      continue;
    }
    try {
      const url = await uploadBuffer('product-images', file);
      const current = await db.getProduct(product.id);
      const images = [...(current.images || []), url];
      const patch = { images };
      if (!current.imageUrl) patch.imageUrl = url;
      await db.updateProduct(product.id, patch);
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

function orderAddressLine(order) {
  const a = order.deliveryAddress || {};
  if (order.fulfillmentMethod === 'collection' || !a.line1) return null;
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
    items: [{ label: product ? `${product.brand} ${product.model}` : (order.notes || 'Device'), amount: order.amount }],
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
    items: [{ label: product ? `${product.brand} ${product.model}` : (order.notes || 'Device'), amount: order.amount }],
    paymentStatus: order.paymentStatus, paymentMethod: order.paymentMethod,
    fulfillment: order.fulfillmentMethod === 'collection' ? 'Collection' : `${order.courier || 'Courier Guy'} delivery${addressLine ? ' — ' + addressLine : ''}`,
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

// Fills a view template. {{KEY}} tokens are HTML-escaped; JSON-LD and boot data are inserted raw.
function renderView(name, { title, description, canonical, ogImage, ogType = 'website', noindex = false, jsonld, boot } = {}, base = '') {
  let html = readView(name)
    .replace('<!--HEADER-->', readView('partials/header.html'))
    .replace('<!--FOOTER-->', readView('partials/footer.html'));
  const tokens = {
    TITLE: title || 'TheTechMart | the #1 electronics market',
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
  const staticUrls = ['', '/sell'];
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
        description: 'the #1 electronics market', image: `${base}/img/logo.png`,
        telephone: '+27716623565', areaServed: 'ZA', sameAs: ['https://instagram.com/the_tech_mart']
      },
      {
        '@context': 'https://schema.org', '@type': 'FAQPage',
        mainEntity: [
          ['What warranty do I get?', 'Every device comes with a 3-month warranty. Special offers carry a 21-day warranty.'],
          ['What condition are the devices in?', 'Our devices are Grade A-B pre-owned and quality checked.'],
          ['How long does delivery take?', 'Delivery takes 2 days via The Courier Guy.'],
          ['Can I make an offer on a price?', 'Yes. Use "Make an offer" on any device and we reply on WhatsApp.'],
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
  const image = absUrl(base, product.imageUrl);
  const description = `${name}${product.storage ? ' ' + product.storage : ''}, ${product.condition}, ${fmtR(product.price)}. ${pub.deal ? '21-day warranty (special offer)' : '3-month warranty'}, 2-day Courier Guy delivery. Buy now or make an offer.`;

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

// Anything else: a friendly page instead of Express's bare "Cannot GET".
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).send(renderView('404.html', { title: 'Page not found | TheTechMart', noindex: true }, siteBase(req)));
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`TheTechMart running at http://localhost:${PORT}`));
}

module.exports = app;
