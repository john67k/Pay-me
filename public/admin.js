let poMethod = 'bank', tab = 'all', summary = null, poTimer, cfg = { cryptoAssets: {} };
const NET_PH = { bitcoin: 'bc1q… or 1…/3… address', lightning: 'name@wallet.com or lnbc… invoice', ethereum: '0x…', solana: 'Solana address', tron: 'T… address', litecoin: 'ltc1… / L… / M… address' };
const NET_OPT = { bitcoin: 'Bitcoin (on-chain)', lightning: 'Lightning ⚡', ethereum: 'Ethereum (ERC-20)', solana: 'Solana (SPL)', tron: 'Tron (TRC-20)', litecoin: 'Litecoin' };
function fillNets() {
  const a = cfg.cryptoAssets[$('#poAsset').value]; if (!a) return;
  $('#poNet').innerHTML = a.networks.map((n) => `<option value="${n}">${NET_OPT[n] || n}</option>`).join(''); netChanged();
}
function netChanged() {
  const n = $('#poNet').value; $('#poAddr').placeholder = NET_PH[n] || '';
  $('#poAddrLabel').textContent = n === 'lightning' ? 'Lightning Address or invoice' : 'Wallet address'; quote();
}
function quote() {
  const a = cfg.cryptoAssets[$('#poAsset').value]; const v = +$('#poAmount').value;
  $('#poQuote').textContent = a && v > 0 ? `≈ ${(v / a.rate).toFixed(a.decimals)} ${$('#poAsset').value} at demo rate $${a.rate.toLocaleString()}` : '';
}
api('/api/config').then(({ data }) => { cfg = data;
  $('#poAsset').innerHTML = Object.keys(data.cryptoAssets).map((k) => `<option>${k}</option>`).join(''); $('#poAsset').value = 'BTC'; fillNets(); });

async function load() {
  const { ok, status, data } = await api('/api/admin/summary');
  if (status === 401) { $('#loginView').hidden = false; $('#dash').hidden = true; $('#logout').hidden = true; return; }
  if (!ok) return;
  summary = data; $('#loginView').hidden = true; $('#dash').hidden = false; $('#logout').hidden = false;
  $('#biz').textContent = data.business + ' · Payouts';
  const b = data.balance;
  $('#sAvail').textContent = fmt(b.availableCents); $('#sIn').textContent = fmt(b.incomingCents); $('#sOut').textContent = fmt(b.paidOutCents);
  $('#sPend').innerHTML = `<span class="in">+${fmt(b.pendingInCents)}</span> in<br><span>−${fmt(b.pendingOutCents)}</span> out`;
  renderRows();
  clearTimeout(poTimer);
  if (data.payouts.some((p) => p.status === 'pending') || data.payments.some((p) => p.status === 'processing')) poTimer = setTimeout(load, 2500);
}

