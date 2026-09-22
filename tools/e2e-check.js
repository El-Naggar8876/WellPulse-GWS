/* End-to-end check in a real headless Chrome/Edge: enrolment, service worker, offline reload, auto-sync.
 * Prerequisites: `npm start` running on port 8080, and `npm i -D puppeteer-core` (one-time).
 * Usage: node tools/e2e-check.js
 */
const fs = require('fs');
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch (e) { console.error('Run: npm i -D puppeteer-core'); process.exit(1); }
const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];
const executablePath = process.env.BROWSER_PATH || CANDIDATES.find(p => fs.existsSync(p));
if (!executablePath) { console.error('No Chrome/Edge found; set BROWSER_PATH'); process.exit(1); }
(async () => {
  const browser = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-first-run'] });
  const page = await browser.newPage();
  await page.emulate({ viewport: { width: 390, height: 844, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36' });
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://localhost:8080/?f=T900&n=Test&w=W1:Well%20one&l=ar&api=http://localhost:8080/api', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1500));
  const sw = await page.evaluate(async () => { const reg = await navigator.serviceWorker.ready; return { scope: reg.scope, active: !!reg.active, state: reg.active && reg.active.state }; });
  const cache = await page.evaluate(async () => { const keys = await caches.keys(); const c = await caches.open(keys[0]); return { keys, entries: (await c.keys()).length }; });
  const manifest = await page.evaluate(async () => { const r = await fetch('manifest.webmanifest'); const m = await r.json(); return { name: m.name, icons: m.icons.length, display: m.display }; });
  // Save a reading, then go offline and reload: app must still open and show the pending reading
  await page.evaluate(async () => { document.getElementById('btnStart').click(); await new Promise(r => setTimeout(r, 300)); document.querySelectorAll('#wellChips .chip')[0].click(); document.getElementById('ecInput').value = '2.2'; document.getElementById('tempInput').value = '23'; document.getElementById('btnSave').click(); await new Promise(r => setTimeout(r, 500)); document.getElementById('ovLater').click(); });
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 1200));
  const offline = await page.evaluate(async () => ({ title: document.title, view: window.__wp.state.view, net: document.getElementById('netText').textContent, syncTitle: document.getElementById('syncTitle').textContent, pending: (await window.__wp.DB.byStatus('pending')).length, startVisible: !document.getElementById('view-home').hidden }));
  // try sending while offline -> stays pending; then back online -> auto sync on 'online' event
  const offSend = await page.evaluate(async () => { const r = await window.__wp.doSync(); return r; });
  await page.setOfflineMode(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await new Promise(r => setTimeout(r, 1500));
  const online = await page.evaluate(async () => ({ pending: (await window.__wp.DB.byStatus('pending')).length, sent: (await window.__wp.DB.byStatus('sent')).length, syncTitle: document.getElementById('syncTitle').textContent }));
  const out = { sw, cache, manifest, offline, offSend, online, errors };
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  const ok = sw.active && cache.entries >= 10 && offline.pending === 1 && offline.startVisible && offSend.error === 'offline' && online.sent === 1 && online.pending === 0 && errors.length === 0;
  console.log(ok ? 'E2E PASSED' : 'E2E FAILED'); process.exit(ok ? 0 : 1);
})().catch(e => { console.error('CHECK FAILED', e); process.exit(1); });
