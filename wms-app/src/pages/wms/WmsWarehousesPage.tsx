import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { MapPin, Phone, Mail, Loader2, Building2 } from 'lucide-react';

const FALLBACK = [
  { id: '00000000-0000-0000-0000-000000000001', name: '深圳前海云仓', code: 'SZ-HQ', country: 'CN', contact_name: '李运营', contact_phone: '+86 13800001111', status: 'active' },
  { id: '00000000-0000-0000-0000-000000000002', name: '义乌分仓', code: 'YW-02', country: 'CN', contact_name: '王仓管', contact_phone: '+86 13800002222', status: 'active' },
  { id: '00000000-0000-0000-0000-000000000003', name: '波兰海外仓', code: 'PL-01', country: 'PL', contact_name: 'Anna', contact_phone: '+48 500 123 456', status: 'active' },
  { id: '00000000-0000-0000-0000-000000000004', name: '美国洛杉矶仓', code: 'US-LA', country: 'US', contact_name: 'Jack', contact_phone: '+1 323-555-0199', status: 'maintenance' },
];

const STATUS_META: Record<string, { label: string; cls: string }> = {
  active: { label: '运营中', cls: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  inactive: { label: '已停用', cls: 'bg-slate-50 text-slate-500 border-slate-100' },
  maintenance: { label: '维护中', cls: 'bg-amber-50 text-amber-700 border-amber-100' },
};

export function WmsWarehousesPage() {
  const [rows, setRows] = useState<any[]>(FALLBACK);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from('tlv_warehouses')
          .select('id, name, code, country, contact_name, contact_phone, contact_email, status')
          .order('country', { ascending: true });
        if (error) throw error;
        if (data && data.length) setRows(data);
      } catch (e: any) {
        setErr(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">仓库管理</h2>
          <p className="text-sm text-slate-500 mt-0.5">所有运营中的仓库 · Thalvior 跨境物流网络</p>
        </div>
        <div className="text-xs text-slate-500">
          共 <b className="text-emerald-700">{rows.length}</b> 个仓库
        </div>
      </div>

      {loading && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-12 flex items-center justify-center text-slate-400 text-sm">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载中...
        </div>
      )}

      {!loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {rows.map((w: any) => {
            const meta = STATUS_META[w.status] || STATUS_META.active;
            return (
              <div key={w.id} className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 hover:shadow-md transition">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shrink-0">
                      <Building2 className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-semibold text-slate-800 leading-tight">{w.name}</div>
                      <div className="text-xs text-slate-500 font-mono">{w.code}</div>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 text-[11px] rounded-full border ${meta.cls}`}>{meta.label}</span>
                </div>

                <div className="space-y-2 text-sm text-slate-600 border-t border-slate-100 pt-3">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>{w.country || '-'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>{w.contact_name || '-'} · {w.contact_phone || '无电话'}</span>
                  </div>
                  {w.contact_email && (
                    <div className="flex items-center gap-2">
                      <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">{w.contact_email}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {err && (
        <div className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          查询异常，展示示例数据 · {err}
        </div>
      )}
    </div>
  );
}
