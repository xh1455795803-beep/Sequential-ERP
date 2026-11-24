import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ==================== 物流轨迹自动抓取 ====================
// 定时（cron）调用，从 tlv_outbound_orders 里找需要更新轨迹的订单
// 然后调 4PX / 燕文 / 云途 等物流商 API
// POST /functions/v1/sync-logistics-tracking { warehouse_id? }

const CARRIER_TRACKING: Record<string, { api: string; parser: string }> = {
  '4PX':      { api: 'https://openapi.4px.com/track', parser: '4px' },
  '燕文物流': { api: 'https://api.yanwen.com/track', parser: 'yanwen' },
  '云途物流': { api: 'https://www.yuntongex.com/api/track', parser: 'yuntong' },
  'DHL':      { api: 'https://api-eu.dhl.com/track', parser: 'dhl' },
  'EMS':      { api: 'https://api.ems.com.cn/track', parser: 'ems' },
};

serve(async (req) => {
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const FOURPX_API_KEY = Deno.env.get('FOURPX_API_KEY') || '';

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
    const { warehouse_id } = await req.json().catch(() => ({}));

    // 拉取所有已发货但未完成的订单
    let query = supabase.from('tlv_outbound_orders').select('id, tracking_no, carrier, merchant_id, warehouse_id, status')
      .neq('tracking_no', null).in('status', ['shipped', 'label_printed', 'packing']);
    if (warehouse_id) query = query.eq('warehouse_id', warehouse_id);
    const { data: orders } = await query;

    if (!orders || orders.length === 0) {
      return json({ ok: true, checked: 0, updated: 0 });
    }

    let updated = 0;
    let failed = 0;

    for (const o of orders) {
      const carrier = CARRIER_TRACKING[o.carrier];
      if (!carrier) continue;

      // 占位：真实环境下调各物流商 API
      // const events = await fetchTrackingEvents(carrier.api, o.tracking_no, FOURPX_API_KEY);
      const events: any[] = []; // 没配 API key 时跳过

      for (const ev of events) {
        await supabase.from('tlv_logistics_tracking').upsert({
          merchant_id: o.merchant_id,
          warehouse_id: o.warehouse_id,
          outbound_id: o.id,
          tracking_no: o.tracking_no,
          event_time: ev.time,
          event_status: ev.status,
          event_description: ev.description,
          event_location: ev.location,
          carrier: o.carrier,
        });
        updated++;
      }

      // 更新订单的最终状态
      const finalStatus = events.find((e) => e.is_final);
      if (finalStatus) {
        await supabase.from('tlv_outbound_orders').update({
          status: 'completed', completed_at: new Date().toISOString(),
        }).eq('id', o.id);
      }
    }

    return json({ ok: true, checked: orders.length, updated, failed });
  } catch (e: any) {
    return json({ error: e?.message }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
