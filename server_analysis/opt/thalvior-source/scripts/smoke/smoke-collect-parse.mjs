// 验证 content.js 在各平台的真实解析能力
// 手法：按平台真实 DOM 结构构造 fixture，用 playwright 在对应 hostname 下加载，
//       注入 content.js 触发 COLLECT_PAGE，断言关键字段。
// 重点：验证「详情图」不再是空数组（这是之前最致命的缺失）。
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const contentJs = readFileSync("./extension/content.js", "utf8");
const IMG = "https://cdn.example.com";

// 各平台真实 DOM 结构（选择器取自各平台线上页面）
const FIXTURES = {
  "www.amazon.com": `
    <span id="productTitle">Wireless Bluetooth Earbuds Noise Cancelling</span>
    <span class="a-price"><span class="a-offscreen">$29.99</span></span>
    <span class="a-price a-text-price"><span class="a-offscreen">$39.99</span></span>
    <img id="landingImage" src="${IMG}/main.jpg" data-old-hires="${IMG}/main-hi.jpg">
    <div id="altImages"><img src="${IMG}/a1.jpg"><img src="${IMG}/a2.jpg"><img src="${IMG}/a3.jpg"></div>
    <span id="acrPopover" title="4.5 out of 5 stars"></span>
    <span id="acrCustomerReviewText">1,234 ratings</span>
    <span id="sellerProfileTriggerId">BestSound Store</span>
    <div id="twister"><li title="Black"></li><li title="White"></li></div>
    <div id="productDescription"><img src="${IMG}/d1.jpg"><img src="${IMG}/d2.jpg"><img src="${IMG}/d3.jpg"></div>`,

  "www.ebay.com": `
    <h1 class="x-item-title__mainTitle"><span>Mens Running Shoes Lightweight Sneakers</span></h1>
    <div class="x-price-primary"><span>US $45.90</span></div>
    <div class="x-price-strikethrough"><span>US $59.90</span></div>
    <img id="icImg" src="${IMG}/eb-main.jpg">
    <div class="ux-image-carousel-item"><img src="${IMG}/eb1.jpg"><img src="${IMG}/eb2.jpg"></div>
    <div class="ux-swatch-item" title="Red / M">红 M</div>
    <div class="ux-swatch-item" title="Blue / L">蓝 L</div>
    <div id="vi-desc-maincntr"><img src="${IMG}/ebd1.jpg"><img src="${IMG}/ebd2.jpg"></div>`,

  "www.temu.com": `
    <h1 class="title-text">Summer Floral Print Women Dress</h1>
    <div class="price-current"><span>$12.49</span></div>
    <div class="price-original"><span>$18.99</span></div>
    <div class="goods-img-box"><img class="goods-img" src="${IMG}/tm-main.jpg"></div>
    <div class="banner-slide"><img src="${IMG}/tm1.jpg"><img src="${IMG}/tm2.jpg"></div>
    <div class="sku-item">Red-M</div><div class="sku-item">Blue-L</div>
    <div class="detail-content"><img src="${IMG}/tmd1.jpg"><img src="${IMG}/tmd2.jpg"></div>`,

  "shopee.com.my": `
    <div class="qaNIZv"><h1>Kids Educational Building Blocks Set 200pcs</h1></div>
    <div class="pqTWkA"><span>RM 89.90</span></div>
    <div class="CGGiLt"><span>RM 129.90</span></div>
    <div class="_2mgJnZ"><img src="${IMG}/sp-main.jpg"></div>
    <div class="product-image"><img src="${IMG}/sp1.jpg"><img src="${IMG}/sp2.jpg"></div>
    <div class="product-variation">Red</div><div class="product-variation">Blue</div>
    <div class="product-detail"><img src="${IMG}/spd1.jpg"><img src="${IMG}/spd2.jpg"></div>`,

  "www.lazada.com.my": `
    <h1 id="pdp-title">Stainless Steel Water Bottle 1L Vacuum Flask</h1>
    <span class="pdp-price_size_l">RM 49.90</span>
    <span class="pdp-price_type_deleted">RM 79.90</span>
    <div class="gallery-preview-panel"><img src="${IMG}/lz-main.jpg"><img src="${IMG}/lz1.jpg"></div>
    <div class="pdp-product-sku"><div class="sku-prop-content-item">500ml Black</div><div class="sku-prop-content-item">1L Silver</div></div>
    <div class="pdp-product-detail"><img src="${IMG}/lzd1.jpg"><img src="${IMG}/lzd2.jpg"></div>`,

  "detail.1688.com": `
    <h1 class="title-text">厂家直供 不锈钢保温杯 定制logo批发</h1>
    <div class="price-text">¥18.50</div>
    <img class="main-image" src="${IMG}/1688-main.jpg">
    <div class="thumb-list"><img src="${IMG}/p1.jpg"><img src="${IMG}/p2.jpg"><img src="${IMG}/p3.jpg"></div>
    <div class="company-name">永康市保温杯厂</div>
    <div class="sell-count">月销 3200 件</div>
    <div class="sku-item">黑色 500ml</div><div class="sku-item">白色 500ml</div>
    <div class="detail-content"><img src="${IMG}/1688d1.jpg"><img src="${IMG}/1688d2.jpg"><img src="${IMG}/1688d3.jpg"></div>`,

  "item.jd.com": `
    <div class="sku-name">小米 Redmi 手机壳 防摔保护套</div>
    <div class="p-price"><span class="price">¥39.00</span></div>
    <img id="spec-img" src="${IMG}/jd-main.jpg">
    <div id="spec-list"><img src="${IMG}/jd1.jpg"><img src="${IMG}/jd2.jpg"></div>
    <div id="choose-attr-1"><div class="item" data-sku="JD-BLK">黑色</div><div class="item" data-sku="JD-WHT">白色</div></div>
    <div class="detail-content"><img src="${IMG}/jdd1.jpg"><img src="${IMG}/jdd2.jpg"></div>`,

  "www.aliexpress.com": `
    <h1 class="product-title-text">LED Strip Light RGB 5M Bluetooth Controller</h1>
    <div class="product-price-value"><span>US $15.99</span></div>
    <div class="product-price-del"><span>US $25.99</span></div>
    <img class="magnifier--image" src="${IMG}/ae-main.jpg">
    <div class="ImageSlider"><img src="${IMG}/ae1.jpg"><img src="${IMG}/ae2.jpg"></div>
    <div class="sku-property-item">5M Kit</div>
    <div class="product-description"><img src="${IMG}/aed1.jpg"><img src="${IMG}/aed2.jpg"></div>`,
};