const when = (t) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function destText(po) {
  const d = po.destination || {};
  if (po.method === 'bank') return `Bank •••• ${d.last4}`;
  if (po.method === 'paypal') return `PayPal · ${d.email}`;
  if (po.method === 'venmo') return `Venmo · ${d.username}`;
  if (po.method === 'cashapp') return `Cash App · ${d.cashtag}`;
  if (po.method === 'zelle') return `Zelle · ${d.email || d.phone}`;
  if (po.method === 'crypto') return `${d.cryptoAmount ? d.cryptoAmount + ' ' : ''}${d.asset}${d.network === 'lightning' ? ' ⚡' : ''} → ${d.address.slice(0, 6)}…${d.address.slice(-4)}`;
  return po.method;
}
function renderRows() {
  const rows = [];
  if (tab !== 'out') summary.payments.forEach((p) => rows.push({ t: p.createdAt, html: `<tr class="${p.status === 'failed' ? 'failed-row' : ''}">
    <td class="small nw">${when(p.createdAt)}</td><td class="nw"><span class="in">↓ In</span></td>
    <td>${esc(p.description)}<div class="small muted">${esc(p.customer?.name || p.customer?.email || '')}</div></td>
    <td class="small">${esc(methodText(p.method, p.methodSummary))}</td>
    <td><span class="pill ${p.status}" title="${esc(p.failureReason || '')}">${p.status}</span></td>
    <td style="text-align:right" class="in nw amt">+${fmt(p.amountCents)}</td></tr>` }));
  if (tab !== 'in') summary.payouts.forEach((po) => rows.push({ t: po.createdAt, html: `<tr class="${po.status === 'failed' ? 'failed-row' : ''}">
    <td class="small nw">${when(po.createdAt)}</td><td class="nw"><span class="out">↑ Payout</span></td>
    <td>${esc(po.recipientName || '—')}<div class="small muted">${esc(po.note || '')}</div></td>
    <td class="small">${esc(destText(po))}</td>
    <td><span class="pill ${po.status}" title="${esc(po.failureReason || '')}">${po.status}</span>${po.failureReason ? `<div class="small" style="color:var(--err)">${esc(po.failureReason)}</div>` : ''}</td>
    <td style="text-align:right" class="out nw amt">−${fmt(po.amountCents)}</td></tr>` }));
  rows.sort((a, b) => b.t.localeCompare(a.t));
  $('#rows').innerHTML = rows.map((r) => r.html).join('') || '<tr><td colspan="6" class="muted center" style="padding:30px">No transactions yet.</td></tr>';
}
$$('#tabs button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.t; $$('#tabs button').forEach((x) => x.classList.toggle('active', x === b)); renderRows(); }));

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#loginErr').hidden = true;
  const { ok, data } = await api('/api/admin/login', { method: 'POST', body: { password: $('#pw').value } });
  if (!ok) { $('#loginErr').textContent = data.error || 'Login failed'; $('#loginErr').hidden = false; return; }
  $('#pw').value = ''; load();
});
$('#logout').addEventListener('click', async () => { await api('/api/admin/logout', { method: 'POST' }); load(); });

$$('#poSeg button').forEach((b) => b.addEventListener('click', () => {
  poMethod = b.dataset.m; $$('#poSeg button').forEach((x) => x.classList.toggle('active', x === b));
  $$('#poForm .panel').forEach((p) => p.classList.toggle('active', p.dataset.p === poMethod));
}));
$('#poAsset').addEventListener('change', fillNets); $('#poNet').addEventListener('change', netChanged); $('#poAmount').addEventListener('input', quote);

