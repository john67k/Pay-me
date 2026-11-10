// Validation helpers shared by the server (the browser does the same checks for UX).

function digits(s) { return String(s || '').replace(/\D/g, ''); }

function luhn(num) {
  const n = digits(num);
  if (n.length < 12 || n.length > 19) return false;
  let sum = 0, dbl = false;
  for (let i = n.length - 1; i >= 0; i--) {
    let d = +n[i];
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d; dbl = !dbl;
  }
  return sum % 10 === 0;
}

function cardBrand(num) {
  const n = digits(num);
  if (/^4/.test(n)) return 'visa';
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(n)) return 'mastercard';
  if (/^3[47]/.test(n)) return 'amex';
  if (/^(6011|65|64[4-9])/.test(n)) return 'discover';
  if (/^35(2[89]|[3-8])/.test(n)) return 'jcb';
  if (/^3(0[0-5]|[68])/.test(n)) return 'diners';
  return 'unknown';
}

function validExpiry(mm, yy, now = new Date()) {
  const m = parseInt(mm, 10); let y = parseInt(yy, 10);
  if (!(m >= 1 && m <= 12) || isNaN(y)) return false;
  if (y < 100) y += 2000;
  if (y > now.getFullYear() + 20) return false;
  // card valid through the last day of the expiry month
  return new Date(y, m, 1) > now;
}

function validCvc(cvc, brand) {
  const c = digits(cvc);
  if (c !== String(cvc).trim()) return false;
  return brand === 'amex' ? c.length === 4 : c.length === 3;
}

// ABA routing number checksum
function validRouting(r) {
  const d = digits(r);
  if (d.length !== 9 || d !== String(r).trim()) return false;
  const w = [3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += +d[i] * w[i % 3];
  return sum % 10 === 0;
}

function validAccount(a) { const d = digits(a); return d === String(a).trim() && d.length >= 4 && d.length <= 17; }
function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim()); }

function validWallet(address, network) {
  const a = String(address || '').trim();
  if (network === 'ethereum') return /^0x[0-9a-fA-F]{40}$/.test(a);
  if (network === 'solana') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
  return false;
}

// Amount in dollars (string/number) -> integer cents, or null
function toCents(amount) {
  const s = String(amount ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(parseFloat(s) * 100);
  return cents > 0 ? cents : null;
}

// Cash App $Cashtag: "$" + 1–20 letters/digits/underscore, at least one letter
function validCashtag(t) { return /^\$(?=[A-Za-z0-9_]*[A-Za-z])[A-Za-z0-9_]{1,20}$/.test(String(t || '').trim()); }
// Venmo @username: "@" + 5–30 letters/digits/hyphens/underscores
function validVenmo(u) { return /^@[A-Za-z0-9_-]{5,30}$/.test(String(u || '').trim()); }
// US phone -> "+1XXXXXXXXXX" or null (NANP: area code & exchange can't start with 0/1)
function normPhone(ph) { let d = digits(ph); if (d.length === 11 && d[0] === '1') d = d.slice(1);
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(d) || /[^\d\s()+.-]/.test(String(ph))) return null; return '+1' + d; }

module.exports = { validCashtag, validVenmo, normPhone, digits, luhn, cardBrand, validExpiry, validCvc, validRouting, validAccount, validEmail, validWallet, toCents };
