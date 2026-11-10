[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/john67k/Pay-me)

# Payments Site (TEST MODE prototype)

The button deploys the `render.yaml` blueprint to Render's free tier (`npm install` / `npm start`). Render generates `ADMIN_PASSWORD` and shows it on the service's Environment tab. The process listens on `process.env.PORT` and binds `0.0.0.0`. The JSON datastore directory (`data/`, or `DATA_FILE`'s parent) is created on boot. The free-tier disk is ephemeral, so saved payments reset when the instance restarts.

A self-contained payments website with two halves:

1. **Customer checkout** (`/`): the method picker is grouped:
   * **Cards & wallets:** Card, Apple Pay, Google Pay
   * **Bank:** ACH bank debit, Zelle (instructions + memo code)
   * **Pay apps:** PayPal, Venmo, Cash App Pay (QR or $Cashtag approval)
   * **Buy now, pay later:** Klarna, Afterpay (Pay in 4, with the installment schedule shown)
   * **Crypto:** Bitcoin (on-chain or ⚡ Lightning), USDC (Solana/Ethereum), USDT (Ethereum/Tron/Solana), ETH, SOL, LTC. Each gets a deposit address or invoice and a QR code.

   Checkout shows success, failure, pending, and processing states and a printable receipt (`/receipt?id=…`).
2. **Payouts dashboard** (`/admin`, password protected): shows your balance (successful incoming payments minus payouts), full transaction history, and a payout form with a confirmation step and live status. You can pay out by:
   * **Bank (ACH)**, **Zelle** (email or US mobile), **PayPal** (email), **Venmo** (@username), **Cash App** ($Cashtag)
   * **Crypto**: BTC on-chain (legacy `1…`/`3…`, bech32 `bc1q…`, taproot `bc1p…`, all checksum-verified), BTC Lightning (Lightning Address or BOLT11 invoice), USDC, USDT (ERC-20/TRC-20/SPL), ETH, SOL, LTC

> ⚠️ **No real money moves.** All processing runs through `providers/mock.js`, a simulated processor. The Apple Pay, Google Pay, PayPal, and crypto flows are simulations.

## Run it

```bash
npm install
ADMIN_PASSWORD='choose-something' npm start      # http://localhost:3000
```

* Checkout: http://localhost:3000/
* Dashboard: http://localhost:3000/admin. The default password is **`demo-admin-123`**. Set `ADMIN_PASSWORD` to change it.
* `npm test` runs the end-to-end API test suite (72 checks, temporary datastore).
* `npm run screenshots` drives the real UI in headless Chrome and saves PNGs in `screenshots/` (needs the server running and Chrome at `/usr/bin/google-chrome`, or set `CHROME_PATH`).

See `.env.example` for all settings. Data is stored in `data/db.json`. Delete that file to reset.

## Test values (mock provider)

| Scenario | Input |
|---|---|
| Card success | `4242 4242 4242 4242`, any future expiry, any CVC (Amex `3782 822463 10005` needs a 4-digit CVC) |
| Card declined / insufficient funds / bad CVC | `4000 0000 0000 0002` / `4000 0000 0000 9995` / `4000 0000 0000 0127` |
| Decline on any method | amount `13.13` |
| ACH | routing `110000000`, account `000123456789` (status goes processing → succeeded after ~8s). Account `000111111116` is returned (fails) |
| PayPal / Venmo / Cash App / Klarna / Afterpay decline | an email, @username, or $Cashtag containing `decline` |
| Klarna / Afterpay limits | Klarna $10–$10,000, Afterpay $1–$2,000 (outside the range is declined) |
| Crypto / Zelle | pick the method, then click "Simulate: I've sent…" on the receipt page |
| Payout failure | bank account `000111111116`, or a PayPal/Venmo/Cash App/Zelle handle containing `fail` |
| Valid BTC payout addresses | `bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq`, `1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa`, `3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy` |
| Valid Tron payout address | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` |

## Architecture

```
server.js              Express app: validation, ledger and balance, admin auth, REST API
lib/validation.js      Luhn, card brand, expiry, CVC, ABA routing checksum, email, $Cashtag, Venmo @username, US phone, amount→cents
lib/addresses.js       Crypto address checksums (Base58Check, Bech32/Bech32m) for BTC/LTC/Tron/SOL/ETH/Lightning + demo address generators
lib/store.js           JSON-file datastore (atomic writes)
providers/index.js     Adapter interface docs + selection via PAYMENT_PROVIDER
providers/mock.js      Simulated processor (default)
providers/stripe.js    Stripe stub with TODOs for PaymentIntents, Connect, payouts, and webhooks
public/                Plain HTML/CSS/JS frontend (checkout, receipt, admin)
test/e2e.js            API end-to-end tests
scripts/screenshots.js Headless-browser UI walkthrough + screenshots
```

**Security and integrity measures already in place:**

* Full card numbers and CVCs are never stored or logged. Only brand, last4, and expiry are kept. Bank account numbers are reduced to last4.
* All validation runs on the server too. The browser checks are only for UX.
* Amounts are handled as integer cents.
* Idempotency keys stop double charges and double payouts when a request is retried.
* Pending payouts are reserved against the balance, so you can't overdraw.
* Admin login uses a constant-time password compare and a random session token in an HttpOnly, SameSite=Strict cookie (8 h). Repeated failed logins are rate-limited.
* Security headers are set, including a strict CSP. All rendered user content is HTML-escaped.

### API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/config` | business name, provider, demo crypto rates |
| POST | `/api/payments` | `{amount, description, method, details, customer, idempotencyKey}` |
| GET | `/api/payments/:id` | public receipt data |
| GET | `/api/payments/:id/qr.png` | crypto payment QR |
| POST | `/api/payments/:id/simulate-received` | mock only: marks a crypto or Zelle payment as received |
| GET | `/api/qr.png?text=` | QR helper (simulated Cash App scan code) |
| POST | `/api/admin/login` / `/api/admin/logout` | `{password}` |
| GET | `/api/admin/summary` | balance + history (auth) |
| POST | `/api/admin/payouts` | `{amount, method: bank|zelle|paypal|venmo|cashapp|crypto, destination, recipientName, note, idempotencyKey}` (auth) |

## Going live with Stripe

What you need:

1. **A Stripe account** (stripe.com). Activate it by giving business details, tax ID/SSN, and a bank account for settlements. That is Stripe's **KYC**, and live payments stay locked until it's approved.
2. **API keys** from Dashboard → Developers → API keys. Use `pk_test_`/`sk_test_` first, then `pk_live_`/`sk_live_`. Keep the secret key on the server only, in an env var or secrets manager.
3. **Webhooks**: add an endpoint `https://yourdomain/webhooks/stripe` and save `STRIPE_WEBHOOK_SECRET`. Listen for `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.processing`, `charge.refunded`, `charge.dispute.created`, `transfer.created`, `payout.paid`, and `payout.failed`. Webhooks, not redirects, should be the source of truth for status. Test locally with `stripe listen --forward-to localhost:3000/webhooks/stripe`.
4. **HTTPS + a real domain.** Apple Pay also requires registering the domain under Dashboard → Settings → Payment method domains.

Code changes (see TODOs in `providers/stripe.js`):

* `npm i stripe`, set `PAYMENT_PROVIDER=stripe`.
* **Replace the card form with Stripe Elements / the Payment Element** (Stripe.js). This is mandatory. Raw card numbers must never touch your server. Tokenizing in the browser keeps you in PCI **SAQ-A** scope. The Payment Element also shows Apple Pay, Google Pay, ACH (`us_bank_account` + Financial Connections), and PayPal (where your account is eligible) in one component, and it handles 3-D Secure.
* Server: create a PaymentIntent (`automatic_payment_methods`), return its `client_secret`, and let the browser confirm. Mark the payment paid from the webhook.
* **Crypto**: use Stripe's stablecoin/crypto payment method if your account and country support it. Otherwise add a separate adapter (e.g. Coinbase Commerce) behind the same interface.
* **Payouts**:
  * To pay *yourself* out to your own bank: `stripe.payouts.create`.
  * To pay *other people*: **Stripe Connect**. Onboard each recipient as an Express or Custom connected account (Stripe runs their KYC), then `stripe.transfers.create({ destination: 'acct_…' })`. Stripe pays them out to their bank. Connect has to be enabled on your platform account and has its own fees and agreements.
  * PayPal/email payouts need the **PayPal Payouts API** (a PayPal business account with Payouts enabled). Crypto-wallet payouts need Stripe's crypto payouts (where available) or a custody/on-ramp provider. Each is a separate adapter.
* Replace the JSON file with a real database (Postgres/SQLite) using transactions. Add proper user accounts or SSO plus 2FA for the admin area, audit logs, refunds, disputes, email receipts (Stripe can send them), and fraud rules (Radar).
* Legal and compliance: terms of service, refund policy, privacy policy, and sales tax (Stripe Tax). Money-transmission rules can apply if you hold or move funds for others, which is one reason to let Connect and PayPal do it.

## How each method would go live

Each method sits behind the same adapter interface (`providers/index.js`). The usual path is one adapter per real provider, routed by method.

| Method | Customer checkout (pay in) | Payouts (pay out) |
|---|---|---|
| Card, Apple Pay, Google Pay | Stripe Payment Element (register your domain for Apple Pay) | n/a |
| ACH | Stripe `us_bank_account` + Financial Connections | Stripe payouts to your own bank; Stripe Connect transfers to other people |
| PayPal | Stripe (PayPal method, where eligible) or PayPal Checkout / Braintree | PayPal Payouts API |
| **Venmo** | **PayPal Checkout or Braintree** (Venmo is US-only and needs the PayPal/Braintree SDK) | **PayPal Payouts API** with `recipient_wallet: "VENMO"` (by phone/handle) |
| **Cash App Pay** | **Stripe** (`cashapp` payment method) or **Square** Web Payments SDK | No public merchant payout API to $Cashtags. Pay out by ACH or Connect instead, or use Square's banking/payroll products |
| **Zelle** | No merchant API. Customers push money from their bank app, and you reconcile deposits by memo code through your bank feed or Plaid | Your business bank's Zelle for Business (manual or bank API). Some banks offer it through treasury APIs |
| **Klarna / Afterpay** | **Stripe** (`klarna`, `afterpay_clearpay` methods). You're paid in full and the BNPL provider takes the credit risk. Direct merchant agreements are also possible | n/a |
| **Bitcoin (on-chain + Lightning)** | **BTCPay Server** (self-hosted, non-custodial, Lightning via LND/CLN), **BitPay**, **Coinbase Commerce**, OpenNode, or Strike | Custody/exchange API (Coinbase Prime, Kraken, BitGo), BTCPay payouts, or a Lightning node/LNURL-pay for Lightning Addresses |
| **USDC / USDT / ETH / SOL / LTC** | Stripe stablecoin payments (USDC, where available), Coinbase Commerce, BitPay, or chain watchers (Alchemy/Helius/TronGrid webhooks) | Circle (USDC) or a custody provider (Fireblocks, BitGo, Coinbase). Always screen addresses (OFAC) and handle network fees |

Compliance notes: BNPL and pay-app approvals are the provider's decision, not yours. Holding customer crypto, or sending crypto or money to third parties, can trigger money-transmitter and KYC/AML obligations, so use licensed providers. Crypto receipts usually need to be converted to USD for accounting and tax.

## Limitations of this prototype

* Mock processor only. The Apple Pay, Google Pay, PayPal, Venmo, Cash App, Zelle, Klarna, and Afterpay screens are all simulations.
* Demo crypto deposit addresses come from random hashes with valid checksums, so nobody holds their keys. Never send real funds to them. The Lightning invoices are BOLT11-shaped but unsigned and not payable.
* Nothing watches a real blockchain. Crypto rates are hard-coded (USDC/USDT $1, BTC $60,000, ETH $3,000, SOL $150, LTC $80).
* BNPL installment schedules are display-only. A real provider manages collection.
* The JSON-file store is single-process and not meant for concurrency or scale.
* Single admin password. Sessions live in memory, so they reset when the server restarts.
* No refunds, disputes, multi-currency, email sending, or webhook handling yet.
* The Stripe adapter is a stub and throws `501` until it's implemented.

## Sharing a temporary public link (phone testing)

Every page shows a "TEST MODE - no real money" banner. Before sharing, start the server with a strong password, e.g. `ADMIN_PASSWORD="$(cat ADMIN_PASSWORD.txt)" npm start`. `ADMIN_PASSWORD.txt` is git-ignored and left out of the zip. Then run a quick tunnel from a machine that allows it:

```bash
cloudflared tunnel --url http://localhost:3000     # prints https://<random>.trycloudflare.com
# or: npx localtunnel --port 3000   |   ngrok http 3000 (free account)
```

The app trusts `X-Forwarded-*` from loopback only. Behind an HTTPS tunnel the admin cookie gets the `Secure` flag.
