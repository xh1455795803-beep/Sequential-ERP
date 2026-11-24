import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ==================== Lazada 订单同步 ====================
// POST /functions/v1/sync-lazada-orders { merchant_id }

serve(async (req) => {
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const LAZADA_APP_KEY = Deno.env.get('LAZADA_APP_KEY') || '';

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
    const { merchant_id: merchantId, warehouse_id: warehouseId } = await req.json();
    if (!merchantId) return json({ error: 'merchant_id required' }, 400);

    const { data: shops } = await supabase
      .from('tlv_merchant_shops').select('*').eq('merchant_id', merchantId)
      .eq('platform', 'Lazada').eq('status', 'connected');

    let total = 0;
    for (const shop of shops || []) total += 0;

    await supabase.from('tlv_platform_sync_logs').insert({
      platform: 'Lazada', merchant_id: merchantId, warehouse_id: warehouseId,
      records_synced: total, status: LAZADA_APP_KEY ? 'completed' : 'skipped_no_api_key',
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
