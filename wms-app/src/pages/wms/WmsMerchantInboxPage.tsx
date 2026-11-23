import { useEffect, useState } from 'react';
import { supabase, getAuthContext } from '../../lib/supabase';
import { Inbox, CheckCircle2, ArrowRight, Loader2 } from 'lucide-react';

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: '待收货', cls: 'bg-slate-100 text-slate-700' },
  received: { label: '已收货待检验', cls: 'bg-blue-50 text-blue-700' },
  inspecting: { label: '检验中', cls: 'bg-amber-50 text-amber-700' },
};

const NEXT_STATUS: Record<string, { label: string; next: string }> = {
  pending: { label: '确认收货', next: 'received' },
  received: { label: '开始检验', next: 'inspecting' },
  inspecting: { label: '完成上架', next: 'completed' },
};

export function WmsMerchantInboxPage() {
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    (async () => {
      const ctx = await getAuthContext();
      if (!ctx.warehouseId) return;
      setWarehouseId(ctx.warehouseId);
      await load(ctx.warehouseId);
      setLoading(false);
    })();
  }, []);

  async function load(wid: string) {
    try {
      const { data, error } = await supabase
        .from('tlv_inbound_orders')
        .select('id, inbound_no, merchant_name, sku_count, total_qty, eta, status')
        .eq('warehouse_id', wid)
        .in('status', ['pending', 'received', 'inspecting'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      setRows(data || []);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function advance(id: string, current: string, wid: string) {
    const step = NEXT_STATUS[current];
    if (!step) return;
    setBusy(id);
    try {
      const now = new Date().toISOString();
      const patch: any = { status: step.next };
      if (step.next === 'received') patch.received_at = now;
      if (step.next === 'inspecting') patch.inspecting_at = now;
      if (step.next === 'completed') {
        patch.completed_at = now;
        // 完成上架：将入库商品写入库存
        const { data: inbound } = await supabase
          .from('tlv_inbound_orders').select('merchant_id').eq('id', id).single();
        const merchantId = inbound?.merchant_id;
        const { data: items } = await supabase
          .from('tlv_inbound_items')
          .select('sku, product_name, location, actual_qty')
          .eq('inbound_id', id);
        if (items && merchantId) {
          for (const it of items as any[]) {
            const qty = it.actual_qty || 0;
            if (qty <= 0) continue;
            // 累加到现有库存
            const { data: existing } = await supabase
              .from('tlv_merchant_inventory')
              .select('qty_on_hand').eq('warehouse_id', wid).eq('merchant_id', merchantId).eq('sku', it.sku).single();
            if (existing) {
              await supabase.from('tlv_merchant_inventory')
                .update({ qty_on_hand: (existing.qty_on_hand || 0) + qty })
                .eq('warehouse_id', wid).eq('merchant_id', merchantId).eq('sku', it.sku);
            } else {
              await supabase.from('tlv_merchant_inventory')
                .insert({
                  warehouse_id: wid, merchant_id: merchantId,
                  sku: it.sku, product_name: it.product_name, location: it.location,
                  qty_on_hand: qty, qty_reserved: 0,
                });
            }
          }
        }
      }
      const { error } = await supabase.from('tlv_inbound_orders').update(patch).eq('id', id);
      if (error) throw error;
      setToast(`已更新为"${(STATUS_META as any)[step.next]?.label || step.next}"`);
      setTimeout(() => setToast(''), 2500);
      await load(wid);
    } catch (e: any) {
      setToast(`操作失败: ${e.message}`);
      setTimeout(() => setToast(''), 3000);
    } finally {
      setBusy(null);
    }
  }

  if (!warehouseId) return <div className="p-12 text-center text-slate-500">未登录</div>;
  if (loading) return <div className="p-12 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" />加载中...</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-800">商家入库待处理</h2>
        <p className="text-sm text-slate-500 mt-0.5">待收货 / 检验中入库单</p>
      </div>

      {toast && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-2 rounded-lg">{toast}</div>}

      {rows.length === 0 && <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-12 text-center text-slate-400 text-sm">暂无待处理入库单</div>}

      <div className="space-y-3">
        {rows.map((r: any) => {
          const meta = STATUS_META[r.status] || STATUS_META.pending;
          const next = NEXT_STATUS[r.status];
          return (
            <div key={r.id} className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 flex flex-col md:flex-row md:items-center gap-4">
              <div className="w-11 h-11 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0"><Inbox className="w-5 h-5" /></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold text-slate-800">{r.inbound_no}</span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${meta.cls}`}>{meta.label}</span>
                </div>
                <div className="text-sm text-slate-500 mt-1">{r.merchant_name} · {r.sku_count} SKU · {r.total_qty} 件 · 预计 {r.eta || '未设定'}</div>
              </div>
              {next && (
                <button
                  disabled={busy === r.id}
                  onClick={() => advance(r.id, r.status, warehouseId)}
                  className="px-3 py-2 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg flex items-center gap-1"
                >
                  {busy === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : r.status === 'inspecting' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <ArrowRight className="w-3.5 h-3.5" />}
                  {next.label}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {err && <div className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">查询异常 · {err}</div>}
    </div>
  );
}
