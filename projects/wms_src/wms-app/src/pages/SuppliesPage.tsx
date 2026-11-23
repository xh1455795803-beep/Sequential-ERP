import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Plus, Pencil, Trash2, AlertTriangle, Box, Package, Receipt, Search } from 'lucide-react';
import { useState } from 'react';
import { Modal, Grid, Field, Footer } from './LocationsPage';

// ========================================================
// 耗材管理 — wms_supplies + wms_supply_usage
// 低库存预警 / 分类 / 成本 / 发货单使用记录
// ========================================================

const CATEGORY_OPTIONS = [
  { v: 'box', l: '纸箱' }, { v: 'polybag', l: '气泡袋' }, { v: 'envelope', l: '信封袋' },
  { v: 'label', l: '标签' }, { v: 'tape', l: '胶带' }, { v: 'dunnage', l: '缓冲填充物' },
  { v: 'fragile', l: '易碎贴' }, { v: 'custom', l: '自定义' },
];

export function SuppliesPage() {
  const qc = useQueryClient();
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [lowOnly, setLowOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [usageDetail, setUsageDetail] = useState<any>(null);

  const { data: warehouses } = useQuery({
    queryKey: ['wms_warehouses'],
    queryFn: async () => { const { data } = await supabase.from('wms_warehouses').select('*'); return data || []; },
  });

  const { data: supplies, isLoading } = useQuery({
    queryKey: ['wms_supplies', categoryFilter, lowOnly, search],
    queryFn: async () => {
      const uid = (await supabase.auth.getUser()).data.user?.id;
      let q: any = supabase.from('wms_supplies').select('*').eq('user_id', uid)
        .order('created_at', { ascending: false });
      if (categoryFilter !== 'all') q = q.eq('category', categoryFilter);
      const { data } = await q;
      let rows = data || [];
      if (lowOnly) rows = rows.filter((r: any) => (r.qty_on_hand || 0) <= (r.min_stock_warning || 0));
      if (search.trim()) {
        const s = search.trim().toLowerCase();
        rows = rows.filter((r: any) =>
          r.sku?.toLowerCase().includes(s) ||
          r.name?.toLowerCase().includes(s)
        );
      }
      return rows;
    },
  });

  // 低库存统计
  const { data: lowCount } = useQuery({
    queryKey: ['wms_supplies_low_count'],
    queryFn: async () => {
      const uid = (await supabase.auth.getUser()).data.user?.id;
      const { data } = await supabase.from('wms_supplies').select('*').eq('user_id', uid);
      return (data || []).filter((r: any) => (r.qty_on_hand || 0) <= (r.min_stock_warning || 0)).length;
    },
  });

  const { data: usageTotal } = useQuery({
    queryKey: ['wms_supply_usage_total'],
    queryFn: async () => {
      const uid = (await supabase.auth.getUser()).data.user?.id;
      const { data } = await supabase.from('wms_supply_usage').select('*').eq('user_id', uid);
      return data?.length || 0;
    },
  });

  // 入库补数
  async function restock(supply: any) {
    const delta = prompt(`入库数量 (当前 ${supply.qty_on_hand || 0})`, '100');
    const d = parseInt(delta || '0');
    if (!d || d <= 0) return;
    const { data: { user } } = await supabase.auth.getUser();
    const newQty = (supply.qty_on_hand || 0) + d;
    await supabase.from('wms_supplies').update({ qty_on_hand: newQty }).eq('id', supply.id);
    // 写 usage 记录（特殊：restock）
    await supabase.from('wms_supply_usage').insert({
      user_id: user!.id, supply_id: supply.id, qty_used: -d, reason: 'restock',
    });
    qc.invalidateQueries();
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">耗材管理</h2>
          <p className="text-sm text-gray-500 mt-1">
            纸箱 / 气泡袋 / 标签 / 胶带等耗材 · 低库存预警 · 成本核算
          </p>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true); }}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 text-sm">
          <Plus className="w-4 h-4" /> 新建耗材
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
          <div className="text-xs text-gray-500 mb-1">耗材 SKU 数</div>
          <div className="text-2xl font-bold text-gray-800 tabular-nums">{(supplies as any[])?.length ?? '-'}</div>
        </div>
        <div className={`rounded-xl p-4 border shadow-sm ${lowCount && lowCount > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100'}`}>
          <div className={`text-xs mb-1 flex items-center gap-1 ${lowCount && lowCount > 0 ? 'text-red-600' : 'text-gray-500'}`}>
            <AlertTriangle className="w-3 h-3" /> 低库存预警
          </div>
          <div className={`text-2xl font-bold tabular-nums ${lowCount && lowCount > 0 ? 'text-red-500 animate-pulse' : 'text-gray-800'}`}>
            {lowCount ?? 0}
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
          <div className="text-xs text-gray-500 mb-1">累计使用记录</div>
          <div className="text-2xl font-bold text-sea-600 tabular-nums">{usageTotal ?? 0}</div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-xl border border-gray-100 p-3 mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-gray-500">分类：</span>
        {[{ v: 'all', l: '全部' }, ...CATEGORY_OPTIONS].map(c => (
          <button key={c.v} onClick={() => setCategoryFilter(c.v)}
            className={`px-2.5 py-1 rounded ${categoryFilter === c.v ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-600'}`}>{c.l}</button>
        ))}
        <label className="inline-flex items-center gap-1.5 text-gray-600 ml-2">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
          仅看低库存
        </label>
        <div className="ml-auto relative">
          <Search className="w-3 h-3 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
          <input placeholder="搜索 SKU / 名称"
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="pl-6 pr-2 py-1 border border-gray-200 rounded text-xs w-48" />
        </div>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-5 py-2.5">SKU</th>
              <th className="text-left px-5 py-2.5">名称</th>
              <th className="text-left px-5 py-2.5">分类</th>
              <th className="text-left px-5 py-2.5">单位</th>
              <th className="text-right px-5 py-2.5">在库</th>
              <th className="text-right px-5 py-2.5">最低预警</th>
              <th className="text-right px-5 py-2.5">成本 / 总价值</th>
              <th className="text-left px-5 py-2.5">状态</th>
              <th className="text-right px-5 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {(supplies as any[])?.map((s: any) => {
              const low = (s.qty_on_hand || 0) <= (s.min_stock_warning || 0);
              const totalValue = (s.qty_on_hand || 0) * Number(s.cost_per_unit || 0);
              return (
                <tr key={s.id} className={`border-t border-gray-50 hover:bg-gray-50/50 ${low ? 'bg-red-50/40' : ''}`}>
                  <td className="px-5 py-3 font-mono font-medium text-brand-600">{s.sku}</td>
                  <td className="px-5 py-3">
                    <div className="font-medium text-gray-800">{s.name}</div>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-xs px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">
                      {CATEGORY_OPTIONS.find(c => c.v === s.category)?.l || s.category}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-500">{s.unit || '个'}</td>
                  <td className={`px-5 py-3 text-right font-semibold tabular-nums ${low ? 'text-red-500' : 'text-gray-800'}`}>
                    {s.qty_on_hand || 0}
                    {low && <AlertTriangle className="inline w-3 h-3 ml-1 text-red-500" />}
                  </td>
                  <td className="px-5 py-3 text-right text-xs text-gray-500">{s.min_stock_warning || 0}</td>
                  <td className="px-5 py-3 text-right text-xs tabular-nums">
                    <div className="text-gray-600">¥ {Number(s.cost_per_unit || 0).toFixed(2)}</div>
                    <div className="text-gray-400">≈ ¥ {totalValue.toFixed(2)}</div>
                  </td>
                  <td className="px-5 py-3">
                    {s.status === 'active' ? (
                      <span className="text-xs text-green-600">● 正常</span>
                    ) : (
                      <span className="text-xs text-gray-400">已停用</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => restock(s)}
                        className="px-2 py-1 text-xs bg-green-50 text-green-600 rounded hover:bg-green-100">入库</button>
                      <button onClick={() => setEditing(s)}
                        className="p-1 hover:bg-gray-100 rounded text-gray-500"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={async () => {
                        if (!confirm(`删除耗材 ${s.sku}？`)) return;
                        await supabase.from('wms_supplies').delete().eq('id', s.id);
                        qc.invalidateQueries({ queryKey: ['wms_supplies'] });
                      }} className="p-1 hover:bg-red-50 rounded text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!supplies?.length && <tr><td colSpan={9} className="p-10 text-center text-gray-400">{isLoading ? '加载中...' : '暂无耗材'}</td></tr>}
          </tbody>
        </table>
      </div>

      {/* 低库存预警区 */}
      {lowCount && lowCount > 0 && (
        <div className="mt-4 bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium text-red-700">低库存预警通知</div>
              <div className="text-sm text-red-600 mt-1">
                有 <b>{lowCount}</b> 项耗材低于最低预警线。请及时补货以避免影响发货。
              </div>
              <button onClick={() => setLowOnly(true)}
                className="mt-2 text-xs text-red-600 hover:text-red-800 underline">立即筛选查看</button>
            </div>
          </div>
        </div>
      )}

      {/* Usage History — 最近 10 条 */}
      <div className="mt-4 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 font-medium flex items-center gap-2">
          <Receipt className="w-4 h-4 text-gray-500" />
          <span>最近使用记录</span>
        </div>
        <UsageRecent />
      </div>

      {/* Modal: 新建 / 编辑 */}
      {showForm && (
        <SupplyForm
          warehouses={warehouses!} initial={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['wms_supplies'] }); }} />
      )}
    </div>
  );
}

