import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ==================== 批量生成面单 PDF ====================
// 接收一批 outbound_ids，调物流商 API 拿面单，存 label_pdf_url
// POST /functions/v1/generate-label-pdf { outbound_ids: [uuid,...], carrier: '4PX' }

serve(async (req) => {
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const FOURPX_API_KEY = Deno.env.get('FOURPX_API_KEY') || '';
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    const { outbound_ids: ids, carrier } = await req.json();
    if (!ids || ids.length === 0) return json({ error: 'outbound_ids required' }, 400);

    const { data: orders } = await supabase
      .from('tlv_outbound_orders').select('id, order_no, tracking_no, carrier, warehouse_id')
      .in('id', ids);

    let generated = 0;
    const results: any[] = [];

    for (const o of orders || []) {
      const targetCarrier = carrier || o.carrier;
      // 真实环境下：调 4PX / 燕文 API 拿面单 PDF bytes → 存 Storage → 返回 URL
      // const pdfBytes = await fetchLabelPDF(targetCarrier, o.tracking_no, FOURPX_API_KEY);
      // const { data } = await supabase.storage.from('labels').upload(`${o.order_no}.pdf`, pdfBytes);
      const fakeUrl = `https://storage.example.com/labels/${o.order_no}.pdf`;

      await supabase.from('tlv_outbound_orders').update({
        label_pdf_url: fakeUrl, labeled_at: new Date().toISOString(),
      }).eq('id', o.id);

      generated++;
      results.push({ outbound_id: o.id, label_pdf_url: fakeUrl, carrier: targetCarrier });
    }

    return json({ ok: true, generated, results });
  } catch (e: any) {
    return json({ error: e?.message }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
