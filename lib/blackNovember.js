// Black November campaign (separate page: /black-november).
//
// HOW IT WORKS: each offer below is matched against your LIVE catalogue (brand, model and
// storage must match exactly). The page only shows an offer when the live product's price
// equals the approved campaign price here, so the landing page, the product page, the
// checkout and the price list can never disagree. To run a deal: set that product's price in
// the admin to the campaign price. To end it: set the normal price back. Nothing here changes
// any price.
//
// OWNER CONFIRMATION: the four prices below come from the owner's approved Black Friday list.
// They must be confirmed before this goes live.
const OFFERS = [
  { key: 'bn-16pm-256', brand: 'Apple', model: 'iPhone 16 Pro Max', storage: '256GB', price: 15950, feature: true },
  { key: 'bn-17-256',   brand: 'Apple', model: 'iPhone 17',         storage: '256GB', price: 14450, noStockPhoto: true },
  { key: 'bn-15-128',   brand: 'Apple', model: 'iPhone 15',         storage: '128GB', price: 8499 },
  { key: 'bn-13-128',   brand: 'Apple', model: 'iPhone 13',         storage: '128GB', price: 6500 }
];

// November specials: the rest of the owner's CONFIRMED Black Friday price list (confirmed 18 Nov 2026).
// 'normal' is for the owner's review only and is never shown or used to change a price. October deals are NOT carried over.
// cond: 'preowned' = Grade A-B checked; 'new' = brand new / sealed.
const SPECIALS = [
  { brand: 'Apple', model: 'iPhone 17 Pro Max', storage: '256GB', price: 30120, cond: 'new', group: 'iPhones', normal: 30620 },
  { brand: 'Apple', model: 'iPhone 17 Pro', storage: '256GB', price: 26120, cond: 'new', group: 'iPhones', normal: 26620 },
  { brand: 'Apple', model: 'iPhone 16 Pro', storage: '256GB', price: 16020, cond: 'preowned', group: 'iPhones', normal: 16520 },
  { brand: 'Apple', model: 'iPhone 16 Pro', storage: '128GB', price: 15020, cond: 'preowned', group: 'iPhones', normal: 15520 },
  { brand: 'Apple', model: 'iPhone 16', storage: '256GB', price: 12570, cond: 'preowned', group: 'iPhones', normal: 12970 },
  { brand: 'Apple', model: 'iPhone 16', storage: '128GB', price: 11820, cond: 'preowned', group: 'iPhones', normal: 12220 },
  { brand: 'Apple', model: 'iPhone 15 Pro Max', storage: '256GB', price: 15470, cond: 'preowned', group: 'iPhones', normal: 15970 },
  { brand: 'Apple', model: 'iPhone 15 Pro', storage: '256GB', price: 13520, cond: 'preowned', group: 'iPhones', normal: 13920 },
  { brand: 'Apple', model: 'iPhone 15 Pro', storage: '128GB', price: 12520, cond: 'preowned', group: 'iPhones', normal: 12920 },
  { brand: 'Apple', model: 'iPhone 15', storage: '256GB', price: 10470, cond: 'preowned', group: 'iPhones', normal: 10870 },
  { brand: 'Apple', model: 'iPhone 14 Pro Max', storage: '256GB', price: 11970, cond: 'preowned', group: 'iPhones', normal: 12370 },
  { brand: 'Apple', model: 'iPhone 14 Pro Max', storage: '128GB', price: 10970, cond: 'preowned', group: 'iPhones', normal: 11370 },
  { brand: 'Apple', model: 'iPhone 14 Pro', storage: '256GB', price: 10420, cond: 'preowned', group: 'iPhones', normal: 10820 },
  { brand: 'Apple', model: 'iPhone 14 Pro', storage: '128GB', price: 9920, cond: 'preowned', group: 'iPhones', normal: 10320 },
  { brand: 'Apple', model: 'iPhone 14', storage: '256GB', price: 7699, cond: 'preowned', group: 'iPhones', normal: 8770 },
  { brand: 'Apple', model: 'iPhone 14', storage: '128GB', price: 7870, cond: 'preowned', group: 'iPhones', normal: 8270 },
  { brand: 'Apple', model: 'iPhone 13 Pro Max', storage: '256GB', price: 9870, cond: 'preowned', group: 'iPhones', normal: 10270 },
  { brand: 'Apple', model: 'iPhone 13 Pro Max', storage: '128GB', price: 9370, cond: 'preowned', group: 'iPhones', normal: 9770 },
  { brand: 'Apple', model: 'iPhone 13 Pro', storage: '256GB', price: 8820, cond: 'preowned', group: 'iPhones', normal: 9220 },
  { brand: 'Apple', model: 'iPhone 13 Pro', storage: '128GB', price: 8320, cond: 'preowned', group: 'iPhones', normal: 8720 },
  { brand: 'Apple', model: 'iPhone 13', storage: '256GB', price: 7770, cond: 'preowned', group: 'iPhones', normal: 8170 },
  { brand: 'Apple', model: 'iPhone 12 Pro Max', storage: '256GB', price: 8770, cond: 'preowned', group: 'iPhones', normal: 9170 },
  { brand: 'Apple', model: 'iPhone 12 Pro Max', storage: '128GB', price: 8270, cond: 'preowned', group: 'iPhones', normal: 8670 },
  { brand: 'Apple', model: 'iPhone 12 Pro', storage: '256GB', price: 7320, cond: 'preowned', group: 'iPhones', normal: 7620 },
  { brand: 'Apple', model: 'iPhone 12 Pro', storage: '128GB', price: 6820, cond: 'preowned', group: 'iPhones', normal: 7120 },
  { brand: 'Apple', model: 'iPhone 12', storage: '128GB', price: 5399, cond: 'preowned', group: 'iPhones', normal: 6070 },
  { brand: 'Apple', model: 'iPhone 12', storage: '64GB', price: 4600, cond: 'preowned', group: 'iPhones', normal: 5570 },
  { brand: 'Apple', model: 'iPhone 11 Pro Max', storage: '256GB', price: 6770, cond: 'preowned', group: 'iPhones', normal: 7070 },
  { brand: 'Apple', model: 'iPhone 11 Pro Max', storage: '64GB', price: 6020, cond: 'preowned', group: 'iPhones', normal: 6320 },
  { brand: 'Apple', model: 'iPhone 11 Pro', storage: '256GB', price: 5720, cond: 'preowned', group: 'iPhones', normal: 6020 },
  { brand: 'Apple', model: 'iPhone 11 Pro', storage: '64GB', price: 5220, cond: 'preowned', group: 'iPhones', normal: 5520 },
  { brand: 'Apple', model: 'iPhone 11', storage: '128GB', price: 4799, cond: 'preowned', group: 'iPhones', normal: 5270 },
  { brand: 'Apple', model: 'iPhone 11', storage: '64GB', price: 3999, cond: 'preowned', group: 'iPhones', normal: 4770 },
  { brand: 'Apple', model: 'iPhone XR', storage: '128GB', price: 4170, cond: 'preowned', group: 'iPhones', normal: 4470 },
  { brand: 'Apple', model: 'iPhone XR', storage: '64GB', price: 3670, cond: 'preowned', group: 'iPhones', normal: 3970 },
  { brand: 'Samsung', model: 'Galaxy S22+', storage: '256GB', price: 5950, cond: 'preowned', group: 'Samsung', normal: 6250 },
  { brand: 'Samsung', model: 'Galaxy S23 Ultra', storage: '256GB', price: 8850, cond: 'preowned', group: 'Samsung', normal: 9250 },
  { brand: 'Samsung', model: 'Galaxy S24 Ultra', storage: '256GB', price: 12350, cond: 'preowned', group: 'Samsung', normal: 12750 },
  { brand: 'Samsung', model: 'Galaxy S26+', storage: '256GB', price: 14750, cond: 'preowned', group: 'Samsung', normal: 15250 },
  { brand: 'Samsung', model: 'Galaxy S26 Ultra', storage: '256GB', price: 17250, cond: 'preowned', group: 'Samsung', normal: 17750 },
  { brand: 'Samsung', model: 'Galaxy S26 Ultra', storage: '512GB', price: 20750, cond: 'preowned', group: 'Samsung', normal: 21250 },
  // hold: live catalogue has Z Fold 5 256GB at R16,500; this 512GB row's approved normal R12,250 is implausibly
  // below the 256GB live price - identity or data error, owner's decision needed.
  { brand: 'Samsung', model: 'Galaxy Z Fold 5', storage: '512GB', price: 11850, cond: 'preowned', group: 'Samsung', normal: 12250, hold: true },
  { brand: 'Samsung', model: 'Galaxy Z Flip 6', storage: '256GB', price: 11350, cond: 'preowned', group: 'Samsung', normal: 11750 },
  { brand: 'Sony', model: 'PS5 Digital (original)', storage: '', price: 9100, cond: 'preowned', group: 'Consoles, pre-owned', normal: 9500, warranty: '6-month warranty included' },
  { brand: 'Sony', model: 'PS5 Disc (original)', storage: '', price: 9850, cond: 'preowned', group: 'Consoles, pre-owned', normal: 10500, warranty: '6-month warranty included' },
  { brand: 'Sony', model: 'PlayStation 5 Slim (Disc)', storage: '1TB', price: 10600, cond: 'preowned', group: 'Consoles, pre-owned', normal: 11000 },
  { brand: 'Sony', model: 'PlayStation 5 Pro', storage: '2TB', price: 16500, cond: 'preowned', group: 'Consoles, pre-owned', normal: 17000 },
  { brand: 'Sony', model: 'PS5 Pro + disc drive', storage: '2TB', price: 18000, cond: 'preowned', group: 'Consoles, pre-owned', normal: 18500 },
  { brand: 'Microsoft', model: 'Xbox Series S', storage: '512GB', price: 5700, cond: 'preowned', group: 'Consoles, pre-owned', normal: 6000 },
  { brand: 'Microsoft', model: 'Xbox Series X', storage: '1TB', price: 9600, cond: 'preowned', group: 'Consoles, pre-owned', normal: 10000 },
  { brand: 'Nintendo', model: 'Switch OLED', storage: '64GB', price: 5700, cond: 'preowned', group: 'Consoles, pre-owned', normal: 6000 },
  { brand: 'Nintendo', model: 'Switch Lite', storage: '32GB', price: 2600, cond: 'preowned', group: 'Consoles, pre-owned', normal: 2900 },
  { brand: 'Sony', model: 'PS5 Digital E', storage: '825GB', price: 14100, cond: 'new', group: 'Consoles, new', normal: 14500 },
  { brand: 'Sony', model: 'PS5 Slim Disc E', storage: '1TB', price: 15000, cond: 'new', group: 'Consoles, new', normal: 15500 },
  { brand: 'Sony', model: 'PS5 Pro Digital', storage: '2TB', price: 22000, cond: 'new', group: 'Consoles, new', normal: 22500 },
  { brand: 'Microsoft', model: 'Xbox Series X (disc)', storage: '1TB', price: 16500, cond: 'new', group: 'Consoles, new', normal: 17000 },
  { brand: 'Microsoft', model: 'Xbox Series X Digital', storage: '1TB', price: 14500, cond: 'new', group: 'Consoles, new', normal: 15000 },
  { brand: 'Microsoft', model: 'Xbox Series S White', storage: '1TB', price: 11600, cond: 'new', group: 'Consoles, new', normal: 12000 },
  { brand: 'Nintendo', model: 'Switch OLED White', storage: '64GB', price: 7600, cond: 'new', group: 'Consoles, new', normal: 8000 },
  { brand: 'Nintendo', model: 'Switch Lite', storage: '', price: 4700, cond: 'new', group: 'Consoles, new', normal: 5000 },
  { brand: 'Nintendo', model: 'Switch 2', storage: '', price: 11100, cond: 'new', group: 'Consoles, new', normal: 11500 }
];

