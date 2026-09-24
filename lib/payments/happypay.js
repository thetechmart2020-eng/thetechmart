// Happy Pay (buy-now-pay-later) adapter. Not live until HAPPYPAY_MERCHANT_KEY is
// set AND an admin switches it on in Settings.
//
// Same pattern as PayJustNow — this is the wiring point for a real integration.
// Fill in the fetch() call below once Happy Pay's merchant docs/credentials are
// in hand; the checkout page, order model and admin settings already work.
module.exports = {
  key: 'happypay',
  label: 'Happy Pay',
  description: 'Buy now, pay later with Happy Pay.',
  requiredEnv: ['HAPPYPAY_MERCHANT_KEY'],

  async createCheckout(order) {
    const res = await fetch('https://api.happypay.co.za/v1/checkouts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.HAPPYPAY_MERCHANT_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: Number(order.amount),
        currency: 'ZAR',
        reference: order.id,
        successUrl: `${process.env.PUBLIC_BASE_URL || ''}/checkout/complete?order=${order.id}&status=success`,
        cancelUrl: `${process.env.PUBLIC_BASE_URL || ''}/checkout/complete?order=${order.id}&status=cancelled`
      })
    });
    if (!res.ok) throw new Error(`Happy Pay checkout failed (${res.status})`);
    const data = await res.json();
    return { redirectUrl: data.redirectUrl, providerRef: data.id };
  }
};
