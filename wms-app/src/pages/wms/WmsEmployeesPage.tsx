import { useEffect, useState } from 'react';
import { supabase, getAuthContext } from '../../lib/supabase';
import { Users, Plus, Trash2, UserPlus } from 'lucide-react';

const ROLES = ['picker', 'packer', 'inspector', 'shipper', 'manager'];
const ROLE_LABEL: Record<string, string> = {
  picker: '拣货员', packer: '打包员', inspector: '质检员', shipper: '发货员', manager: '主管',
};

export function WmsEmployeesPage() {
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [emps, setEmps] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', username: '', role: 'picker', phone: '', email: '' });

  useEffect(() => {
    (async () => {
      const ctx = await getAuthContext();
      if (!ctx.warehouseId) return;
      setWarehouseId(ctx.warehouseId);
      await load(ctx.warehouseId);
    })();
  }, []);

  async function load(wid: string) {
    const { data } = await supabase.from('tlv_employees').select('*').eq('warehouse_id', wid).order('role').order('name');
    setEmps(data || []);
  }

  async function create() {
    if (!warehouseId || !form.name.trim()) return;
    const { error } = await supabase.from('tlv_employees').insert({
      warehouse_id: warehouseId, ...form, username: form.username || null, phone: form.phone || null, email: form.email || null,
    });
    if (error) { alert(error.message); return; }
    setShowNew(false);
    setForm({ name: '', username: '', role: 'picker', phone: '', email: '' });
    await load(warehouseId);
  }

  async function toggleStatus(id: string, current: string) {
    await supabase.from('tlv_employees').update({ status: current === 'active' ? 'inactive' : 'active' }).eq('id', id);
    if (warehouseId) await load(warehouseId);
  }

  async function remove(id: string) {
    if (!confirm('确定删除该员工？操作不可恢复')) return;
    await supabase.from('tlv_employees').delete().eq('id', id);
    if (warehouseId) await load(warehouseId);
  }

  if (!warehouseId) return <div>未绑定仓库</div>;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 flex items-center gap-3 justify-between">
        <div>
          <h3 className="font-semibold text-slate-700 flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" /> 员工管理
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">员工完成的每个操作都会自动计入绩效</p>
        </div>
        <button onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium">
          <UserPlus className="w-4 h-4" /> 新增员工
        </button>
      </div>

      {emps.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-100 p-12 text-center text-slate-400 text-sm">
          还没有员工，点击「新增员工」开始
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-5 py-3 font-medium">姓名</th>
                <th className="text-left px-5 py-3 font-medium">工号</th>
                <th className="text-left px-5 py-3 font-medium">角色</th>
                <th className="text-left px-5 py-3 font-medium">联系方式</th>
                <th className="text-center px-5 py-3 font-medium">状态</th>
                <th className="text-right px-5 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {emps.map((e: any) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-800">{e.name}</td>
                  <td className="px-5 py-3 font-mono text-slate-500 text-xs">{e.username || '-'}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                      e.role === 'manager' ? 'bg-purple-100 text-purple-700' :
                      e.role === 'packer' ? 'bg-indigo-100 text-indigo-700' :
                      e.role === 'shipper' ? 'bg-teal-100 text-teal-700' :
                      'bg-slate-100 text-slate-600'
                    }`}>{ROLE_LABEL[e.role] || e.role}</span>
                  </td>
                  <td className="px-5 py-3 text-slate-600 text-xs">
                    {e.phone || '-'}{e.email ? ` · ${e.email}` : ''}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <button onClick={() => toggleStatus(e.id, e.status)}
                      className={`px-2 py-0.5 rounded text-xs font-medium ${e.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {e.status === 'active' ? '在职' : '离职'}
                    </button>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => remove(e.id)} className="text-red-400 hover:text-red-600">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowNew(false)}>
          <div className="bg-white rounded-xl p-6 w-96" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-800 mb-4">新增员工</h3>
            <div className="space-y-3">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="姓名 *"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
              <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="工号"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="电话"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="邮箱"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowNew(false)} className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm">取消</button>
              <button onClick={create} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