// Referral amounts quoted on the page.
const REFERRAL_SPECIAL = 150;   // friend buys a November special
const REFERRAL_TOP = 300;       // up to, on full-price sales

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s*\bplus\b/g, '+').replace(/\s+/g, ' ');
// Catalogue rows store sealed units with a "(Sealed)" suffix inside storage; condition carries that fact separately.
const normStorage = (s) => norm(s).replace(/\s*\(sealed\)\s*$/, '');
const isNewCond = (c) => ['new', 'sealed', 'brand new'].includes(norm(c));
const same = (o, p) => norm(o.brand) === norm(p.brand) && norm(o.model) === norm(p.model) && normStorage(o.storage) === normStorage(p.storage) &&
  (!o.cond || (o.cond === 'new') === isNewCond(p.condition));

// Why an offer cannot be shown (or null when it is fine). The page hides offers that fail.
function problem(o, p) {
  if (!p) return 'No live product matches this brand, model and storage.';
  if (p.active === false) return 'The product is switched off.';
  if (Number(p.price) !== o.price) return `Live price is R${Number(p.price)}, not the campaign price R${o.price}.`;
  const c = norm(p.condition);
  if (o.cond === 'new') { if (!isNewCond(c)) return `Condition is "${p.condition}", but this offer is for a new/sealed unit.`; return null; }
  if (c === 'new' || c === 'fair' || c === 'damaged') return `Condition is "${p.condition}", so the Grade A-B wording would not be true.`;
  return null;
}

function resolve(list, products) {
  return list.map((o) => {
    const p = products.find((x) => same(o, x));
    const why = problem(o, p);
    return { offer: o, product: p || null, ok: !why, why };
  });
}

// Used by the product pages: true only while the campaign price is actually live.
function isCampaign(p) {
  return [...OFFERS, ...SPECIALS].some((o) => same(o, p) && Number(p.price) === o.price && p.active !== false);
}

module.exports = { OFFERS, SPECIALS, REFERRAL_SPECIAL, REFERRAL_TOP, resolve, problem, isCampaign };