function buildPayout() {
  const amount = $('#poAmount').value.trim();
  const body = { amount, method: poMethod, note: $('#poNote').value.trim(), idempotencyKey: uid() };
  if (poMethod === 'bank') { body.destination = { accountHolder: $('#poHolder').value.trim(), routingNumber: $('#poRouting').value.trim(), accountNumber: $('#poAcct').value.trim() }; body.recipientName = body.destination.accountHolder; }
  if (poMethod === 'paypal') { body.destination = { email: $('#poEmail').value.trim() }; body.recipientName = $('#poName').value.trim() || body.destination.email; }
  if (poMethod === 'zelle') { body.destination = { recipient: $('#poZelle').value.trim() }; body.recipientName = $('#poZName').value.trim() || body.destination.recipient; }
  if (poMethod === 'venmo') { let u = $('#poVenmo').value.trim(); if (u && u[0] !== '@') u = '@' + u; body.destination = { username: u }; body.recipientName = $('#poVName').value.trim() || u; }
  if (poMethod === 'cashapp') { let t = $('#poCashtag').value.trim(); if (t && t[0] !== '$') t = '$' + t; body.destination = { cashtag: t }; body.recipientName = $('#poCAName').value.trim() || t; }
  if (poMethod === 'crypto') { body.destination = { asset: $('#poAsset').value, network: $('#poNet').value, address: $('#poAddr').value.trim() }; body.recipientName = $('#poCName').value.trim() || 'Crypto wallet'; }
  return body;
}
function localCheck(b) {
  if (!/^\d+(\.\d{1,2})?$/.test(b.amount) || +b.amount <= 0) return 'Enter a valid amount.';
  const cents = Math.round(+b.amount * 100); if (summary && cents > summary.balance.availableCents) return `Amount exceeds available balance (${fmt(summary.balance.availableCents)}).`;
  const d = b.destination;
  if (b.method === 'bank') { if (!d.accountHolder) return 'Recipient name is required.'; if (!/^\d{9}$/.test(d.routingNumber)) return 'Routing number must be 9 digits.'; if (!/^\d{4,17}$/.test(d.accountNumber)) return 'Account number must be 4–17 digits.'; }
  if (b.method === 'paypal' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) return 'Enter a valid email.';
  if (b.method === 'venmo' && !/^@[A-Za-z0-9_-]{5,30}$/.test(d.username)) return 'Enter a Venmo @username (5–30 letters, numbers, - or _).';
  if (b.method === 'cashapp' && !/^\$(?=[A-Za-z0-9_]*[A-Za-z])[A-Za-z0-9_]{1,20}$/.test(d.cashtag)) return 'Enter a valid $Cashtag (e.g. $janedoe).';
  if (b.method === 'zelle' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.recipient) && !/^(\+?1)?[2-9]\d{2}[2-9]\d{6}$/.test(d.recipient.replace(/[\s().-]/g, ''))) return 'Enter a Zelle email or US mobile number.';
  if (b.method === 'crypto' && !d.address) return 'Enter a wallet address.'; // full checksum validation happens on the server
  return null;
}
$('#poForm').addEventListener('submit', (e) => {
  e.preventDefault(); $('#poErr').hidden = true; $('#poOk').hidden = true;
  const b = buildPayout(); const err = localCheck(b);
  if (err) { $('#poErr').textContent = err; $('#poErr').hidden = false; return; }
  const d = b.destination; const cents = Math.round(+b.amount * 100);
  const to = b.method === 'bank' ? `${esc(d.accountHolder)} · Bank •••• ${esc(d.accountNumber.slice(-4))} (routing ${esc(d.routingNumber)})`
    : b.method === 'paypal' ? `${esc(b.recipientName)} · ${esc(d.email)}`
    : b.method === 'venmo' ? `${esc(b.recipientName)} · ${esc(d.username)}`
    : b.method === 'cashapp' ? `${esc(b.recipientName)} · ${esc(d.cashtag)}`
    : b.method === 'zelle' ? `${esc(b.recipientName)} · ${esc(d.recipient)}`
    : `<span class="mono">${esc(d.address.length > 60 ? d.address.slice(0, 40) + '…' : d.address)}</span><br><span class="small muted">${esc(d.asset)} · ${esc(NET_OPT[d.network] || d.network)}${cfg.cryptoAssets[d.asset] ? ' · ≈ ' + (cents / 100 / cfg.cryptoAssets[d.asset].rate).toFixed(cfg.cryptoAssets[d.asset].decimals) + ' ' + esc(d.asset) : ''}</span>`;
  $('#confirmBody').innerHTML = `<h2>Confirm payout</h2>
    <div class="center" style="font-size:32px;font-weight:800;margin:6px 0 12px">${fmt(cents)}</div>
    <div class="kv"><span>To</span><span>${to}</span></div>
    <div class="kv"><span>Method</span><span>${esc(METHOD_LABEL[b.method] || b.method)}</span></div>
    ${b.note ? `<div class="kv"><span>Note</span><span>${esc(b.note)}</span></div>` : ''}
    <div class="kv"><span>Balance after</span><span>${fmt(summary.balance.availableCents - cents)}</span></div>
    <p class="small muted">Payouts can't be reversed once sent. (Test mode: nothing real is sent.)</p>
    <button class="btn block" id="cOk">Send ${fmt(cents)}</button><button class="btn ghost block" style="margin-top:8px" id="cCancel">Cancel</button>`;
  $('#confirm').classList.add('show');
  $('#cCancel').onclick = () => $('#confirm').classList.remove('show');
  $('#cOk').onclick = async () => {
    $('#cOk').disabled = true; $('#cOk').innerHTML = '<span class="spinner"></span> Sending…';
    const { ok, data } = await api('/api/admin/payouts', { method: 'POST', body: b });
    $('#confirm').classList.remove('show');
    if (!ok) { $('#poErr').textContent = data.error || 'Payout failed'; $('#poErr').hidden = false; return; }
    $('#poOk').textContent = `Payout ${data.id} created — status: ${data.status}. It will update automatically.`; $('#poOk').hidden = false;
    $('#poForm').reset(); $('#poAsset').value = 'BTC'; fillNets(); poMethod = 'bank'; $$('#poSeg button').forEach((x, i) => x.classList.toggle('active', i === 0));
    $$('#poForm .panel').forEach((p) => p.classList.toggle('active', p.dataset.p === 'bank'));
    load();
  };
});
load();
