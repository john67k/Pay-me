/**
 * Stripe provider — STUB. Not functional yet; every method throws until implemented.
 * See README "Going live with Stripe".
 *
 * Setup:  npm i stripe
 *         STRIPE_SECRET_KEY=sk_test_...   STRIPE_PUBLISHABLE_KEY=pk_test_...
 *         STRIPE_WEBHOOK_SECRET=whsec_...  PAYMENT_PROVIDER=stripe
 *
 * IMPORTANT: with Stripe, raw card numbers must NEVER reach this server. The frontend must
 * use Stripe.js / the Payment Element, which tokenizes cards in the browser (keeps you in
 * PCI SAQ-A scope). So `details` for card/wallet/ACH becomes a PaymentMethod/confirmation
 * token id, not card data.
 */
// const Stripe = require('stripe');
// const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const notImplemented = (what) => { throw Object.assign(new Error(`Stripe provider: ${what} not implemented yet`), { status: 501 }); };

async function createPayment({ id, amountCents, currency, description, method, details }) {
  // TODO: card / apple_pay / google_pay / paypal:
  //   const pi = await stripe.paymentIntents.create({
  //     amount: amountCents, currency, description,
  //     automatic_payment_methods: { enabled: true },   // Apple Pay, Google Pay, PayPal (where eligible) via Payment Element
  //     metadata: { internal_id: id },
  //   }, { idempotencyKey: id });
  //   Return pi.client_secret to the browser; the Payment Element confirms it (handles 3DS).
  //   Final status arrives via webhook `payment_intent.succeeded` / `payment_intent.payment_failed`.
  //   Apple Pay also requires registering your domain: stripe.applePayDomains / Dashboard > Payment method domains.
  // TODO: ach -> payment_method_types: ['us_bank_account'] with Financial Connections; status 'processing' for ~4 business days.
  // TODO: cashapp   -> payment_method_types: ['cashapp']   (US only; QR on desktop, redirect on mobile)
  // TODO: klarna   -> payment_method_types: ['klarna']    (needs billing country/email; redirect flow)
  // TODO: afterpay -> payment_method_types: ['afterpay_clearpay'] (needs shipping address)
  // venmo: NOT a Stripe method. Use a separate PayPal/Braintree adapter.
  // zelle: no API to pull funds. Keep the instructions + memo flow and reconcile bank deposits (e.g. Plaid).
  // BTC/Lightning/USDT/LTC: separate adapter (BTCPay Server, BitPay, Coinbase Commerce, OpenNode).
  // TODO: crypto -> Stripe "Crypto" payment method (stablecoins, USDC) where available on your account,
  //   or keep a separate provider (Coinbase Commerce, etc.).
  notImplemented('createPayment');
}

async function refreshPayment(_p) {
  // TODO: stripe.paymentIntents.retrieve(p.providerRef) — but prefer webhooks as the source of truth.
  return null;
}

async function confirmReceived(_p) { notImplemented('confirmReceived'); }

async function createPayout({ id, amountCents, currency, method, destination }) {
  // Two models:
  //  (a) Paying YOURSELF out to your own bank:  stripe.payouts.create({ amount, currency })
  //  (b) Paying OTHER PEOPLE (vendors/contractors): Stripe Connect.
  //      1. Onboard each recipient as a connected account (Express/Custom) — Stripe does their KYC:
  //         stripe.accounts.create({ type: 'express', ... }) + stripe.accountLinks.create(...)
  //      2. Move funds: stripe.transfers.create({ amount, currency, destination: 'acct_...' }, { idempotencyKey: id })
  //      3. Stripe pays out the connected account to its bank on its payout schedule
  //         (or stripe.payouts.create({...}, { stripeAccount: 'acct_...' }) for manual payouts).
  //  Venmo payouts: PayPal Payouts API (recipient_wallet VENMO). Cash App $Cashtag and Zelle: no Stripe API.
  //  PayPal/email and crypto-wallet payouts are NOT Stripe Connect features: use PayPal Payouts API,
  //  or Stripe's stablecoin/crypto payouts if enabled for your account, or a crypto custody provider.
  //  Track status via webhooks: transfer.*, payout.paid, payout.failed.
  notImplemented('createPayout');
}

async function refreshPayout(_po) { return null; }

// TODO: webhook handler — mount BEFORE express.json():
//   app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res) => {
//     const event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
//     switch (event.type) { case 'payment_intent.succeeded': ...; case 'payout.paid': ...; }
//     res.json({ received: true });
//   });

module.exports = { name: 'stripe', testMode: String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_'), RATES: {},
  ASSETS: {}, BNPL: {}, createPayment, refreshPayment, confirmReceived, createPayout, refreshPayout };
