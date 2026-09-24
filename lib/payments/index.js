// Payment-gateway abstraction layer.
//
// TheTechMart's checkout is built to plug straight into Yoco, PayJustNow and
// Happy Pay — but none of those need live API keys to ship. Every provider here
// exposes the same shape: { key, label, kind, isLive(cfg), createCheckout(order, cfg) }.
//
// - isLive(cfg)      → true once the admin has switched it on (config.payment_settings)
//                       AND its required env vars are present. Until then the
//                       checkout page shows it as "Coming soon" and the customer
//                       is routed to the always-on manual handoff instead.
// - createCheckout() → called once a provider is live. Returns { redirectUrl } for
//                       a hosted checkout page, or { instructions } for anything
//                       that doesn't redirect. Each adapter isolates the one API
//                       call that will need real credentials later — swap the
//                       inside of the function, the rest of the app doesn't change.
//
// Manual handoff (WhatsApp / email) is not a "provider" in the gateway sense — it's
// the fallback every checkout can always use, handled directly in server.js.

const yoco = require('./yoco');
const payjustnow = require('./payjustnow');
const happypay = require('./happypay');

const PROVIDERS = [yoco, payjustnow, happypay];

function envReady(provider) {
  return provider.requiredEnv.every((k) => !!process.env[k]);
}

// Returns the provider list annotated with whether each is actually usable right
// now, for the checkout page to render (live gateways selectable, others shown
// as "coming soon").
function listProviders(paymentSettings = {}) {
  return PROVIDERS.map((p) => {
    const adminEnabled = !!(paymentSettings[p.key] && paymentSettings[p.key].enabled);
    const configured = envReady(p);
    return {
      key: p.key,
      label: p.label,
      description: p.description,
      live: adminEnabled && configured,
      // Surfaced only to the admin dashboard so it's clear what's still missing —
      // never sent to the public checkout page.
      adminEnabled,
      configured
    };
  });
}

function getProvider(key) {
  return PROVIDERS.find((p) => p.key === key) || null;
}

async function createCheckout(key, order, paymentSettings) {
  const provider = getProvider(key);
  if (!provider) throw new Error('Unknown payment method');
  if (!envReady(provider) || !(paymentSettings[key] && paymentSettings[key].enabled)) {
    throw new Error(`${provider.label} isn't live yet on this store`);
  }
  return provider.createCheckout(order);
}

module.exports = { listProviders, getProvider, createCheckout, PROVIDERS };
