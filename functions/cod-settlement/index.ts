import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ==================== COD 结算（代收/结算/打款） ====================
// 商家发起提现 → 仓库确认 → 平台审核 → 打款
// POST /functions/v1/cod-settlement/create     { merchant_id, outbound_ids: [] }
// POST /functions/v1/cod-settlement/approve   { settlement_id, approver_role: 'warehouse'|'admin' }
// POST /functions/v1/cod-settlement/pay        { settlement_id }  (最终打款)

serve(async (req) => {
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    const url = new URL(req.url);
    const action = url.pathname.split('/').pop();
    const body = await req.json().catch(() => ({}));

    if (action === 'create') return await createSettlement(supabase, body);
    if (action === 'approve') return await approveSettlement(supabase, body);
    if (action === 'pay') return await paySettlement(supabase, body);

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e: any) {
    return json({ error: e?.message }, 500);
  }
});

async function createSettlement(supabase: any, body: any) {
  const { merchant_id, outbound_ids = [] } = body;
  if (!merchant_id) return json({ error: 'merchant_id required' }, 400);

  // 查这些订单的 COD 金额总和
  const { data: orders } = await supabase.from('tlv_outbound_orders')
    .select('id, order_no, cod_amount, tracking_no, carrier')
    .in('id', outbound_ids).eq('merchant_id', merchant_id).eq('is_cod', true);

  const totalCod = orders?.reduce((s: number, o: any) => s + Number(o.cod_amount || 0), 0) || 0;
  const { data: s, error } = await supabase.from('tlv_cod_settlements').insert({
    merchant_id,
    outbound_ids: outbound_ids,
    cod_total: totalCod,
    fee_amount: +(totalCod * 0.03).toFixed(2), // 3% 手续费
    net_amount: +(totalCod * 0.97).toFixed(2),
    status: 'pending_warehouse',
  }).select().single();

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, settlement: s });
}

async function approveSettlement(supabase: any, body: any) {
  const { settlement_id, approver_role } = body;
  if (!settlement_id) return json({ error: 'settlement_id required' }, 400);

  const nextStatus = approver_role === 'warehouse' ? 'pending_admin' : 'pending_pay';
  const { error } = await supabase.from('tlv_cod_settlements')
    .update({ status: nextStatus, [`${approver_role}_approved_at`]: new Date().toISOString() })
    .eq('id', settlement_id);

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, settlement_id, new_status: nextStatus });
}

async function paySettlement(supabase: any, body: any) {
  const { settlement_id } = body;
  const { data: s } = await supabase.from('tlv_cod_settlements').select('*').eq('id', settlement_id).maybeSingle();
  if (!s) return json({ error: 'not found' }, 404);

  // 打款后，把 net_amount 加到商家钱包（type='recharge' / COD 到账）
  await supabase.from('tlv_merchant_wallets').insert({
    merchant_id: s.merchant_id, type: 'recharge', amount: Number(s.net_amount),
    transaction_id: `COD-SETTLE-${s.id.slice(0, 8).toUpperCase()}`,
    note: `COD 代收结算（单号 ${s.id.slice(0, 8)}）`,
  });

  // 扣减手续费（平台收入）
  if (Number(s.fee_amount) > 0) {
    await supabase.from('tlv_merchant_wallets').insert({
      merchant_id: s.merchant_id, type: 'adjustment', amount: -Number(s.fee_amount),
      transaction_id: `COD-FEE-${s.id.slice(0, 8).toUpperCase()}`,
      note: `COD 代收手续费 3%`,
    });
  }

  await supabase.from('tlv_cod_settlements').update({
    status: 'paid', paid_at: new Date().toISOString(),
  }).eq('id', settlement_id);

  return json({ ok: true, settlement_id, net_amount: s.net_amount });
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
