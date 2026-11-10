// Payments demo server — TEST MODE. No real money moves with the mock provider.
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const QRCode = require('qrcode');
const store = require('./lib/store');
const v = require('./lib/validation');
const provider = require('./providers');
const addr = require('./lib/addresses');

const PORT = +(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'demo-admin-123';
const BUSINESS_NAME = process.env.BUSINESS_NAME || "John Michael's Shop";
const CURRENCY = 'usd';
const MAX_CENTS = 1_000_000_00; // $1M cap per transaction

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback'); // real client IP / https when behind a local tunnel or reverse proxy
app.use(express.json({ limit: '20kb' }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'" });
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const newId = (p) => `${p}_${crypto.randomBytes(8).toString('hex')}`;
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// ---------- public views (never expose internals) ----------
function publicPayment(p) {
  return { id: p.id, status: p.status, amountCents: p.amountCents, currency: p.currency, description: p.description,
    method: p.method, methodSummary: p.methodSummary, customer: p.customer, failureReason: p.failureReason || null,
    crypto: p.crypto || null, zelle: p.zelle || null, bnpl: p.bnpl || null, providerRef: p.providerRef, createdAt: p.createdAt, updatedAt: p.updatedAt,
    business: BUSINESS_NAME, testMode: provider.testMode };
}

async function refresh(p) {
  const upd = await provider.refreshPayment(p);
  if (upd) { Object.assign(p, upd, { updatedAt: new Date().toISOString() }); store.save(); }
  return p;
}
async function refreshPo(po) {
  const upd = await provider.refreshPayout(po);
  if (upd) { Object.assign(po, upd, { updatedAt: new Date().toISOString() }); store.save(); }
  return po;
}
async function refreshAll() {
  for (const p of store.db.payments) await refresh(p);
  for (const po of store.db.payouts) await refreshPo(po);
}

function balances() {
  const sum = (arr) => arr.reduce((a, x) => a + x.amountCents, 0);
  const incoming = sum(store.db.payments.filter((p) => p.status === 'succeeded'));
  const pendingIn = sum(store.db.payments.filter((p) => p.status === 'processing'));
  const paidOut = sum(store.db.payouts.filter((p) => p.status === 'paid'));
  const pendingOut = sum(store.db.payouts.filter((p) => p.status === 'pending'));
  // Pending payouts are reserved so you can't overdraw.
  return { incomingCents: incoming, paidOutCents: paidOut, pendingInCents: pendingIn, pendingOutCents: pendingOut,
           availableCents: incoming - paidOut - pendingOut };
}

// ---------- config ----------
app.get('/api/config', (req, res) => res.json({ business: BUSINESS_NAME, currency: CURRENCY, provider: provider.name,
  testMode: provider.testMode, cryptoRates: provider.RATES, cryptoAssets: provider.ASSETS || {}, bnpl: provider.BNPL || {} }));

// ---------- customer checkout ----------
function validateMethod(method, d) {
  switch (method) {
    case 'card': {
      if (!v.luhn(d.number)) return 'Card number is invalid.';
      const brand = v.cardBrand(d.number);
      if (!v.validExpiry(d.expMonth, d.expYear)) return 'Card expiry date is invalid or in the past.';
      if (!v.validCvc(d.cvc, brand)) return brand === 'amex' ? 'CVC must be 4 digits for Amex.' : 'CVC must be 3 digits.';
      if (!String(d.name || '').trim()) return 'Name on card is required.';
      if (d.postal !== undefined && !/^[A-Za-z0-9 \-]{3,10}$/.test(String(d.postal).trim())) return 'Postal code is invalid.';
      return null;
    }
    case 'apple_pay': case 'google_pay': return null;
    case 'ach':
      if (!String(d.accountHolder || '').trim()) return 'Account holder name is required.';
      if (!v.validRouting(d.routingNumber)) return 'Routing number is invalid.';
      if (!v.validAccount(d.accountNumber)) return 'Account number must be 4–17 digits.';
      if (!d.mandate) return 'You must authorize the bank debit.';
      return null;
    case 'paypal': return v.validEmail(d.email) ? null : 'A valid PayPal email is required.';
    case 'venmo': return v.validVenmo(d.username) ? null : 'Enter your Venmo @username (5–30 characters).';
    case 'cashapp': return v.validCashtag(d.cashtag) ? null : 'Enter your $Cashtag (e.g. $janedoe).';
    case 'zelle': return null;
    case 'klarna': case 'afterpay': return v.validEmail(d.email) ? null : 'A valid email is required for the payment plan.';
    case 'crypto': {
      const a = (provider.ASSETS || {})[String(d.asset || '').toUpperCase()];
      if (!a) return 'Choose a supported crypto asset.';
      if (d.network && !a.networks.includes(String(d.network).toLowerCase())) return 'That network is not supported for this asset.';
      return null;
    }
    default: return 'Unsupported payment method.';
  }
}

app.post('/api/payments', async (req, res, next) => {
  try {
    const { amount, description, method, details = {}, customer = {}, idempotencyKey } = req.body || {};
    // Idempotency: retries with the same key return the original payment (no double charge)
    if (idempotencyKey) {
      const existing = store.db.payments.find((p) => p.idempotencyKey === String(idempotencyKey));
      if (existing) return res.json(publicPayment(existing));
    }
    const amountCents = v.toCents(amount);
    if (!amountCents) return bad(res, 'Enter an amount greater than $0 (max 2 decimals).');
    if (amountCents > MAX_CENTS) return bad(res, 'Amount exceeds the $1,000,000 limit.');
    const desc = String(description || '').trim().slice(0, 200);
    if (!desc) return bad(res, 'Description is required.');
    if (customer.email && !v.validEmail(customer.email)) return bad(res, 'Customer email is invalid.');
    const err = validateMethod(method, details);
    if (err) return bad(res, err);

    const id = newId('pay');
    // `details` (raw card/bank numbers) goes ONLY to the provider and is never persisted.
    const result = await provider.createPayment({ id, amountCents, currency: CURRENCY, description: desc, method, details,
      customer: { name: customer.name, email: customer.email } });
    const now = new Date().toISOString();
    const payment = { id, idempotencyKey: idempotencyKey ? String(idempotencyKey) : undefined, amountCents, currency: CURRENCY,
      description: desc, method, customer: { name: String(customer.name || '').slice(0, 100), email: String(customer.email || '').slice(0, 200) },
      createdAt: now, updatedAt: now, ...result };
    store.db.payments.push(payment); store.save();
    res.status(result.status === 'failed' ? 402 : 201).json(publicPayment(payment));
  } catch (e) { next(e); }
});

app.get('/api/payments/:id', async (req, res) => {
  const p = store.db.payments.find((x) => x.id === req.params.id);
  if (!p) return bad(res, 'Payment not found', 404);
  res.json(publicPayment(await refresh(p)));
});

app.get('/api/payments/:id/qr.png', async (req, res) => {
  const p = store.db.payments.find((x) => x.id === req.params.id);
  if (!p || !p.crypto) return bad(res, 'Not found', 404);
  res.type('png').send(await QRCode.toBuffer(p.crypto.uri, { width: 260, margin: 1 }));
});

// Generic QR (used for simulated Cash App Pay scan codes). Small payloads only.
app.get('/api/qr.png', async (req, res) => {
  const t = String(req.query.text || ''); if (!t || t.length > 300) return bad(res, 'Bad text');
  res.type('png').send(await QRCode.toBuffer(t, { width: 220, margin: 1 }));
});

// Simulates the chain watcher detecting the customer's transfer.
// Simulates the chain watcher / bank deposit detecting a customer's push payment (crypto or Zelle).
app.post(['/api/payments/:id/simulate-received', '/api/payments/:id/simulate-crypto-received'], async (req, res) => {
  const p = store.db.payments.find((x) => x.id === req.params.id);
  if (!p || !['crypto', 'zelle'].includes(p.method)) return bad(res, 'Payment not found', 404);
  await refresh(p);
  const upd = await provider.confirmReceived(p);
  if (upd) { Object.assign(p, upd, { updatedAt: new Date().toISOString() }); store.save(); }
  res.json(publicPayment(p));
});

// ---------- admin auth ----------
const sessions = new Map(); // token -> expiry
const SESSION_MS = 8 * 60 * 60 * 1000;
const loginAttempts = new Map();

function getCookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
function requireAdmin(req, res, next) {
  const t = getCookie(req, 'admin_session');
  const exp = t && sessions.get(t);
  if (!exp || exp < Date.now()) { if (t) sessions.delete(t); return bad(res, 'Unauthorized', 401); }
  next();
}
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

app.post('/api/admin/login', (req, res) => {
  const ip = req.ip; const now = Date.now();
  const a = loginAttempts.get(ip) || { n: 0, until: 0 };
  if (a.until > now) return bad(res, 'Too many attempts. Try again in a minute.', 429);
  if (!safeEqual((req.body || {}).password || '', ADMIN_PASSWORD)) {
    a.n += 1; if (a.n >= 5) { a.until = now + 60_000; a.n = 0; } loginAttempts.set(ip, a);
    return bad(res, 'Incorrect password', 401);
  }
  loginAttempts.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, now + SESSION_MS);
  res.set('Set-Cookie', `admin_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => {
  const t = getCookie(req, 'admin_session'); if (t) sessions.delete(t);
  res.set('Set-Cookie', 'admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});

// ---------- admin dashboard ----------
app.get('/api/admin/summary', requireAdmin, async (req, res) => {
  await refreshAll();
  const strip = ({ willFail, idempotencyKey, settleAt, ...rest }) => rest;
  res.json({ business: BUSINESS_NAME, provider: provider.name, testMode: provider.testMode, balance: balances(),
    payments: store.db.payments.map(strip).reverse(), payouts: store.db.payouts.map(strip).reverse() });
});

function validatePayoutDest(method, d) {
  switch (method) {
    case 'bank':
      if (!String(d.accountHolder || '').trim()) return 'Recipient name is required.';
      if (!v.validRouting(d.routingNumber)) return 'Routing number is invalid.';
      if (!v.validAccount(d.accountNumber)) return 'Account number must be 4–17 digits.';
      return null;
    case 'paypal': return v.validEmail(d.email) ? null : 'A valid recipient email is required.';
    case 'venmo': return v.validVenmo(d.username) ? null : 'Enter a Venmo @username (5–30 letters, numbers, - or _).';
    case 'cashapp': return v.validCashtag(d.cashtag) ? null : 'Enter a valid $Cashtag ($ + 1–20 letters/numbers/_, at least one letter).';
    case 'zelle': {
      const t = String(d.recipient || '').trim();
      return v.validEmail(t) || v.normPhone(t) ? null : 'Enter the recipient\'s Zelle email or US mobile number.';
    }
    case 'crypto': {
      const asset = String(d.asset || '').toUpperCase(); const a = (provider.ASSETS || {})[asset];
      if (!a) return 'Choose a supported crypto asset.';
      const network = String(d.network || a.networks[0]).toLowerCase();
      if (!a.networks.includes(network)) return 'That network is not supported for this asset.';
      if (!addr.validAddress(network, d.address)) return {
        ethereum: 'Enter a valid Ethereum address (0x + 40 hex chars).', solana: 'Enter a valid Solana address.',
        tron: 'Enter a valid Tron address (starts with T, checksum verified).',
        bitcoin: 'Enter a valid Bitcoin address (bc1… bech32/taproot, or legacy 1…/3…; checksum verified).',
        litecoin: 'Enter a valid Litecoin address (ltc1…, L…, M… or 3…).',
        lightning: 'Enter a Lightning Address (name@domain) or a BOLT11 invoice (lnbc…).' }[network];
      return null;
    }
    default: return 'Unsupported payout method.';
  }
}

app.post('/api/admin/payouts', requireAdmin, async (req, res, next) => {
  try {
    const { amount, method, destination = {}, note, recipientName, idempotencyKey } = req.body || {};
    if (idempotencyKey) {
      const existing = store.db.payouts.find((p) => p.idempotencyKey === String(idempotencyKey));
      if (existing) return res.json(existing);
    }
    await refreshAll();
    const amountCents = v.toCents(amount);
    if (!amountCents) return bad(res, 'Enter an amount greater than $0.');
    const err = validatePayoutDest(method, destination);
    if (err) return bad(res, err);
    const bal = balances();
    if (amountCents > bal.availableCents) return bad(res, `Insufficient available balance ($${(bal.availableCents / 100).toFixed(2)}).`, 409);

    const id = newId('po');
    let dest;
    if (method === 'bank') dest = { accountHolder: destination.accountHolder.trim(), last4: v.digits(destination.accountNumber).slice(-4), routingLast4: v.digits(destination.routingNumber).slice(-4) };
    if (method === 'paypal') dest = { email: destination.email.trim().toLowerCase() };
    if (method === 'venmo') dest = { username: destination.username.trim() };
    if (method === 'cashapp') dest = { cashtag: destination.cashtag.trim() };
    if (method === 'zelle') { const t = destination.recipient.trim(); dest = v.validEmail(t) ? { email: t.toLowerCase() } : { phone: v.normPhone(t) }; }
    if (method === 'crypto') {
      const asset = destination.asset.toUpperCase(); const network = String(destination.network || provider.ASSETS[asset].networks[0]).toLowerCase();
      dest = { asset, network, address: destination.address.trim() };
      if (provider.cryptoAmount) dest.cryptoAmount = provider.cryptoAmount(amountCents, asset);
    }

    const result = await provider.createPayout({ id, amountCents, currency: CURRENCY, method, destination: { ...destination, ...dest } });
    const now = new Date().toISOString();
    const payout = { id, idempotencyKey: idempotencyKey ? String(idempotencyKey) : undefined, amountCents, currency: CURRENCY, method,
      recipientName: String(recipientName || dest.accountHolder || dest.email || dest.username || dest.cashtag || dest.phone || '').slice(0, 100), destination: dest,
      note: String(note || '').slice(0, 200), createdAt: now, updatedAt: now, ...result };
    store.db.payouts.push(payout); store.save();
    const { willFail, settleAt, idempotencyKey: _k, ...pub } = payout;
    res.status(201).json(pub);
  } catch (e) { next(e); }
});

app.use((err, req, res, _next) => {
  if (err.type === 'entity.parse.failed') return bad(res, 'Invalid JSON');
  console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' });
});

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`Payments demo (${provider.name}${provider.testMode ? ', TEST MODE' : ''}) on http://${HOST}:${PORT}`);
    if (!process.env.ADMIN_PASSWORD) console.log('Admin password: default "demo-admin-123" (set ADMIN_PASSWORD to change)');
  });
}
module.exports = app;
