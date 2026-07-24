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
  id: r.id, brand: r.brand, model: r.model, price: Number(r.price), condition: r.condition,
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
    brand: p.brand, model: p.model, price: p.price, condition: p.condition,
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

// ---------- CSV price-list sync ----------
// Upserts by (brand, model, storage, condition) — re-uploading the same CSV updates
// matching rows instead of creating duplicates.
async function syncProductsFromRows(rows) {
  const existing = await listProducts();
  const keyOf = (r) => `${r.brand}|${r.model}|${r.storage || ''}|${r.condition || ''}`.toLowerCase();
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
        brand: row.brand, model: row.model, price: row.price, condition: row.condition,
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

module.exports = {
  getConfig, updateConfig,
  listProducts, getProduct, insertProduct, updateProduct, deleteProduct, syncProductsFromRows,
  addOffer, listOffers, updateOfferStatus,
  addTradein, listTradeins, updateTradeinStatus
};
