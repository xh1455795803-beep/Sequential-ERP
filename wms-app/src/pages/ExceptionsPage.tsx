import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { useState } from 'react';

// wms_exceptions: exception_no, exception_type, ref_type, ref_id, ref_no, description, status(smallint), resolution
const STATUS: Record<number, { label: string; cls: string }> = {
  1: { label: '待处理', cls: 'bg-red-50 text-red-600' },
  2: { label: '处理中', cls: 'bg-amber-50 text-amber-600' },
  3: { label: '已关闭', cls: 'bg-gray-100 text-gray-500' },
};

const TYPE_LABEL: Record<string, string> = {
  short_receive: '少收', more_receive: '多收',
  sku_unpaired: 'SKU 未配对', out_of_stock: '库存不足',
  bin_conflict: '库位冲突', label_fail: '面单生成失败',
  channel_fail: '渠道调用失败', cancel_request: '客户取消',
  other: '其他',
};

export function ExceptionsPage() {
  const qc = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<number | 0>(0);

  const { data } = useQuery({
    queryKey: ['wms_exceptions_all', filterStatus],
    queryFn: async () => {
      let q: any = supabase.from('wms_exceptions').select('*').order('created_at', { ascending: false });
      if (filterStatus > 0) q = q.eq('status', filterStatus);
      const { data } = await q;
      return data || [];
    },
  });
  const { data: warehouses } = useQuery({
    queryKey: ['wms_warehouses_map'],
    queryFn: async () => { const { data } = await supabase.from('wms_warehouses').select('id, warehouse_code'); return data || []; },
  });
  const whMap = Object.fromEntries((warehouses || []).map((w: any) => [w.id, w.warehouse_code]));

  async function resolve(e: any) {
    const resolution = prompt('处理方案（简述）：', e.resolution || '已手动处理');
    if (resolution === null) return;
    await supabase.from('wms_exceptions').update({
      status: 3, resolution, resolved_at: new Date().toISOString(),
    }).eq('id', e.id);
    qc.invalidateQueries();
  }

  async function reopen(e: any) {
    await supabase.from('wms_exceptions').update({ status: 1, resolution: null, resolved_at: null }).eq('id', e.id);
    qc.invalidateQueries();
  }

  async function deleteOne(id: number) {
    if (!confirm('删除此异常？')) return;
    await supabase.from('wms_exceptions').delete().eq('id', id);
    qc.invalidateQueries();
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">异常中心</h2>
          <p className="text-sm text-gray-500 mt-1">wms_exceptions · 订单/入库/面单 异常汇总</p>
        </div>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {[{ k: 0, l: '全部' }, ...Object.entries(STATUS).map(([k, v]) => ({ k: +k, l: v.label }))].map(({ k, l }) => (
          <button key={k || 'all'} onClick={() => setFilterStatus(k)}
            className={`px-3 py-1 rounded-full text-xs border ${filterStatus === k ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>{l}</button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-5 py-2.5">异常单号</th>
              <th className="text-left px-5 py-2.5">类型</th>
              <th className="text-left px-5 py-2.5">关联单</th>
              <th className="text-left px-5 py-2.5">仓库</th>
              <th className="text-left px-5 py-2.5">描述</th>
              <th className="text-left px-5 py-2.5">状态</th>
              <th className="text-left px-5 py-2.5">创建时间</th>
              <th className="text-right px-5 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((e: any) => {
              const st = STATUS[e.status] || { label: e.status, cls: 'bg-gray-100' };
              return (
                <tr key={e.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                  <td className="px-5 py-3 font-mono text-brand-600">{e.exception_no}</td>
                  <td className="px-5 py-3">
                    <span className="px-2 py-0.5 rounded text-xs bg-red-50 text-red-600">
                      {TYPE_LABEL[e.exception_type] || e.exception_type}
                    </span>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-gray-500">
                    {e.ref_type || ''} {e.ref_no || `-#${e.ref_id || ''}`}
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-500">{whMap[e.warehouse_id] || '-'}</td>
                  <td className="px-5 py-3 text-gray-600 max-w-xs truncate">{e.description || '-'}</td>
                  <td className="px-5 py-3"><span className={`px-2 py-0.5 rounded text-xs ${st.cls}`}>{st.label}</span></td>
                  <td className="px-5 py-3 text-xs text-gray-400">{new Date(e.created_at).toLocaleString('zh-CN')}</td>
                  <td className="px-5 py-3 text-right">
                    {e.status === 1 && (
                      <button onClick={() => resolve(e)} className="p-1.5 text-green-600 hover:bg-green-50 rounded" title="处理"><CheckCircle2 className="w-4 h-4" /></button>
                    )}
                    {e.status === 3 && (
                      <button onClick={() => reopen(e)} className="p-1.5 text-amber-500 hover:bg-amber-50 rounded" title="重开"><XCircle className="w-4 h-4" /></button>
                    )}
                    <button onClick={() => deleteOne(e.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded" title="删除"><AlertTriangle className="w-4 h-4" /></button>
                  </td>
                </tr>
              );
            })}
            {!data?.length && <tr><td colSpan={8} className="p-10 text-center text-gray-400">暂无异常</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
