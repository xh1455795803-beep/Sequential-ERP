import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { ChevronDown, ChevronRight, Package, Loader2 } from 'lucide-react';

const MERCHANT_ID = '00000000-0000-0000-0000-000000000101';

export function MerchantLogisticsPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [trackingCache, setTrackingCache] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('tlv_outbound_orders')
      .select('*')
      .eq('merchant_id', MERCHANT_ID)
      .neq('tracking_no', null)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!error) setOrders(data || []);
        setLoading(false);
      });
  }, []);

  async function toggle(row: any) {
    const key = row.id;
    if (!expanded[key] && !trackingCache[key]) {
      const { data } = await supabase
        .from('tlv_logistics_tracking')
        .select('*')
        .eq('merchant_id', MERCHANT_ID)
        .eq('tracking_no', row.tracking_no)
        .order('event_time', { ascending: false });
      setTrackingCache((c) => ({ ...c, [key]: data || [] }));
    }
    setExpanded((e) => ({ ...e, [key]: !e[key] }));
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
        <div className="flex items-center gap-2">
          <Package className="w-5 h-5 text-blue-600" />
          <h2 className="text-lg font-semibold text-slate-800">物流追踪</h2>
        </div>
        <p className="text-sm text-slate-500 mt-1">查看所有已发货的出库单及追踪事件</p>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-slate-100 p-12 flex items-center justify-center text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载中...
        </div>
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-100 p-12 text-center text-slate-400 text-sm">暂无带物流单号的出库单</div>
      ) : (
        <div className="space-y-3">
          {orders.map((o: any) => (
            <div key={o.id} className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
              <button onClick={() => toggle(o)}
                className="w-full px-5 py-4 flex items-center gap-4 hover:bg-slate-50 text-left">
                {expanded[o.id] ? <ChevronDown className="w-5 h-5 text-slate-400" /> : <ChevronRight className="w-5 h-5 text-slate-400" />}
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-4 gap-2 text-sm">
                  <div>
                    <div className="text-xs text-slate-400">订单号</div>
                    <div className="font-mono text-slate-800">{o.id}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">物流单号</div>
                    <div className="font-mono text-slate-800">{o.tracking_no}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">承运商</div>
                    <div className="text-slate-700">{o.carrier || '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">状态</div>
                    <span className="inline-block px-2 py-0.5 rounded text-xs bg-teal-100 text-teal-700 font-medium">{o.status || '-'}</span>
                  </div>
                </div>
              </button>

              {expanded[o.id] && (
                <div className="px-5 pb-4 border-t border-slate-100 pt-4">
                  {(trackingCache[o.id] || []).length === 0 ? (
                    <div className="text-sm text-slate-400 py-4 text-center">暂无追踪事件</div>
                  ) : (
                    <div className="relative pl-5">
                      <div className="absolute left-1.5 top-2 bottom-2 w-px bg-slate-200" />
                      {trackingCache[o.id].map((ev: any, idx: number) => (
                        <div key={ev.id || idx} className="relative mb-3 last:mb-0">
                          <div className="absolute -left-4 top-1.5 w-3 h-3 rounded-full bg-blue-500 ring-2 ring-white" />
                          <div className="text-sm font-medium text-slate-800">{ev.event_description || ev.status || '---'}</div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {ev.event_time?.slice(0, 16).replace('T', ' ') || '-'} · {ev.location || o.carrier || '-'}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
