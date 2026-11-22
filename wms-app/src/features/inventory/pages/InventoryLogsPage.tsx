import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

const TXN_TONE: Record<string, string> = {
  INBOUND: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  OUTBOUND: 'bg-red-50 text-red-700 border-red-200',
  LOCK: 'bg-blue-50 text-blue-700 border-blue-200',
  UNLOCK: 'bg-slate-50 text-slate-700 border-slate-200',
  ADJUST: 'bg-amber-50 text-amber-700 border-amber-200',
  TRANSFER: 'bg-purple-50 text-purple-700 border-purple-200',
  DEFECTIVE: 'bg-rose-50 text-rose-700 border-rose-200',
};
const TXN_LABEL: Record<string, string> = {
  INBOUND: '入库', OUTBOUND: '出库', LOCK: '锁定',
  UNLOCK: '解锁', ADJUST: '调整', TRANSFER: '调拨', DEFECTIVE: '次品',
};

export function InventoryLogsPage() {
  const { data: logs, isLoading } = useQuery({
    queryKey: ['wms_txn_all'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_inventory_txn')
        .select('*').order('created_at', { ascending: false }).limit(500);
      return data || [];
    },
  });

  const { data: products } = useQuery({
    queryKey: ['wms_products_map'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_products').select('id, sku_code, name');
      return Object.fromEntries((data || []).map((p: any) => [p.id, p]));
    },
  });

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold">库存流水</h2>
        <p className="text-sm text-muted-foreground mt-1">全部出入库/调整/调拨记录（最多显示 500 条）</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5">时间</th>
              <th className="text-left px-4 py-2.5">类型</th>
              <th className="text-left px-4 py-2.5">SKU</th>
              <th className="text-right px-4 py-2.5">变动</th>
              <th className="text-right px-4 py-2.5">结存</th>
              <th className="text-left px-4 py-2.5">关联单据</th>
              <th className="text-left px-4 py-2.5">备注</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="p-8 text-center text-slate-400">加载中...</td></tr>}
            {!isLoading && logs?.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-slate-400">暂无流水</td></tr>}
            {logs?.map((r: any) => {
              const p = products?.[r.product_id];
              return (
                <tr key={r.id} className="border-t hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-xs text-slate-500 font-mono">
                    {new Date(r.created_at).toLocaleString('zh-CN')}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs border ${TXN_TONE[r.txn_type] || 'bg-slate-50'}`}>
                      {TXN_LABEL[r.txn_type] || r.txn_type}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-mono text-xs text-slate-600">{p?.sku_code || r.product_id}</div>
                    {p?.name && <div className="text-xs text-slate-400 truncate max-w-[200px]">{p.name}</div>}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-mono font-medium ${(r.qty_delta || 0) > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {(r.qty_delta || 0) > 0 ? '+' : ''}{r.qty_delta ?? 0}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-600">{r.after_qty ?? '-'}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">
                    {r.ref_type || '-'}{r.ref_no ? ` · ${r.ref_no}` : ''}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-400 truncate max-w-[150px]">{r.remark || '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