// ========================================================
// 最近使用记录（独立组件，避免每次全量 join）
// ========================================================

function UsageRecent() {
  const { data: supplies } = useQuery({
    queryKey: ['wms_supplies_map'],
    queryFn: async () => {
      const uid = (await supabase.auth.getUser()).data.user?.id;
      const { data } = await supabase.from('wms_supplies').select('id,sku,name').eq('user_id', uid);
      return data || [];
    },
  });
  const { data: usage } = useQuery({
    queryKey: ['wms_supply_usage_recent'],
    queryFn: async () => {
      const uid = (await supabase.auth.getUser()).data.user?.id;
      const { data } = await supabase.from('wms_supply_usage').select('*').eq('user_id', uid)
        .order('created_at', { ascending: false }).limit(15);
      return data || [];
    },
  });
  const map = (supplies as any[])?.reduce((m: any, s: any) => { m[s.id] = s; return m; }, {});

  if (!(usage as any[])?.length) {
    return <div className="p-8 text-center text-gray-400 text-sm">暂无使用记录</div>;
  }

  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50 text-gray-500 text-xs">
        <tr>
          <th className="text-left px-5 py-2">时间</th>
          <th className="text-left px-5 py-2">耗材</th>
          <th className="text-right px-5 py-2">数量</th>
          <th className="text-left px-5 py-2">关联</th>
          <th className="text-left px-5 py-2">原因</th>
        </tr>
      </thead>
      <tbody>
        {(usage as any[]).map((u: any) => {
          const supply = map[u.supply_id];
          const isRestock = u.reason === 'restock';
          return (
            <tr key={u.id} className="border-t border-gray-50">
              <td className="px-5 py-2 text-xs text-gray-500 tabular-nums">
                {new Date(u.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </td>
              <td className="px-5 py-2">
                <div className="font-mono text-xs">{supply?.sku || '-'}</div>
                <div className="text-[10px] text-gray-400">{supply?.name || u.supply_id?.slice(0, 8)}</div>
              </td>
              <td className={`px-5 py-2 text-right font-semibold tabular-nums ${isRestock ? 'text-green-600' : 'text-red-500'}`}>
                {u.qty_used > 0 ? '+' : ''}{u.qty_used}
              </td>
              <td className="px-5 py-2 text-xs font-mono text-gray-500">
                {u.shipment_id ? `发货单 ${u.shipment_id.slice(0, 8)}` : '-'}
              </td>
              <td className="px-5 py-2 text-xs">
                <span className={`px-1.5 py-0.5 rounded ${isRestock ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                  {isRestock ? '入库补数' : u.reason || '发货使用'}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ========================================================
// Supply Form (新建 / 编辑)
// ========================================================

function SupplyForm({ warehouses, initial, onClose, onSaved }: any) {
  const [f, setF] = useState<any>(initial || {
    warehouse_id: warehouses?.[0]?.id || '',
    sku: '', name: '', category: 'box', unit: '个',
    qty_on_hand: 0, min_stock_warning: 100, cost_per_unit: 0,
    status: 'active',
  });

  async function save() {
    if (!f.sku.trim() || !f.name.trim()) return alert('请填写 SKU 和名称');
    const { data: { user } } = await supabase.auth.getUser();
    if (!initial) {
      const { error } = await supabase.from('wms_supplies').insert({ ...f, user_id: user!.id });
      if (error) return alert(error.message);
    } else {
      const { error } = await supabase.from('wms_supplies').update(f).eq('id', initial.id);
      if (error) return alert(error.message);
    }
    onSaved();
  }

  return (
    <Modal title={initial ? '编辑耗材' : '新建耗材'} onClose={onClose}>
      <Grid>
        <Field label="仓库 *">
          <select className="inp" value={f.warehouse_id} onChange={(e) => setF({ ...f, warehouse_id: e.target.value })}>
            {(warehouses as any[])?.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
        <Field label="SKU *"><input className="inp" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} disabled={!!initial} /></Field>
        <Field label="名称 *"><input className="inp" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="分类">
          <select className="inp" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {CATEGORY_OPTIONS.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
          </select>
        </Field>
        <Field label="单位"><input className="inp" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="个 / 卷 / 袋" /></Field>
        <Field label="在库数量"><input className="inp" type="number" value={f.qty_on_hand} onChange={(e) => setF({ ...f, qty_on_hand: +e.target.value })} /></Field>
        <Field label="最低预警"><input className="inp" type="number" value={f.min_stock_warning} onChange={(e) => setF({ ...f, min_stock_warning: +e.target.value })} /></Field>
        <Field label="单价 (成本)"><input className="inp" type="number" step="0.01" value={f.cost_per_unit} onChange={(e) => setF({ ...f, cost_per_unit: +e.target.value })} /></Field>
        <Field label="状态">
          <select className="inp" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="active">启用</option>
            <option value="inactive">停用</option>
          </select>
        </Field>
      </Grid>
      <Footer onClose={onClose} onSave={save} />
    </Modal>
  );
}
