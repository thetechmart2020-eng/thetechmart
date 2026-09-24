// Yoco Online Checkout adapter. Not live until YOCO_SECRET_KEY is set in the
// deployment's environment variables AND an admin switches it on in Settings.
// Docs: https://developer.yoco.com/online/api-reference/checkouts-api
//
// To go live later: add YOCO_SECRET_KEY (starts with sk_live_ / sk_test_) in
// Vercel's Environment Variables, flip "Yoco" on in Admin > Settings, and this
// function starts actually being called — nothing else in the app needs to change.
module.exports = {
  key: 'yoco',
  label: 'Yoco',
  description: 'Card payments via Yoco Online Checkout.',
  requiredEnv: ['YOCO_SECRET_KEY'],

  async createCheckout(order) {
    const amountInCents = Math.round(Number(order.amount) * 100);
    const res = await fetch('https://payments.yoco.com/api/checkouts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.YOCO_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: amountInCents,
        currency: 'ZAR',
        successUrl: `${process.env.PUBLIC_BASE_URL || ''}/checkout/complete?order=${order.id}&status=success`,
        cancelUrl: `${process.env.PUBLIC_BASE_URL || ''}/checkout/complete?order=${order.id}&status=cancelled`,
        failureUrl: `${process.env.PUBLIC_BASE_URL || ''}/checkout/complete?order=${order.id}&status=failed`,
        metadata: { orderId: order.id }
      })
    });
    if (!res.ok) throw new Error(`Yoco checkout failed (${res.status})`);
    const data = await res.json();
    return { redirectUrl: data.redirectUrl, providerRef: data.id };
  }
};
