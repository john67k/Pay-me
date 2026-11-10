// Drives the real UI in headless Chrome and saves screenshots. Usage: BASE_URL=http://localhost:3000 node scripts/screenshots.js
const { chromium } = require('playwright-core');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PW = process.env.ADMIN_PASSWORD || 'demo-admin-123';
const OUT = path.join(__dirname, '..', 'screenshots');
const shot = (page, name) => page.waitForTimeout(300).then(() => page.screenshot({ path: path.join(OUT, name), fullPage: true })).then(() => console.log('saved', name));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = []; page.on('console', (m) => m.type() === 'error' && errors.push(m.text())); page.on('pageerror', (e) => errors.push(e.message));

  // 1. Checkout page with card filled
  await page.goto(BASE + '/');
  await page.fill('#amount', '249.00'); await page.fill('#description', 'Logo design – Invoice #1042');
  await page.fill('#custName', 'Jane Doe'); await page.fill('#custEmail', 'jane@example.com');
  await page.fill('#ccName', 'Jane Doe'); await page.type('#ccNum', '4242424242424242'); await page.type('#ccExp', '1230'); await page.fill('#ccCvc', '123'); await page.fill('#ccZip', '10001');
  await shot(page, '01-checkout.png');
  await page.click('#payBtn'); await page.waitForURL(/receipt/); await page.waitForSelector('.status-icon.ok');
  await shot(page, '02-receipt-success.png');

  // 2. Declined card
  await page.goto(BASE + '/'); await page.fill('#amount', '75.00'); await page.fill('#ccName', 'Jane Doe');
  await page.type('#ccNum', '4000000000000002'); await page.type('#ccExp', '1230'); await page.fill('#ccCvc', '123');
  await page.click('#payBtn'); await page.waitForSelector('.status-icon.err'); await shot(page, '03-receipt-declined.png');

  // 3. Client-side validation
  await page.goto(BASE + '/'); await page.fill('#ccName', 'X'); await page.type('#ccNum', '4242424242424241'); await page.type('#ccExp', '0120'); await page.fill('#ccCvc', '1');
  await page.click('#payBtn'); await page.waitForSelector('#ccNumErr:has-text("invalid")'); await shot(page, '04-checkout-validation.png');

  // 4. Apple Pay sheet
  await page.goto(BASE + '/'); await page.fill('#amount', '120.00'); await page.click('[data-m=apple_pay]'); await page.click('#applePayBtn');
  await shot(page, '05-apple-pay-sheet.png'); await page.click('#sheetOk'); await page.waitForSelector('.status-icon.ok');

  // 5. PayPal
  await page.goto(BASE + '/'); await page.fill('#amount', '60.00'); await page.click('[data-m=paypal]'); await page.click('#paypalBtn');
  await page.fill('#ppEmail', 'buyer@example.com'); await page.click('#sheetOk'); await page.waitForSelector('.status-icon.ok');

  // 6. ACH
  await page.goto(BASE + '/'); await page.fill('#amount', '500.00'); await page.fill('#description', 'Monthly retainer'); await page.click('[data-m=ach]');
  await page.fill('#achName', 'Acme Corp'); await page.fill('#achRouting', '110000000'); await page.fill('#achAcct', '000123456789'); await page.check('#achMandate');
  await page.click('#payBtn'); await page.waitForSelector('.status-icon.pend'); await shot(page, '06-ach-processing.png');
  await page.waitForSelector('.status-icon.ok', { timeout: 20000 });

  // 7. Crypto (USDC)
  await page.goto(BASE + '/'); await page.fill('#amount', '150.00'); await page.fill('#description', 'Consulting (USDC)'); await page.click('[data-asset=USDC]');
  await page.click('#payBtn'); await page.waitForSelector('.crypto-box img'); await page.waitForFunction(() => document.querySelector('.crypto-box img').complete);
  await shot(page, '07-crypto-qr.png'); await page.click('#simulate'); await page.waitForSelector('.status-icon.ok'); await shot(page, '08-crypto-paid.png');

  // 13–14. Cash App Pay
  await page.goto(BASE + '/'); await page.fill('#amount', '35.00'); await page.fill('#description', 'Sticker pack'); await page.fill('#custName', 'Sam Lee');
  await page.click('[data-m=cashapp]'); await shot(page, '13-method-picker-cashapp.png');
  await page.click('#cashappBtn'); await page.waitForFunction(() => document.querySelector('.fakeqr img')?.complete);
  await page.fill('#caTag', '$samlee'); await shot(page, '14-cashapp-approval.png');
  await page.click('#sheetOk'); await page.waitForSelector('.status-icon.ok'); await shot(page, '15-cashapp-receipt.png');

  // Venmo
  await page.goto(BASE + '/'); await page.fill('#amount', '22.00'); await page.click('[data-m=venmo]'); await page.click('#venmoBtn');
  await page.fill('#vmUser', '@sam-lee'); await page.click('#sheetOk'); await page.waitForSelector('.status-icon.ok');

  // 16–18. Bitcoin on-chain + Lightning
  await page.goto(BASE + '/'); await page.fill('#amount', '300.00'); await page.fill('#description', 'Website hosting (1 yr)'); await page.click('[data-asset=BTC]');
  await shot(page, '16-checkout-bitcoin.png');
  await page.click('#payBtn'); await page.waitForSelector('.crypto-box img'); await page.waitForFunction(() => document.querySelector('.crypto-box img').complete);
  await shot(page, '17-bitcoin-qr.png'); await page.click('#simulate'); await page.waitForSelector('.status-icon.ok');
  await page.goto(BASE + '/'); await page.fill('#amount', '12.00'); await page.fill('#description', 'Coffee ⚡'); await page.click('[data-asset=BTC]'); await page.click('#netSeg [data-n=lightning]');
  await page.click('#payBtn'); await page.waitForSelector('.crypto-box img'); await page.waitForFunction(() => document.querySelector('.crypto-box img').complete);
  await shot(page, '18-lightning-qr.png'); await page.click('#simulate'); await page.waitForSelector('.status-icon.ok');
  // USDT on Tron
  await page.goto(BASE + '/'); await page.fill('#amount', '45.00'); await page.click('[data-asset=USDC]'); await page.click('#assetSeg [data-a=USDT]'); await page.click('#netSeg [data-n=tron]');
  await page.click('#payBtn'); await page.waitForSelector('.crypto-box img'); await shot(page, '19-usdt-tron-qr.png'); await page.click('#simulate'); await page.waitForSelector('.status-icon.ok');

  // 20–22. BNPL
  await page.goto(BASE + '/'); await page.fill('#amount', '480.00'); await page.fill('#description', 'Brand identity package'); await page.fill('#custEmail', 'jane@example.com');
  await page.click('[data-m=klarna]'); await shot(page, '20-klarna-plan.png');
  await page.click('#payBtn'); await page.waitForSelector('#sheet.show'); await page.check('#bnplAgree'); await shot(page, '21-klarna-confirm.png');
  await page.click('#sheetOk'); await page.waitForSelector('.status-icon.ok'); await shot(page, '22-klarna-receipt.png');
  await page.goto(BASE + '/'); await page.fill('#amount', '90.00'); await page.fill('#custEmail', 'jo@example.com'); await page.click('[data-m=afterpay]');
  await page.click('#payBtn'); await page.check('#bnplAgree'); await page.click('#sheetOk'); await page.waitForSelector('.status-icon.ok');

  // 23. Zelle
  await page.goto(BASE + '/'); await page.fill('#amount', '200.00'); await page.fill('#description', 'Photography session'); await page.click('[data-m=zelle]');
  await page.click('#payBtn'); await page.waitForSelector('#simulate'); await shot(page, '23-zelle-instructions.png');
  await page.click('#simulate'); await page.waitForSelector('.status-icon.ok');

  // 8. Admin
  await page.goto(BASE + '/admin'); await page.waitForSelector('#loginView:not([hidden])'); await shot(page, '09-admin-login.png');
  await page.fill('#pw', PW); await page.click('#loginForm button'); await page.waitForSelector('#dash:not([hidden])');
  await page.fill('#poAmount', '300.00'); await page.fill('#poHolder', 'Pixel Contractors LLC'); await page.fill('#poRouting', '110000000'); await page.fill('#poAcct', '000987654321'); await page.fill('#poNote', 'Invoice #88');
  await page.click('#poBtn'); await page.waitForSelector('#confirm.show'); await shot(page, '10-payout-confirm.png');
  await page.click('#cOk'); await page.waitForSelector('#confirm:not(.show)', { state: 'attached' }); await page.waitForTimeout(300);
  await page.click('#poSeg [data-m=crypto]'); await page.fill('#poAmount', '50.00'); await page.selectOption('#poAsset', 'SOL'); await page.fill('#poAddr', '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV'); await page.fill('#poCName', 'Dev wallet');
  await page.click('#poBtn'); await page.click('#cOk'); await page.waitForSelector('#confirm:not(.show)', { state: 'attached' }); await page.waitForTimeout(300);
  await page.click('#poSeg [data-m=paypal]'); await page.fill('#poAmount', '40.00'); await page.fill('#poName', 'Sam Writer'); await page.fill('#poEmail', 'sam@example.com');
  await page.click('#poBtn'); await page.click('#cOk'); await page.waitForSelector('#confirm:not(.show)', { state: 'attached' }); await page.waitForTimeout(300);
  // Cash App payout
  await page.click('#poSeg [data-m=cashapp]'); await page.fill('#poAmount', '25.00'); await page.fill('#poCAName', 'Maya Illustrations'); await page.fill('#poCashtag', '$mayaillo');
  await shot(page, '24-payout-form-cashapp.png'); await page.click('#poBtn'); await page.click('#cOk'); await page.waitForSelector('#confirm:not(.show)', { state: 'attached' }); await page.waitForTimeout(300);
  // Venmo + Zelle payouts
  await page.click('#poSeg [data-m=venmo]'); await page.fill('#poAmount', '15.00'); await page.fill('#poVName', 'Chris P'); await page.fill('#poVenmo', '@chris-p-design');
  await page.click('#poBtn'); await page.click('#cOk'); await page.waitForSelector('#confirm:not(.show)', { state: 'attached' }); await page.waitForTimeout(300);
  await page.click('#poSeg [data-m=zelle]'); await page.fill('#poAmount', '60.00'); await page.fill('#poZName', 'Dana Ortiz'); await page.fill('#poZelle', '(212) 555-0123');
  await page.click('#poBtn'); await page.click('#cOk'); await page.waitForSelector('#confirm:not(.show)', { state: 'attached' }); await page.waitForTimeout(300);
  // Bitcoin payout: bad checksum first, then valid
  await page.click('#poSeg [data-m=crypto]'); await page.fill('#poAmount', '120.00'); await page.selectOption('#poAsset', 'BTC'); await page.selectOption('#poNet', 'bitcoin');
  await page.fill('#poAddr', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdr'); await page.fill('#poCName', 'Cold storage');
  await page.click('#poBtn'); await page.click('#cOk'); await page.waitForSelector('#poErr:not([hidden])'); await shot(page, '25-payout-btc-invalid.png');
  await page.fill('#poAddr', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'); await page.click('#poBtn'); await page.waitForSelector('#confirm.show');
  await shot(page, '26-payout-btc-confirm.png'); await page.click('#cOk'); await page.waitForSelector('#confirm:not(.show)', { state: 'attached' }); await page.waitForTimeout(300);
  // USDT on Tron payout
  await page.click('#poSeg [data-m=crypto]'); await page.fill('#poAmount', '30.00'); await page.selectOption('#poAsset', 'USDT'); await page.selectOption('#poNet', 'tron');
  await page.fill('#poAddr', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'); await page.fill('#poCName', 'Supplier (TRC-20)'); await page.click('#poBtn'); await page.click('#cOk'); await page.waitForSelector('#confirm:not(.show)', { state: 'attached' }); await page.waitForTimeout(300);
  await page.click('#poSeg [data-m=crypto]'); await page.selectOption('#poAsset', 'BTC'); await page.selectOption('#poNet', 'lightning'); await page.fill('#poAmount', '5.00'); await page.fill('#poAddr', 'tips@getalby.com');
  await page.fill('#poCName', 'Lightning tip jar'); await shot(page, '27-payout-form-lightning.png'); await page.click('#poBtn'); await page.click('#cOk'); await page.waitForSelector('#confirm:not(.show)', { state: 'attached' }); await page.waitForTimeout(300);
  await page.waitForTimeout(500); await shot(page, '11-payouts-dashboard-pending.png');
  await page.waitForFunction(() => !document.querySelector('#rows .pill.pending, #rows .pill.processing'), null, { timeout: 30000 });
  await shot(page, '12-payouts-dashboard.png');

  console.log(errors.length ? 'Browser errors:\n' + errors.join('\n') : 'No browser console errors.');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
