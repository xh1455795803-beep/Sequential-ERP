import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Plus, Pencil, Trash2, Star, Settings, Zap, Calendar, Gauge, Layers, MapPin, CheckCircle } from 'lucide-react';
import { useState } from 'react';
import { Modal, Grid, Field, Footer } from './LocationsPage';

// ========================================================
// 波次策略 — wms_wave_strategies
// 5 种类型：manual / auto / cutoff / volume_based / zone_based
// 设为默认策略 → 新建波次时复用默认策略参数
// ========================================================

const STRATEGY_TYPES = [
  { v: 'manual', l: '手动分组', icon: Layers, desc: '手动从订单池中勾选发货单打包成波次，适合小批量或定制化场景', color: 'bg-gray-100 text-gray-700' },
  { v: 'auto', l: '自动波次', icon: Zap, desc: '系统自动按订单创建时间 + max_orders 阈值分波次', color: 'bg-blue-50 text-blue-600' },
  { v: 'cutoff', l: '截点波次', icon: Calendar, desc: '按时间截点（例如每天 14:00 / 18:00）集中处理订单', color: 'bg-amber-50 text-amber-600' },
  { v: 'volume_based', l: '体积/重量', icon: Gauge, desc: '按 max_volume_cm3 / max_weight_kg 聚合，控制运输成本', color: 'bg-purple-50 text-purple-600' },
  { v: 'zone_based', l: '按库区', icon: MapPin, desc: '按 zone_filter 指定的拣货区分组，减少跨区移动', color: 'bg-teal-50 text-teal-600' },
];

