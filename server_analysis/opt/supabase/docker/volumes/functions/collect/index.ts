import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BAILIAN_BASE_URL = 'https://ws-14w50zl0wvf8lldk.cn-beijing.maas.aliyuncs.com';

// ============ 完整商品数据结构 ============
interface ParsedVariant {
  name: string;    // 变体名，如 "颜色:红 / 尺寸:L"
  sku: string;     // 变体 SKU
  price: number;   // 变体价格
  image: string;   // 变体图
  stock: number;   // 变体库存（可抓到时）
}

interface ParsedProduct {
  name: string;
  price: number;
  originalPrice: number;
  currency: string;
  image: string;
  images: string[];
  detailImages: string[];
  description: string;
  sku: string;
  brand: string;
  category: string;
  platform: string;
  seller: string;
  rating: number;
  reviews: number;
  stock: number;
  sales: number;
  variants: ParsedVariant[];
  source: string;
}

function emptyProduct(): ParsedProduct {
  return {
    name: '', price: 0, originalPrice: 0, currency: '', image: '', images: [],
    detailImages: [], description: '', sku: '', brand: '', category: '',
    platform: '', seller: '', rating: 0, reviews: 0, stock: 0, sales: 0,
    variants: [], source: '',
  };
}

// ============ 计费与鉴权 ============

async function resolveUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data } = await admin.auth.getUser(token);
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

function adminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

async function getPricing(serviceKey: string) {
  const { data } = await adminClient()
    .from('service_pricing')
    .select('*')
    .eq('service_key', serviceKey)
    .maybeSingle();
  return data;
}

async function getQuota(userId: string) {
  const { data } = await adminClient()
    .from('tenant_quotas')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  return data;
}

async function deductCredits(userId: string, credits: number) {
  const admin = adminClient();
  const { data: quota } = await admin
    .from('tenant_quotas')
    .select('credits')
    .eq('user_id', userId)
    .maybeSingle();
  if (!quota) return;
  const newCredits = Math.max(0, Number(quota.credits ?? 0) - credits);
  await admin
    .from('tenant_quotas')
    .update({ credits: newCredits, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
}

async function writeUsageLog(userId: string, serviceKey: string, serviceName: string, cost: number, status: string, credits?: number) {
  await adminClient().from('ai_usage_logs').insert({
    user_id: userId,
    service_key: serviceKey,
    service_name: serviceName,
    cost,
    credits: credits ?? null,
    status,
  });
}

// ============ 通用工具 ============

function pick(html: string, patterns: RegExp[]): string {
  for (const p of patterns) {
    const m = html.match(p);
    if (m && m[1]) return m[1].trim();
  }
  return '';
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&hellip;/g, '…');
}

function toPrice(raw: string): number {
  if (!raw) return 0;
  const cleaned = String(raw).replace(/[^0-9.,]/g, '').replace(/,(?=\d{3}\b)/g, '');
  const n = Number(cleaned.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function extractMeta(html: string) {
  return {
    title: decodeEntities(pick(html, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
      /<title[^>]*>([^<]+)<\/title>/i,
    ])),
    image: pick(html, [
      /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
      /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
    ]),
    description: decodeEntities(pick(html, [
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    ])),
    price: pick(html, [
      /<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+itemprop=["']price["'][^>]+content=["']([^"']+)["']/i,
    ]),
    currency: pick(html, [
      /<meta[^>]+property=["']product:price:currency["'][^>]+content=["']([^"']+)["']/i,
    ]),
  };
}

// JSON-LD（schema.org Product）
function extractJsonLd(html: string) {
  const blocks: string[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) blocks.push(m[1]);

  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block.trim());
    } catch {
      continue;
    }
    const candidates: Record<string, unknown>[] = [];
    const collectNodes = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(collectNodes);
        return;
      }
      if (node && typeof node === 'object') {
        const obj = node as Record<string, unknown>;
        const type = obj['@type'];
        if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) {
          candidates.push(obj);
        }
        if (obj['@graph']) collectNodes(obj['@graph']);
      }
    };
    collectNodes(parsed);
    if (candidates.length === 0) continue;
    return candidates[0];
  }
  return null;
}

