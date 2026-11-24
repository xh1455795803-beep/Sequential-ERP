import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ==================== Mercado Libre 订单同步 ====================
// POST /functions/v1/sync-mercado-orders { merchant_id? }
// 无 App Key: 生成 demo 订单入库, 保证完整可用链路
const PLATFORM = 'Mercado Libre';
const PLATFORM_CODE = 'mercado';

serve(async (req) => {
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    const body = await req.json().catch(() => ({}));
    const merchantId = body.merchant_id;

    // 找目标 merchant
    let targetMerchants: string[] = [];
    if (merchantId) {
      targetMerchants = [merchantId];
    } else {
      const { data: shops } = await supabase
        .from('tlv_merchant_shops')
        .select('merchant_id')
        .ilike('platform', PLATFORM_CODE);
      if (shops && shops.length > 0) {
        targetMerchants = [...new Set(shops.map((s: any) => s.merchant_id))];
      } else {
        // 退而求其次: 取任意 merchant
        const { data: all } = await supabase.from('tlv_merchants').select('id').limit(2);
        targetMerchants = (all || []).map((m: any) => m.id);
      }
    }

    if (targetMerchants.length === 0) return json({ error: 'no merchants' }, 404);

    const { data: allMerchants } = await supabase.from('tlv_merchants').select('id, warehouse_id');
    const mMap: any = Object.fromEntries((allMerchants || []).map((m: any) => [m.id, m]));

    let created = 0;
    const results: any[] = [];

    for (const mid of targetMerchants) {
      const m = mMap[mid];
      if (!m) continue;
      const wid = m.warehouse_id;

      // 生成 3-5 条 demo 订单
      const orderCount = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < orderCount; i++) {
        const orderNo = `${PLATFORM_CODE.toUpperCase()}-${Date.now()}-${i}`;
        const isCOD = Math.random() < 0.3;
        const codAmt = isCOD ? Math.round((20 + Math.random() * 80) * 100) / 100 : null;
        const items = generateItems();
        const itemSKUs = items.map(it => it.sku);

        const { data: inv } = await supabase
          .from('tlv_merchant_inventory')
          .select('sku')
          .eq('merchant_id', mid)
          .in('sku', itemSKUs);
        const available = new Set((inv || []).map((x: any) => x.sku));
        const validItems = items.filter(it => available.has(it.sku));
        if (validItems.length === 0) continue;

        // INSERT order
        const { data: orderInsert } = await supabase.from('tlv_outbound_orders').insert({
          warehouse_id: wid,
          merchant_id: mid,
          order_no: orderNo,
          platform: PLATFORM,
          receiver_name: generateName(),
          receiver_phone: `+1${String(2000000000 + Math.floor(Math.random() * 7999999999))}`,
          receiver_address: generateAddr(),
          is_cod: isCOD,
          cod_amount: codAmt,
          carrier: generateCarrier(),
          weight_kg: validItems.reduce((s, it) => s + it.qty * 0.3, 0),
          status: 'pending',
        }).select().maybeSingle();

        if (orderInsert) {
          // INSERT items
          const toInsert = validItems.map(it => ({
            outbound_order_id: orderInsert.id,
            warehouse_id: wid,
            merchant_id: mid,
            sku: it.sku,
            qty: it.qty,
            weight_g: Math.round(it.qty * 300),
          }));
          await supabase.from('tlv_outbound_items').insert(toInsert);
          created++;
          results.push({ order_id: orderInsert.id, order_no: orderNo, item_count: validItems.length });
        }
      }
    }

    // 记录 sync log
    await supabase.from('tlv_platform_sync_logs').insert({
      platform: PLATFORM_CODE,
      merchant_id: targetMerchants[0],
      direction: 'order_in',
      records_fetched: created,
      records_created: created,
      status: 'success',
      message: `dev-sync: generated ${created} demo orders`,
    });

    return json({ ok: true, platform: PLATFORM, created, results, source: 'demo-generator' });
  } catch (e: any) {
    return json({ error: e?.message, stack: e?.stack }, 500);
  }
});

function generateItems(): any[] {
  const skus = ['SKU-001', 'SKU-002', 'SKU-003'];
  const n = 1 + Math.floor(Math.random() * 3);
  return Array.from({ length: n }, () => ({
    sku: skus[Math.floor(Math.random() * skus.length)],
    qty: 1 + Math.floor(Math.random() * 3),
  }));
}
function generateName() {
  const f = ['John', 'Sarah', 'Mike', 'Emma', 'Alex', 'Lisa', 'David', 'Anna'];
  const l = ['Smith', 'Johnson', 'Lee', 'Brown', 'Wilson', 'Garcia', 'Taylor'];
  return `${f[Math.floor(Math.random()*f.length)]} ${l[Math.floor(Math.random()*l.length)]}`;
}
function generateAddr() {
  const states = ['CA', 'NY', 'TX', 'FL', 'WA', 'IL'];
  const cities = ['Los Angeles', 'New York', 'Houston', 'Miami', 'Seattle', 'Chicago'];
  return `${100 + Math.floor(Math.random() * 9900)} Main St, ${cities[Math.floor(Math.random()*cities.length)]}, ${states[Math.floor(Math.random()*states.length)]} ${10000 + Math.floor(Math.random()*89999)}, USA`;
}
function generateCarrier() {
  return ['4PX', 'Yanwen', 'DHL', 'UPS', 'USPS'][Math.floor(Math.random() * 5)];
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
