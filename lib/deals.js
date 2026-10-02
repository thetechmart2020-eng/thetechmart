// October deals shown on the homepage.
//
// HOW TO CHANGE THE DEALS: edit the list below, commit, and redeploy. Each entry
// is matched against your LIVE catalogue (brand + model, and storage if you give
// one), so the price shown on the site is always the real current price in your
// stock list. Entries that don't match a live product are silently skipped, and if
// nothing matches the whole "October deals" section hides itself.
//
// A deal is a negotiated (special-price) device, so it shows the 21-day replacement
// warranty badge instead of the standard 3-month one.
//
// Matching is case-insensitive and exact on brand/model/storage.
const DEALS = [
  { brand: 'Apple', model: 'iPhone 12', storage: '64GB' },
  { brand: 'Apple', model: 'iPhone 13', storage: '128GB' },
  { brand: 'Apple', model: 'iPhone 14', storage: '128GB' },
  { brand: 'Samsung', model: 'Galaxy S22', storage: '256GB' },
  { brand: 'Samsung', model: 'Galaxy S23', storage: '256GB' },
  { brand: 'Sony', model: 'PlayStation 4 Slim', storage: '1TB' },
  { brand: 'Sony', model: 'PlayStation 5 Slim (Digital)', storage: '1TB' },
  { brand: 'Apple', model: 'MacBook Air 13-inch (M1)', storage: '256GB' }
];

const norm = (s) => String(s || '').trim().toLowerCase();

function matches(deal, p) {
  return norm(deal.brand) === norm(p.brand)
    && norm(deal.model) === norm(p.model)
    && (!deal.storage || norm(deal.storage) === norm(p.storage));
}

// Marks negotiated / special-price products (used for the 21-day warranty badge).
function isDeal(p) {
  return DEALS.some((d) => matches(d, p));
}

// Returns the live products that match the deals list, in the order listed.
function pickDeals(products) {
  const out = [];
  for (const d of DEALS) {
    const p = products.find((x) => x.active !== false && matches(d, x));
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

module.exports = { DEALS, isDeal, pickDeals };
