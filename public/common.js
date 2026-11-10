const fmt = (c, cur = 'usd') => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur.toUpperCase() }).format(c / 100);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());
async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}
const METHOD_LABEL = { card: 'Card', apple_pay: 'Apple Pay', google_pay: 'Google Pay', ach: 'Bank transfer (ACH)', paypal: 'PayPal', venmo: 'Venmo', cashapp: 'Cash App', zelle: 'Zelle', klarna: 'Klarna', afterpay: 'Afterpay', crypto: 'Crypto', bank: 'Bank transfer' };
const NETWORK_NAME = { bitcoin: 'Bitcoin', lightning: 'Lightning', ethereum: 'Ethereum', solana: 'Solana', tron: 'Tron', litecoin: 'Litecoin' };
function methodText(m, s = {}) {
  if (!s) return METHOD_LABEL[m] || m;
  if (m === 'card') return `${(s.brand || 'card').toUpperCase()} •••• ${s.last4}`;
  if (m === 'apple_pay' || m === 'google_pay') return `${METHOD_LABEL[m]} (${(s.brand || '').toUpperCase()} •••• ${s.last4})`;
  if (m === 'ach') return `${s.bankName || 'Bank'} ${s.accountType || ''} •••• ${s.last4}`;
  if (m === 'paypal') return `PayPal · ${s.email}`;
  if (m === 'venmo') return `Venmo · ${s.username}`;
  if (m === 'cashapp') return `Cash App Pay · ${s.cashtag}`;
  if (m === 'zelle') return `Zelle · memo ${s.memo}`;
  if (m === 'klarna' || m === 'afterpay') return `${s.provider} · Pay in 4`;
  if (m === 'crypto') return `${s.asset} on ${NETWORK_NAME[s.network] || s.network}`;
  return METHOD_LABEL[m] || m;
}
