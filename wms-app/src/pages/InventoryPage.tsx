import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Boxes, AlertCircle } from 'lucide-react';
import { useState } from 'react';

export function InventoryPage() {
  const [filter, setFilter] = useState('');

  const { data: warehouses } = useQuery({
    queryKey: ['wms_warehouses'],
    queryFn: async () => { const { data } = await supabase.from('wms_warehouses').select('id, name'); return data || []; },
  });

  // 库位映射
  const { data: bins } = useQuery({
    queryKey: ['wms_bins_map'],
    queryFn: async () => { const { data } = await supabase.from('wms_bins').select('id, bin_code'); return data || []; },
  });

  // 商品映射
  const { data: products } = useQuery({
    queryKey: ['wms_products_map'],
    queryFn: async () => { const { data } = await supabase.from('wms_products').select('id, sku_code, name'); return data || []; },
  });

  // 库存
  const { data: inv, isLoading } = useQuery({
    queryKey: ['wms_inventory_all'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_inventory').select('*').order('product_id');
      return data || [];
    },
  });

  const rows = (inv as any[]) || [];
  const kw = filter.trim().toLowerCase();

  const productMap = Object.fromEntries((products || []).map((p: any) => [p.id, p]));
  const binMap = Object.fromEntries((bins || []).map((b: any) => [b.id, b.bin_code]));
  const whMap = Object.fromEntries((warehouses || []).map((w: any) => [w.id, w.name]));

  const enriched = rows.map((r: any) => ({
    ...r,
    sku_code: productMap[r.product_id]?.sku_code || `P${r.product_id}`,
    product_name: productMap[r.product_id]?.name || '',
    bin_code: binMap[r.bin_id] || `B${r.bin_id}`,
    wh_name: whMap[r.warehouse_id] || '',
  }));

  const filtered = enriched.filter((r) => {
    if (!kw) return true;
    return r.sku_code.toLowerCase().includes(kw)
      || r.bin_code.toLowerCase().includes(kw)
      || r.product_name.toLowerCase().includes(kw);
  });

  const lowStock = rows.filter((r) => (r.qty_onhand ?? 0) <= 2 && (r.qty_onhand ?? 0) > 0).length;
  const totalQty = rows.reduce((s, r) => s + (r.qty_onhand || 0), 0);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">实时库存</h2>
          <p className="text-sm text-muted-foreground mt-1">按库位粒度的 WMS 库存快照</p>
        </div>
        <input
          value={filter} onChange={(e) => setFilter(e.target.value)}
          placeholder="搜索 SKU / 库位 / 商品名..."
          className="px-4 py-2 border border-border rounded-lg text-sm w-80 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <StatCard icon={Boxes} color="bg-brand-500"  label="SKU × 库位" value={rows.length} />
        <StatCard icon={Boxes} color="bg-sea-500"    label="在库总数"   value={totalQty} />
        <StatCard icon={AlertCircle} color="bg-danger-bg0" label="低库存预警" value={lowStock} />
      </div>

      <div className="bg-card rounded-xl shadow-soft border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground text-xs">
            <tr>
              <th className="text-left px-5 py-2.5">仓库</th>
              <th className="text-left px-5 py-2.5">SKU</th>
              <th className="text-left px-5 py-2.5">商品名</th>
              <th className="text-left px-5 py-2.5">库位</th>
              <th className="text-right px-5 py-2.5">在库</th>
              <th className="text-right px-5 py-2.5">锁定</th>
              <th className="text-right px-5 py-2.5">可用</th>
              <th className="text-left px-5 py-2.5">最后变动</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r: any) => {
              const available = (r.qty_onhand || 0) - (r.qty_locked || 0);
              return (
                <tr key={r.id} className={`border-t border-transparent hover:bg-muted/50 ${r.qty_onhand <= 2 && r.qty_onhand > 0 ? 'bg-danger-bg/30' : ''}`}>
                  <td className="px-5 py-2.5">{r.wh_name || '-'}</td>
                  <td className="px-5 py-2.5 font-mono text-brand-600">{r.sku_code}</td>
                  <td className="px-5 py-2.5 text-muted-foreground">{r.product_name}</td>
                  <td className="px-5 py-2.5 font-mono text-xs">{r.bin_code}</td>
                  <td className={`px-5 py-2.5 text-right font-medium ${r.qty_onhand <= 2 ? 'text-destructive' : ''}`}>{r.qty_onhand}</td>
                  <td className="px-5 py-2.5 text-right text-muted-foreground">{r.qty_locked || 0}</td>
                  <td className="px-5 py-2.5 text-right text-success">{available}</td>
                  <td className="px-5 py-2.5 text-muted-foreground text-xs">
                    {r.last_move_at ? new Date(r.last_move_at).toLocaleString('zh-CN') : '-'}
                  </td>
                </tr>
              );
            })}
            {!isLoading && !filtered?.length && (
              <tr><td colSpan={8} className="p-10 text-center text-muted-foreground">{filter ? '未匹配到库存' : '暂无库存，请先入库上架'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, color, label, value }: any) {
  return (
    <div className="bg-card rounded-xl p-4 shadow-soft border border-border flex items-center gap-4">
      <div className={`w-10 h-10 rounded-lg ${color} text-white flex items-center justify-center`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}
