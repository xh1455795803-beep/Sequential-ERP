import { useEffect, useState } from 'react';
import { supabase, getAuthContext } from '../../lib/supabase';
import { ClipboardList, Plus, Search, CheckCircle2, XCircle, Trash2 } from 'lucide-react';

type TakeType = 'dynamic' | 'static';

export function WmsStockTakePage() {
  const [loading, setLoading] = useState(true);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [takes, setTakes] = useState<any[]>([]);
  const [showNewModal, setShowNewModal] = useState(false);

  useEffect(() => {
    (async () => {
      const ctx = await getAuthContext();
      if (!ctx.warehouseId) { setLoading(false); return; }
      setWarehouseId(ctx.warehouseId);
      await loadTakes(ctx.warehouseId);
    })();
  }, []);

  async function loadTakes(wid: string) {
    const { data } = await supabase.from('tlv_stock_takes')
      .select('*').eq('warehouse_id', wid).order('started_at', { ascending: false });
    setTakes(data || []);
    setLoading(false);
  }

  async function createTake(type: TakeType, note: string) {
    if (!warehouseId) return;
    const ctx = await getAuthContext();

    // 拉当前 inventory 快照
    const { data: inv } = await supabase.from('tlv_merchant_inventory')
      .select('*, tlv_merchant_products(id as product_id)')
      .eq('warehouse_id', warehouseId).gt('qty_on_hand', 0);

    const { data: take, error } = await supabase.from('tlv_stock_takes').insert({
      warehouse_id: warehouseId,
      type,
      status: 'in_progress',
      operator_id: ctx.userId,
      operator_name: ctx.user?.email?.split('@')[0] || 'unknown',
      note: note || null,
      total_rows: inv?.length || 0,
    }).select().single();
    if (error) { alert(error.message); return; }

    // 自动生成盘点项（system_qty 从 inventory 快照拿）
    const items = (inv || []).map((r: any, idx) => ({
      stock_take_id: take.id,
      merchant_id: r.merchant_id,
      product_id: r.product_id || r.tlv_merchant_products?.id,
      sku: r.sku,
      location: r.location,
      system_qty: r.qty_on_hand,
      counted_qty: 0,
      row_no: idx + 1,
    }));
    if (items.length > 0) {
      await supabase.from('tlv_stock_take_items').insert(items);
    }
    setShowNewModal(false);
    await loadTakes(warehouseId);
  }

  if (loading) return <div className="p-12 text-center text-slate-400">加载中...</div>;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 flex items-center gap-3 justify-between">
        <div>
          <h3 className="font-semibold text-slate-700 flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-blue-600" /> 库存盘点
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">支持动态盘点（边盘边继续出入库）和静态盘点（冻结）</p>
        </div>
        <button onClick={() => setShowNewModal(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium">
          <Plus className="w-4 h-4" /> 新建盘点
        </button>
      </div>

      {takes.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-100 p-12 text-center text-slate-400 text-sm">
          暂无盘点记录，点击「新建盘点」开始
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {takes.map((t) => (
            <div key={t.id} className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-medium text-slate-800">
                    {t.type === 'dynamic' ? '动态盘点' : '静态盘点'}
                    <span className={`ml-2 px-2 py-0.5 rounded text-xs ${
                      t.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                      t.status === 'completed' ? 'bg-green-100 text-green-700' :
                      'bg-slate-100 text-slate-600'
                    }`}>{t.status}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {t.started_at?.slice(0, 16).replace('T', ' ')} · 操作人: {t.operator_name}
                  </div>
                </div>
                <button onClick={() => window.location.hash = `#take-${t.id}`}
                  className="text-xs text-blue-600 hover:text-blue-700">查看</button>
              </div>
              <div className="mt-3 flex gap-4 text-xs text-slate-600">
                <span>总 SKU: <b>{t.total_rows}</b></span>
                <span>差异 SKU: <b className={t.diff_rows > 0 ? 'text-red-600' : 'text-green-600'}>{t.diff_rows || 0}</b></span>
                <span>已调整: <b>{t.adjusted_qty || 0}</b></span>
              </div>
              {t.note && <div className="mt-2 text-xs text-slate-400 italic">"{t.note}"</div>}
            </div>
          ))}
        </div>
      )}

      {showNewModal && <NewTakeModal onClose={() => setShowNewModal(false)} onCreate={createTake} />}
      {takes.filter(t => t.status === 'in_progress').map(t => <TakeDetail key={t.id} take={t} warehouseId={warehouseId!} onDone={() => loadTakes(warehouseId!)} />)}
    </div>
  );
}