function jsonLdToProduct(p: Record<string, unknown>): Partial<ParsedProduct> {
  const offers = (Array.isArray(p['offers']) ? p['offers'][0] : p['offers']) as Record<string, unknown> | undefined;
  const imageRaw = p['image'];
  const images = Array.isArray(imageRaw)
    ? imageRaw.map((x) => String((x as Record<string, unknown>)?.['url'] ?? x))
    : typeof imageRaw === 'string' ? [imageRaw] : [];
  const hasVariants = Array.isArray(p['hasVariant']) ? (p['hasVariant'] as Record<string, unknown>[]) : [];
  const variants: ParsedVariant[] = hasVariants.slice(0, 50).map((v) => {
    const vOffers = (Array.isArray(v['offers']) ? v['offers'][0] : v['offers']) as Record<string, unknown> | undefined;
    return {
      name: String(v['name'] ?? ''),
      sku: String(v['sku'] ?? ''),
      price: toPrice(String(vOffers?.['price'] ?? '')),
      image: typeof v['image'] === 'string' ? v['image'] : '',
      stock: 0,
    };
  });
  return {
    name: decodeEntities(String(p['name'] ?? '')),
    price: toPrice(String(offers?.['price'] ?? offers?.['lowPrice'] ?? p['price'] ?? '')),
    image: images[0] ?? '',
    images,
    description: decodeEntities(String(p['description'] ?? '')),
    sku: String(p['sku'] ?? p['mpn'] ?? ''),
    brand: String((p['brand'] as Record<string, unknown>)?.['name'] ?? p['brand'] ?? ''),
    currency: String(offers?.['priceCurrency'] ?? ''),
    rating: Number((p['aggregateRating'] as Record<string, unknown>)?.['ratingValue'] ?? 0) || 0,
    reviews: Number((p['aggregateRating'] as Record<string, unknown>)?.['reviewCount'] ?? (p['aggregateRating'] as Record<string, unknown>)?.['ratingCount'] ?? 0) || 0,
    variants,
  };
}

// ============ 平台专用解析器 ============

  // Amazon：内嵌 JSON（colorImages / asinVariationValues / twister）
