const express = require('express');
const session = require('express-session');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { v4: uuid } = require('uuid');
const path = require('path');
const fs = require('fs');
const { readDB, writeDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'thetechmart-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Uploads ----------
const csvUpload = multer({ dest: path.join(__dirname, 'data', 'tmp') });
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public/uploads/images')),
  filename: (req, file, cb) => cb(null, uuid() + path.extname(file.originalname))
});
const imageUpload = multer({ storage: imageStorage });

const tradeinStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public/uploads/tradeins')),
  filename: (req, file, cb) => cb(null, uuid() + path.extname(file.originalname))
});
const tradeinUpload = multer({ storage: tradeinStorage });

// ---------- Helpers ----------
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

function waLink(number, message) {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

function publicProduct(p) {
  return p; // all fields are safe to expose
}

// ================= PUBLIC API =================

app.get('/api/config', (req, res) => {
  const db = readDB();
  res.json({ storeName: db.config.storeName });
});

app.get('/api/products', (req, res) => {
  const db = readDB();
  let list = db.products.filter(p => p.active !== false);
  const { q, brand, condition, minPrice, maxPrice, sort } = req.query;
  if (q) {
    const s = q.toLowerCase();
    list = list.filter(p => (p.model + ' ' + p.brand).toLowerCase().includes(s));
  }
  if (brand) list = list.filter(p => p.brand.toLowerCase() === brand.toLowerCase());
  if (condition) list = list.filter(p => p.condition.toLowerCase() === condition.toLowerCase());
  if (minPrice) list = list.filter(p => p.price >= Number(minPrice));
  if (maxPrice) list = list.filter(p => p.price <= Number(maxPrice));
  if (sort === 'price_asc') list = [...list].sort((a, b) => a.price - b.price);
  if (sort === 'price_desc') list = [...list].sort((a, b) => b.price - a.price);
  if (sort === 'newest') list = [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(list.map(publicProduct));
});

app.get('/api/products/:id', (req, res) => {
  const db = readDB();
  const p = db.products.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
});

// Submit an offer / negotiation on a product
app.post('/api/offers', (req, res) => {
  const { productId, amount, name, phone, message } = req.body;
  const db = readDB();
  const product = db.products.find(p => p.id === productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  if (!amount || !name || !phone) return res.status(400).json({ error: 'Missing required fields' });

  const offer = {
    id: uuid(),
    productId,
    productName: `${product.brand} ${product.model}`,
    listPrice: product.price,
    amount: Number(amount),
    name, phone,
    message: message || '',
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  db.offers.push(offer);
  writeDB(db);

  const waMessage = `Hi TheTechMart! I'd like to make an offer.\n\nDevice: ${offer.productName}\nList price: R${offer.listPrice}\nMy offer: R${offer.amount}\nName: ${name}\nContact: ${phone}\n${message ? 'Note: ' + message : ''}\n\n(Offer ref: ${offer.id.slice(0, 8)})`;

  res.json({ offer, whatsappUrl: waLink(db.config.whatsappNumber, waMessage) });
});

// Submit a device for sale / trade-in
app.post('/api/tradeins', tradeinUpload.array('photos', 6), (req, res) => {
  const { brand, model, storage, condition, askingPrice, name, phone, notes, type } = req.body;
  if (!brand || !model || !name || !phone) return res.status(400).json({ error: 'Missing required fields' });

  const db = readDB();
  const photos = (req.files || []).map(f => `/uploads/tradeins/${f.filename}`);
  const submission = {
    id: uuid(),
    type: type === 'trade' ? 'trade' : 'sell', // 'sell' = cash sale to store, 'trade' = trade toward another device
    brand, model, storage: storage || '', condition: condition || '',
    askingPrice: askingPrice ? Number(askingPrice) : null,
    name, phone, notes: notes || '',
    photos,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  db.tradeins.push(submission);
  writeDB(db);

  const waMessage = `Hi TheTechMart! I'd like to ${submission.type === 'trade' ? 'trade in' : 'sell'} a device.\n\nDevice: ${brand} ${model}\nStorage: ${storage || 'N/A'}\nCondition: ${condition || 'N/A'}\n${askingPrice ? 'Asking price: R' + askingPrice : ''}\nName: ${name}\nContact: ${phone}\n${notes ? 'Notes: ' + notes : ''}\n\n(Ref: ${submission.id.slice(0, 8)})`;

  res.json({ submission, whatsappUrl: waLink(db.config.whatsappNumber, waMessage) });
});

// ================= ADMIN AUTH =================

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const db = readDB();
  if (password === db.config.adminPassword) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Incorrect password' });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin/session', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

// ================= ADMIN: PRODUCTS =================

app.get('/api/admin/products', requireAdmin, (req, res) => {
  const db = readDB();
  res.json(db.products);
});

// Upload price list CSV. Expected columns:
// brand,model,price,condition,storage,color,stock,imageUrl(optional)
app.post('/api/admin/upload-csv', requireAdmin, csvUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const content = fs.readFileSync(req.file.path, 'utf-8');
  fs.unlinkSync(req.file.path);

  let records;
  try {
    records = parse(content, { columns: true, skip_empty_lines: true, trim: true });
  } catch (e) {
    return res.status(400).json({ error: 'Could not parse CSV: ' + e.message });
  }

  const db = readDB();
  let added = 0, updated = 0;

  for (const row of records) {
    if (!row.brand || !row.model || !row.price) continue;
    const price = Number(String(row.price).replace(/[^0-9.]/g, ''));
    if (Number.isNaN(price)) continue;

    // Match existing product by brand+model+storage+condition to update, else create new
    const key = `${row.brand}|${row.model}|${row.storage || ''}|${row.condition || ''}`.toLowerCase();
    let product = db.products.find(p =>
      `${p.brand}|${p.model}|${p.storage}|${p.condition}`.toLowerCase() === key
    );

    const data = {
      brand: row.brand.trim(),
      model: row.model.trim(),
      price,
      condition: row.condition ? row.condition.trim() : 'New',
      storage: row.storage ? row.storage.trim() : '',
      color: row.color ? row.color.trim() : '',
      stock: row.stock ? Number(row.stock) : 1,
      imageUrl: row.imageUrl ? row.imageUrl.trim() : (product ? product.imageUrl : ''),
      active: true
    };

    if (product) {
      Object.assign(product, data);
      updated++;
    } else {
      db.products.push({
        id: uuid(),
        ...data,
        createdAt: new Date().toISOString()
      });
      added++;
    }
  }

  writeDB(db);
  res.json({ ok: true, added, updated, total: records.length });
});

app.put('/api/admin/products/:id', requireAdmin, (req, res) => {
  const db = readDB();
  const p = db.products.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  Object.assign(p, req.body);
  writeDB(db);
  res.json(p);
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  const db = readDB();
  db.products = db.products.filter(x => x.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

app.post('/api/admin/products/:id/image', requireAdmin, imageUpload.single('image'), (req, res) => {
  const db = readDB();
  const p = db.products.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  p.imageUrl = `/uploads/images/${req.file.filename}`;
  writeDB(db);
  res.json(p);
});

// ================= ADMIN: OFFERS =================

app.get('/api/admin/offers', requireAdmin, (req, res) => {
  const db = readDB();
  res.json(db.offers.slice().reverse());
});

app.post('/api/admin/offers/:id/:action', requireAdmin, (req, res) => {
  const { id, action } = req.params;
  if (!['accept', 'reject'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
  const db = readDB();
  const offer = db.offers.find(o => o.id === id);
  if (!offer) return res.status(404).json({ error: 'Not found' });
  offer.status = action === 'accept' ? 'accepted' : 'rejected';
  writeDB(db);
  res.json(offer);
});

// ================= ADMIN: TRADE-INS =================

app.get('/api/admin/tradeins', requireAdmin, (req, res) => {
  const db = readDB();
  res.json(db.tradeins.slice().reverse());
});

app.post('/api/admin/tradeins/:id/:action', requireAdmin, (req, res) => {
  const { id, action } = req.params;
  if (!['accept', 'reject'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
  const db = readDB();
  const t = db.tradeins.find(x => x.id === id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  t.status = action === 'accept' ? 'accepted' : 'rejected';
  writeDB(db);
  res.json(t);
});

// ================= ADMIN: SETTINGS =================

app.get('/api/admin/config', requireAdmin, (req, res) => {
  const db = readDB();
  res.json(db.config);
});

app.put('/api/admin/config', requireAdmin, (req, res) => {
  const db = readDB();
  Object.assign(db.config, req.body);
  writeDB(db);
  res.json(db.config);
});

// ================= PAGES =================

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views/index.html')));
app.get('/product', (req, res) => res.sendFile(path.join(__dirname, 'views/product.html')));
app.get('/sell', (req, res) => res.sendFile(path.join(__dirname, 'views/sell.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'views/admin/login.html')));
app.get('/admin/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'views/admin/dashboard.html')));

app.listen(PORT, () => console.log(`TheTechMart running at http://localhost:${PORT}`));
