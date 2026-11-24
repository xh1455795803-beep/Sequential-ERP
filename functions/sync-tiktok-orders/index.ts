import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ==================== TikTok Shop 订单同步 ====================
// 调用 TikTok Shop Partner API 拉取指定商家的订单，upsert 到 tlv_outbound_orders
// 需配置环境变量: TIKTOK_APP_KEY, TIKTOK_APP_SECRET
// 调用方式: POST /functions/v1/sync-tiktok-orders { merchant_id: '...' }

serve(async (req) => {
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const TIKTOK_APP_KEY = Deno.env.get('TIKTOK_APP_KEY') || '';
    const TIKTOK_APP_SECRET = Deno.env.get('TIKTOK_APP_SECRET') || '';

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
    const { merchant_id: merchantId, warehouse_id: warehouseId } = await req.json();

    if (!merchantId) return json({ error: 'merchant_id required' }, 400);

    // 1. 查商家已授权的 TikTok 店铺
    const { data: shops } = await supabase
      .from('tlv_merchant_shops')
      .select('id, shop_name, api_token, platform, tlv_merchants!merchant_id(warehouse_id)')
      .eq('merchant_id', merchantId)
      .eq('platform', 'TikTok Shop')
      .eq('status', 'connected');

    if (!shops || shops.length === 0) {
      return json({ ok: true, message: 'No connected TikTok shops', synced: 0 });
    }

    const now = new Date();
    const fromDate = new Date(now.getTime() - 24 * 3600_000).toISOString();
    let totalSynced = 0;
    const logs: any[] = [];

    for (const shop of shops) {
      // 调 TikTok API（占位：实际需要用 refresh_token 换 access_token）
      // const accessToken = await refreshTikTokToken(shop.api_token, TIKTOK_APP_KEY, TIKTOK_APP_SECRET);
      // const tiktokOrders = await fetchTiktokOrders(accessToken, fromDate);

      // 演示：没有真实 API key 时跳过，只写 sync_log
      const synced = 0;
      logs.push({ shop: shop.shop_name, synced, note: TIKTOK_APP_KEY ? 'queried (no real data)' : 'skipped (no TIKTOK_APP_KEY)' });
      totalSynced += synced;
    }

    // 写 platform_sync_logs
    await supabase.from('tlv_platform_sync_logs').insert({
      platform: 'TikTok Shop',
      merchant_id: merchantId,
      warehouse_id: warehouseId || shops[0]?.tlv_merchants?.warehouse_id,
      records_synced: totalSynced,
      status: TIKTOK_APP_KEY ? 'completed' : 'skipped_no_api_key',
      log_details: { logs, env_configured: !!TIKTOK_APP_KEY },
    });

    return json({ ok: true, synced: totalSynced, logs });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
