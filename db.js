// Data access layer backed by Supabase (Postgres). Postgres columns are snake_case
// by convention; everything here maps to/from the camelCase shape the rest of the
// app (and the frontend JS, unchanged) already expects — so this is the only file
// that needs to know about the underlying column names.
const { supabase } = require('./lib/supabase');

function check(error) {
  if (error) throw new Error(error.message);
}

// ---------- mappers ----------
const productOut = (r) => ({
  id: r.id, brand: r.brand, model: r.model, category: r.category || 'Phones', price: Number(r.price), condition: r.condition,
  storage: r.storage, color: r.color, stock: r.stock, imageUrl: r.image_url,
  active: r.active, createdAt: r.created_at
});
const offerOut = (r) => ({
  id: r.id, productId: r.product_id, productName: r.product_name, listPrice: Number(r.list_price),
  amount: Number(r.amount), name: r.name, phone: r.phone, message: r.message,
  status: r.status, createdAt: r.created_at
});
const tradeinOut = (r) => ({
  id: r.id, type: r.type, brand: r.brand, model: r.model, storage: r.storage, condition: r.condition,
  askingPrice: r.asking_price === null ? null : Number(r.asking_price), name: r.name, phone: r.phone,
  notes: r.notes, photos: r.photos || [], status: r.status, createdAt: r.created_at
});
const configOut = (r) => ({ storeName: r.store_name, whatsappNumber: r.whatsapp_number, adminPassword: r.admin_password });
const orderOut = (r) => ({
  id: r.id, type: r.type, source: r.source, sourceId: r.source_id, productId: r.product_id,
  customerName: r.customer_name, customerPhone: r.customer_phone, amount: Number(r.amount),
  status: r.status, notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at
});

// ---------- config ----------
async function getConfig() {
  const { data, error } = await supabase.from('config').select('*').eq('id', 1).single();
  check(error);
  return configOut(data);
}
async function updateConfig(patch) {
  const row = {};
  if (patch.storeName !== undefined) row.store_name = patch.storeName;
  if (patch.whatsappNumber !== undefined) row.whatsapp_number = patch.whatsappNumber;
  if (patch.adminPassword !== undefined) row.admin_password = patch.adminPassword;
  const { data, error } = await supabase.from('config').update(row).eq('id', 1).select().single();
  check(error);
  return configOut(data);
}

// ---------- products ----------
async function listProducts({ activeOnly } = {}) {
  let q = supabase.from('products').select('*').order('created_at', { ascending: false });
  if (activeOnly) q = q.neq('active', false);
  const { data, error } = await q;
  check(error);
  return data.map(productOut);
}
async function getProduct(id) {
  const { data, error } = await supabase.from('products').select('*').eq('id', id).maybeSingle();
  check(error);
  return data ? productOut(data) : null;
}
async function insertProduct(p) {
  const row = {
    brand: p.brand, model: p.model, category: p.category || 'Phones', price: p.price, condition: p.condition,
    storage: p.storage, color: p.color, stock: p.stock, image_url: p.imageUrl || null, active: true
  };
  const { data, error } = await supabase.from('products').insert(row).select().single();
  check(error);
  return productOut(data);
}
async function updateProduct(id, patch) {
  const row = {};
  if (patch.brand !== undefined) row.brand = patch.brand;
  if (patch.model !== undefined) row.model = patch.model;
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.price !== undefined) row.price = patch.price;
  if (patch.condition !== undefined) row.condition = patch.condition;
  if (patch.storage !== undefined) row.storage = patch.storage;
  if (patch.color !== undefined) row.color = patch.color;
  if (patch.stock !== undefined) row.stock = patch.stock;
  if (patch.imageUrl !== undefined) row.image_url = patch.imageUrl;
  if (patch.active !== undefined) row.active = patch.active;
  const { data, error } = await supabase.from('products').update(row).eq('id', id).select().maybeSingle();
  check(error);
  return data ? productOut(data) : null;
}
async function deleteProduct(id) {
  const { error } = await supabase.from('products').delete().eq('id', id);
  check(error);
}

// ---------- offers ----------
async function addOffer(o) {
  const row = {
    product_id: o.productId, product_name: o.productName, list_price: o.listPrice,
    amount: o.amount, name: o.name, phone: o.phone, message: o.message || '', status: 'pending'
  };
  const { data, error } = await supabase.from('offers').insert(row).select().single();
  check(error);
  return offerOut(data);
}
async function listOffers() {
  const { data, error } = await supabase.from('offers').select('*').order('created_at', { ascending: false });
  check(error);
  return data.map(offerOut);
}
async function updateOfferStatus(id, status) {
  const { data, error } = await supabase.from('offers').update({ status }).eq('id', id).select().maybeSingle();
  check(error);
  return data ? offerOut(data) : null;
}

// Accepting an offer: mark it accepted, create a "sale" order, and take one unit off
// stock (hiding the listing if that was the last one).
async function acceptOffer(id) {
  const { data: offerRow, error: offerErr } = await supabase.from('offers').update({ status: 'accepted' }).eq('id', id).select().maybeSingle();
  check(offerErr);
  if (!offerRow) return null;
  const offer = offerOut(offerRow);

  if (offer.productId) {
    const product = await getProduct(offer.productId);
    if (product) {
      const nextStock = Math.max(0, (product.stock || 0) - 1);
      await updateProduct(product.id, { stock: nextStock, active: nextStock > 0 });
    }
  }

  const order = await addOrder({
    type: 'sale', source: 'offer', sourceId: offer.id, productId: offer.productId,
    customerName: offer.name, customerPhone: offer.phone, amount: offer.amount,
    notes: offer.message || ''
  });

  return { offer, order };
}

