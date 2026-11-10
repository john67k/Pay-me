let method = 'card', asset = 'BTC', network = 'bitcoin', cfg = { cryptoAssets: {}, bnpl: {} };
const idem = uid(); // one idempotency key per checkout attempt (prevents double charges on retry)
const NET_LABEL = { bitcoin: 'On-chain', lightning: '⚡ Lightning', ethereum: 'Ethereum', solana: 'Solana', tron: 'Tron (TRC-20)', litecoin: 'Litecoin' };
const SHEET_METHODS = ['apple_pay', 'google_pay', 'paypal', 'venmo', 'cashapp'];

api('/api/config').then(({ data }) => {
  cfg = data; $('#biz').textContent = data.business; $('#bizName').textContent = data.business; document.title = 'Pay ' + data.business;
  if (!data.testMode) $('#modeBadge').hidden = true; renderAssets(); updateSummary();
});

// ---- client-side validation (server re-validates everything) ----
const digits = (s) => s.replace(/\D/g, '');
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
function luhn(n) { n = digits(n); if (n.length < 12 || n.length > 19) return false; let s = 0, d = false;
  for (let i = n.length - 1; i >= 0; i--) { let x = +n[i]; if (d) { x *= 2; if (x > 9) x -= 9; } s += x; d = !d; } return s % 10 === 0; }
function brand(n) { n = digits(n);
  if (/^4/.test(n)) return 'visa'; if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(n)) return 'mastercard';
  if (/^3[47]/.test(n)) return 'amex'; if (/^(6011|65|64[4-9])/.test(n)) return 'discover'; if (/^35/.test(n)) return 'jcb'; return ''; }
function routingOk(r) { if (!/^\d{9}$/.test(r)) return false; const w = [3, 7, 1]; let s = 0; for (let i = 0; i < 9; i++) s += +r[i] * w[i % 3]; return s % 10 === 0; }
function amountCents() { const s = $('#amount').value.trim(); if (!/^\d+(\.\d{1,2})?$/.test(s)) return null; const c = Math.round(parseFloat(s) * 100); return c > 0 ? c : null; }
function setErr(id, msg) { const el = $('#' + id + 'Err'); if (el) el.textContent = msg || ''; $('#' + id)?.classList.toggle('invalid', !!msg); return !msg; }

