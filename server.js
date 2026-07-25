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

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Uploads (memory — files go straight to Supabase Storage, never to disk) ----------
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });
const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const tradeinUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// ---------- Helpers ----------
function requireAdmin(req, res, next) {
  if (isAdminRequest(req)) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

function waLink(number, message) {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
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
  res.json({ storeName: cfg.storeName });
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
  res.json(list);
}));

app.get('/api/products/:id', asyncRoute(async (req, res) => {
  const p = await db.getProduct(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
}));

app.post('/api/track', asyncRoute(async (req, res) => {
  const { type, path: p, productId } = req.body;
  const allowed = ['page_view', 'product_view', 'offer_submitted', 'tradein_submitted'];
  if (!allowed.includes(type)) return res.status(400).json({ error: 'Invalid event type' });
  await db.logEvent({ type, path: p, productId });
  res.json({ ok: true });
}));

app.post('/api/offers', asyncRoute(async (req, res) => {
  const { productId, amount, name, phone, message } = req.body;
  const product = await db.getProduct(productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  if (!amount || !name || !phone) return res.status(400).json({ error: 'Missing required fields' });

  const offer = await db.addOffer({
    productId, productName: `${product.brand} ${product.model}`, listPrice: product.price,
    amount: Number(amount), name, phone, message: message || ''
  });
  await db.logEvent({ type: 'offer_submitted', productId }).catch(() => {});

  const cfg = await db.getConfig();
  const waMessage = `Hi TheTechMart! I'd like to make an offer.\n\nDevice: ${offer.productName}\nList price: R${offer.listPrice}\nMy offer: R${offer.amount}\nName: ${name}\nContact: ${phone}\n${message ? 'Note: ' + message : ''}\n\n(Offer ref: ${offer.id.slice(0, 8)})`;

  res.json({ offer, whatsappUrl: waLink(cfg.whatsappNumber, waMessage) });
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

  res.json({ submission, whatsappUrl: waLink(cfg.whatsappNumber, waMessage) });
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

app.post('/api/admin/products/:id/image', requireAdmin, imageUpload.single('image'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  const imageUrl = await uploadBuffer('product-images', req.file);
  const p = await db.updateProduct(req.params.id, { imageUrl });
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
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

// ================= ADMIN: ANALYTICS =================

app.get('/api/admin/analytics', requireAdmin, asyncRoute(async (req, res) => {
  res.json(await db.getAnalyticsSummary());
}));

// ================= ADMIN: SETTINGS =================

app.get('/api/admin/config', requireAdmin, asyncRoute(async (req, res) => {
  res.json(await db.getConfig());
}));

app.put('/api/admin/config', requireAdmin, asyncRoute(async (req, res) => {
  res.json(await db.updateConfig(req.body));
}));

// ================= PAGES =================

app.get('/sitemap.xml', asyncRoute(async (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const products = await db.listProducts({ activeOnly: true });
  const staticUrls = ['', '/sell'];
  const urls = [
    ...staticUrls.map((p) => `<url><loc>${base}${p}</loc><changefreq>daily</changefreq></url>`),
    ...products.map((p) => `<url><loc>${base}/product?id=${p.id}</loc><changefreq>weekly</changefreq></url>`)
  ];
  res.set('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`);
}));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views/index.html')));

// Server-rendered so shared links (WhatsApp, Facebook, Google) show the right
// device name/price/photo instead of generic "TheTechMart" text for every link.
app.get('/product', asyncRoute(async (req, res) => {
  const id = req.query.id;
  const template = fs.readFileSync(path.join(__dirname, 'views/product.html'), 'utf-8');
  const product = id ? await db.getProduct(id).catch(() => null) : null;

  const title = product ? `${product.brand} ${product.model} — ${fmtR(product.price)} | TheTechMart` : 'Device — TheTechMart';
  const description = product
    ? `${product.brand} ${product.model}${product.storage ? ' · ' + product.storage : ''} — ${product.condition}, listed at ${fmtR(product.price)} and negotiable. Message us on WhatsApp to make an offer.`
    : 'Browse negotiable phone deals at TheTechMart.';
  const image = product && product.imageUrl ? `${req.protocol}://${req.get('host')}${product.imageUrl}` : `${req.protocol}://${req.get('host')}/img/logo.png`;
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

  const html = template
    .replace('<title>Device — TheTechMart</title>', `<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:type" content="product">
<meta name="twitter:card" content="summary_large_image">`);

  res.send(html);
}));

function fmtR(n) { return 'R' + Number(n).toLocaleString('en-ZA'); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

app.get('/sell', (req, res) => res.sendFile(path.join(__dirname, 'views/sell.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'views/admin/login.html')));
app.get('/admin/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'views/admin/dashboard.html')));

if (require.main === module) {
  app.listen(PORT, () => console.log(`TheTechMart running at http://localhost:${PORT}`));
}

module.exports = app;
