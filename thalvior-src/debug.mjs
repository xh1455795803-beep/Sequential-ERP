import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
const consoleMsgs = [];
page.on('pageerror', e => errors.push({msg:e.message, stack:e.stack}));
page.on('console', msg => {
  if (msg.type() === 'error' || msg.type() === 'warning') consoleMsgs.push({type: msg.type(), text: msg.text().slice(0,300)});
});
const failedReqs = [];
page.on('requestfailed', req => failedReqs.push(req.url().slice(0,120) + ' => ' + req.failure()?.errorText));
page.on('response', async res => { const s = res.status(); if (s >= 400) failedReqs.push(res.url().slice(0,120) + ' => HTTP ' + s); });
try { await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 15000 }); } catch(e) { console.log('goto err', e.message); }
await page.waitForTimeout(2000);
const rootHtml = await page.evaluate(() => document.getElementById('root')?.innerHTML?.slice(0, 500) || 'EMPTY');
console.log('=== ROOT HTML ===', rootHtml);
console.log('\n=== PAGE ERRORS ===');
errors.length ? errors.forEach(e => console.log(e.msg, (e.stack||'').slice(0,400))) : console.log('(none)');
console.log('\n=== CONSOLE ERR/WARN ===');
consoleMsgs.length ? consoleMsgs.forEach(m => console.log(m.type + ': ' + m.text)) : console.log('(none)');
console.log('\n=== FAILED/4XX REQS ===');
failedReqs.length ? failedReqs.forEach(r => console.log(r)) : console.log('(none)');
await browser.close();
