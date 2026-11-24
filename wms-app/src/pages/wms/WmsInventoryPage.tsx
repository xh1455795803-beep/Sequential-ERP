import { useEffect, useState } from 'react';
import { supabase, getAuthContext } from '../../lib/supabase';
import { Search, Package, AlertCircle, Loader2 } from 'lucide-react';

export function WmsInventoryPage() {
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

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
        .from('tlv_merchant_inventory')
        .select(`
          sku, product_name, location, qty_on_hand, qty_reserved, merchant_id,
          tlv_merchants(business_name)
        `)
        .eq('warehouse_id', wid)
        .order('sku', { ascending: true });
      if (error) throw error;
      setRows((data || []).map((r: any) => ({
        sku: r.sku,
        product_name: r.product_name,
        location: r.location,
        qty_on_hand: r.qty_on_hand ?? 0,
        qty_reserved: r.qty_reserved ?? 0,
        merchant: (r.tlv_merchants as any)?.business_name || '未知商家',
      })));
    } catch (e: any) {
      setErr(e.message);
    }
  }

  const filtered = rows.filter((r) =>
    !search ||
    (r.sku || '').toLowerCase().includes(search.toLowerCase()) ||
    (r.product_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (r.merchant || '').toLowerCase().includes(search.toLowerCase())
  );

  if (!warehouseId) return <div className="p-12 text-center text-slate-500">未登录</div>;
  if (loading) return <div className="p-12 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" />加载中...</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-800">库存管理</h2>
        <p className="text-sm text-slate-500 mt-0.5">当前仓库所有商家库存</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索 SKU / 商品名 / 商家..."
            className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm" />
        </div>
        <div className="text-xs text-slate-500 ml-auto">
          共 <b className="text-emerald-700">{filtered.length}</b> 条 SKU
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {filtered.length === 0 && <div className="p-12 text-center text-slate-400 text-sm">未找到匹配的库存</div>}
        {filtered.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-5 py-3 font-medium">商家</th>
                <th className="text-left px-5 py-3 font-medium">SKU</th>
                <th className="text-left px-5 py-3 font-medium">商品名称</th>
                <th className="text-left px-5 py-3 font-medium">库位</th>
                <th className="text-right px-5 py-3 font-medium">可用数量</th>
                <th className="text-right px-5 py-3 font-medium">已预留</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map((r: any, idx: number) => {
                const avail = (r.qty_on_hand ?? 0) - (r.qty_reserved ?? 0);
                const low = avail > 0 && avail < 10;
                const out = avail === 0;
                return (
                  <tr key={idx} className="hover:bg-slate-50">
                    <td className="px-5 py-3 text-slate-800">{r.merchant}</td>
                    <td className="px-5 py-3 font-mono font-semibold text-emerald-700">{r.sku}</td>
                    <td className="px-5 py-3 text-slate-700">{r.product_name || '-'}</td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-500">{r.location || '-'}</td>
                    <td className={`px-5 py-3 text-right tabular-nums font-medium ${out ? 'text-red-600' : low ? 'text-amber-600' : 'text-green-600'}`}>
                      {avail}{out && <AlertCircle className="w-3 h-3 inline ml-1" />}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-amber-600">{r.qty_reserved ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {err && <div className="px-5 py-2 text-xs text-amber-600 bg-amber-50 border-t border-amber-100">查询异常 · {err}</div>}
      </div>
    </div>
  );
}
