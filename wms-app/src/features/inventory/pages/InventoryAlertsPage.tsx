import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

export function InventoryAlertsPage({ mode }: { mode?: 'all' | 'low' | 'out' }) {
  const { data: rows, isLoading } = useQuery({
    queryKey: ['wms_inventory_alert', mode],
    queryFn: async () => {
      let q = supabase.from('wms_inventory')
        .select('*, product:product_id(id, sku_code, name, safety_stock), warehouse:warehouse_id(id, name)')
        .gt('qty_on_hand', -1);
      const { data, error } = await q.order('qty_on_hand');
      if (error) throw error;
      const list = (data || []).filter((r: any) => {
        const safety = r.product?.safety_stock ?? 0;
        if (mode === 'out') return r.qty_on_hand <= 0;
        if (mode === 'low') return r.qty_on_hand > 0 && r.qty_on_hand <= safety;
        return r.qty_on_hand <= safety;
      });
      return list;
    },
  });

  const title = mode === 'out' ? '缺货清单' : mode === 'low' ? '低库存清单' : '库存告警';
  const desc = mode === 'out'
    ? '库存为 0 的 SKU，必须立即补货'
    : mode === 'low'
    ? '库存低于安全线的 SKU，建议尽快补货'
    : '低于安全库存 / 缺货的 SKU 汇总';

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold">{title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{desc}</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5">SKU</th>
              <th className="text-left px-4 py-2.5">商品名</th>
              <th className="text-left px-4 py-2.5">仓库</th>
              <th className="text-right px-4 py-2.5">在库</th>
              <th className="text-right px-4 py-2.5">安全线</th>
              <th className="text-right px-4 py-2.5">缺口</th>
              <th className="text-left px-4 py-2.5">状态</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="p-8 text-center text-slate-400">加载中...</td></tr>}
            {!isLoading && rows?.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-emerald-500">✅ 无告警</td></tr>}
            {rows?.map((r: any) => {
              const safety = r.product?.safety_stock ?? 0;
              const gap = safety - r.qty_on_hand;
              const isOut = r.qty_on_hand <= 0;
              return (
                <tr key={r.id} className="border-t hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-mono text-xs">{r.product?.sku_code || r.product_id}</td>
                  <td className="px-4 py-2.5 text-slate-600 truncate max-w-[200px]">{r.product?.name || '-'}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{r.warehouse?.name || '-'}</td>
                  <td className={`px-4 py-2.5 text-right font-mono font-medium ${isOut ? 'text-red-600' : 'text-amber-600'}`}>
                    {r.qty_on_hand}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-500">{safety}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-red-500">{gap > 0 ? gap : '-'}</td>
                  <td className="px-4 py-2.5">
                    {isOut
                      ? <span className="inline-flex px-2 py-0.5 rounded text-xs bg-red-50 text-red-600 border border-red-200">缺货</span>
                      : <span className="inline-flex px-2 py-0.5 rounded text-xs bg-amber-50 text-amber-600 border border-amber-200">低库存</span>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
