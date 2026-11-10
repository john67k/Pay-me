// Mock provider: simulates a payment processor entirely in-process. NO real money moves.
const crypto = require('crypto');
const { digits, cardBrand } = require('../lib/validation');
const addr = require('../lib/addresses');

const ACH_SETTLE_MS = +(process.env.MOCK_ACH_SETTLE_MS || 8000);
const PAYOUT_SETTLE_MS = +(process.env.MOCK_PAYOUT_SETTLE_MS || 5000);
const CRYPTO_TTL_MS = 30 * 60 * 1000;
const ZELLE_TTL_MS = 24 * 60 * 60 * 1000;
const ZELLE_RECIPIENT = process.env.ZELLE_RECIPIENT || 'payments@johnmichael.example';

// Demo crypto catalog: static USD rates, supported networks, display decimals.
const ASSETS = {
  USDC: { rate: 1, decimals: 2, networks: ['solana', 'ethereum'] },
  USDT: { rate: 1, decimals: 2, networks: ['ethereum', 'tron', 'solana'] },
  ETH: { rate: 3000, decimals: 6, networks: ['ethereum'] },
  SOL: { rate: 150, decimals: 6, networks: ['solana'] },
  BTC: { rate: 60000, decimals: 8, networks: ['bitcoin', 'lightning'] },
  LTC: { rate: 80, decimals: 6, networks: ['litecoin'] },
};
const RATES = Object.fromEntries(Object.entries(ASSETS).map(([k, v]) => [k, v.rate]));
const TOKEN_CONTRACTS = { // real mainnet token contracts, shown for realism
  'USDC:solana': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'USDC:ethereum': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  'USDT:ethereum': '0xdAC17F958D2ee523a2206206994597C13D831ec7', 'USDT:tron': 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  'USDT:solana': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
};
// BNPL plans (merchant is paid in full up front; customer pays the provider in 4)
const BNPL = { klarna: { name: 'Klarna', min: 1000, max: 1000000 }, afterpay: { name: 'Afterpay', min: 100, max: 200000 } };

// Special test values (mirroring Stripe's test-mode conventions)
const DECLINE_CARDS = {
  '4000000000000002': 'Your card was declined.',
  '4000000000009995': 'Your card has insufficient funds.',
  '4000000000000127': 'Your card\'s security code is incorrect.',
};
const ACH_FAIL_ACCOUNT = '000111111116';
const MAGIC_DECLINE_CENTS = 1313; // $13.13 declines for any method

const ref = (p) => `${p}_mock_${crypto.randomBytes(10).toString('hex')}`;
const randHash = (network) => network === 'ethereum' ? '0x' + crypto.randomBytes(32).toString('hex')
  : ['bitcoin', 'litecoin', 'tron', 'lightning'].includes(network) ? crypto.randomBytes(32).toString('hex') : crypto.randomBytes(32).toString('base64url');

function cryptoAmount(amountCents, asset) {
  const a = ASSETS[asset]; return (amountCents / 100 / a.rate).toFixed(a.decimals);
}

function installments(amountCents, n = 4, everyDays = 14) {
  const base = Math.floor(amountCents / n), rem = amountCents - base * n; const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(); d.setDate(d.getDate() + i * everyDays);
    out.push({ n: i + 1, amountCents: base + (i === 0 ? rem : 0), due: d.toISOString().slice(0, 10), status: i === 0 ? 'paid' : 'scheduled' });
  }
  return out;
}

