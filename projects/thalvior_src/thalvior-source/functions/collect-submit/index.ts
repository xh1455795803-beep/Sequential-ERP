/**
 * collect-submit — 接收浏览器采集插件提交的商品数据，创建商品草稿
 * 鉴权：Bearer token（Supabase 用户会话）
 * 入参：{ product: { title|name, price?, images?, description?, sku?, brand?, platform?, url?, ... } }
 * 返回：{ data: { id } }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

function cleanText(s: unknown, max = 5000): string {
  if (s == null) return '';
  return String(s).replace(/\s+/g, ' ').trim().slice(0, max);
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickImages(p: Record<string, unknown>): string[] {
  const raw = p.images ?? p.image_urls ?? p.imgs ?? [];
  const arr = Array.isArray(raw) ? raw : (typeof raw === 'string' ? [raw] : []);
  return arr
    .map((u) => (typeof u === 'string' ? u.trim() : ''))
    .filter((u) => /^https?:\/\//i.test(u) && u.length < 1000)
    .slice(0, 40);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }

  const userId = await resolveUserId(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: '未授权，请登录后重试' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const p: Record<string, unknown> = (body?.product ?? body ?? {});
    if (!p || typeof p !== 'object') {
      return new Response(JSON.stringify({ error: '参数错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const name = cleanText(p.title || p.name || p.itemTitle || '');
    const images = pickImages(p);
    if (!name && !images.length) {
      return new Response(JSON.stringify({ error: '未识别到商品标题或图片，请确认在商品详情页采集' }), { status: 422, headers: { 'Content-Type': 'application/json' } });
    }

    const description = cleanText(p.description || p.desc || '', 8000);
    const sku = cleanText(p.sku || p.goodsId || p.offerId || p.asin || '', 100);
    const brand = cleanText(p.brand || p.seller || p.shopName || '', 200);
    const platform = cleanText(p.platform || '', 50);
    const sourceUrl = cleanText(p.url || '', 1000);
    const price = toNum(p.price);

    const now = new Date().toISOString();
    const extras: Record<string, unknown> = {
      source_url: sourceUrl,
      source_platform: platform || '插件采集',
      brand: brand || undefined,
      collector: 'browser-extension',
      collected_at: now,
      weight: toNum(p.weight) ?? undefined,
      length: toNum(p.length) ?? undefined,
      width: toNum(p.width) ?? undefined,
      height: toNum(p.height) ?? undefined,
    };

    const { data: inserted, error } = await adminClient()
      .from('products')
      .insert({
        name,
        description,
        category: cleanText(p.category, 200),
        sku,
        price,
        stock: toNum(p.stock) ?? 0,
        status: 'draft',
        images,
        primary_image: images[0] ?? null,
        source_platform: platform || '插件采集',
        source_url: sourceUrl,
        extras,
        created_at: now,
        updated_at: now,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[collect-submit] insert failed:', error.message);
      return new Response(JSON.stringify({ error: `保存失败：${error.message}` }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    console.info(`[collect-submit] ok user=${userId.slice(0, 8)} id=${inserted?.id} name=${name.slice(0, 40)}`);

    // 变体：插件采集到的 SKU 列表（spec/price/stock）→ product_variants 行
    const skus = Array.isArray(p.skus) ? p.skus : [];
    if (skus.length > 0) {
      const vNow = new Date().toISOString();
      const rows = skus
        .map((s: Record<string, unknown>) => ({
          product_id: inserted?.id,
          sku: cleanText(s?.skuId ?? s?.sku ?? '', 100),
          attributes: cleanText(s?.spec ?? '', 500),
          price: toNum(s?.price),
          stock: toNum(s?.stock) ?? 0,
          user_id: userId,
          created_at: vNow,
          updated_at: vNow,
        }))
        .filter((r: Record<string, unknown>) => r.sku || r.attributes || r.price != null);
      if (rows.length > 0) {
        const { error: vErr } = await adminClient().from('product_variants').insert(rows);
        if (vErr) console.error(`[collect-submit] variants insert failed: ${vErr.message}`);
        else console.info(`[collect-submit] variants inserted=${rows.length} product=${inserted?.id}`);
      }
    }

    return new Response(
      JSON.stringify({ data: { id: inserted?.id, status: 'draft' } }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    console.error(`[collect-submit] failed: ${message}`);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