export function WaveStrategiesPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const { data: warehouses } = useQuery({
    queryKey: ['wms_warehouses'],
    queryFn: async () => { const { data } = await supabase.from('wms_warehouses').select('*'); return data || []; },
  });

  const { data: strategies, isLoading } = useQuery({
    queryKey: ['wms_wave_strategies'],
    queryFn: async () => {
      const uid = (await supabase.auth.getUser()).data.user?.id;
      const { data } = await supabase.from('wms_wave_strategies').select('*').eq('user_id', uid)
        .order('is_default', { ascending: false }).order('created_at', { ascending: false });
      return data || [];
    },
  });

  const { data: defaultStrategy } = useQuery({
    queryKey: ['wms_wave_default'],
    queryFn: async () => {
      const uid = (await supabase.auth.getUser()).data.user?.id;
      const { data } = await supabase.from('wms_wave_strategies').select('*').eq('user_id', uid)
        .eq('is_default', true).single();
      return data;
    },
  });

  async function setAsDefault(s: any) {
    if (!confirm(`将策略 "${s.name}" 设为该仓库的默认波次策略？`)) return;
    const { data: { user } } = await supabase.auth.getUser();
    // 先把该仓库所有策略的 is_default 清掉
    await supabase.from('wms_wave_strategies')
      .update({ is_default: false })
      .eq('warehouse_id', s.warehouse_id).eq('user_id', user!.id);
    // 再把当前这个设为默认
    await supabase.from('wms_wave_strategies').update({ is_default: true }).eq('id', s.id);
    qc.invalidateQueries();
  }

  async function del(s: any) {
    if (!confirm(`删除波次策略 "${s.name}"？`)) return;
    await supabase.from('wms_wave_strategies').delete().eq('id', s.id);
    qc.invalidateQueries();
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">波次策略</h2>
          <p className="text-sm text-gray-500 mt-1">
            定义发货单打包成波次的规则 · 5 种策略类型 · 设为默认后新建波次自动复用
          </p>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true); }}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 text-sm">
          <Plus className="w-4 h-4" /> 新建波次策略
        </button>
      </div>

      {/* 当前默认策略展示 */}
      {defaultStrategy ? (
        <div className="bg-gradient-to-r from-brand-50 to-amber-50 border border-brand-200 rounded-xl p-5 mb-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-brand-500 to-amber-500 text-white flex items-center justify-center">
            <Star className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <div className="text-xs text-brand-600 font-medium flex items-center gap-1">
              <Star className="w-3 h-3" /> 当前默认波次策略
            </div>
            <div className="text-lg font-bold text-gray-800">{defaultStrategy.name}</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {STRATEGY_TYPES.find(t => t.v === defaultStrategy.strategy_type)?.l}
              {' · '}最多 {defaultStrategy.max_orders} 单
              {defaultStrategy.max_weight_kg && ` · 限重 ${defaultStrategy.max_weight_kg}kg`}
              {defaultStrategy.max_volume_cm3 && ` · 限体积 ${defaultStrategy.max_volume_cm3}cm³`}
            </div>
          </div>
          <div className="text-xs text-gray-500 bg-white/50 rounded-lg px-3 py-2">
            <div>新建波次时</div>
            <div className="font-semibold text-brand-600">自动复用此策略</div>
          </div>
        </div>
      ) : (
        <div className="bg-gray-50 border border-dashed border-gray-300 rounded-xl p-5 mb-5 text-center">
          <div className="text-sm text-gray-500">暂无默认波次策略，请新建一个并设为默认</div>
        </div>
      )}

      {/* 所有策略 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-5 py-2.5 w-10"></th>
              <th className="text-left px-5 py-2.5">策略名称</th>
              <th className="text-left px-5 py-2.5">类型</th>
              <th className="text-left px-5 py-2.5">仓库</th>
              <th className="text-left px-5 py-2.5">参数配置</th>
              <th className="text-left px-5 py-2.5">默认</th>
              <th className="text-right px-5 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {(strategies as any[])?.map((s: any) => {
              const type = STRATEGY_TYPES.find(t => t.v === s.strategy_type);
              return (
                <tr key={s.id} className={`border-t border-gray-50 hover:bg-gray-50/50 ${s.is_default ? 'bg-amber-50/40' : ''}`}>
                  <td className="px-5 py-3">
                    {s.is_default && <Star className="w-4 h-4 text-amber-500" />}
                  </td>
                  <td className="px-5 py-3">
                    <div className="font-medium text-gray-800">{s.name}</div>
                    {s.remark && <div className="text-xs text-gray-400 mt-0.5">{s.remark}</div>}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${type?.color || 'bg-gray-100'}`}>
                      {type?.icon && <type.icon className="w-3 h-3" />}
                      {type?.l || s.strategy_type}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-600">
                    {(warehouses as any[])?.find((w: any) => w.id === s.warehouse_id)?.name || '-'}
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-600 space-y-0.5">
                    {s.max_orders > 0 && <div>最多 {s.max_orders} 单</div>}
                    {s.max_weight_kg > 0 && <div>限重 {s.max_weight_kg} kg</div>}
                    {s.max_volume_cm3 > 0 && <div>限体积 {s.max_volume_cm3?.toLocaleString()} cm³</div>}
                    {s.order_by && <div>排序：{s.order_by}</div>}
                    {s.carrier_filter && <div className="text-gray-500">承运商过滤：{s.carrier_filter}</div>}
                    {s.zone_filter && <div className="text-gray-500">库区过滤：{s.zone_filter}</div>}
                  </td>
                  <td className="px-5 py-3">
                    {s.is_default ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-600">
                        <CheckCircle className="w-3.5 h-3.5" /> 已设为默认
                      </span>
                    ) : (
                      <button onClick={() => setAsDefault(s)}
                        className="text-xs text-brand-500 hover:text-brand-600 underline">设为默认</button>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => { setEditing(s); setShowForm(true); }}
                        className="p-1 hover:bg-gray-100 rounded text-gray-500"><Pencil className="w-3.5 h-3.5" /></button>
                      {!s.is_default && (
                        <button onClick={() => del(s)}
                          className="p-1 hover:bg-red-50 rounded text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!strategies?.length && (
              <tr><td colSpan={7} className="p-10 text-center text-gray-400">
                {isLoading ? '加载中...' : '暂无波次策略，请新建一个'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Strategy types legend */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-5 gap-3">
        {STRATEGY_TYPES.map(t => (
          <div key={t.v} className="bg-white border border-gray-100 rounded-xl p-3">
            <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs mb-2 ${t.color}`}>
              <t.icon className="w-3 h-3" /> {t.l}
            </div>
            <div className="text-[11px] text-gray-500 leading-relaxed">{t.desc}</div>
          </div>
        ))}
      </div>

      {/* Modal: 新建 / 编辑 */}
      {showForm && (
        <WaveStrategyForm
          warehouses={warehouses!} initial={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['wms_wave_strategies'] }); }} />
      )}
    </div>
  );
}

// ========================================================
// Wave Strategy Form — 不同类型显示不同参数
// ========================================================

function WaveStrategyForm({ warehouses, initial, onClose, onSaved }: any) {
  const [f, setF] = useState<any>(initial || {
    warehouse_id: warehouses?.[0]?.id || '',
    name: '', strategy_type: 'auto',
    order_by: 'weight', max_orders: 50,
    max_weight_kg: 500, max_volume_cm3: 100000,
    zone_filter: '', carrier_filter: '',
    is_default: false, remark: '',
    status: 'active',
  });

  const strategy = STRATEGY_TYPES.find(t => t.v === f.strategy_type);

  async function save() {
    if (!f.name.trim()) return alert('请填写策略名称');
    const { data: { user } } = await supabase.auth.getUser();
    if (!initial) {
      // 新建设为默认时要先清理
      if (f.is_default) {
        await supabase.from('wms_wave_strategies')
          .update({ is_default: false })
          .eq('warehouse_id', f.warehouse_id).eq('user_id', user!.id);
      }
      const { error } = await supabase.from('wms_wave_strategies').insert({ ...f, user_id: user!.id });
      if (error) return alert(error.message);
    } else {
      if (f.is_default && !initial.is_default) {
        await supabase.from('wms_wave_strategies')
          .update({ is_default: false })
          .eq('warehouse_id', initial.warehouse_id).eq('user_id', user!.id);
      }
      const { error } = await supabase.from('wms_wave_strategies').update(f).eq('id', initial.id);
      if (error) return alert(error.message);
    }
    onSaved();
  }

  return (
    <Modal title={initial ? '编辑波次策略' : '新建波次策略'} onClose={onClose}>
      <div className="mb-3 p-3 bg-brand-50 border border-brand-200 rounded text-xs text-brand-700">
        <strong>{strategy?.l}</strong>：{strategy?.desc}
      </div>
      <Grid>
        <Field label="仓库 *">
          <select className="inp" value={f.warehouse_id} onChange={(e) => setF({ ...f, warehouse_id: e.target.value })}>
            {(warehouses as any[])?.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
        <Field label="策略名称 *"><input className="inp" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="例如：美国仓自动波次" /></Field>
        <Field label="策略类型">
          <select className="inp" value={f.strategy_type} onChange={(e) => setF({ ...f, strategy_type: e.target.value })}>
            {STRATEGY_TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
        </Field>
        <Field label="排序依据">
          <select className="inp" value={f.order_by} onChange={(e) => setF({ ...f, order_by: e.target.value })}>
            <option value="weight">按重量</option><option value="volume">按体积</option>
            <option value="qty">按件数</option><option value="carrier">按承运商</option>
            <option value="zone">按库区</option>
          </select>
        </Field>

        {/* 通用参数 */}
        <Field label="单波次最大订单数"><input className="inp" type="number" value={f.max_orders} onChange={(e) => setF({ ...f, max_orders: +e.target.value })} /></Field>
        <Field label="最大重量 (kg)"><input className="inp" type="number" step="0.01" value={f.max_weight_kg} onChange={(e) => setF({ ...f, max_weight_kg: +e.target.value })} /></Field>
        <Field label="最大体积 (cm³)">
          <input className="inp" type="number" value={f.max_volume_cm3} onChange={(e) => setF({ ...f, max_volume_cm3: +e.target.value })} />
        </Field>
        <Field label="承运商过滤">
          <input className="inp" value={f.carrier_filter} onChange={(e) => setF({ ...f, carrier_filter: e.target.value })} placeholder="例如：UPS,FEDEX" />
        </Field>
        <Field label="库区过滤 (zone_based)">
          <input className="inp" value={f.zone_filter} onChange={(e) => setF({ ...f, zone_filter: e.target.value })} placeholder="例如：A,B,C" />
        </Field>

        <Field label="状态">
          <select className="inp" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="active">启用</option><option value="inactive">停用</option>
          </select>
        </Field>
        <Field label="设为默认策略">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.is_default} onChange={(e) => setF({ ...f, is_default: e.target.checked })} />
            是（该仓库新建波次时自动复用）
          </label>
        </Field>
        <Field label="备注" full><textarea className="inp" rows={2} value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} /></Field>
      </Grid>
      <Footer onClose={onClose} onSave={save} />
    </Modal>
  );
}
