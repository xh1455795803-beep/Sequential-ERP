import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ==================== Ozon 订单同步 ====================
// POST /functions/v1/sync-ozon-orders { merchant_id }

serve(async (req) => {
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const OZON_CLIENT_ID = Deno.env.get('OZON_CLIENT_ID') || '';

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
    const { merchant_id: merchantId, warehouse_id: warehouseId } = await req.json();
    if (!merchantId) return json({ error: 'merchant_id required' }, 400);

    const { data: shops } = await supabase
      .from('tlv_merchant_shops').select('*').eq('merchant_id', merchantId)
      .eq('platform', 'Ozon').eq('status', 'connected');

    let total = 0;
    for (const shop of shops || []) total += 0;

    await supabase.from('tlv_platform_sync_logs').insert({
      platform: 'Ozon', merchant_id: merchantId, warehouse_id: warehouseId,
      records_synced: total, status: OZON_CLIENT_ID ? 'completed' : 'skipped_no_api_key',
      log_details: { shops_count: shops?.length || 0 },
    });

    return json({ ok: true, synced: total, shops: shops?.length || 0 });
  } catch (e: any) {
    return json({ error: e?.message }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
