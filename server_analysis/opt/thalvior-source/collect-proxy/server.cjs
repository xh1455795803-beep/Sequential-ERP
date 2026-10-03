const http = require('http');
const { chromium } = require('/opt/thalvior-source/node_modules/playwright-core');

const PORT = 8788;
const EXE = '/home/ubuntu/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BLOCK = /punish|captcha|\u9a8c\u8bc1\u7801|\u8bbf\u95ee\u9a8c\u8bc1|\u5b89\u5168\u9a8c\u8bc1|pardon the interruption|verify you are human/i;

(async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--lang=zh-CN',
      '--window-size=1366,900',
    ],
  });
  const server = http.createServer(async (req, res) => {
    const target = new URL(req.url, 'http://localhost').searchParams.get('url');
    if (!target) { res.writeHead(400); return res.end('missing url'); }
    console.log('[proxy] GET', target);
    const start = Date.now();
    let ctx = null;
    try {
      ctx = await browser.newContext({
        userAgent: UA,
        locale: 'zh-CN',
        viewport: { width: 1366, height: 900 },
      });
      const page = await ctx.newPage();
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(3500);
      let html = await page.content();
      if (html.length < 3000 || BLOCK.test(html)) {
        await page.waitForTimeout(4500);
        html = await page.content();
      }
      await ctx.close();
      ctx = null;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      console.log('[proxy] OK', target, html.length, Date.now() - start + 'ms');
    } catch (e) {
      if (ctx) { try { await ctx.close(); } catch (_) {} }
      console.error('[proxy] ERR', target, e.message);
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('proxy error: ' + e.message);
    }
  });
  server.listen(PORT, '0.0.0.0', () => console.log('[proxy] listening on :' + PORT));
})();