function cryptoQuote(id, amountCents, asset, network) {
  const amount = cryptoAmount(amountCents, asset); const expiresAt = Date.now() + CRYPTO_TTL_MS;
  if (network === 'lightning') {
    const sats = Math.round(amountCents / 100 / ASSETS.BTC.rate * 1e8);
    const invoice = addr.demoLightningInvoice(sats, id);
    return { asset, network, amount, sats, rateUsd: ASSETS[asset].rate, address: invoice, invoice, uri: `lightning:${invoice}`, expiresAt: Date.now() + 15 * 60 * 1000 };
  }
  const address = addr.demoAddress(network, id); const token = TOKEN_CONTRACTS[`${asset}:${network}`];
  let uri;
  if (network === 'bitcoin') uri = `bitcoin:${address}?amount=${amount}&label=Demo%20Payment`;
  else if (network === 'litecoin') uri = `litecoin:${address}?amount=${amount}`;
  else if (network === 'ethereum') uri = token ? `ethereum:${token}/transfer?address=${address}&uint256=${Math.round(+amount * 1e6)}` : `ethereum:${address}?value=${amount}`;
  else if (network === 'solana') uri = `solana:${address}?amount=${amount}${token ? '&spl-token=' + token : ''}&label=Demo%20Payment`;
  else if (network === 'tron') uri = `tron:${address}?amount=${amount}${token ? '&token=' + token : ''}`;
  return { asset, network, amount, rateUsd: ASSETS[asset].rate, address, token, uri, expiresAt };
}

async function createPayment({ id, amountCents, method, details }) {
  const declined = (reason) => ({ status: 'failed', providerRef: ref('pi'), failureReason: reason });
  const magic = amountCents === MAGIC_DECLINE_CENTS;

  switch (method) {
    case 'card': {
      const n = digits(details.number);
      const summary = { brand: cardBrand(n), last4: n.slice(-4), expMonth: +details.expMonth, expYear: +details.expYear };
      if (DECLINE_CARDS[n]) return { ...declined(DECLINE_CARDS[n]), methodSummary: summary };
      if (magic) return { ...declined('Your card was declined (test amount $13.13).'), methodSummary: summary };
      return { status: 'succeeded', providerRef: ref('pi'), methodSummary: summary };
    }
    case 'apple_pay':
    case 'google_pay': {
      const summary = { wallet: method, brand: 'visa', last4: '4242' };
      if (magic) return { ...declined('Wallet payment declined (test amount $13.13).'), methodSummary: summary };
      return { status: 'succeeded', providerRef: ref('pi'), methodSummary: summary };
    }
    case 'ach': {
      const acct = digits(details.accountNumber);
      const summary = { bankName: 'Test Bank', accountType: details.accountType || 'checking', last4: acct.slice(-4), holder: details.accountHolder };
      if (magic) return { ...declined('Bank debit declined (test amount $13.13).'), methodSummary: summary };
      return { status: 'processing', providerRef: ref('pi'), methodSummary: summary,
               settleAt: Date.now() + ACH_SETTLE_MS, willFail: acct === ACH_FAIL_ACCOUNT };
    }
    case 'paypal': case 'venmo': case 'cashapp': {
      const handle = String(details.email || details.username || details.cashtag).trim();
      const summary = method === 'paypal' ? { email: handle.toLowerCase() } : method === 'venmo' ? { username: handle } : { cashtag: handle };
      const label = { paypal: 'PayPal', venmo: 'Venmo', cashapp: 'Cash App Pay' }[method];
      if (/decline/i.test(handle) || magic) return { ...declined(`${label} declined the payment.`), methodSummary: summary };
      return { status: 'succeeded', providerRef: ref({ paypal: 'PAYID', venmo: 'VENMO', cashapp: 'CAP' }[method]), methodSummary: summary };
    }
    case 'zelle': {
      // Zelle has no merchant API for pulling funds: customer sends from their bank app with a memo code.
      const memo = 'ZL-' + crypto.randomBytes(3).toString('hex').toUpperCase();
      return { status: 'pending', providerRef: ref('zelle'), methodSummary: { recipient: ZELLE_RECIPIENT, memo },
               zelle: { recipient: ZELLE_RECIPIENT, recipientName: process.env.BUSINESS_NAME || "John Michael's Shop", memo, expiresAt: Date.now() + ZELLE_TTL_MS } };
    }
    case 'klarna': case 'afterpay': {
      const plan = BNPL[method];
      const summary = { provider: plan.name, email: String(details.email || '').trim().toLowerCase(), installments: 4 };
      if (amountCents < plan.min || amountCents > plan.max)
        return { ...declined(`${plan.name} is available for orders between $${plan.min / 100} and $${(plan.max / 100).toLocaleString()}.`), methodSummary: summary };
      if (/decline/i.test(summary.email) || magic) return { ...declined(`${plan.name} couldn't approve this purchase.`), methodSummary: summary };
      return { status: 'succeeded', providerRef: ref(method === 'klarna' ? 'klarna' : 'ap'), methodSummary: summary,
               bnpl: { provider: plan.name, schedule: installments(amountCents), interestCents: 0 } };
    }
    case 'crypto': {
      const asset = String(details.asset || 'USDC').toUpperCase();
      const network = String(details.network || ASSETS[asset]?.networks[0] || '').toLowerCase();
      if (!ASSETS[asset] || !ASSETS[asset].networks.includes(network)) throw Object.assign(new Error('Unsupported asset/network'), { status: 400 });
      return { status: 'pending', providerRef: ref('cpay'), methodSummary: { asset, network }, crypto: cryptoQuote(id, amountCents, asset, network) };
    }
    default:
      throw Object.assign(new Error('Unsupported payment method'), { status: 400 });
  }
}

