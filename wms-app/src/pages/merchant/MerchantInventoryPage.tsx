import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Search, Loader2 } from 'lucide-react';

const MERCHANT_ID = '00000000-0000-0000-0000-000000000101';

export function MerchantInventoryPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    supabase
      .from('tlv_merchant_inventory')
      .select('sku, location, qty_on_hand, qty_reserved, qty_in_transit, merchant_products (name)')
      .eq('merchant_id', MERCHANT_ID)
      .then(({ data, error }) => {
        if (!error) setRows(data || []);
        setLoading(false);
      });
  }, []);

  const filtered = rows.filter((r) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (r.sku || '').toLowerCase().includes(s) ||
      ((r.merchant_products as any)?.name || '').toLowerCase().includes(s)
    );
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
        {loading ? (
          <div className="p-12 flex items-center justify-center text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载中...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">暂无库存数据</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-5 py-3 font-medium">SKU</th>
                <th className="text-left px-5 py-3 font-medium">商品名</th>
                <th className="text-left px-5 py-3 font-medium">库位</th>
                <th className="text-right px-5 py-3 font-medium">在库</th>
                <th className="text-right px-5 py-3 font-medium">已占用</th>
                <th className="text-right px-5 py-3 font-medium">在途</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map((r: any) => {
                const name = (r.merchant_products as any)?.name || r.name || '-';
                return (
                  <tr key={r.sku + r.location} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-mono font-semibold text-blue-700">{r.sku}</td>
                    <td className="px-5 py-3 text-slate-800">{name}</td>
                    <td className="px-5 py-3 text-slate-600 font-mono text-xs">{r.location || '-'}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-medium text-green-600">{r.qty_on_hand ?? 0}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-amber-600">{r.qty_reserved ?? 0}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-blue-600">{r.qty_in_transit ?? 0}</td>
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
