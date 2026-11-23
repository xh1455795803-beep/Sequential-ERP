import { useEffect, useState } from 'react';
import { supabase, getAuthContext } from '../../lib/supabase';
import { MapPin, Phone, Mail, Loader2, Building2, User } from 'lucide-react';

const STATUS_META: Record<string, { label: string; cls: string }> = {
  active: { label: '运营中', cls: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  inactive: { label: '已停用', cls: 'bg-slate-50 text-slate-500 border-slate-100' },
  maintenance: { label: '维护中', cls: 'bg-amber-50 text-amber-700 border-amber-100' },
};

export function WmsWarehousesPage() {
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [row, setRow] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      const ctx = await getAuthContext();
      if (!ctx.warehouseId) return;
      setWarehouseId(ctx.warehouseId);
      try {
        const { data, error } = await supabase
          .from('tlv_warehouses')
          .select('id, name, code, country, address, contact_name, contact_phone, contact_email, status, created_at')
          .eq('id', ctx.warehouseId)
          .single();
        if (error || !data) throw new Error(error?.message || '仓库未找到');
        setRow(data);
      } catch (e: any) {
        setErr(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (!warehouseId) return <div className="p-12 text-center text-slate-500">未登录</div>;
  if (loading) return <div className="p-12 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" />加载中...</div>;
  if (!row) return <div className="p-12 text-center text-slate-500">仓库信息未找到</div>;

  const meta = STATUS_META[row.status] || STATUS_META.active;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-800">当前仓库</h2>
        <p className="text-sm text-slate-500 mt-0.5">您当前登录的仓库账户信息</p>
      </div>

      {err && <div className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">{err}</div>}

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 p-6 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                <Building2 className="w-7 h-7" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">{row.name}</h1>
                <div className="text-emerald-100 mt-1 font-mono text-sm">{row.code} · {row.country}</div>
              </div>
            </div>
            <span className={`px-3 py-1 text-xs rounded-full border ${meta.cls} bg-white font-medium`}>{meta.label}</span>
          </div>
        </div>

        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">基本信息</h3>
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-3">
                <MapPin className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-slate-400 text-xs">地址</div>
                  <div className="text-slate-700">{row.address || '-'}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
                <div>
                  <div className="text-slate-400 text-xs">仓库ID</div>
                  <div className="text-slate-700 font-mono text-xs">{row.id}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <User className="w-4 h-4 text-slate-400 shrink-0" />
                <div>
                  <div className="text-slate-400 text-xs">状态</div>
                  <div className="text-slate-700">{row.status}</div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">联系方式</h3>
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-3">
                <Phone className="w-4 h-4 text-slate-400 shrink-0" />
                <div>
                  <div className="text-slate-400 text-xs">联系人</div>
                  <div className="text-slate-700">{row.contact_name || '-'} · {row.contact_phone || '-'}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-slate-400 shrink-0" />
                <div>
                  <div className="text-slate-400 text-xs">邮箱</div>
                  <div className="text-slate-700 truncate">{row.contact_email || '-'}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
