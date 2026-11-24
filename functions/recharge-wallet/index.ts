import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ==================== 钱包充值 ====================
// POST /functions/v1/recharge-wallet { merchant_id, amount }
// dev 模式: 直接 INSERT wallet, 同时 INSERT merchant_wallets 表
serve(async (req) => {
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    const { merchant_id, amount } = await req.json();
    if (!merchant_id || !amount || amount <= 0) return json({ error: 'merchant_id and amount required' }, 400);

    // 查 merchant 当前余额
    const { data: lastTx } = await supabase
      .from('tlv_merchant_wallets')
      .select('balance_after, warehouse_id')
      .eq('merchant_id', merchant_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const currentBal = Number(lastTx?.balance_after || 0);
    const warehouseId = lastTx?.warehouse_id || (
      await supabase.from('tlv_merchants').select('warehouse_id').eq('id', merchant_id).maybeSingle()
    ).data?.warehouse_id;

    const newBal = +(currentBal + Number(amount)).toFixed(2);
    const txnId = `RECH-${Date.now()}`;

    // INSERT wallet
    await supabase.from('tlv_merchant_wallets').insert({
      merchant_id,
      warehouse_id: warehouseId,
      type: 'recharge',
      amount: Number(amount),
      balance_after: newBal,
      transaction_id: txnId,
      note: '充值 (dev-mode)',
    });

    return json({ ok: true, balance: newBal, transaction_id: txnId, amount: Number(amount) });
  } catch (e: any) {
    return json({ error: e?.message }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
