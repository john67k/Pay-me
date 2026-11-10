// Crypto address helpers: real checksum validation (Base58Check, Bech32/Bech32m) and
// generators for well-formed DEMO deposit addresses (random keys nobody holds; never send funds).
const crypto = require('crypto');

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();
const sha256d = (b) => sha256(sha256(b));

function b58encode(buf) {
  let n = BigInt('0x' + (buf.toString('hex') || '0')); let s = '';
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const byte of buf) { if (byte === 0) s = '1' + s; else break; }
  return s;
}
function b58decode(str) {
  let n = 0n;
  for (const c of str) { const i = B58.indexOf(c); if (i < 0) return null; n = n * 58n + BigInt(i); }
  let hex = n.toString(16); if (hex.length % 2) hex = '0' + hex; if (n === 0n) hex = '';
  const lead = str.match(/^1*/)[0].length;
  return Buffer.concat([Buffer.alloc(lead), Buffer.from(hex, 'hex')]);
}
function b58checkEncode(version, payload) {
  const body = Buffer.concat([Buffer.from([version]), payload]);
  return b58encode(Buffer.concat([body, sha256d(body).subarray(0, 4)]));
}
function b58checkDecode(str) {
  const raw = b58decode(str); if (!raw || raw.length < 5) return null;
  const body = raw.subarray(0, -4);
  if (!sha256d(body).subarray(0, 4).equals(raw.subarray(-4))) return null;
  return { version: body[0], payload: body.subarray(1) };
}

// ---- Bech32 / Bech32m (BIP-173 / BIP-350) ----
const CS = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function polymod(values) {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]; let chk = 1;
  for (const v of values) { const top = chk >>> 25; chk = ((chk & 0x1ffffff) << 5) ^ v; for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= G[i]; }
  return chk >>> 0;
}
const hrpExpand = (h) => [...[...h].map((c) => c.charCodeAt(0) >> 5), 0, ...[...h].map((c) => c.charCodeAt(0) & 31)];
const BECH32 = 1, BECH32M = 0x2bc830a3;
function convertBits(data, from, to, pad) {
  let acc = 0, bits = 0; const out = []; const max = (1 << to) - 1;
  for (const v of data) { acc = (acc << from) | v; bits += from; while (bits >= to) { bits -= to; out.push((acc >> bits) & max); } }
  if (pad && bits) out.push((acc << (to - bits)) & max);
  else if (!pad && (bits >= from || ((acc << (to - bits)) & max))) return null;
  return out;
}
function bech32Encode(hrp, data, constant) {
  const p = polymod([...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ constant;
  const chk = [0, 1, 2, 3, 4, 5].map((i) => (p >>> (5 * (5 - i))) & 31);
  return hrp + '1' + [...data, ...chk].map((d) => CS[d]).join('');
}
function bech32Decode(str) {
  if (str !== str.toLowerCase() && str !== str.toUpperCase()) return null;
  str = str.toLowerCase(); const pos = str.lastIndexOf('1');
  if (pos < 1 || pos + 7 > str.length || str.length > 90) return null;
  const hrp = str.slice(0, pos); const data = [...str.slice(pos + 1)].map((c) => CS.indexOf(c));
  if (data.includes(-1)) return null;
  const c = polymod([...hrpExpand(hrp), ...data]);
  if (c !== BECH32 && c !== BECH32M) return null;
  return { hrp, data: data.slice(0, -6), spec: c };
}
function segwitDecode(hrp, addr) {
  const d = bech32Decode(addr); if (!d || d.hrp !== hrp || !d.data.length) return false;
  const ver = d.data[0]; const prog = convertBits(d.data.slice(1), 5, 8, false);
  if (!prog || prog.length < 2 || prog.length > 40 || ver > 16) return false;
  if (ver === 0 && (d.spec !== BECH32 || (prog.length !== 20 && prog.length !== 32))) return false;
  if (ver !== 0 && d.spec !== BECH32M) return false;
  return true;
}
const segwitEncode = (hrp, ver, prog) => bech32Encode(hrp, [ver, ...convertBits(prog, 8, 5, true)], ver === 0 ? BECH32 : BECH32M);

// ---- validators ----
function validBitcoin(a) {
  a = String(a || '').trim();
  if (/^bc1/i.test(a)) return segwitDecode('bc', a);               // bech32 (bc1q…) / bech32m taproot (bc1p…)
  if (!/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(a)) return false;   // legacy P2PKH (1…) / P2SH (3…)
  const d = b58checkDecode(a); return !!d && d.payload.length === 20 && (d.version === 0x00 || d.version === 0x05);
}
function validLitecoin(a) {
  a = String(a || '').trim();
  if (/^ltc1/i.test(a)) return segwitDecode('ltc', a);
  if (!/^[LM3][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(a)) return false;
  const d = b58checkDecode(a); return !!d && d.payload.length === 20 && [0x30, 0x32, 0x05].includes(d.version);
}
function validTron(a) {
  a = String(a || '').trim(); if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)) return false;
  const d = b58checkDecode(a); return !!d && d.version === 0x41 && d.payload.length === 20;
}
const validEthereum = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a || '').trim());
const validSolana = (a) => { a = String(a || '').trim(); if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return false; const b = b58decode(a); return !!b && b.length === 32; };
// Lightning payout destination: Lightning Address (name@domain) or a BOLT11 invoice
const validLightning = (a) => { a = String(a || '').trim();
  return /^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(a) || (/^ln(bc|tb)/i.test(a) && !!bech32DecodeLoose(a)); };
function bech32DecodeLoose(s) { // BOLT11 invoices exceed the 90-char bech32 limit
  s = s.toLowerCase(); const pos = s.lastIndexOf('1'); if (pos < 3) return null;
  const data = [...s.slice(pos + 1)].map((c) => CS.indexOf(c)); if (data.includes(-1) || data.length < 7) return null;
  return polymod([...hrpExpand(s.slice(0, pos)), ...data]) === BECH32 ? true : null;
}

function validAddress(network, a) {
  return ({ ethereum: validEthereum, solana: validSolana, tron: validTron, bitcoin: validBitcoin, litecoin: validLitecoin, lightning: validLightning }[network] || (() => false))(a);
}

// ---- demo generators (deterministic from a seed) ----
function demoAddress(network, seed) {
  const h = sha256(Buffer.from(String(seed))); const h20 = h.subarray(0, 20);
  switch (network) {
    case 'ethereum': return '0x' + h20.toString('hex');
    case 'solana': { let s = b58encode(h); return s; }
    case 'tron': return b58checkEncode(0x41, h20);
    case 'bitcoin': return segwitEncode('bc', 0, h20);
    case 'litecoin': return segwitEncode('ltc', 0, h20);
    default: throw new Error('no address for ' + network);
  }
}
// Fake BOLT11-shaped invoice with a valid bech32 checksum (not signed, not payable).
function demoLightningInvoice(sats, seed) {
  const hrp = 'lnbc' + (sats * 10) + 'n';
  const data = convertBits(sha256d(Buffer.from(String(seed))), 8, 5, true);
  const more = convertBits(sha256(Buffer.from('x' + seed)), 8, 5, true);
  return bech32Encode(hrp, [...data, ...more, ...data], BECH32);
}

module.exports = { validAddress, validBitcoin, validLitecoin, validTron, validEthereum, validSolana, validLightning,
  demoAddress, demoLightningInvoice, b58checkEncode, segwitEncode };
