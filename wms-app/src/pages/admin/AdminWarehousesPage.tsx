import { useEffect, useState } from 'react';
import { supabase, getAuthContext } from '../../lib/supabase';
import { Eye, EyeOff, Save, Pencil, ShieldAlert } from 'lucide-react';

const BADGE: Record<string, string> = { active: 'bg-green-50 text-green-600', suspended: 'bg-red-50 text-red-600', testing: 'bg-amber-50 text-amber-600' };

export function AdminWarehousesPage() {
  const [ok, setOk] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showKeyId, setShowKeyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<any>({});

  useEffect(() => { (async () => {
    const { portalRole } = await getAuthContext();
    if (portalRole !== 'admin') { setOk(false); return; }
    setOk(true);
    await load();
  })(); }, []);

  async function load() {
    setLoading(true);
    // 管理员无过滤 —— 查看所有仓库
    const { data, error } = await supabase.from('tlv_warehouses').select('*').order('created_at', { ascending: false });
    if (!error) setRows(data || []);
    setLoading(false);
  }

  function startEdit(w: any) { setEditingId(w.id); setForm({ ...w }); }
  function cancelEdit() { setEditingId(null); setForm({}); }

  async function saveEdit() {
    if (!editingId) return;
    const { error } = await supabase.from('tlv_warehouses').update({
      name: form.name, code: form.code, country: form.country, contact_name: form.contact_name,
      contact_email: form.contact_email, status: form.status,
    }).eq('id', editingId);
    if (!error) { setEditingId(null); await load(); }
  }

  function maskKey(k: string) {
    if (!k) return '-';
    return k.length <= 8 ? '****' : k.slice(0, 4) + '****' + k.slice(-4);
  }

  if (!ok) return <div className="p-12 text-center text-red-500 flex items-center justify-center gap-2"><ShieldAlert className="w-5 h-5" /> 需要管理员权限</div>;

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">仓库管理</h2>
        <p className="text-sm text-slate-500 mt-1">所有接入 Thalvior 平台的仓库节点</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? <div className="p-10 text-center text-slate-400">加载中...</div> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-4 py-2.5">仓库名称 / 编码</th>
                <th className="text-left px-4 py-2.5">国家</th>
                <th className="text-left px-4 py-2.5">联系方式</th>
                <th className="text-center px-4 py-2.5">状态</th>
                <th className="text-left px-4 py-2.5">API Key</th>
                <th className="text-right px-4 py-2.5">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w: any) => editingId === w.id ? (
                <tr key={w.id} className="border-t border-slate-50 bg-purple-50/40">
                  <td className="px-4 py-2"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-2 py-1 border rounded text-sm" />
                    <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="mt-1 w-full px-2 py-1 border rounded text-xs font-mono" /></td>
                  <td className="px-4 py-2"><input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} className="w-full px-2 py-1 border rounded text-sm" /></td>
                  <td className="px-4 py-2">
                    <input value={form.contact_name || ''} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} placeholder="联系人" className="w-full px-2 py-1 border rounded text-sm" />
                    <input value={form.contact_email || ''} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} placeholder="邮箱" className="mt-1 w-full px-2 py-1 border rounded text-xs" /></td>
                  <td className="px-4 py-2 text-center">
                    <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="px-2 py-1 border rounded text-sm">
                      <option value="active">active</option><option value="suspended">suspended</option><option value="testing">testing</option>
                    </select>
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">不可编辑</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={saveEdit} className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-emerald-600 text-white hover:bg-emerald-700"><Save className="w-3 h-3" /> 保存</button>
                    <button onClick={cancelEdit} className="ml-1 px-2 py-1 rounded text-xs text-slate-500 hover:bg-slate-100">取消</button>
                  </td>
                </tr>
              ) : (
                <tr key={w.id} className="border-t border-slate-50 hover:bg-slate-50/50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-700">{w.name}</div>
                    <div className="text-xs font-mono text-slate-400">{w.code}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{w.country || '-'}</td>
                  <td className="px-4 py-3">
                    <div className="text-slate-600">{w.contact_name || '-'}</div>
                    <div className="text-[11px] text-slate-400">{w.contact_email || '-'}</div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${BADGE[w.status] || 'bg-slate-100 text-slate-500'}`}>
                      {(w.status || '').toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-slate-600">
                    {showKeyId === w.id ? w.api_key || '-' : maskKey(w.api_key || '')}
                    {w.api_key && (
                      <button onClick={() => setShowKeyId(showKeyId === w.id ? null : w.id)}
                        className="ml-2 text-[#8b5cf6] hover:underline inline-flex items-center gap-1">
                        {showKeyId === w.id ? <><EyeOff className="w-3 h-3" />隐藏</> : <><Eye className="w-3 h-3" />查看</>}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => startEdit(w)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-[#8b5cf6] hover:bg-purple-50">
                      <Pencil className="w-3 h-3" /> 编辑
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={6} className="p-10 text-center text-slate-400">暂无仓库数据</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
