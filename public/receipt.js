const id = new URLSearchParams(location.search).get('id');
let timer;
async function load() {
  const { ok, data: p } = await api('/api/payments/' + encodeURIComponent(id));
  if (!ok) { $('#root').innerHTML = `<p class="center">Payment not found. <a href="/">Back to checkout</a></p>`; return; }
  $('#biz').textContent = p.business; render(p);
  clearTimeout(timer); if (p.status === 'processing' || p.status === 'pending') timer = setTimeout(load, 2000);
}
function render(p) {
  const st = { succeeded: ['ok', '✓', 'Payment successful', `Thanks${p.customer?.name ? ', ' + esc(p.customer.name) : ''}! Your payment to ${esc(p.business)} went through.`],
    failed: ['err', '✕', 'Payment failed', esc(p.failureReason || 'The payment could not be completed.')],
    processing: ['pend', '⏳', 'Payment processing', 'Your bank transfer was initiated. ACH payments take a few days to clear (seconds in this demo).'],
    pending: p.method === 'zelle' ? ['pend', 'Z', 'Awaiting your Zelle payment', 'Send the exact amount from your bank app using the details below.']
      : ['pend', p.crypto?.asset === 'BTC' ? '₿' : '◎', p.crypto?.network === 'lightning' ? 'Pay the Lightning invoice' : 'Awaiting crypto payment',
         p.crypto?.network === 'lightning' ? 'Scan with any Lightning wallet. Settles in seconds.' : 'Send the exact amount below to the deposit address.'] }[p.status];
  if (p.status === 'succeeded' && p.bnpl) st[3] = `Your ${esc(p.bnpl.provider)} plan is approved. ${esc(p.business)} has been paid in full.`;
  let cryptoHtml = '';
  if (p.method === 'crypto' && p.crypto) {
    const c = p.crypto;
    cryptoHtml = p.status === 'pending' ? `
      <div class="crypto-box"><img src="/api/payments/${esc(p.id)}/qr.png" alt="Payment QR code">
        <div style="min-width:0"><div class="small muted">Send exactly</div><div style="font-size:22px;font-weight:700">${esc(c.amount)} ${esc(c.asset)}</div>
        ${c.sats ? `<div class="small">${c.sats.toLocaleString()} sats</div>` : ''}
        <div class="small muted">on ${esc(NETWORK_NAME[c.network] || c.network)}${c.token ? ' (token ' + esc(c.token.slice(0, 6)) + '…' + esc(c.token.slice(-4)) + ')' : ''} · rate $${c.rateUsd.toLocaleString()}/${esc(c.asset)}</div>
        <div class="small muted" style="margin-top:8px">${c.invoice ? 'Lightning invoice' : 'To address'}</div><div class="mono" id="addr">${esc(c.invoice ? c.invoice.slice(0, 40) + '…' + c.invoice.slice(-8) : c.address)}</div>
        <button class="btn ghost" style="margin-top:8px;padding:6px 10px;font-size:13px" id="copy">Copy ${c.invoice ? 'invoice' : 'address'}</button>
        <div class="small muted" style="margin-top:6px">Expires ${new Date(c.expiresAt).toLocaleTimeString()}</div></div></div>
      <button class="btn block" id="simulate">Simulate: I've sent the funds</button>
      <p class="small muted center">In production a chain watcher / webhook confirms the transfer automatically.</p>`
      : c.txHash ? `<div class="kv"><span>Transaction</span><span class="mono">${esc(c.txHash.slice(0, 18))}…</span></div>` : '';
  }
  if (p.method === 'zelle' && p.zelle) {
    const z = p.zelle;
    cryptoHtml = p.status === 'pending' ? `<div class="bnpl" style="margin-bottom:12px">
      <div class="small muted">1. Open your bank's app → <b>Send money with Zelle®</b></div>
      <div class="kv"><span>Send to</span><span class="mono">${esc(z.recipient)}</span></div>
      <div class="kv"><span>Recipient name</span><span>${esc(z.recipientName)}</span></div>
      <div class="kv"><span>Amount</span><span><b>${fmt(p.amountCents)}</b></span></div>
      <div class="kv"><span>Memo (required)</span><span class="mono" style="font-size:16px"><b>${esc(z.memo)}</b></span></div>
      <div class="small muted" style="margin-top:8px">Only send Zelle to people and businesses you trust. Zelle payments can't be reversed.</div></div>
      <button class="btn block" id="simulate">Simulate: I've sent the Zelle payment</button>
      <p class="small muted center">In production, incoming Zelle deposits are matched by memo code via your bank feed.</p>`
      : z.confirmation ? `<div class="kv"><span>Zelle confirmation</span><span class="mono">${esc(z.confirmation)}</span></div>` : '';
  }
  if (p.bnpl && p.status === 'succeeded') {
    cryptoHtml = `<div class="bnpl" style="margin-bottom:12px"><b>${esc(p.bnpl.provider)} · Pay in 4 (0% interest)</b>
      <div class="plan">${p.bnpl.schedule.map((s, i) => `<div class="inst"><div class="dot q${i + 1}"></div><b>${fmt(s.amountCents)}</b>
        <span class="muted">${i ? new Date(s.due + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Paid today'}</span></div>`).join('')}</div></div>`;
  }
  $('#root').innerHTML = `
    <div class="status-icon ${st[0]}">${st[1]}</div>
    <h1 class="center">${st[2]}</h1><p class="muted center" style="margin-top:4px">${st[3]}</p>
    <div class="center" style="font-size:34px;font-weight:800;margin:10px 0 16px">${fmt(p.amountCents, p.currency)}</div>
    ${cryptoHtml}
    <div class="kv"><span>Status</span><span><span class="pill ${p.status}">${p.status}</span></span></div>
    <div class="kv"><span>Paid to</span><span>${esc(p.business)}</span></div>
    <div class="kv"><span>Description</span><span>${esc(p.description)}</span></div>
    <div class="kv"><span>Method</span><span>${esc(methodText(p.method, p.methodSummary))}</span></div>
    ${p.customer?.email ? `<div class="kv"><span>Receipt sent to</span><span>${esc(p.customer.email)} <span class="muted small">(simulated)</span></span></div>` : ''}
    <div class="kv"><span>Receipt #</span><span class="mono">${esc(p.id)}</span></div>
    <div class="kv"><span>Reference</span><span class="mono">${esc(p.providerRef)}</span></div>
    <div class="kv"><span>Date</span><span>${new Date(p.createdAt).toLocaleString()}</span></div>
    <div style="display:flex;gap:10px;margin-top:18px">
      ${p.status === 'failed' ? '<a class="btn" style="flex:1;text-decoration:none" href="/">Try again</a>' : '<a class="btn ghost" style="flex:1;text-decoration:none" href="/">New payment</a>'}
      ${p.status === 'succeeded' ? '<button class="btn ghost" style="flex:1" id="print">Print receipt</button>' : ''}
    </div>`;
  $('#print')?.addEventListener('click', () => print());
  $('#copy')?.addEventListener('click', () => navigator.clipboard?.writeText(p.crypto.invoice || p.crypto.address));
  $('#simulate')?.addEventListener('click', async () => { $('#simulate').disabled = true;
    const { data } = await api(`/api/payments/${encodeURIComponent(p.id)}/simulate-received`, { method: 'POST' }); render(data); });
}
load();
