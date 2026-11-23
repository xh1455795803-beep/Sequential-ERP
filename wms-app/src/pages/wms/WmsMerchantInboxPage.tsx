import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Inbox, Package, Eye, CheckCircle2, ArrowRight, Loader2 } from 'lucide-react';

const WH_ID = '00000000-0000-0000-0000-000000000001';

const FALLBACK = [
  { id: 'ib-1', inbound_no: 'IB20261123001', merchant_name: '星辰电子', sku_count: 4, total_qty: 120, eta: '今日 14:00', status: 'pending' },
  { id: 'ib-2', inbound_no: 'IB20261123005', merchant_name: '极光家居', sku_count: 2, total_qty: 35, eta: '今日 16:30', status: 'received' },
  { id: 'ib-3', inbound_no: 'IB20261123008', merchant_name: 'FunToy', sku_count: 6, total_qty: 280, eta: '明日 10:00', status: 'inspecting' },
];

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: '待收货', cls: 'bg-slate-100 text-slate-700' },
  received: { label: '已收货待检验', cls: 'bg-blue-50 text-blue-700' },
  inspecting: { label: '检验中', cls: 'bg-amber-50 text-amber-700' },
};

const NEXT_STATUS: Record<string, { label: string; next: string; action: 'mark_received' | 'start_inspect' | 'complete_stock' }> = {
  pending: { label: '确认收货', next: 'received', action: 'mark_received' },
  received: { label: '开始检验', next: 'inspecting', action: 'start_inspect' },
  inspecting: { label: '完成上架', next: 'stocked', action: 'complete_stock' },
};

export function WmsMerchantInboxPage() {
  const [rows, setRows] = useState<any[]>(FALLBACK);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const { data, error } = await supabase
        .from('tlv_inbound_orders')
        .select('id, inbound_no, merchant_name, sku_count, total_qty, eta, status')
        .eq('warehouse_id', WH_ID)
        .in('status', ['pending', 'received', 'inspecting'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      if (data && data.length) setRows(data);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function advance(id: string, current: string) {
    const step = NEXT_STATUS[current];
    if (!step) return;
    setBusy(id);
    try {
      const now = new Date().toISOString();
      const patch: any = { status: step.next };
      if (step.action === 'mark_received') patch.received_at = now;
      if (step.action === 'start_inspect') patch.inspecting_at = now;
      if (step.action === 'complete_stock') patch.stocked_at = now;
      const { error } = await supabase.from('tlv_inbound_orders').update(patch).eq('id', id);
      if (error) throw error;
      setToast(`已更新为"${STATUS_META[step.next]?.label || step.next}"`);
      setTimeout(() => setToast(''), 2500);
      await load();
    } catch (e: any) {
      setToast(`操作失败: ${e.message}`);
      setTimeout(() => setToast(''), 3000);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">商家入库待处理</h2>
          <p className="text-sm text-slate-500 mt-0.5">待收货 / 检验中入库单</p>
        </div>
      </div>

      {toast && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-2 rounded-lg">
          {toast}
        </div>
      )}

      {loading && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-12 flex items-center justify-center text-slate-400 text-sm">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载中...
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-12 text-center text-slate-400 text-sm">
          暂无待处理入库单
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((r: any) => {
            const meta = STATUS_META[r.status] || STATUS_META.pending;
            const next = NEXT_STATUS[r.status];
            return (
              <div key={r.id} className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 flex flex-col md:flex-row md:items-center gap-4">
                <div className="w-11 h-11 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                  <Inbox className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-slate-800">{r.inbound_no}</span>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${meta.cls}`}>{meta.label}</span>
                  </div>
                  <div className="text-sm text-slate-500 mt-1">
                    {r.merchant_name} · {r.sku_count} SKU · {r.total_qty} 件 · 预计 {r.eta || '未设定'}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button className="px-3 py-2 text-xs border border-slate-200 hover:bg-slate-50 rounded-lg text-slate-600 flex items-center gap-1">
                    <Eye className="w-3.5 h-3.5" /> 详情
                  </button>
                  {next && (
                    <button
                      disabled={busy === r.id}
                      onClick={() => advance(r.id, r.status)}
                      className="px-3 py-2 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg flex items-center gap-1"
                    >
                      {busy === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
                       r.status === 'inspecting' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <ArrowRight className="w-3.5 h-3.5" />}
                      {next.label}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {err && (
        <div className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          查询异常 · {err}
        </div>
      )}
    </div>
  );
}
