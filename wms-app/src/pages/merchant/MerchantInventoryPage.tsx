import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { Search, Warehouse, Loader2 } from 'lucide-react';

const FALLBACK = [
  { sku: 'CH-001', name: 'USB-C 充电线 1m', location: 'A-01-01', qty_available: 120, qty_reserved: 10, qty_intransit: 30 },
  { sku: 'CH-002', name: 'USB-C 充电线 2m', location: 'A-01-02', qty_available: 85, qty_reserved: 5, qty_intransit: 20 },
  { sku: 'CH-003', name: 'USB-C 快充头 65W', location: 'A-02-01', qty_available: 42, qty_reserved: 8, qty_intransit: 15 },
  { sku: 'EL-001', name: '蓝牙降噪耳机', location: 'B-01-03', qty_available: 18, qty_reserved: 3, qty_intransit: 50 },
  { sku: 'EL-002', name: '便携式充电宝 20000mAh', location: 'B-02-01', qty_available: 66, qty_reserved: 0, qty_intransit: 12 },
];

const WAREHOUSES = [
  { id: 'wh-cn-01', name: '深圳总仓' },
  { id: 'wh-cn-02', name: '义乌分仓' },
  { id: 'wh-eu-01', name: '波兰海外仓' },
  { id: 'wh-us-01', name: '美国洛杉矶仓' },
];

async function fetchInventory() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('未登录');
  const { data, error } = await supabase
    .from('tlv_inventory')
    .select('*')
    .eq('merchant_id', user.id)
    .order('sku', { ascending: true });
  if (error) throw error;
  return data?.length ? data : FALLBACK;
}

export function MerchantInventoryPage() {
  const [search, setSearch] = useState('');
  const [wh, setWh] = useState('all');

  const { data: rows, isLoading, isError } = useQuery({
    queryKey: ['merchant-inventory'], queryFn: fetchInventory,
  });

  const list: any[] = (rows as any[]) || FALLBACK;
  const filtered = list.filter((r: any) =>
    !search ||
    (r.sku || '').toLowerCase().includes(search.toLowerCase()) ||
    (r.name || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Top tool bar */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索 SKU 或商品名称..."
            className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <Warehouse className="w-4 h-4 text-slate-400" />
          <select
            value={wh} onChange={(e) => setWh(e.target.value)}
            className="px-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white"
          >
            <option value="all">全部仓库</option>
            {WAREHOUSES.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {isLoading && !rows ? (
          <div className="p-12 flex items-center justify-center text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载中...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">未找到匹配的 SKU</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-5 py-3 font-medium">SKU</th>
                <th className="text-left px-5 py-3 font-medium">商品名称</th>
                <th className="text-left px-5 py-3 font-medium">库位</th>
                <th className="text-right px-5 py-3 font-medium">可用库存</th>
                <th className="text-right px-5 py-3 font-medium">已预留</th>
                <th className="text-right px-5 py-3 font-medium">在途</th>
                <th className="text-right px-5 py-3 font-medium">合计</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map((r: any) => {
                const avail = r.qty_available ?? r.qty_on_hand ?? 0;
                const reserved = r.qty_reserved ?? 0;
                const transit = r.qty_intransit ?? r.qty_inbound ?? 0;
                return (
                  <tr key={r.sku} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-mono font-semibold text-blue-700">{r.sku}</td>
                    <td className="px-5 py-3 text-slate-800">{r.name || r.product_name || '-'}</td>
                    <td className="px-5 py-3 text-slate-600 font-mono text-xs">{r.location || '-'}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-medium text-green-600">{avail}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-amber-600">{reserved}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-blue-600">{transit}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-semibold text-slate-800">{avail + reserved + transit}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {isError && rows && (
          <div className="px-5 py-2 text-xs text-amber-600 bg-amber-50 border-t border-amber-100">
            查询失败，展示示例数据
          </div>
        )}
      </div>
    </div>
  );
}
