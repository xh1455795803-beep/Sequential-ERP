const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext('/tmp/tools-profile3', { headless: true, ignoreHTTPSErrors: true });
  const p = ctx.pages()[0] || await ctx.newPage();
  await p.goto('https://thalvior.icu/login', { waitUntil: 'networkidle', timeout: 40000 }).catch(e=>console.log('nav', e.message));
  const info = await p.evaluate(() => ({
    inputs: Array.from(document.querySelectorAll('input')).map(i => ({type:i.type, ph:i.placeholder, name:i.name, id:i.id})),
    btns: Array.from(document.querySelectorAll('button')).map(b => (b.innerText||'').trim()).filter(Boolean).slice(0,12),
    url: location.pathname,
  }));
  console.log(JSON.stringify(info, null, 1));
  await ctx.close();
})();
