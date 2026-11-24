import { useEffect, useState } from 'react';
import { supabase, getAuthContext } from '../../lib/supabase';
import { Search } from 'lucide-react';

export function MerchantInventoryPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const { merchantId } = await getAuthContext();
      if (!merchantId) { setLoading(false); return; }
      const { data, error } = await supabase
        .from('tlv_merchant_inventory')
        .select('sku, product_name, location, qty_on_hand, qty_reserved, inbound_qty')
        .eq('merchant_id', merchantId)
        .order('sku', { ascending: true });
      if (error) console.error(error);
      setRows(data || []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="p-12 text-center text-slate-400">加载中...</div>;

  return <InventoryUI rows={rows} />;
}

function InventoryUI({ rows }: { rows: any[] }) {
  const [search, setSearch] = useState('');
  const filtered = rows.filter((r) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (r.sku || '').toLowerCase().includes(s) || (r.product_name || '').toLowerCase().includes(s);
  });
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索 SKU 或商品名..."
            className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>
        <span className="text-sm text-slate-500">共 {filtered.length} 条</span>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">暂无库存数据</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-5 py-3 font-medium">SKU</th>
                <th className="text-left px-5 py-3 font-medium">商品名</th>
                <th className="text-left px-5 py-3 font-medium">库位</th>
                <th className="text-right px-5 py-3 font-medium">在库</th>
                <th className="text-right px-5 py-3 font-medium">已预留</th>
                <th className="text-right px-5 py-3 font-medium">在途</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map((r: any, idx: number) => (
                <tr key={idx} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-mono font-semibold text-blue-700">{r.sku}</td>
                  <td className="px-5 py-3 text-slate-800">{r.product_name || '-'}</td>
                  <td className="px-5 py-3 text-slate-600 font-mono text-xs">{r.location || '-'}</td>
                  <td className="px-5 py-3 text-right tabular-nums font-medium text-green-600">{r.qty_on_hand ?? 0}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-amber-600">{r.qty_reserved ?? 0}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-blue-600">{r.inbound_qty ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
