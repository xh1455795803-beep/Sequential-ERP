import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ==================== 物流轨迹同步 ====================
// POST /functions/v1/sync-logistics-tracking { tracking_no, carrier }
// 无物流商 API Key → 生成 demo 轨迹入库
serve(async (req) => {
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    const body = await req.json().catch(() => ({}));
    const trackingNo = body.tracking_no;
    const carrier = body.carrier || 'Unknown';

    if (!trackingNo) {
      // 批量: 为所有 shipped orders 生成轨迹
      const { data } = await supabase
        .from('tlv_outbound_orders')
        .select('id, tracking_no, merchant_id')
        .eq('status', 'shipped')
        .not('tracking_no', 'is', null);
      if (!data || data.length === 0) return json({ ok: true, synced: 0 });

      let synced = 0;
      for (const o of data) {
        await generateAndInsertTracking(supabase, o.tracking_no, carrier, o.id, o.merchant_id);
        synced++;
      }
      return json({ ok: true, synced });
    }

    // 单个
    const { data: order } = await supabase
      .from('tlv_outbound_orders')
      .select('id, merchant_id')
      .eq('tracking_no', trackingNo)
      .maybeSingle();
    if (order) {
      await generateAndInsertTracking(supabase, trackingNo, carrier, order.id, order.merchant_id);
    }
    return json({ ok: true, tracking_no: trackingNo });
  } catch (e: any) {
    return json({ error: e?.message }, 500);
  }
});

async function generateAndInsertTracking(supabase: any, tracking: string, carrier: string, orderId: string, merchantId: string) {
  const events = [
    { status: 'picked_up', loc: 'Shanghai', desc: '包裹已揽收', offset_h: -48 },
    { status: 'in_transit', loc: 'Shanghai Hub', desc: '到达上海转运中心', offset_h: -36 },
    { status: 'in_transit', loc: 'Hong Kong', desc: '到达香港国际口岸', offset_h: -24 },
    { status: 'in_transit', loc: 'Los Angeles', desc: '到达洛杉矶国际机场', offset_h: -12 },
    { status: 'out_for_delivery', loc: 'Los Angeles Local', desc: '派送中', offset_h: -4 },
    { status: 'delivered', loc: 'Los Angeles', desc: '已签收 ✅', offset_h: 0 },
  ];
  for (const ev of events) {
    await supabase.from('tlv_logistics_tracking').insert({
      outbound_order_id: orderId,
      merchant_id: merchantId,
      tracking_no: tracking,
      carrier,
      status: ev.status,
      location: ev.loc,
      description: ev.desc,
      tracked_at: new Date(Date.now() + ev.offset_h * 3600_000).toISOString(),
    });
  }
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
