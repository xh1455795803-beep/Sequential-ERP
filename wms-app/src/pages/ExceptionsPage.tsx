import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { AlertTriangle, Check, X, ExternalLink } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';

const TYPE_LABEL: Record<string, { label: string; cls: string; emoji: string }> = {
  out_of_stock:    { label: '缺货',       cls: 'bg-orange-50 text-orange-600',     emoji: '📦' },
  sku_unpaired:     { label: 'SKU未配对',  cls: 'bg-purple-50 text-purple-600',     emoji: '🔗' },
  label_fail:       { label: '面单申请失败', cls: 'bg-red-50 text-red-600',          emoji: '🖨️' },
  pack_mismatch:    { label: '打包校验错', cls: 'bg-red-50 text-red-600',          emoji: '❌' },
  address_invalid:  { label: '地址无效',   cls: 'bg-amber-50 text-amber-700',       emoji: '📍' },
  partial_stock:    { label: '部分缺货',   cls: 'bg-amber-50 text-amber-700',       emoji: '⚠️' },
  cancelled:        { label: '已取消',     cls: 'bg-gray-100 text-gray-500',        emoji: '🚫' },
};

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  open:       { label: '待处理', cls: 'bg-red-50 text-red-600' },
  processing: { label: '处理中', cls: 'bg-amber-50 text-amber-600' },
  resolved:   { label: '已解决', cls: 'bg-green-50 text-green-600' },
  ignored:    { label: '已忽略', cls: 'bg-gray-100 text-gray-500' },
};

export function ExceptionsPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [filterStatus, setFilterStatus] = useState('open');

  const { data: ex } = useQuery({
    queryKey: ['wms_exceptions', filterStatus],
    queryFn: async () => {
      let q = supabase.from('wms_exceptions')
        .select(`*, warehouse:wms_warehouses(id,name,code),
                order:erp_orders(id,erp_order_no,status)`)
        .order('created_at', { ascending: false });
      if (filterStatus) q = q.eq('status', filterStatus);
      const { data } = await q;
      return data || [];
    },
  });

  // 同时也抓 erp_orders 里 status=exception 的（异常可以直接挂在订单上不单独建 exceptions 表）
  const { data: exceptionOrders } = useQuery({
    queryKey: ['erp_orders_exceptions', filterStatus],
    queryFn: async () => {
      if (filterStatus !== 'open') return [];
      const { data } = await supabase.from('erp_orders')
        .select(`id,erp_order_no,exception_type,exception_detail,warehouse:wms_warehouses(id,name,code),created_at,status`)
        .eq('status', 'exception')
        .order('created_at', { ascending: false });
      return (data || []).map((o: any) => ({
        id: o.id,
        type: o.exception_type || 'order_exception',
        description: (o.exception_detail?.unpaired_skus || []).join(', ') || o.exception_detail || '订单异常',
        status: 'open',
        warehouse: o.warehouse,
        order: { id: o.id, erp_order_no: o.erp_order_no, status: o.status },
        _source: 'erp_order',
        created_at: o.created_at,
      }));
    },
  });

  useEffect(() => {
    const { data: sub } = supabase.channel('exceptions-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wms_exceptions' }, () => {
        qc.invalidateQueries();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'erp_orders', filter: 'status=eq.exception' }, () => {
        qc.invalidateQueries();
      })
      .subscribe();
    return () => sub.unsubscribe();
  }, []);

  const allExceptions = [...(exceptionOrders as any[] || []), ...(ex as any[] || [])];

  async function resolveException(e: any, resolution: string) {
    if (e._source === 'erp_order') {
      // 从 ERP 订单异常恢复
      if (resolution === 'resolve') {
        await supabase.from('erp_orders').update({ status: 'pending', exception_type: null, exception_detail: null }).eq('id', e.id);
        alert('✅ 异常已标记为已处理，订单回到待处理状态');
      } else if (resolution === 'cancel') {
        await supabase.from('erp_orders').update({ status: 'cancelled', operator: 'exception_resolved' }).eq('id', e.id);
        alert('✅ 订单已取消');
      }
    } else {
      await supabase.from('wms_exceptions').update({
        status: resolution === 'resolve' ? 'resolved' : 'ignored',
        resolution, resolved_at: new Date().toISOString(),
      }).eq('id', e.id);
    }
    qc.invalidateQueries();
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-red-500" /> 异常中心
          </h2>
          <p className="text-sm text-gray-500 mt-1">所有异常订单集中在此处理 · Realtime 实时同步三端</p>
        </div>
        <div className="text-sm text-gray-500">
          共 {allExceptions.length} 条异常
        </div>
      </div>

      {/* 状态筛选 */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {[
          { k: 'open',       l: '待处理' },
          { k: 'processing', l: '处理中' },
          { k: 'resolved',   l: '已解决' },
          { k: 'ignored',    l: '已忽略' },
          { k: '',           l: '全部' },
        ].map(({ k, l }) => (
          <button key={k || 'all'} onClick={() => setFilterStatus(k)}
            className={`px-3 py-1 rounded-full text-xs border transition-colors
              ${filterStatus === k ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
            {l}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {allExceptions.map((e: any) => {
          const tl = TYPE_LABEL[e.type] || { label: e.type, cls: 'bg-gray-100', emoji: '⚠️' };
          const sl = STATUS_LABEL[e.status] || { label: e.status, cls: 'bg-gray-100' };
          return (
            <div key={e.id + (e._source || '')}
              className={`bg-white rounded-xl shadow-sm border overflow-hidden ${e.status === 'open' ? 'border-red-200' : 'border-gray-100'}`}>
              <div className="p-4 flex items-start gap-4">
                <div className="text-2xl">{tl.emoji}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-2 py-0.5 rounded text-xs ${tl.cls}`}>{tl.label}</span>
                    <span className={`px-2 py-0.5 rounded text-xs ${sl.cls}`}>{sl.label}</span>
                    {e.order && (
                      <button onClick={() => nav({ to: `/orders/$id`, params: { id: e.order.id } })}
                        className="text-xs text-brand-500 hover:underline flex items-center gap-0.5">
                        查看订单 {e.order.erp_order_no} <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <div className="text-sm text-gray-700">{typeof e.description === 'string' ? e.description : JSON.stringify(e.description)}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    {e.warehouse?.code || '-'} · {new Date(e.created_at).toLocaleString()}
                  </div>
                </div>
                {e.status === 'open' && (
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => resolveException(e, 'resolve')}
                      className="px-3 py-1.5 bg-green-500 text-white rounded text-xs hover:bg-green-600 flex items-center gap-1">
                      <Check className="w-3 h-3" /> 处理
                    </button>
                    <button onClick={() => resolveException(e, 'ignore')}
                      className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded text-xs hover:bg-gray-200 flex items-center gap-1">
                      <X className="w-3 h-3" /> 忽略
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {!allExceptions.length && (
          <div className="text-center py-16 text-gray-400">
            <AlertTriangle className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <div>🎉 没有异常！所有订单处理顺畅</div>
          </div>
        )}
      </div>
    </div>
  );
}