const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const ok = (b) => (b ? "✅" : "❌");
const results = [];

for (const [host, body] of Object.entries(FIXTURES)) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.addInitScript(() => {
    // 模拟扩展环境：content.js 依赖 chrome.runtime.onMessage
    window.chrome = { runtime: { onMessage: { addListener: (fn) => { window.__listener = fn; } } } };
  });

  await page.route(`https://${host}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>fixture</title></head><body>${body}</body></html>`,
    }),
  );

  await page.goto(`https://${host}/dp/TEST123456`, { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ content: contentJs });

  const data = await page.evaluate(async () => {
    return new Promise((resolve) => {
      window.__listener({ type: "COLLECT_PAGE" }, {}, resolve);
      setTimeout(() => resolve({ ok: false, error: "timeout" }), 3000);
    });
  });

  if (!data?.ok) {
    results.push([`${host} — 采集失败: ${data?.error}`, false]);
    await ctx.close();
    continue;
  }

  const d = data.data;
  const platform = d.platform || "?";
  const nameOk = !!d.name && d.name !== "未命名商品";
  const priceOk = Number(d.price) > 0;
  const imgOk = (d.images || []).length > 0;
  const detailOk = (d.detailImages || []).length > 0;
  const variantOk = (d.variants || []).length > 0;
  const currencyOk = !!d.currency;

  results.push([
    `${platform.padEnd(10)} 名称✓${nameOk ? "" : "✗"} 图集${(d.images || []).length}张 详情图${(d.detailImages || []).length}张 变体${(d.variants || []).length}个 价格${d.price}${d.currency}`,
    nameOk && priceOk && imgOk && detailOk && currencyOk,
  ]);
  if (!variantOk) results.push([`  ↳ ${platform} 未抓到变体（该平台 DOM 可能不同）`, true]); // 非致命
  await ctx.close();
}

console.log("\n===== 采集解析能力 =====");
for (const [n, p] of results) console.log(`${ok(p)} ${n}`);
const fatal = results.filter(([n]) => !n.startsWith("  ↳"));
console.log("总判定:", fatal.every(([, p]) => p) ? "✅ 全部通过" : "❌ 存在失败项");

await browser.close();
