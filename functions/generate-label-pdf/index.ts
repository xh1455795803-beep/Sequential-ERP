import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ==================== 批量生成面单 ====================
// 无 API Key 也能跑通 → 生成真实 SVG 面单 base64，前端可直接 download
serve(async (req) => {
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    const body = await req.json();
    const ids: string[] = body.outbound_ids || (body.outbound_id ? [body.outbound_id] : []);
    const carrier = body.carrier || 'default';

    if (ids.length === 0) return json({ error: 'outbound_id(s) required' }, 400);

    const { data: orders } = await supabase
      .from('tlv_outbound_orders')
      .select('id, order_no, tracking_no, platform, receiver_name, receiver_phone, receiver_address, weight_kg, is_cod, cod_amount')
      .in('id', ids);

    if (!orders || orders.length === 0) return json({ error: 'orders not found' }, 404);

    const results: any[] = [];
    for (const o of orders) {
      const svg = generateLabelSVG(o, carrier);
      const base64 = btoa(unescape(encodeURIComponent(svg)));
      const dataUrl = `data:image/svg+xml;base64,${base64}`;

      await supabase.from('tlv_outbound_orders').update({
        tracking_no: o.tracking_no || `TRACK-${o.order_no}`,
        labeled_at: new Date().toISOString(),
      }).eq('id', o.id);

      results.push({
        outbound_id: o.id,
        order_no: o.order_no,
        tracking_no: o.tracking_no || `TRACK-${o.order_no}`,
        svg_base64: base64,
        data_url: dataUrl,
        carrier,
        format: 'svg',
      });
    }

    return json({ ok: true, generated: results.length, results });
  } catch (e: any) {
    return json({ error: e?.message, stack: e?.stack }, 500);
  }
});

function generateLabelSVG(o: any, carrier: string): string {
  const w = 400, h = 600;
  const tracking = o.tracking_no || `TRACK-${o.order_no}`;
  const name = o.receiver_name || 'Buyer';
  const phone = o.receiver_phone || '-';
  const addr = o.receiver_address || '-';
  const cod = o.is_cod ? `COD ¥${o.cod_amount || 0}` : '';

  // 简易条码（用 tracking_no 重复字符模拟）
  let barcodeBars = '';
  for (let i = 0; i < tracking.length; i++) {
    const c = tracking.charCodeAt(i);
    const bar = (c % 3 === 0) ? 4 : (c % 3 === 1 ? 2 : 3);
    barcodeBars += `<rect x="${10 + i * 6}" y="0" width="${bar}" height="40" fill="#000"/>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <rect width="${w}" height="${h}" fill="#fff"/>
  <!-- Header -->
  <rect x="10" y="10" width="${w-20}" height="40" fill="#1f2937"/>
  <text x="20" y="37" font-family="monospace" font-size="16" fill="#fff" font-weight="bold">THALVIOR WMS · ${carrier.toUpperCase()}</text>

  <!-- Order No -->
  <text x="20" y="90" font-family="monospace" font-size="12" fill="#666">ORDER NO</text>
  <text x="20" y="108" font-family="monospace" font-size="18" fill="#111" font-weight="bold">${o.order_no}</text>

  <!-- Barcode -->
  <g transform="translate(20, 125)">
    <rect x="0" y="0" width="${tracking.length * 6 + 10}" height="44" fill="#fff" stroke="#000"/>
    ${barcodeBars}
    <text x="${tracking.length * 3}" y="62" font-family="monospace" font-size="11" text-anchor="middle" fill="#000">${tracking}</text>
  </g>

  <!-- To: address -->
  <rect x="10" y="190" width="${w-20}" height="170" fill="#f9fafb" stroke="#d1d5db"/>
  <text x="20" y="212" font-family="sans-serif" font-size="10" fill="#666" font-weight="bold">TO</text>
  <text x="20" y="232" font-family="sans-serif" font-size="18" fill="#111" font-weight="bold">${name}</text>
  <text x="20" y="252" font-family="sans-serif" font-size="12" fill="#444">📞 ${phone}</text>
  <text x="20" y="272" font-family="sans-serif" font-size="12" fill="#444">📍 ${addr}</text>
  ${cod ? `<rect x="${w-120}" y="195" width="100" height="30" fill="#f59e0b"/><text x="${w-70}" y="215" font-family="sans-serif" font-size="12" fill="#fff" text-anchor="middle" font-weight="bold">${cod}</text>` : ''}

  <!-- Weight -->
  <text x="20" y="395" font-family="monospace" font-size="14" fill="#374151">Weight: ${o.weight_kg || 0.5} kg</text>

  <!-- QR Code (simple grid) -->
  <g transform="translate(${w-90}, ${h-150})">
    ${generateQR(tracking, 70)}
  </g>

  <!-- Footer -->
  <text x="${w/2}" y="${h-15}" font-family="monospace" font-size="9" text-anchor="middle" fill="#999">
    Thalvior WMS · Generated ${new Date().toISOString().slice(0,10)}
  </text>
</svg>`;
}

function generateQR(data: string, size: number): string {
  const cells = 15;
  const cellSize = size / cells;
  const hash = Array.from(data).reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0);
  let rects = '';
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      const bit = (hash >> ((r * cells + c) % 32)) & 1;
      if (bit) rects += `<rect x="${c * cellSize}" y="${r * cellSize}" width="${cellSize-1}" height="${cellSize-1}" fill="#000"/>`;
    }
  }
  return rects;
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
