import { useEffect, useState } from 'react';
import { supabase, getAuthContext } from '../../lib/supabase';
import { CalendarDays, Package, TrendingDown, TrendingUp, AlertTriangle, Clock } from 'lucide-react';

const AGE_BUCKETS = [
  { key: '0-7',   label: '0-7天',   days: 7,   color: 'bg-green-100 text-green-700' },
  { key: '8-30',  label: '8-30天',  days: 30,  color: 'bg-emerald-100 text-emerald-700' },
  { key: '31-90', label: '31-90天', days: 90,  color: 'bg-amber-100 text-amber-700' },
  { key: '91-180',label: '91-180天',days: 180, color: 'bg-orange-100 text-orange-700' },
  { key: '181+',  label: '181天+',  days: Infinity, color: 'bg-red-100 text-red-700' },
];

function bucketFor(firstInAt: string | null) {
  if (!firstInAt) return AGE_BUCKETS[0];
  const days = Math.floor((Date.now() - new Date(firstInAt).getTime()) / 86400000);
  for (const b of AGE_BUCKETS) if (days <= b.days) return b;
  return AGE_BUCKETS[AGE_BUCKETS.length - 1];
}

export function WmsInventoryAgePage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const ctx = await getAuthContext();
      if (!ctx.warehouseId) { setLoading(false); return; }
      setWarehouseId(ctx.warehouseId);
      const { data } = await supabase
        .from('tlv_merchant_inventory')
        .select('sku, product_name, location, qty_on_hand, qty_reserved, first_in_at, merchant_id, tlv_merchants!merchant_id(business_name)')
        .eq('warehouse_id', ctx.warehouseId)
        .gt('qty_on_hand', 0);
      setRows(data || []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="p-12 text-center text-slate-400">加载中...</div>;
  if (!warehouseId) return <div>未绑定仓库</div>;

  const totalQty = rows.reduce((s, r) => s + Number(r.qty_on_hand || 0), 0);
  const bucketStats = AGE_BUCKETS.map((b) => {
    const inBucket = rows.filter((r) => bucketFor(r.first_in_at).key === b.key);
    const qty = inBucket.reduce((s, r) => s + Number(r.qty_on_hand || 0), 0);
    return { ...b, rows: inBucket, qty, pct: totalQty > 0 ? (qty / totalQty * 100).toFixed(1) : '0.0' };
  });
  const slowMoving = rows.filter((r) => bucketFor(r.first_in_at).key === '181+' || bucketFor(r.first_in_at).key === '91-180');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {bucketStats.map((b) => (
          <div key={b.key} className={`rounded-xl p-4 shadow-sm border border-slate-100 ${b.color}`}>
            <div className="flex items-center gap-2 text-xs opacity-70">
              <CalendarDays className="w-3 h-3" /> {b.label}
            </div>
            <div className="text-2xl font-bold mt-1 tabular-nums">{b.qty}</div>
            <div className="text-[10px] opacity-60 mt-1">占比 {b.pct}% · {b.rows.length} SKU</div>
          </div>
        ))}
      </div>

      {slowMoving.length > 0 && (
        <div className="bg-gradient-to-r from-red-50 to-amber-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-center gap-2 text-red-700 font-medium text-sm">
            <AlertTriangle className="w-4 h-4" />
            慢动销/滞销预警 — 共 {slowMoving.length} 个 SKU，{slowMoving.reduce((s, r) => s + Number(r.qty_on_hand || 0), 0)} 件
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
          <Clock className="w-4 h-4 text-slate-500" />
          <h3 className="font-semibold text-slate-700">SKU 库龄明细</h3>
          <span className="text-xs text-slate-400 ml-auto">共 {rows.length} 条有库存记录</span>
        </div>
        {rows.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">暂无库存数据</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-5 py-3 font-medium">SKU</th>
                <th className="text-left px-5 py-3 font-medium">商品名</th>
                <th className="text-left px-5 py-3 font-medium">商家</th>
                <th className="text-left px-5 py-3 font-medium">库位</th>
                <th className="text-right px-5 py-3 font-medium">在库</th>
                <th className="text-left px-5 py-3 font-medium">首次入库</th>
                <th className="text-left px-5 py-3 font-medium">库龄</th>
                <th className="text-left px-5 py-3 font-medium">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows
                .map((r) => ({ ...r, _bucket: bucketFor(r.first_in_at) }))
                .sort((a, b) => {
                  const da = a.first_in_at ? new Date(a.first_in_at).getTime() : 0;
                  const db2 = b.first_in_at ? new Date(b.first_in_at).getTime() : 0;
                  return da - db2; // 最老的排前面
                })
                .map((r: any, idx) => {
                  const days = r.first_in_at ? Math.floor((Date.now() - new Date(r.first_in_at).getTime()) / 86400000) : 0;
                  return (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-mono font-semibold text-blue-700">{r.sku}</td>
                      <td className="px-5 py-3 text-slate-800">{r.product_name || '-'}</td>
                      <td className="px-5 py-3 text-slate-600 text-xs">{(r.tlv_merchants as any)?.business_name || '-'}</td>
                      <td className="px-5 py-3 text-slate-600 font-mono text-xs">{r.location}</td>
                      <td className="px-5 py-3 text-right tabular-nums font-medium text-green-600">{r.qty_on_hand}</td>
                      <td className="px-5 py-3 text-slate-500 text-xs">{r.first_in_at?.slice(0, 10) || '-'}</td>
                      <td className="px-5 py-3 tabular-nums text-slate-700">{days}天</td>
                      <td className="px-5 py-3"><span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${r._bucket.color}`}>{r._bucket.label}</span></td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