function NewTakeModal({ onClose, onCreate }: { onClose: () => void; onCreate: (t: TakeType, note: string) => void }) {
  const [type, setType] = useState<TakeType>('dynamic');
  const [note, setNote] = useState('');
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl p-6 w-96" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-slate-800 mb-4">新建盘点</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-500">盘点类型</label>
            <div className="mt-1 flex gap-2">
              {(['dynamic', 'static'] as TakeType[]).map((t) => (
                <button key={t} onClick={() => setType(t)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm border ${type === t ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200'}`}>
                  {t === 'dynamic' ? '动态盘点' : '静态盘点'}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              动态: 盘点期间正常出入库（差异需人工核准）<br/>
              静态: 建议先暂停该仓库出入库操作
            </p>
          </div>
          <div>
            <label className="text-xs text-slate-500">备注</label>
            <input value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="例: Q4 年度盘点"
              className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm">取消</button>
          <button onClick={() => onCreate(type, note)} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">创建</button>
        </div>
      </div>
    </div>
  );
}

function TakeDetail({ take, warehouseId, onDone }: { take: any; warehouseId: string; onDone: () => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [adjusting, setAdjusting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('tlv_stock_take_items')
        .select('*').eq('stock_take_id', take.id).order('row_no');
      setItems(data || []);
    })();
  }, [take.id]);

  async function complete() {
    setAdjusting(true);
    const ctx = await getAuthContext();
    // 1. 把 counted_qty 写回 inventory（adjusted=true 的行）
    for (const it of items) {
      if (!it.adjusted && it.diff_qty !== 0) {
        await supabase.from('tlv_merchant_inventory')
          .update({ qty_on_hand: it.counted_qty })
          .eq('warehouse_id', warehouseId).eq('merchant_id', it.merchant_id).eq('sku', it.sku).eq('location', it.location);
        await supabase.from('tlv_inventory_logs').insert({
          warehouse_id: warehouseId, merchant_id: it.merchant_id,
          sku: it.sku, location: it.location,
          change_type: 'stock_take_adjust',
          qty_change: it.counted_qty - it.system_qty,
          qty_before: it.system_qty, qty_after: it.counted_qty,
          ref_id: take.id, ref_no: 'STOCK-TAKE',
          operator_note: `operator: ${ctx.user?.email}`,
        });
      }
    }
    const matched = items.filter(i => i.diff_qty === 0).length;
    const diff = items.length - matched;
    const adj = items.reduce((s, i) => s + Math.abs(i.diff_qty), 0);
    await supabase.from('tlv_stock_takes').update({
      status: 'completed', matched_rows: matched, diff_rows: diff, adjusted_qty: adj, completed_at: new Date().toISOString(),
    }).eq('id', take.id);
    setAdjusting(false);
    onDone();
  }

  async function saveItem(id: string, qty: number) {
    const newItems = items.map(i => i.id === id ? { ...i, counted_qty: qty, adjusted: true } : i);
    setItems(newItems);
    await supabase.from('tlv_stock_take_items').update({ counted_qty: qty, adjusted: true }).eq('id', id);
  }

  const completed = items.filter((i) => i.counted_qty > 0).length;

  return (
    <div id={`take-${take.id}`} className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <div className="font-semibold text-slate-700">
          盘点进行中 — {take.type === 'dynamic' ? '动态' : '静态'}
          <span className="ml-3 text-xs text-slate-500">{completed}/{items.length} 已盘点</span>
        </div>
        <button onClick={complete} disabled={adjusting}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium">
          {adjusting ? '调整中...' : '完成盘点'}
        </button>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-500 text-xs">
          <tr>
            <th className="text-left px-5 py-3 font-medium">#</th>
            <th className="text-left px-5 py-3 font-medium">SKU</th>
            <th className="text-left px-5 py-3 font-medium">库位</th>
            <th className="text-right px-5 py-3 font-medium">系统数</th>
            <th className="text-center px-5 py-3 font-medium">实盘数</th>
            <th className="text-right px-5 py-3 font-medium">差异</th>
            <th className="text-center px-5 py-3 font-medium">状态</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {items.map((it, idx) => (
            <tr key={it.id} className={it.diff_qty !== 0 ? 'bg-amber-50/50' : 'hover:bg-slate-50'}>
              <td className="px-5 py-3 text-slate-400 text-xs">{idx + 1}</td>
              <td className="px-5 py-3 font-mono font-semibold text-slate-800">{it.sku}</td>
              <td className="px-5 py-3 font-mono text-xs text-slate-500">{it.location}</td>
              <td className="px-5 py-3 text-right tabular-nums">{it.system_qty}</td>
              <td className="px-5 py-3 text-center">
                <input type="number" min={0} value={it.counted_qty}
                  onChange={(e) => saveItem(it.id, Number(e.target.value))}
                  className="w-20 px-2 py-1 border border-slate-300 rounded text-center tabular-nums focus:ring-2 focus:ring-blue-500" />
              </td>
              <td className={`px-5 py-3 text-right tabular-nums font-medium ${it.diff_qty > 0 ? 'text-green-600' : it.diff_qty < 0 ? 'text-red-600' : 'text-slate-400'}`}>
                {it.diff_qty === 0 ? '—' : (it.diff_qty > 0 ? '+' : '') + it.diff_qty}
              </td>
              <td className="px-5 py-3 text-center">
                {it.diff_qty === 0 ? <CheckCircle2 className="w-4 h-4 text-green-500 inline" /> : <XCircle className="w-4 h-4 text-amber-500 inline" />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
