// ops/qa-crawl-routes.cjs —— 全站实测爬取
// 目的：把"看起来成型、实际一进来就报错/空白"的页面全部抓出来（登录态、真实接口）
// 记录：JS 异常、console error、>=400 的接口响应（含 PostgREST 错误体）、正文长度、表格数、空/错文案
// 用法：MAXP=220 node ops/qa-crawl-routes.cjs   （结果 ops/qa-crawl-out.jsonl）
const { chromium } = require('playwright-core');
const fs = require('fs');
const BASE = process.env.BASE_URL || 'https://thalvior.icu';
const EMAIL = process.env.QA_EMAIL || 'qa-nav@thalvior.local';
const PW = fs.readFileSync(process.env.QA_PW || '/tmp/qw/.qa_pw', 'utf8').trim();
const OUT = process.env.QA_OUT || 'ops/qa-crawl-out.jsonl';
const LOG = process.env.QA_LOG || '/tmp/qw/crawl.progress';
const MAX = Number(process.env.MAXP || 220);
const SETTLE = Number(process.env.SETTLE || 1500);
const SKIP = [/^\/auth/, /^\/login/, /^\/register/, /^\/reset-password/, /^\/callback/,
              /privacy/, /terms/, /refund/, /\.(png|jpe?g|svg|css|js|ico|woff2?)$/i];
const log = (m) => fs.appendFileSync(LOG, m + '\n');

(async () => {
  fs.writeFileSync(OUT, ''); fs.writeFileSync(LOG, '');
  const ctx = await chromium.launchPersistentContext('/tmp/tools-crawl', {
    headless: true, ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 },
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  const rec = {};
  const ensure = (p) => (rec[p] ||= { errors: [], api: [], body: 0 });
  let cur = '/login';
  page.on('pageerror', e => ensure(cur).errors.push('PAGEERROR: ' + String(e.message).slice(0, 240)));
  page.on('console', m => { if (m.type() === 'error') ensure(cur).errors.push('CONSOLE: ' + m.text().slice(0, 240)); });
  page.on('response', async (res) => {
    const u = res.url(), st = res.status();
    if (st < 400) return;
    if (!u.startsWith(BASE)) return;
    let body = ''; try { body = (await res.text()).slice(0, 400); } catch {}
    // 只关心自家接口
    ensure(cur).api.push({ st, url: u.replace(BASE, '').slice(0, 180), body: body.replace(/\s+/g, ' ').slice(0, 260) });
  });

  log('登录 ' + EMAIL);
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  await page.fill('#account', EMAIL).catch(e => log('填账号失败 ' + e.message));
  await page.fill('#password', PW).catch(e => log('填密码失败 ' + e.message));
  await page.locator('button:has-text("登录")').last().click().catch(e => log('点登录失败 ' + e.message));
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20000 })
             .catch(() => log('!! 登录后仍停在 /login —— 凭据或流程有问题'));
  await page.waitForTimeout(1500);
  log('登录后 URL=' + page.url());

  let listFile = process.env.QA_LIST;
  if (listFile) { log('使用路由清单 ' + listFile); }
  const queue = listFile ? fs.readFileSync(listFile, 'utf8').split('\n').map(x => x.trim()).filter(Boolean) : ['/dashboard'];
  const seen = new Set();
  while (queue.length && Object.keys(rec).length < MAX) {
    const p = queue.shift();
    if (seen.has(p) || SKIP.some(r => r.test(p))) continue;
    seen.add(p); cur = p;
    try { await page.goto(BASE + p, { waitUntil: 'networkidle', timeout: 25000 }); }
    catch (e) { ensure(p).errors.push('NAV: ' + String(e.message).slice(0, 150)); }
    await page.waitForTimeout(SETTLE);
    const info = await page.evaluate(() => {
      const main = document.querySelector('main') || document.body;
      const txt = (main.innerText || '').trim();
      return {
        links: Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href'))
                   .filter(h => h && h.startsWith('/') && !h.startsWith('/assets')),
        len: txt.length, tables: document.querySelectorAll('table').length,
        rows: document.querySelectorAll('tbody tr').length,
        empty: /暂无数据|没有相关|没有数据|No data/i.test(txt),
        errText: /出错了|加载失败|请求失败|操作失败|系统异常/.test(txt),
        toasts: Array.from(document.querySelectorAll('[data-sonner-toast],[role="alert"]')).map(e => (e.innerText||'').slice(0,90)),
      };
    }).catch(e => ({ links: [], len: -1, tables: 0, rows: 0, empty: false, errText: false, toasts: ['EVALFAIL ' + e.message] }));
    const r = ensure(p);
    Object.assign(r, { body: info.len, tables: info.tables, rows: info.rows,
                       empty: info.empty, errText: info.errText, toasts: info.toasts });
    if (!listFile && info.links) for (const l of info.links) {
      const q = l.split('#')[0].split('?')[0];
      if (!seen.has(q)) queue.push(q);
    }
    log(`${Object.keys(rec).length}/${MAX} ${p} 正文${info.len}字 行${info.rows} ${r.errors.length}错 ${r.api.length}接口${info.errText?' 有错文案':''}`);
    fs.writeFileSync(OUT, Object.entries(rec).map(([k, v]) => JSON.stringify({ path: k, ...v })).join('\n') + '\n');
  }
  log('完成：' + Object.keys(rec).length + ' 页');
  await ctx.close();
})().catch(e => { log('FATAL ' + e.message); process.exit(1); });
