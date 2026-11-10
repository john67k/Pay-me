/**
 * Payment provider adapter.
 *
 * Every provider must implement this interface (all methods async):
 *
 *   name: string
 *   createPayment({ id, amountCents, currency, description, method, details, customer })
 *       -> { status: 'succeeded'|'processing'|'pending'|'failed', providerRef, methodSummary,
 *            failureReason?, settleAt?, crypto? }
 *       `details` holds RAW method input (e.g. card number). Providers must NEVER persist it;
 *       only `methodSummary` (brand/last4, bank last4, email, ...) is saved by the app.
 *   refreshPayment(payment)  -> partial update (e.g. ACH settles, crypto expires) or null
 *   confirmReceived(payment) -> partial update once a push payment (crypto / Zelle) is detected
 *   ASSETS, BNPL             -> catalogs of supported crypto assets/networks and BNPL limits (for the UI)
 *   createPayout({ id, amountCents, currency, method, destination })
 *       -> { status: 'pending'|'paid'|'failed', providerRef, failureReason?, settleAt? }
 *   refreshPayout(payout)    -> partial update or null
 *
 * Select with PAYMENT_PROVIDER=mock|stripe (default: mock).
 */
const name = (process.env.PAYMENT_PROVIDER || 'mock').toLowerCase();

let provider;
if (name === 'stripe') provider = require('./stripe');
else provider = require('./mock');

module.exports = provider;
