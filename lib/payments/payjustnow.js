// PayJustNow (buy-now-pay-later, 3 interest-free installments) adapter.
// Not live until PAYJUSTNOW_MERCHANT_ID + PAYJUSTNOW_API_KEY are set AND an admin
// switches it on in Settings. Docs: https://www.payjustnow.com/business/integration
//
// PayJustNow's real integration is typically a redirect-based order API similar to
// Yoco's — the exact endpoint/payload depends on the merchant contract they issue,
// so this stub is the wiring point: fill in the fetch() call below once those
// integration docs/credentials are in hand, nothing else in the app changes.
module.exports = {
  key: 'payjustnow',
  label: 'PayJustNow',
  description: 'Buy now, pay in 3 interest-free installments.',
  requiredEnv: ['PAYJUSTNOW_MERCHANT_ID', 'PAYJUSTNOW_API_KEY'],

  async createCheckout(order) {
    // Placeholder call shape — replace url/body with PayJustNow's real order-create
    // endpoint once merchant onboarding provides it.
    const res = await fetch('https://api.payjustnow.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYJUSTNOW_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        merchantId: process.env.PAYJUSTNOW_MERCHANT_ID,
        amount: Number(order.amount),
        currency: 'ZAR',
        reference: order.id,
        returnUrl: `${process.env.PUBLIC_BASE_URL || ''}/checkout/complete?order=${order.id}&status=success`,
        cancelUrl: `${process.env.PUBLIC_BASE_URL || ''}/checkout/complete?order=${order.id}&status=cancelled`
      })
    });
    if (!res.ok) throw new Error(`PayJustNow checkout failed (${res.status})`);
    const data = await res.json();
    return { redirectUrl: data.checkoutUrl || data.redirectUrl, providerRef: data.id };
  }
};