// ---------- trade-ins ----------
async function addTradein(t) {
  const row = {
    type: t.type, brand: t.brand, model: t.model, storage: t.storage || '', condition: t.condition || '',
    asking_price: t.askingPrice, name: t.name, phone: t.phone, notes: t.notes || '',
    photos: t.photos || [], status: 'pending'
  };
  const { data, error } = await supabase.from('tradeins').insert(row).select().single();
  check(error);
  return tradeinOut(data);
}
async function listTradeins() {
  const { data, error } = await supabase.from('tradeins').select('*').order('created_at', { ascending: false });
  check(error);
  return data.map(tradeinOut);
}
async function updateTradeinStatus(id, status) {
  const { data, error } = await supabase.from('tradeins').update({ status }).eq('id', id).select().maybeSingle();
  check(error);
  return data ? tradeinOut(data) : null;
}

// Accepting a trade-in/sell-in: mark it accepted and create a "purchase" order
// (the device coming in — no product_id yet since it isn't listed for sale until
// you add it as stock separately).
async function acceptTradein(id) {
  const { data: row, error } = await supabase.from('tradeins').update({ status: 'accepted' }).eq('id', id).select().maybeSingle();
  check(error);
  if (!row) return null;
  const tradein = tradeinOut(row);

  const order = await addOrder({
    type: 'purchase', source: 'tradein', sourceId: tradein.id, productId: null,
    customerName: tradein.name, customerPhone: tradein.phone, amount: tradein.askingPrice || 0,
    notes: `${tradein.brand} ${tradein.model} ${tradein.storage || ''} · ${tradein.condition || ''}`.trim()
  });

  return { tradein, order };
}

// ---------- CSV price-list sync ----------
// Upserts by (brand, model, storage, condition) — re-uploading the same CSV updates
// matching rows instead of creating duplicates.
async function syncProductsFromRows(rows) {
  const existing = await listProducts();
  const keyOf = (r) => `${r.brand}|${r.model}|${r.storage || ''}|${r.condition || ''}|${r.category || 'Phones'}`.toLowerCase();
  const existingByKey = new Map(existing.map((p) => [keyOf(p), p]));

  const toInsert = [];
  const updates = [];

  for (const row of rows) {
    const key = keyOf(row);
    const match = existingByKey.get(key);
    if (match) {
      updates.push(updateProduct(match.id, row));
    } else {
      toInsert.push({
        brand: row.brand, model: row.model, category: row.category || 'Phones', price: row.price, condition: row.condition,
        storage: row.storage, color: row.color, stock: row.stock, image_url: row.imageUrl || null, active: true
      });
    }
  }

  await Promise.all(updates);
  if (toInsert.length) {
    const { error } = await supabase.from('products').insert(toInsert);
    check(error);
  }

  return { added: toInsert.length, updated: updates.length };
}

// ---------- orders ----------
async function addOrder(o) {
  const row = {
    type: o.type, source: o.source, source_id: o.sourceId || null, product_id: o.productId || null,
    customer_name: o.customerName, customer_phone: o.customerPhone, amount: o.amount || 0,
    status: 'new', notes: o.notes || ''
  };
  const { data, error } = await supabase.from('orders').insert(row).select().single();
  check(error);
  return orderOut(data);
}
async function listOrders() {
  const { data, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
  check(error);
  return data.map(orderOut);
}
async function updateOrder(id, patch) {
  const row = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.notes !== undefined) row.notes = patch.notes;
  if (patch.amount !== undefined) row.amount = patch.amount;
  const { data, error } = await supabase.from('orders').update(row).eq('id', id).select().maybeSingle();
  check(error);
  return data ? orderOut(data) : null;
}

// ---------- events (lightweight first-party analytics) ----------
async function logEvent({ type, path, productId }) {
  const { error } = await supabase.from('events').insert({ type, path: path || null, product_id: productId || null });
  check(error);
}
async function getAnalyticsSummary() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const countOf = async (type) => {
    const { count, error } = await supabase.from('events').select('*', { count: 'exact', head: true })
      .eq('type', type).gte('created_at', since);
    check(error);
    return count || 0;
  };

  const [pageViews, productViews, offersSubmitted, tradeinsSubmitted] = await Promise.all([
    countOf('page_view'), countOf('product_view'), countOf('offer_submitted'), countOf('tradein_submitted')
  ]);

  // Top viewed products: pull recent product_view events and tally in memory
  // (fine at small-business scale; a SQL view/RPC would be the move at higher volume).
  const { data: viewRows, error: viewErr } = await supabase
    .from('events').select('product_id').eq('type', 'product_view').gte('created_at', since)
    .not('product_id', 'is', null).limit(5000);
  check(viewErr);

  const tally = new Map();
  for (const r of viewRows) tally.set(r.product_id, (tally.get(r.product_id) || 0) + 1);
  const topIds = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  const topProducts = [];
  for (const [productId, views] of topIds) {
    const p = await getProduct(productId);
    if (p) topProducts.push({ id: p.id, brand: p.brand, model: p.model, views });
  }

  return { pageViews, productViews, offersSubmitted, tradeinsSubmitted, topProducts };
}

module.exports = {
  getConfig, updateConfig,
  listProducts, getProduct, insertProduct, updateProduct, deleteProduct, syncProductsFromRows,
  addOffer, listOffers, updateOfferStatus, acceptOffer,
  addTradein, listTradeins, updateTradeinStatus, acceptTradein,
  addOrder, listOrders, updateOrder,
  logEvent, getAnalyticsSummary
};