function parseAmazon(html: string, url: string): Partial<ParsedProduct> {
  const out: Partial<ParsedProduct> = { platform: 'Amazon' };
  out.name = decodeEntities(pick(html, [/<span[^>]+id=["']productTitle["'][^>]*>\s*([\s\S]*?)\s*<\/span>/i])).trim();
  // 价格：先取划线价块里的 a-offscreen（它是"原价"），再取第一个非划线价的 a-offscreen（现价）
  // 注意顺序：a-text-price 块在 HTML 中通常位于现价之后，直接取第一个 a-offscreen 可能拿到现价也可能是别处的
  const offscreens = [...html.matchAll(/class=["'][^"']*a-offscreen["'][^>]*>([^<]+)</gi)].map((m) => decodeEntities(m[1]));
  const listPriceBlocks = [...html.matchAll(/class=["'][^"']*a-price a-text-price[^"']*["'][^>]*>[\s\S]{0,200}?class=["'][^"']*a-offscreen["'][^>]*>([^<]+)</gi)].map((m) => decodeEntities(m[1]));
  if (listPriceBlocks.length > 0) out.originalPrice = toPrice(listPriceBlocks[0]);
  const listPrices = listPriceBlocks.map((p) => toPrice(p));
  const currentPrice = offscreens.map((p) => toPrice(p)).find((n) => n > 0 && !listPrices.includes(n));
  if (currentPrice) out.price = currentPrice;
  // 主图：landingImage data-old-hires 优先，hiRes 次之
  out.image = pick(html, [
    /id=["']landingImage["'][^>]+data-old-hires=["']([^"']+)["']/i,
    /'hiRes':\s*'(https:[^']+)'/i,
    /id=["']landingImage["'][^>]+src=["']([^"']+)["']/i,
  ]);
  // 图集：colorImages 初始化块
  const colorImages = html.match(/'colorImages'[\s\S]{0,80}?'initial'[\s\S]*?\[([\s\S]*?)\]/);
  if (colorImages) {
    const imgs: string[] = [];
    const imgRe = /'(hiRes|large)':\s*'(https:[^']+)'/g;
    let im: RegExpExecArray | null;
    while ((im = imgRe.exec(colorImages[1])) !== null) {
      if (!imgs.includes(im[2])) imgs.push(im[2]);
    }
    if (imgs.length > 0) out.images = imgs.slice(0, 12);
  }
  // 评分/评论
  const rating = html.match(/([0-9.]+) out of 5 stars/i);
  if (rating) out.rating = Number(rating[1]) || 0;
  const reviews = html.match(/id=["']acrCustomerReviewText["'][^>]*>\s*([\d,]+)/i);
  if (reviews) out.reviews = Number(reviews[1].replace(/,/g, '')) || 0;
  // 变体：asinVariationValues + dimensionValuesDisplayData
  // 注意：这些值是嵌套 JSON 对象，非贪婪正则会在内部第一个 } 处截断——必须用平衡括号扫描
  const variants: ParsedVariant[] = [];
  // key 可能带引号、无引号（B0abc:）或纯数字（0:）——只给未加引号的补引号
  const quoteKeys = (s: string) =>
    s.replace(
      /([{,]\s*)("(?:[^"\\]|\\.)*"|[A-Za-z_][\w-]*|\d+)\s*:/g,
      (m, pre: string, key: string) => (key.startsWith('"') ? m : `${pre}"${key}":`),
    );
  // 从 html 中提取 key 后第一个平衡的 {...} 块
  const extractBalanced = (s: string, key: string): string | null => {
    const idx = s.indexOf(key);
    if (idx < 0) return null;
    let i = s.indexOf('{', idx);
    if (i < 0) return null;
    let depth = 0;
    let end = -1;
    for (; i < s.length; i++) {
      if (s[i] === '{') depth++;
      else if (s[i] === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    return end > 0 ? s.slice(s.indexOf('{', idx), end + 1) : null;
  };
  const dimBlock = extractBalanced(html, '"dimensionValuesDisplayData"');
  const asinBlock = extractBalanced(html, '"asinVariationValues"');
  const labelBlock = extractBalanced(html, '"variationDisplayLabels"');
  if (dimBlock && asinBlock) {
    try {
      const dims = JSON.parse(quoteKeys(dimBlock)) as Record<string, string[]>;
      const asins = JSON.parse(quoteKeys(asinBlock)) as Record<string, Record<string, number>>;
      let labels: string[] = [];
      if (labelBlock) {
        const n = JSON.parse(quoteKeys(labelBlock)) as Record<string, string>;
        labels = Object.values(n);
      }
      for (const [asin, dimIdx] of Object.entries(asins)) {
        void dimIdx;
        const values = dims[asin] ?? [];
        const vName = labels.length > 0 && values.length > 0
          ? values.map((v, i) => (labels[i] ? `${labels[i]}:${v}` : v)).join(' / ')
          : values.join(' / ');
        variants.push({ name: vName || asin, sku: asin, price: out.price ?? 0, image: '', stock: 0 });
      }
    } catch { /* 变体解析失败不阻塞主流程 */ }
  }
  if (variants.length > 0) out.variants = variants.slice(0, 50);
  // 卖家
  out.seller = decodeEntities(pick(html, [/id=["']sellerProfileTriggerId["'][^>]*>\s*([^<]+)</i]));
  // 详情图：description/aplus 内嵌大图
  const detailImgs: string[] = [];
  const detailBlock = html.slice(0, 2000000).match(/<(div|section)[^>]+id=["'](aplus|productDescription)["'][\s\S]{0,120000}?<\/\1>/i);
  const target = detailBlock ? detailBlock[0] : '';
  if (target) {
    const imgRe = /src=["'](https:[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/gi;
    let im: RegExpExecArray | null;
    while ((im = imgRe.exec(target)) !== null) {
      const src = im[1];
      if (src.includes('transparent-pixel') || src.includes('grey-pixel')) continue;
      if (!detailImgs.includes(src)) detailImgs.push(src);
    }
  }
  if (detailImgs.length > 0) out.detailImages = detailImgs.slice(0, 30);
  void url;
  return out;
}

// 1688 / 淘宝 / 天猫：页面内嵌大 JSON（__INIT_DATA / g_config）
function parse1688(html: string): Partial<ParsedProduct> {
  const out: Partial<ParsedProduct> = { platform: '1688' };
  // 标题
  out.name = decodeEntities(pick(html, [
    /<h1[^>]+class=["'][^"']*title-text[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i,
    /"subject"\s*:\s*"([^"]{4,})"/,
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
  ])).trim();
  // 价格区间：priceRange JSON
  const priceRange = html.match(/"priceRange"\s*:\s*\{[\s\S]*?"price"\s*:\s*\{[\s\S]*?"value"\s*:\s*([0-9.]+)/);
  if (priceRange) out.price = Number(priceRange[1]) || 0;
  // 主图 + 图集
  const imgs: string[] = [];
  const imgRe = /"(imgUrl|imageUri|picUrl)"\s*:\s*"(https?:[^"]+|\/\/[^"]+)"/g;
  let im: RegExpExecArray | null;
  while ((im = imgRe.exec(html)) !== null && imgs.length < 20) {
    const src = im[2].startsWith('//') ? `https:${im[2]}` : im[2];
    if (!imgs.includes(src) && !src.includes('logo')) imgs.push(src);
  }
  if (imgs.length > 0) {
    out.images = imgs.slice(0, 12);
    out.image = imgs[0];
  }
  // 销量
  const sales = html.match(/"sellCount"\s*:\s*(\d+)/) || html.match(/(\d+)\s*[件个]/);
  if (sales) out.sales = Number(sales[1]) || 0;
  out.currency = 'CNY';
  return out;
}

// AliExpress：runParams / _d_c_ 内嵌 JSON，skuModule 含变体价格
function parseAliExpress(html: string): Partial<ParsedProduct> {
  const out: Partial<ParsedProduct> = { platform: 'AliExpress' };
  out.name = decodeEntities(pick(html, [
    /"subject"\s*:\s*"([^"]{4,})"/,
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
  ]));
  // formatedActivityPrice / minActivityAmount
  const price = html.match(/"formatedActivityPrice"\s*:\s*"?([0-9.,]+)"?/) ||
    html.match(/"minActivityAmount"\s*:\s*\{[\s\S]*?"value"\s*:\s*([0-9.]+)/);
  if (price) out.price = toPrice(price[1]);
  // 变体：skuValList（嵌套数组，用平衡括号扫描防截断）
  const skuIdx = html.indexOf('"skuValList"');
  if (skuIdx >= 0) {
    // 找到 skuValList 后第一个平衡的 [...]
    let i = html.indexOf('[', skuIdx);
    if (i >= 0 && i - skuIdx < 20) {
      let depth = 0;
      let end = -1;
      for (; i < html.length; i++) {
        if (html[i] === '[') depth++;
        else if (html[i] === ']') {
          depth--;
          if (depth === 0) { end = i; break; }
        }
      }
      if (end > 0) {
        const block = html.slice(html.indexOf('[', skuIdx), end + 1);
        try {
          const list = JSON.parse(block) as Record<string, unknown>[];
          const variants: ParsedVariant[] = list.slice(0, 50).map((v) => {
            const skuVal = v['skuVal'] as Record<string, unknown> | undefined;
            const prices = skuVal?.['skuValPrices'];
            return {
              name: String(v['skuPropStr'] ?? ''),
              sku: String(skuVal?.['skuId'] ?? ''),
              price: toPrice(String(Array.isArray(prices) ? prices[0] : prices ?? '')),
              image: '',
              stock: Number(skuVal?.['availQuantity'] ?? 0) || 0,
            };
          });
          if (variants.length > 0) out.variants = variants;
        } catch { /* 不阻塞 */ }
      }
    }
  }
  // 评分/销量
  const rating = html.match(/"averageStar"\s*:\s*"?([0-9.]+)"?/);
  if (rating) out.rating = Number(rating[1]) || 0;
  const sales = html.match(/"tradeCount"\s*:\s*(\d+)/);
  if (sales) out.sales = Number(sales[1]) || 0;
  out.currency = 'USD';
  return out;
}

// eBay：结构化 meta 较全
function parseEbay(html: string): Partial<ParsedProduct> {
  const out: Partial<ParsedProduct> = { platform: 'eBay', currency: 'USD' };
  out.name = decodeEntities(pick(html, [/<h1[^>]+class=["'][^"']*x-item-title[^"']*["'][^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i]));
  const price = html.match(/class=["'][^"']*x-price-primary[^"']*["'][^>]*>\s*<span[^>]*>([^<]+)</i);
  if (price) out.price = toPrice(decodeEntities(price[1]));
  const rating = html.match(/([0-9.]+)\s+out of\s+5/i) || html.match(/([0-9.]+)\s*★/);
  if (rating) out.rating = Number(rating[1]) || 0;
  const reviews = html.match(/([\d,]+)\s+product ratings/i);
  if (reviews) out.reviews = Number(reviews[1].replace(/,/g, '')) || 0;
  // 图集：ux-image-carousel
  const imgs: string[] = [];
  const imgRe = /class=["'][^"']*ux-image-carousel-item[^"']*["'][^>]*>\s*<img[^>]+src=["'](https:[^"']+)["']/gi;
  let im: RegExpExecArray | null;
  while ((im = imgRe.exec(html)) !== null && imgs.length < 12) {
    if (!imgs.includes(im[1])) imgs.push(im[1]);
  }
  if (imgs.length > 0) {
    out.images = imgs;
    out.image = imgs[0];
  }
  out.seller = decodeEntities(pick(html, [/class=["'][^"']*x-sellercard-atf[^"']*["'][^>]*>\s*<span[^>]*>([^<]+)</i]));
  return out;
}

// Temu：window.rawData 大 JSON
function parseTemu(html: string): Partial<ParsedProduct> {
  const out: Partial<ParsedProduct> = { platform: 'Temu', currency: 'USD' };
  out.name = decodeEntities(pick(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /"goodsName"\s*:\s*"([^"]{4,})"/,
  ])).replace(/\s*[-–|]\s*Temu.*$/i, '');
  const price = html.match(/"minNormalPrice"\s*:\s*"?([0-9.]+)"?/) || html.match(/"price"\s*:\s*"?([0-9.]+)"?/);
  if (price) out.price = Number(price[1]) / 100 || 0;
  const img = html.match(/"hdBigImage"\s*:\s*\[?"(https?:[^"]+)"/) || html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (img) out.image = img[1];
  const sales = html.match(/"soldQuantity"\s*:\s*"?(\d+)/);
  if (sales) out.sales = Number(sales[1]) || 0;
  const reviews = html.match(/"reviewCount"\s*:\s*"?(\d+)/);
  if (reviews) out.reviews = Number(reviews[1]) || 0;
  return out;
}

// 识别来源平台
function detectPlatform(url: string): { platform: string; domain: string } {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const rules: [RegExp, string][] = [
      [/^amazon\./i, 'Amazon'],
      [/aliexpress\./i, 'AliExpress'],
      [/^1688\./i, '1688'],
      [/^taobao\./i, 'Taobao'],
      [/tmall\./i, 'Tmall'],
      [/ebay\./i, 'eBay'],
      [/walmart\./i, 'Walmart'],
      [/temu\./i, 'Temu'],
      [/shein\./i, 'Shein'],
      [/tiktok\./i, 'TikTok Shop'],
      [/shopee\./i, 'Shopee'],
      [/lazada\./i, 'Lazada'],
      [/etsy\./i, 'Etsy'],
      [/^jd\./i, 'JD'],
      [/^pinduoduo\./i, 'Pinduoduo'],
    ];
    for (const [re, name] of rules) {
      if (re.test(host)) return { platform: name, domain: host };
    }
    const parts = host.split('.');
    return { platform: parts.length > 1 ? parts[parts.length - 2] : host, domain: host };
  } catch {
    return { platform: 'Web', domain: '' };
  }
}

// ===== 按官方单价精算费用（与 ai-chat 保持一致的计费口径） =====
function pickTier(tiers: unknown, promptTokens: number): { input: number; output: number } | null {
  if (!Array.isArray(tiers) || tiers.length === 0) return null;
  const sorted = [...tiers].sort(
    (a: Record<string, number>, b: Record<string, number>) => a.up_to_tokens - b.up_to_tokens,
  );
  for (const t of sorted as Record<string, number>[]) {
    if (promptTokens <= t.up_to_tokens) return { input: Number(t.input), output: Number(t.output) };
  }
  const last = sorted[sorted.length - 1] as Record<string, number>;
  return { input: Number(last.input), output: Number(last.output) };
}

function calcTokenCost(
  pricing: Record<string, unknown> | null,
  promptTokens: number,
  completionTokens: number,
): number {
  const fallback = {
    input: Number(pricing?.input_price_per_mtok ?? 0) || 0,
    output: Number(pricing?.output_price_per_mtok ?? 0) || 0,
  };
  const unit = pickTier(pricing?.price_tiers, promptTokens) ?? fallback;
  const cost = (promptTokens / 1_000_000) * unit.input + (completionTokens / 1_000_000) * unit.output;
  return Math.round(cost * 1e6) / 1e6;
}

// 成本 → 售价（官方成本 × markup）
function sell(cost: number, pricing: Record<string, unknown> | null): number {
  const m = Number(pricing?.markup);
  const markup = Number.isFinite(m) && m > 0 ? m : 1;
  return Math.round(cost * markup * 1e6) / 1e6;
}

// AI 兜底解析（补齐缺失字段）；返回解析结果与真实 Token 用量
async function aiParse(
  apiKey: string,
  htmlText: string,
): Promise<{
  name: string;
  price: string;
  sku: string;
  brand: string;
  seller: string;
  usage: { prompt_tokens: number; completion_tokens: number } | null;
}> {
  const prompt = `你是商品采集助手。从商品页面文本中提取商品信息，只输出一个 JSON 对象：{"name":"商品名称","price":"价格数字","sku":"SKU或货号","brand":"品牌","seller":"卖家或店铺名","description":"商品描述(80字内)","category":"品类","currency":"币种如USD/CNY/EUR","images":["图片URL数组"]}。无法识别的字段填空字符串或空数组。\n\n页面文本：\n${htmlText.slice(0, 8000)}`;

  let content = '';
  let usage: { prompt_tokens: number; completion_tokens: number } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(
        `${BAILIAN_BASE_URL}/compatible-mode/v1/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            // 与其他 AI 能力统一使用 qwen3.6-plus（官方价：输入 ¥2 / 输出 ¥12 每百万 Token）
            model: 'qwen3.8-omni-flash',
            messages: [
              { role: 'system', content: '你只输出合法 JSON，不要输出任何其他内容。' },
              { role: 'user', content: prompt },
            ],
            stream: false,
            enable_thinking: false,
          }),
          signal: AbortSignal.timeout(20000),
        },
      );

      if (!response.ok) throw new Error(`AI 解析失败: ${response.status}`);
      const data = await response.json();
      content = data.choices?.[0]?.message?.content || '';
      usage = data?.usage
        ? { prompt_tokens: Number(data.usage.prompt_tokens) || 0, completion_tokens: Number(data.usage.completion_tokens) || 0 }
        : null;
      if (content) break;
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  try {
    // 清理可能包裹 JSON 的代码块/前后噪音
    const jsonStart = content.indexOf('{');
    const jsonEnd = content.lastIndexOf('}');
    const jsonText = jsonStart >= 0 && jsonEnd > jsonStart ? content.slice(jsonStart, jsonEnd + 1) : content;
    const parsed = JSON.parse(jsonText);
    const imagesRaw = parsed.images;
    const images = Array.isArray(imagesRaw)
      ? imagesRaw.map(String).filter((u) => /^https?:\/\//i.test(u)).slice(0, 10)
      : typeof imagesRaw === 'string' && imagesRaw
        ? [imagesRaw]
        : [];
    return {
      name: String(parsed.name || '').trim(),
      price: String(parsed.price || '').trim(),
      sku: String(parsed.sku || '').trim(),
      brand: String(parsed.brand || '').trim(),
      seller: String(parsed.seller || '').trim(),
      description: String(parsed.description || '').trim(),
      category: String(parsed.category || '').trim(),
      currency: String(parsed.currency || '').trim(),
      images,
      usage,
    };
  } catch {
    return { name: '', price: '', sku: '', brand: '', seller: '', description: '', category: '', currency: '', images: [], usage };
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============ 主流程 ============

Deno.serve(async (req) => {
  const functionName = 'collect';
  const requestId = crypto.randomUUID().slice(0, 8);
  const startTime = Date.now();

  try {
    const apiKey = Deno.env.get('DASHSCOPE_API_KEY') || '';
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'AI 服务凭证未配置（DASHSCOPE_API_KEY），请联系管理员' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const body = await req.json();
    const url = String(body.url || '').trim();
    if (!url) {
      return new Response(
        JSON.stringify({ error: '请提供商品链接' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return new Response(
        JSON.stringify({ error: '链接格式不正确' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return new Response(
        JSON.stringify({ error: '仅支持 http/https 链接' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    console.info(`[${functionName}] request ${requestId} url=${url.slice(0, 120)}`);

    // 额度预校验（AI 积分：智能采集固定 3 积分/次，见 service_pricing.credits_per_use）
    const userId = await resolveUserId(req);
    let billing: { userId: string; serviceKey: string; serviceName: string; cost: number; credits: number } | null = null;
    let pricing: Record<string, unknown> | null = null;
    if (userId) {
      pricing = await getPricing('collect');
      if (pricing && pricing.status === '停用') {
        return new Response(
          JSON.stringify({ error: '该 AI 能力已停用，请联系管理员' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
      }
      // 仅当 HTML 解析失败、需要 AI 兜底时才会产生 Token 费用，按最坏情况（6000 字符输入）估算
      const estimated = sell(calcTokenCost(pricing, 3000, 1024), pricing);
      const collectCredits = Number(pricing?.credits_per_use) || 3;
      const quota = await getQuota(userId);
      const creditsBalance = quota ? Number(quota.credits ?? 0) : 0;
      if (creditsBalance < collectCredits) {
        return new Response(
          JSON.stringify({ error: `AI 积分不足：本次采集需要 ${collectCredits} 积分，当前剩余 ${creditsBalance} 积分，请先充值或订阅套餐` }),
          { status: 402, headers: { 'Content-Type': 'application/json' } },
        );
      }
      billing = { userId, serviceKey: 'collect', serviceName: (pricing?.service_name as string) || '智能采集', cost: estimated, credits: collectCredits };
    }

    // ===== 抓取层：直连优先 + Jina Reader 渲染兜底（新增） =====
    const JINA_READER = 'https://r.jina.ai/';
    const BLOCK_MARKERS = [
      'punish', 'captcha', '验证码', '访问验证', '安全验证', '滑动验证',
      'waf', 'robot check', 'recaptcha', 'hcaptcha',
      'pardon the interruption', 'before you continue', 'verify you are human',
    ];
    async function fetchDirect(u: string): Promise<{ html: string; error: string }> {
      try {
        const resp = await fetch(u, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          },
          redirect: 'follow',
        });
        if (!resp.ok) return { html: '', error: `目标页面返回 ${resp.status}` };
        return { html: await resp.text(), error: '' };
      } catch (e) {
        return { html: '', error: e instanceof Error ? e.message : String(e) };
      }
    }
    function isBlocked(htmlText: string): boolean {
      if (!htmlText || htmlText.length < 2500) return true;
      const lower = htmlText.toLowerCase();
      return BLOCK_MARKERS.some((m) => lower.includes(m));
    }
    async function fetchViaJina(u: string): Promise<{ text: string; error: string }> {
      try {
        const resp = await fetch(JINA_READER + u, {
          headers: { 'Accept': 'text/plain,text/markdown,text/html' },
          redirect: 'follow',
          signal: AbortSignal.timeout(20000),
        });
        if (!resp.ok) return { text: '', error: `代理读取失败 (${resp.status})` };
        return { text: await resp.text(), error: '' };
      } catch (e) {
        return { text: '', error: e instanceof Error ? e.message : String(e) };
      }
    }

    // 抓取目标网页：直连优先，反爬/失败时 Jina Reader 渲染兜底
    let html = '';
    let viaJina = false;
    let fetchError = '';
    {
      const direct = await fetchDirect(url);
      if (direct.html && !isBlocked(direct.html)) {
        html = direct.html;
      } else {
        const jina = await fetchViaJina(url);
        if (jina.text && jina.text.length > 200) {
          html = jina.text;
          viaJina = true;
        } else {
          fetchError = jina.error || direct.error || '目标页面被反爬拦截';
        }
      }
    }

    console.info(`[${functionName}] fetch ${requestId} status=${fetchError ? 'failed' : viaJina ? 'jina' : 'ok'} bytes=${html.length} durationMs=${Date.now() - startTime}`);

    if (!html) {
      if (billing?.userId) {
        await writeUsageLog(billing.userId, billing.serviceKey, billing.serviceName, billing.cost, '失败', 0);
      }
      return new Response(
        JSON.stringify({
          error: `无法读取该商品页面（${fetchError || '目标页面无内容'}）。主流电商平台普遍存在反爬限制，可尝试：① 更换其他平台商品链接；② 浏览器打开链接确认可访问；③ 直接在表单手动填写商品信息。`,
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ===== 解析：直连 HTML 走平台正则/JSON-LD/meta；Jina 渲染文本直接交给 AI =====
    const { platform, domain } = detectPlatform(url);
    const product = emptyProduct();
    product.source = url;
    product.platform = platform;

    if (!viaJina) {
    // 第一层：平台专用
    if (/^amazon\./i.test(domain)) Object.assign(product, { ...parseAmazon(html, url), platform });
    else if (/1688\.com|taobao\.com|tmall\.com/i.test(domain)) Object.assign(product, { ...parse1688(html), platform });
    else if (/aliexpress\./i.test(domain)) Object.assign(product, { ...parseAliExpress(html), platform });
    else if (/ebay\./i.test(domain)) Object.assign(product, { ...parseEbay(html), platform });
    else if (/temu\./i.test(domain)) Object.assign(product, { ...parseTemu(html), platform });

    // 第二层：JSON-LD（补缺）
    const jsonLd = extractJsonLd(html);
    if (jsonLd) {
      const j = jsonLdToProduct(jsonLd);
      product.name = product.name || j.name || '';
      product.price = product.price || j.price || 0;
      product.image = product.image || j.image || '';
      if (product.images.length === 0 && j.images && j.images.length > 0) product.images = j.images;
      product.description = product.description || j.description || '';
      product.sku = product.sku || j.sku || '';
      product.brand = product.brand || j.brand || '';
      product.currency = product.currency || j.currency || '';
      product.rating = product.rating || j.rating || 0;
      product.reviews = product.reviews || j.reviews || 0;
      if (product.variants.length === 0 && j.variants && j.variants.length > 0) product.variants = j.variants;
    }

    // 第三层：meta（补缺）
    const meta = extractMeta(html);
    product.name = product.name || meta.title;
    product.image = product.image || meta.image;
    product.description = product.description || meta.description;
    product.price = product.price || toPrice(meta.price);
    product.currency = product.currency || meta.currency;
    if (product.images.length === 0 && product.image) product.images = [product.image];
    } else {
      // Jina Markdown：Title 行直接作商品名兜底（排除验证码/错误页）+ 提取图片引用
      if (/captcha|verification|access denied|page not found|is blocked|not found/i.test(html) && html.length < 6000) {
        // 验证码/错误页：不产出有效数据，直接返回明确错误
        if (billing?.userId) {
          await writeUsageLog(billing.userId, billing.serviceKey, billing.serviceName, billing.cost, '失败', 0);
        }
        return new Response(
          JSON.stringify({
            error: `无法读取该商品页面：目标平台触发了人机验证或反爬拦截。可尝试：① 更换其他平台商品链接；② 浏览器打开链接确认可访问；③ 直接在表单手动填写商品信息。`,
          }),
          { status: 422, headers: { 'Content-Type': 'application/json' } },
        );
      } else {
        const mdTitle = html.match(/^Title:\s*(.+)$/m);
        if (mdTitle) {
          const t = mdTitle[1].replace(/\s*-\s*(AliExpress|Amazon|eBay|Temu|1688).*$/i, '').trim();
          if (t && !/captcha|verification|blocked|access denied|page not found|^not found$/i.test(t)) product.name = t;
        }
      }
      if (html) {
        const mdImages = [...html.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)]
          .map((m) => m[1])
          .filter((u) => /^https?:\/\//i.test(u) && !/logo|icon|avatar|cart|shopping/i.test(u))
          .slice(0, 10);
        if (mdImages.length > 0) product.images = mdImages;
        // 价格：常见 "$xx.xx" / "US $xx.xx" / "¥xx" / "€xx"（容忍数字间空格）
        const priceM = html.match(/(?:US\s*\$|\$|€|£|¥)\s*([0-9][0-9.,\s]*)/);
        if (priceM && !product.price) {
          const raw = priceM[1].replace(/\s/g, '');
          if (/[0-9]/.test(raw)) product.price = toPrice(raw);
        }
        // 币种：Jina Markdown 常见 "EN/**USD**" 等标记
        const curM = html.match(/\*\*(USD|EUR|GBP|JPY|AUD|CAD|CNY|HKD)\*\*/);
        if (curM && !product.currency) product.currency = curM[1];
      }
    }

    // ===== 1688/淘宝系前置拦截：Jina 渲染内容极短 ≈ 风控/验证页，直接明确报错，避免空转 =====
    if (viaJina && /1688\.com|taobao\.com|tmall\.com/i.test(url) && html.length < 6000) {
      if (billing?.userId) {
        await writeUsageLog(billing.userId, billing.serviceKey, billing.serviceName, 0, '失败', 0);
      }
      console.info(`[${functionName}] reject ${requestId} platform=1688 jina-blocked bytes=${html.length}`);
      return new Response(
        JSON.stringify({
          error: `该平台（1688/淘宝系）反爬风控严格，服务器无法读取商品页面内容（IP 被拦截）。请在电脑 Chrome/Edge 或安卓 Kiwi 浏览器安装「Thalvior 采集插件」后在商品页直接采集，或手动填写商品信息。`,
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // 第四层：AI 兜底（字段缺失或 Jina 渲染内容时强制；价格缺失也兜底提取）
    let aiUsage: { prompt_tokens: number; completion_tokens: number } | null = null;
    if (!product.name || !product.price) {
      try {
        const text = viaJina ? html.slice(0, 12000) : stripHtml(html);
        const ai = await aiParse(apiKey, text);
        aiUsage = ai.usage;
        if (!product.name) product.name = ai.name;
        if (!product.price) product.price = toPrice(ai.price);
        if (!product.sku) product.sku = ai.sku;
        if (!product.brand) product.brand = ai.brand;
        if (!product.seller) product.seller = ai.seller;
        if (!product.description) product.description = ai.description || text.slice(0, 800);
        if (!product.category) product.category = ai.category;
        if (!product.currency) product.currency = ai.currency;
        if (product.images.length === 0 && ai.images && ai.images.length > 0) product.images = ai.images;
      } catch (e) {
        console.warn(`[${functionName}] aiParse fallback failed ${requestId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // ===== 结果质量校验：核心字段全空 = 抓取失败，返回明确错误而非"未命名商品"假成功 =====
    const invalidName = /captcha|verification|access denied|page not found|maintenance|maintaining|under maintenance|not found|未命名商品/i.test(product.name || '');
    const hasCore = (product.name && !invalidName) || product.price > 0 || product.images.length > 0;
    if (!hasCore) {
      const isCny = /1688\.|taobao\.|tmall\.|jd\.com|pinduoduo\./i.test(url);
      const hint = isCny
        ? `该平台（1688/淘宝系）反爬风控严格，服务器端无法读取商品页面（IP 被拦截），未能提取到标题/价格等任何信息。请在电脑 Chrome/Edge 或安卓 Kiwi 浏览器安装「Thalvior 采集插件」后在商品页直接采集，或手动填写商品信息。`
        : `无法从该页面提取到有效商品信息（${fetchError || '页面未解析出标题/价格'}）。可尝试：① 更换其他平台商品链接；② 浏览器打开链接确认可访问；③ 直接在表单手动填写商品信息。`;
      if (billing?.userId) {
        await writeUsageLog(billing.userId, billing.serviceKey, billing.serviceName, 0, '失败', 0);
      }
      console.info(`[${functionName}] reject ${requestId} platform=${platform} empty-core bytes=${html.length}`);
      return new Response(
        JSON.stringify({ error: hint }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      );
    }

    product.name = product.name || '未命名商品';

    // 默认币种推断
    if (!product.currency) {
      if (/amazon\.(de|fr|it|es|co\.uk|nl|se|pl|com\.be)/i.test(url)) product.currency = 'EUR';
      else if (/amazon\.co\.jp/i.test(url)) product.currency = 'JPY';
      else if (/amazon\.ca/i.test(url)) product.currency = 'CAD';
      else if (/amazon\./i.test(url) || /walmart\.|ebay\./i.test(url)) product.currency = 'USD';
      else if (/1688\.|taobao\.|tmall\.|jd\.com|pinduoduo\./i.test(url)) product.currency = 'CNY';
      else product.currency = 'USD';
    }

    // 成功扣费 + 写日志：每次采集固定扣 AI 积分（credits_per_use），未触发 AI 兜底则 cost 按 0 计
    if (billing?.userId) {
      const realCost = aiUsage
        ? sell(calcTokenCost(pricing, aiUsage.prompt_tokens, aiUsage.completion_tokens), pricing)
        : 0;
      await deductCredits(billing.userId, billing.credits);
      await writeUsageLog(billing.userId, billing.serviceKey, billing.serviceName, realCost, '成功', billing.credits);
      if (aiUsage) {
        console.info(`[${functionName}] billed ${requestId} tokens=${aiUsage.prompt_tokens}/${aiUsage.completion_tokens} cost=¥${realCost} credits=${billing.credits}`);
      }
    }

    console.info(`[${functionName}] success ${requestId} name=${product.name.slice(0, 40)} price=${product.price} variants=${product.variants.length} platform=${product.platform} durationMs=${Date.now() - startTime}`);

    return new Response(
      JSON.stringify({
        data: {
          ...product,
          domain,
        },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    console.error(`[${functionName}] failed ${requestId}: ${message}`);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});
