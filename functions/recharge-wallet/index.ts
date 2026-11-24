import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ==================== 钱包充值（Stripe） ====================
// 1. 创建 PaymentIntent → 返回 client_secret 给前端
// 2. Webhook 收到 payment_intent.succeeded → INSERT tlv_merchant_wallets(type='recharge')
// POST /functions/v1/recharge-wallet { merchant_id, amount, currency }
// POST /functions/v1/recharge-wallet/webhook  (Stripe webhook)

serve(async (req) => {
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const STRIPE_SECRET = Deno.env.get('STRIPE_SECRET_KEY') || '';

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
    const url = new URL(req.url);

    if (req.method === 'POST' && url.pathname.endsWith('/webhook')) {
      return await handleWebhook(req, supabase, SUPABASE_SERVICE_ROLE);
    }

    const { merchant_id: merchantId, amount, currency = 'CNY' } = await req.json();
    if (!merchantId || !amount || amount <= 0) return json({ error: 'merchant_id and amount required' }, 400);

    if (!STRIPE_SECRET) {
      // 没 Stripe key → 模拟充值（dev 模式）
      const txnId = `DEV-RECHARGE-${Date.now()}`;
      await supabase.from('tlv_merchant_wallets').insert({
        merchant_id: merchantId, type: 'recharge', amount: Number(amount),
        transaction_id: txnId, note: 'dev-mode recharge (no Stripe)',
      });
      // 更新余额
      await supabase.rpc('_update_merchant_balance', { p_merchant_id: merchantId });
      const { data: m } = await supabase.from('tlv_merchants').select('balance').eq('id', merchantId).maybeSingle();
      return json({ ok: true, mock: true, balance: m?.balance, transaction_id: txnId });
    }

    // 真实 Stripe（占位）
    // const pi = await fetch('https://api.stripe.com/v1/payment_intents', ...);
    return json({ ok: true, stripe: true, message: 'Stripe integration placeholder' });
  } catch (e: any) {
    return json({ error: e?.message }, 500);
  }
});

async function handleWebhook(req: Request, supabase: any, _serviceRole: string) {
  // const sig = req.headers.get('stripe-signature')!;
  // const body = await req.text();
  // const event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  // if (event.type === 'payment_intent.succeeded') { ... credit wallet ... }
  return json({ ok: true, webhook_handled: true });
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