async function refreshPayment(p) {
  if (p.status === 'processing' && p.settleAt && Date.now() >= p.settleAt) {
    return p.willFail ? { status: 'failed', failureReason: 'Bank debit returned (R01: insufficient funds).' } : { status: 'succeeded' };
  }
  if (p.status === 'pending' && p.crypto && Date.now() >= p.crypto.expiresAt)
    return { status: 'failed', failureReason: 'Payment window expired before funds arrived.' };
  if (p.status === 'pending' && p.zelle && Date.now() >= p.zelle.expiresAt)
    return { status: 'failed', failureReason: 'No Zelle transfer was received in time.' };
  return null;
}

// Simulates detecting the customer's push payment (on-chain transfer or Zelle deposit).
async function confirmReceived(p) {
  if (p.status !== 'pending') return null;
  if (p.crypto) return { status: 'succeeded', crypto: { ...p.crypto, txHash: p.crypto.network === 'lightning' ? 'preimage_' + randHash('lightning') : randHash(p.crypto.network) } };
  if (p.zelle) return { status: 'succeeded', zelle: { ...p.zelle, confirmation: 'ZEL' + crypto.randomBytes(5).toString('hex').toUpperCase() } };
  return null;
}

async function createPayout({ method, destination }) {
  let willFail = false;
  if (method === 'bank' && digits(destination.accountNumber) === ACH_FAIL_ACCOUNT) willFail = true;
  const handle = destination.email || destination.username || destination.cashtag || destination.phone || '';
  if (['paypal', 'venmo', 'cashapp', 'zelle'].includes(method) && /fail/i.test(handle)) willFail = true;
  return { status: 'pending', providerRef: ref('po'), settleAt: Date.now() + PAYOUT_SETTLE_MS, willFail };
}

async function refreshPayout(po) {
  if (po.status === 'pending' && Date.now() >= po.settleAt) {
    if (po.willFail) return { status: 'failed', failureReason: po.method === 'bank' ? 'Account closed (R02).' : 'Recipient could not receive funds.' };
    const upd = { status: 'paid' };
    if (po.method === 'crypto') upd.txHash = po.destination.network === 'lightning' ? 'preimage_' + randHash('lightning') : randHash(po.destination.network);
    return upd;
  }
  return null;
}

module.exports = { name: 'mock', testMode: true, RATES, ASSETS, BNPL, cryptoAmount, createPayment, refreshPayment,
  confirmReceived, confirmCrypto: confirmReceived, createPayout, refreshPayout };
