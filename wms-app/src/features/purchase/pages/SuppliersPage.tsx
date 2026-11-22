import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useState } from 'react';
import { toast } from 'sonner';

export function SuppliersPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [remark, setRemark] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['wms_suppliers'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_suppliers').select('*').order('created_at', { ascending: false });
      return data || [];
    },
  });

  async function submit() {
    if (!name.trim()) { toast.error('供应商名称必填'); return; }
    const payload = { name: name.trim(), contact, phone, email, address, remark };
    const { error } = editing
      ? await supabase.from('wms_suppliers').update(payload).eq('id', editing.id)
      : await supabase.from('wms_suppliers').insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success(editing ? '已更新' : '已添加');
    qc.invalidateQueries({ queryKey: ['wms_suppliers'] });
    reset();
  }

  async function del(id: string) {
    if (!confirm('确认删除？')) return;
    await supabase.from('wms_suppliers').delete().eq('id', id);
    qc.invalidateQueries({ queryKey: ['wms_suppliers'] });
  }

  function reset() {
    setShowForm(false); setEditing(null);
    setName(''); setContact(''); setPhone(''); setEmail(''); setAddress(''); setRemark('');
  }

  function edit(s: any) {
    setEditing(s); setShowForm(true);
    setName(s.name); setContact(s.contact || ''); setPhone(s.phone || '');
    setEmail(s.email || ''); setAddress(s.address || ''); setRemark(s.remark || '');
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">供应商管理</h2>
          <p className="text-sm text-muted-foreground mt-1">供应商档案、联系方式、付款备注</p>
        </div>
        <button onClick={() => setShowForm(true)} className="px-4 py-2 rounded-md bg-brand text-white text-sm hover:bg-brand-hover">
          + 新增供应商
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h3 className="font-semibold mb-4">{editing ? '编辑' : '新增'}供应商</h3>
          <div className="grid grid-cols-2 gap-4 max-w-3xl">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">名称 *</label>
              <input value={name} onChange={e => setName(e.target.value)} className="inp w-full" placeholder="深圳市 XX 科技" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">联系人</label>
              <input value={contact} onChange={e => setContact(e.target.value)} className="inp w-full" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">电话</label>
              <input value={phone} onChange={e => setPhone(e.target.value)} className="inp w-full" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">邮箱</label>
              <input value={email} onChange={e => setEmail(e.target.value)} className="inp w-full" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-slate-500 mb-1 block">地址</label>
              <input value={address} onChange={e => setAddress(e.target.value)} className="inp w-full" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-slate-500 mb-1 block">备注</label>
              <input value={remark} onChange={e => setRemark(e.target.value)} className="inp w-full" placeholder="付款条件、账期等" />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={submit} className="px-4 py-2 rounded-md bg-brand text-white text-sm">{editing ? '保存' : '添加'}</button>
            <button onClick={reset} className="px-4 py-2 rounded-md border text-sm">取消</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5">名称</th>
              <th className="text-left px-4 py-2.5">联系人</th>
              <th className="text-left px-4 py-2.5">电话</th>
              <th className="text-left px-4 py-2.5">邮箱</th>
              <th className="text-left px-4 py-2.5">备注</th>
              <th className="text-right px-4 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="p-8 text-center text-slate-400">加载中...</td></tr>}
            {!isLoading && data?.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-400">暂无供应商</td></tr>}
            {data?.map((s: any) => (
              <tr key={s.id} className="border-t hover:bg-slate-50">
                <td className="px-4 py-2.5 font-medium">{s.name}</td>
                <td className="px-4 py-2.5 text-slate-600">{s.contact || '-'}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{s.phone || '-'}</td>
                <td className="px-4 py-2.5 text-xs">{s.email || '-'}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500 truncate max-w-[200px]">{s.remark || '-'}</td>
                <td className="px-4 py-2.5 text-right">
                  <button onClick={() => edit(s)} className="text-xs text-brand hover:underline mr-3">编辑</button>
                  <button onClick={() => del(s.id)} className="text-xs text-red-500 hover:underline">删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