function plan(c) { // 4 interest-free installments, every 2 weeks, first today
  const base = Math.floor(c / 4), rem = c - base * 4;
  return [0, 1, 2, 3].map((i) => { const d = new Date(); d.setDate(d.getDate() + 14 * i); return { amt: base + (i ? 0 : rem), d, i }; });
}
function planHtml(kind) {
  const c = amountCents() || 0; const name = kind === 'klarna' ? 'Klarna' : 'Afterpay'; const lim = cfg.bnpl?.[kind];
  const outOfRange = lim && c && (c < lim.min || c > lim.max);
  return `<div style="display:flex;justify-content:space-between;align-items:center"><b>Pay in 4 with ${name}</b><span class="badge">SIMULATED</span></div>
    <div class="small muted">4 interest-free payments of <b>${fmt(Math.floor(c / 4))}</b>${c % 4 ? ' (first ' + fmt(Math.floor(c / 4) + c % 4) + ')' : ''}, every 2 weeks. 0% APR, no fees when paid on time.</div>
    <div class="plan">${plan(c).map((p) => `<div class="inst"><div class="dot q${p.i + 1}"></div><b>${fmt(p.amt)}</b><span class="muted">${p.i ? p.d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Today'}</span></div>`).join('')}</div>
    ${outOfRange ? `<div class="err" style="margin-top:8px">${name} is available for orders ${fmt(lim.min)}–${fmt(lim.max)}.</div>` : ''}
    <div class="small muted" style="margin-top:8px">${esc(cfg.business || '')} is paid in full today. You pay ${name}.</div>`;
}

function renderAssets() {
  const assets = Object.keys(cfg.cryptoAssets || {});
  $('#assetSeg').innerHTML = assets.map((a) => `<button type="button" data-a="${a}" class="${a === asset ? 'active' : ''}">${a}</button>`).join('');
  $$('#assetSeg button').forEach((b) => b.onclick = () => { asset = b.dataset.a; network = cfg.cryptoAssets[asset].networks[0]; renderAssets(); updateSummary(); });
  const nets = cfg.cryptoAssets[asset]?.networks || [];
  $('#netSeg').innerHTML = nets.map((n) => `<button type="button" data-n="${n}" class="${n === network ? 'active' : ''}">${NET_LABEL[n] || n}</button>`).join('');
  $$('#netSeg button').forEach((b) => b.onclick = () => { network = b.dataset.n; renderAssets(); updateSummary(); });
}

function updateSummary() {
  const c = amountCents(); const txt = c ? fmt(c) : '$0.00';
  $('#sumAmt').textContent = txt; $('#sumTotal').textContent = txt; $('#sumDesc').textContent = $('#description').value || '—';
  const labels = { crypto: `Continue to pay ${txt} in ${asset}`, ach: `Pay ${txt} by bank`, zelle: `Get Zelle instructions`,
    klarna: `Continue with Klarna · ${fmt(Math.floor((c || 0) / 4))} today`, afterpay: `Continue with Afterpay · ${fmt(Math.floor((c || 0) / 4))} today` };
  $('#payBtn').textContent = labels[method] || `Pay ${txt}`;
  const a = cfg.cryptoAssets?.[asset];
  if (c && a) $('#cryptoQuote').textContent = `≈ ${(c / 100 / a.rate).toFixed(a.decimals)} ${asset}${network === 'lightning' ? ` (${Math.round(c / 100 / a.rate * 1e8).toLocaleString()} sats)` : ''} at demo rate $${a.rate.toLocaleString()} / ${asset}`;
  if (method === 'klarna' || method === 'afterpay') $('#' + method + 'Plan').innerHTML = planHtml(method);
}
['amount', 'description'].forEach((id) => $('#' + id).addEventListener('input', () => { setErr('amount', ''); updateSummary(); }));

// card formatting
$('#ccNum').addEventListener('input', (e) => {
  const d = digits(e.target.value).slice(0, 19); const b = brand(d);
  e.target.value = b === 'amex' ? d.replace(/^(\d{0,4})(\d{0,6})(\d{0,5}).*/, (m, a, b2, c) => [a, b2, c].filter(Boolean).join(' ')) : d.replace(/(\d{4})(?=\d)/g, '$1 ');
  $('#ccBrand').hidden = !b; $('#ccBrand').textContent = b; $('#ccCvc').maxLength = b === 'amex' ? 4 : 3; setErr('ccNum', '');
});
$('#ccNum').addEventListener('blur', (e) => e.target.value && setErr('ccNum', luhn(e.target.value) ? '' : 'Card number is invalid.'));
$('#ccExp').addEventListener('input', (e) => { const d = digits(e.target.value).slice(0, 4); e.target.value = d.length > 2 ? d.slice(0, 2) + ' / ' + d.slice(2) : d; setErr('ccExp', ''); });
$('#ccCvc').addEventListener('input', (e) => { e.target.value = digits(e.target.value); setErr('ccCvc', ''); });

function validateCard() {
  let ok = setErr('ccNum', luhn($('#ccNum').value) ? '' : 'Card number is invalid.');
  const [mm, yy] = $('#ccExp').value.split('/').map((s) => parseInt(s, 10)); const now = new Date();
  const expOk = mm >= 1 && mm <= 12 && yy >= 0 && new Date(2000 + yy, mm, 1) > now;
  ok = setErr('ccExp', expOk ? '' : 'Expiry is invalid or in the past.') && ok;
  const need = brand($('#ccNum').value) === 'amex' ? 4 : 3;
  ok = setErr('ccCvc', $('#ccCvc').value.length === need ? '' : `CVC must be ${need} digits.`) && ok;
  if (!$('#ccName').value.trim()) { showErr('Name on card is required.'); return false; }
  return ok;
}

// method switching
function selectMethod(btn) {
  method = btn.dataset.m; $$('#methods .method').forEach((x) => x.classList.toggle('active', x === btn));
  if (btn.dataset.asset) { asset = btn.dataset.asset; network = cfg.cryptoAssets?.[asset]?.networks[0] || network; renderAssets(); }
  $$('.panel').forEach((p) => p.classList.toggle('active', p.dataset.p === method));
  $('#payBtn').hidden = SHEET_METHODS.includes(method); hideErr();
  const em = $('#custEmail').value.trim(); ['klarnaEmail', 'afterpayEmail'].forEach((id) => { if (!$('#' + id).value) $('#' + id).value = em; });
  updateSummary();
}
$$('#methods .method').forEach((b) => b.addEventListener('click', () => selectMethod(b)));

function showErr(m) { $('#formErr').textContent = m; $('#formErr').hidden = false; }
function hideErr() { $('#formErr').hidden = true; }
function baseOk() {
  hideErr();
  if (!amountCents()) { setErr('amount', 'Enter an amount greater than $0 (max 2 decimals).'); showErr('Please fix the amount.'); return false; }
  if (!$('#description').value.trim()) { showErr('Please add a description.'); return false; }
  const em = $('#custEmail').value.trim(); if (em && !emailOk(em)) { showErr('Receipt email looks invalid.'); return false; }
  return true;
}

async function submit(details) {
  const btn = $('#payBtn'); const label = btn.textContent; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Processing…';
  const { status, data } = await api('/api/payments', { method: 'POST', body: {
    amount: $('#amount').value.trim(), description: $('#description').value.trim(), method, details, idempotencyKey: idem + ':' + method + ':' + (details.asset || '') + (details.network || ''),
    customer: { name: $('#custName').value.trim(), email: $('#custEmail').value.trim() } } });
  btn.disabled = false; btn.textContent = label;
  if (data && data.id) { location.href = '/receipt?id=' + encodeURIComponent(data.id); return; }
  showErr(data.error || `Payment failed (HTTP ${status}).`);
}

$('#form').addEventListener('submit', (e) => {
  e.preventDefault(); if (!baseOk()) return;
  if (method === 'card') {
    if (!validateCard()) return;
    const [mm, yy] = $('#ccExp').value.split('/').map((s) => s.trim());
    return submit({ number: digits($('#ccNum').value), expMonth: mm, expYear: '20' + yy, cvc: $('#ccCvc').value, name: $('#ccName').value.trim(), postal: $('#ccZip').value.trim() || undefined });
  }
  if (method === 'ach') {
    const r = $('#achRouting').value.trim(), a = $('#achAcct').value.trim();
    let ok = setErr('achRouting', routingOk(r) ? '' : 'Invalid routing number.');
    ok = setErr('achAcct', /^\d{4,17}$/.test(a) ? '' : '4–17 digits.') && ok;
    if (!$('#achName').value.trim()) return showErr('Account holder name is required.');
    if (!ok) return;
    if (!$('#achMandate').checked) return showErr('Please authorize the bank debit.');
    return submit({ accountHolder: $('#achName').value.trim(), routingNumber: r, accountNumber: a, accountType: $('#achType').value, mandate: true });
  }
  if (method === 'zelle') return submit({});
  if (method === 'crypto') return submit({ asset, network });
  if (method === 'klarna' || method === 'afterpay') return bnplSheet(method);
});

// ---- simulated provider sheets ----
function sheet(html, onConfirm) {
  $('#sheetBody').innerHTML = html; $('#sheet').classList.add('show');
  $('#sheetCancel').onclick = () => $('#sheet').classList.remove('show');
  $('#sheetOk').onclick = async () => { const v = onConfirm(); if (v === false) return; $('#sheet').classList.remove('show'); await submit(v); };
}
const biz = () => esc($('#biz').textContent);
function walletSheet(kind) {
  if (!baseOk()) return;
  const name = kind === 'apple_pay' ? 'Apple Pay' : 'Google Pay';
  sheet(`<h2>${name} <span class="badge">SIMULATED</span></h2>
    <div class="kv"><span>Pay</span><span>${biz()}</span></div>
    <div class="kv"><span>Card</span><span>VISA •••• 4242</span></div>
    <div class="kv"><span>Total</span><span><b>${fmt(amountCents())}</b></span></div>
    <button class="btn block ${kind === 'apple_pay' ? 'dark' : ''}" id="sheetOk">${kind === 'apple_pay' ? 'Confirm with Face ID' : 'Pay'}</button>
    <button class="btn ghost block" style="margin-top:8px" id="sheetCancel">Cancel</button>`, () => ({ simulated: true }));
}
function handleSheet({ title, color, label, id, placeholder, pattern, hint, key, prefill = '', extra = '' }) {
  if (!baseOk()) return;
  sheet(`<h2 style="color:${color}">${title} <span class="badge">SIMULATED</span></h2>
    <p class="small muted">Approve ${fmt(amountCents())} to ${biz()}.</p>${extra}
    <label for="${id}">${label}</label><input id="${id}" placeholder="${placeholder}" value="${esc(prefill)}">
    <div class="err" id="${id}Err"></div>
    <button class="btn block" id="sheetOk" style="background:${color}">Approve ${fmt(amountCents())}</button>
    <button class="btn ghost block" style="margin-top:8px" id="sheetCancel">Cancel and return</button>`, () => {
      let val = $('#' + id).value.trim(); if (key === 'cashtag' && val && val[0] !== '$') val = '$' + val; if (key === 'username' && val && val[0] !== '@') val = '@' + val;
      if (!pattern.test(val)) { $('#' + id + 'Err').textContent = hint; return false; } return { [key]: val }; });
}
$('#applePayBtn').onclick = () => walletSheet('apple_pay');
$('#googlePayBtn').onclick = () => walletSheet('google_pay');
$('#paypalBtn').onclick = () => handleSheet({ title: '<i>PayPal</i>', color: '#0070ba', label: 'PayPal email', id: 'ppEmail', placeholder: 'you@example.com',
  pattern: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, hint: 'Enter a valid email.', key: 'email', prefill: $('#custEmail').value });
$('#venmoBtn').onclick = () => handleSheet({ title: '<b>venmo</b>', color: '#008cff', label: 'Venmo username', id: 'vmUser', placeholder: '@jane-doe',
  pattern: /^@[A-Za-z0-9_-]{5,30}$/, hint: 'Enter your @username (5–30 letters, numbers, - or _).', key: 'username' });
$('#cashappBtn').onclick = () => handleSheet({ title: '<b>$ Cash App Pay</b>', color: '#00b83f', label: 'Or approve with your $Cashtag', id: 'caTag', placeholder: '$janedoe',
  pattern: /^\$(?=[A-Za-z0-9_]*[A-Za-z])[A-Za-z0-9_]{1,20}$/, hint: 'Enter a valid $Cashtag (e.g. $janedoe).', key: 'cashtag',
  extra: `<div class="center small muted">Scan with your phone's camera to open Cash App</div>
    <div class="fakeqr"><img alt="Cash App Pay QR" width="140" height="140" src="/api/qr.png?text=${encodeURIComponent('https://cash.app/demo-pay/' + idem.slice(0, 12))}"></div>` });
function bnplSheet(kind) {
  const name = kind === 'klarna' ? 'Klarna' : 'Afterpay'; const email = $('#' + kind + 'Email').value.trim();
  if (!emailOk(email)) return showErr(`Enter the email for your ${name} account.`);
  const lim = cfg.bnpl?.[kind]; const c = amountCents(); if (lim && (c < lim.min || c > lim.max)) return showErr(`${name} is available for orders ${fmt(lim.min)}–${fmt(lim.max)}.`);
  sheet(`<h2>${name} <span class="badge">SIMULATED</span></h2><p class="small muted">Signed in as ${esc(email)} · soft credit check only (simulated)</p>
    <div class="bnpl">${planHtml(kind)}</div>
    <label class="check"><input type="checkbox" id="bnplAgree"> I agree to the ${name} payment schedule above.</label><div class="err" id="bnplErr"></div>
    <button class="btn block" id="sheetOk" style="background:${kind === 'klarna' ? '#17120f' : '#000'}">Confirm plan · pay ${fmt(Math.floor(c / 4) + c % 4)} today</button>
    <button class="btn ghost block" style="margin-top:8px" id="sheetCancel">Cancel</button>`, () => {
      if (!$('#bnplAgree').checked) { $('#bnplErr').textContent = 'Please accept the payment schedule.'; return false; } return { email }; });
}
updateSummary();
