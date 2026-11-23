import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Plus, Waves, Settings, Play, ArrowRight, Package, Filter, Zap } from 'lucide-react';
import { useState, useMemo } from 'react';
import { Modal, Grid, Field, Footer } from './LocationsPage';

// 波次管理页（新建波次 + 策略选择 + 执行波次）
export function WavesPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: warehouses } = useQuery({
    queryKey: ['wms_warehouses'],
    queryFn: async () => { const { data } = await supabase.from('wms_warehouses').select('*'); return data || []; },
  });

  // 波次策略（新建：auto 或 manual）
  const { data: strategies } = useQuery({
    queryKey: ['wms_wave_strategies'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_wave_strategies').select('*').order('is_default', { ascending: false });
      return data || [];
    },
  });

  // 波次列表
  const { data: waves } = useQuery({
    queryKey: ['wms_wave_tasks'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_wave_tasks').select('*').order('created_at', { ascending: false });
      return data || [];
    },
  });

  const statusLabel: any = {
    draft: '草稿', released: '已释放', processing: '处理中',
    picking: '拣货中', completed: '已完成', cancelled: '已取消',
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Waves className="w-7 h-7 text-brand-500" /> 波次管理
          </h2>
          <p className="text-sm text-gray-500 mt-1">按策略批量合并发货单 → 优化拣货路径 → 释放波次任务</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 text-sm">
          <Plus className="w-4 h-4" /> 新建波次
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {/* 快捷统计 */}
        <div className="col-span-3 grid grid-cols-4 gap-4">
          <Stat label="今日波次" value={waves?.length || 0} color="text-brand-600" />
          <Stat label="执行中" value={waves?.filter((w: any) => w.status === 'picking' || w.status === 'processing').length || 0} color="text-amber-600" />
          <Stat label="已完成" value={waves?.filter((w: any) => w.status === 'completed').length || 0} color="text-green-600" />
          <Stat label="可用策略" value={strategies?.length || 0} color="text-blue-600" />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-5 py-2.5">波次号</th>
              <th className="text-left px-5 py-2.5">策略 / 仓库</th>
              <th className="text-right px-5 py-2.5">发货单</th>
              <th className="text-right px-5 py-2.5">SKU / 件数</th>
              <th className="text-left px-5 py-2.5">状态</th>
              <th className="text-right px-5 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {(waves || []).map((w: any) => (
              <tr key={w.id} className="border-t border-gray-50 hover:bg-brand-50/30">
                <td className="px-5 py-3 font-mono text-brand-600">{w.wave_no}</td>
                <td className="px-5 py-3">
                  <div>{w.strategy_name || '手动策略'}</div>
                  <div className="text-xs text-gray-400">{w.warehouse_id}</div>
                </td>
                <td className="px-5 py-3 text-right">{w.total_shipments || 0}</td>
                <td className="px-5 py-3 text-right">{w.total_skus || 0} / {w.total_qty || 0}</td>
                <td className="px-5 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs ${waveStatusBadge(w.status)}`}>{statusLabel[w.status] || w.status}</span>
                </td>
                <td className="px-5 py-3 text-right">
                  {w.status === 'draft' && (
                    <button
                      onClick={async () => {
                        await supabase.from('wms_wave_tasks').update({ status: 'released', released_at: new Date().toISOString() }).eq('id', w.id);
                        qc.invalidateQueries();
                      }}
                      className="text-brand-500 hover:text-brand-600 text-xs flex items-center gap-0.5 justify-end">
                      <Play className="w-3 h-3" /> 释放
                    </button>
                  )}
                  {w.status === 'released' && (
                    <button
                      onClick={async () => {
                        await supabase.from('wms_wave_tasks').update({ status: 'picking' }).eq('id', w.id);
                        qc.invalidateQueries();
                      }}
                      className="text-sea-500 hover:text-sea-600 text-xs flex items-center gap-0.5 justify-end">
                      <Zap className="w-3 h-3" /> 开始拣货
                    </button>
                  )}
                  {(w.status === 'picking' || w.status === 'processing') && (
                    <button
                      onClick={async () => {
                        await supabase.from('wms_wave_tasks').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', w.id);
                        qc.invalidateQueries();
                      }}
                      className="text-green-500 hover:text-green-600 text-xs flex items-center gap-0.5 justify-end">
                      <ArrowRight className="w-3 h-3" /> 标记完成
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!waves?.length && <tr><td colSpan={6} className="p-10 text-center text-gray-400">暂无波次，点击右上角新建</td></tr>}
          </tbody>
        </table>
      </div>

      {/* 🆕 策略管理 */}
      <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 font-medium flex items-center gap-1.5">
          <Settings className="w-4 h-4 text-gray-500" /> 波次策略
          <span className="text-xs text-gray-400 ml-2">（新建波次时将自动应用）</span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-4 py-2">策略名</th>
              <th className="text-left px-4 py-2">类型</th>
              <th className="text-right px-4 py-2">最大订单</th>
              <th className="text-right px-4 py-2">最大重量 kg</th>
              <th className="text-right px-4 py-2">最大体积 cm³</th>
              <th className="text-left px-4 py-2">库区过滤</th>
              <th className="text-left px-4 py-2">承运商过滤</th>
              <th className="text-center px-4 py-2">默认</th>
            </tr>
          </thead>
          <tbody>
            {(strategies || []).map((s: any) => (
              <tr key={s.id} className="border-t border-gray-50">
                <td className="px-4 py-2 font-medium">{s.name}</td>
                <td className="px-4 py-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${s.strategy_type === 'auto' ? 'bg-brand-50 text-brand-600' : 'bg-gray-100 text-gray-600'}`}>
                    {s.strategy_type === 'auto' ? '自动' : '手动'}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">{s.max_orders}</td>
                <td className="px-4 py-2 text-right">{s.max_weight_kg}</td>
                <td className="px-4 py-2 text-right">{s.max_volume_cm3}</td>
                <td className="px-4 py-2 text-xs">{s.zone_filter || '-'}</td>
                <td className="px-4 py-2 text-xs">{s.carrier_filter || '-'}</td>
                <td className="px-4 py-2 text-center">{s.is_default ? '⭐' : ''}</td>
              </tr>
            ))}
            {!strategies?.length && <tr><td colSpan={8} className="p-6 text-center text-gray-400 text-sm">暂无策略，新建波次时自动创建</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && <WaveForm
        warehouses={warehouses!}
        strategies={strategies!}
        onClose={() => setShowForm(false)}
        onSaved={() => { setShowForm(false); qc.invalidateQueries(); }} />}
    </div>
  );
}

function Stat({ label, value, color }: any) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
    </div>
  );
}

function waveStatusBadge(s: string) {
  const m: any = {
    draft: 'bg-gray-100 text-gray-500', released: 'bg-blue-50 text-blue-600',
    processing: 'bg-amber-50 text-amber-600', picking: 'bg-sea-50 text-sea-600',
    completed: 'bg-green-50 text-green-600', cancelled: 'bg-gray-100 text-gray-400',
  };
  return m[s] || 'bg-gray-100';
}

// 新建波次弹窗（策略下拉 + 自动填充）
function WaveForm({ warehouses, strategies, onClose, onSaved }: any) {
  const qc = useQueryClient();

  // 默认策略：先找 auto 类型
  const autoStrategies = (strategies || []).filter((s: any) => s.strategy_type === 'auto');
  const defaultAuto = (autoStrategies.find((s: any) => s.is_default) || autoStrategies[0])?.id || '';

  const [f, setF] = useState<any>({
    warehouse_id: warehouses?.[0]?.id || '',
    wave_no: 'WV' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + Math.floor(Math.random() * 900 + 100),
    strategy_id: defaultAuto,
    // 自动策略字段
    max_orders: 50,
    max_weight_kg: 500,
    max_volume_cm3: 100000,
    zone_filter: '',
    carrier_filter: '',
  });

  const selectedStrategy = useMemo(
    () => (strategies as any[])?.find((s: any) => s.id === f.strategy_id),
    [f.strategy_id, strategies]
  );

  // 策略变化时自动填充字段
  function applyStrategy(strategyId: string) {
    const s = (strategies as any[])?.find((x: any) => x.id === strategyId);
    if (s && s.strategy_type === 'auto') {
      setF((prev: any) => ({
        ...prev,
        strategy_id: strategyId,
        max_orders: s.max_orders ?? prev.max_orders,
        max_weight_kg: s.max_weight_kg ?? prev.max_weight_kg,
        max_volume_cm3: s.max_volume_cm3 ?? prev.max_volume_cm3,
        zone_filter: s.zone_filter ?? '',
        carrier_filter: s.carrier_filter ?? '',
      }));
    } else {
      // manual 策略：清空自动字段，用户手动填
      setF((prev: any) => ({
        ...prev,
        strategy_id: strategyId,
      }));
    }
  }

  // 🆕 预览：策略匹配到的 shipment 数量
  const { data: matchedShipments } = useQuery({
    queryKey: ['matched_shipments', f.warehouse_id, f.max_orders, f.max_weight_kg, f.max_volume_cm3, f.zone_filter, f.carrier_filter, selectedStrategy],
    enabled: !!f.warehouse_id,
    queryFn: async () => {
      // 取 released + 该仓库的发货单
      let q = supabase.from('wms_shipments').select('*')
        .eq('warehouse_id', f.warehouse_id)
        .eq('status', 'released');

      if (f.carrier_filter) q = q.eq('carrier_id', f.carrier_filter);

      const { data } = await q;
      if (!data) return [];

      // 按策略条件在应用层过滤（避免复杂 RLS + DB 计算）
      let filtered = data;
      if (selectedStrategy?.strategy_type === 'auto') {
        if (f.carrier_filter) filtered = filtered.filter((s: any) => s.carrier_id === f.carrier_filter);
        filtered = filtered.slice(0, f.max_orders);
      }
      return filtered;
    },
  });

  async function save() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!f.warehouse_id) return alert('请选择仓库');

    // 1. 创建波次
    const { data, error } = await supabase.from('wms_wave_tasks').insert({
      user_id: user!.id,
      wave_no: f.wave_no,
      warehouse_id: f.warehouse_id,
      strategy_id: f.strategy_id || null,
      strategy_name: selectedStrategy?.name || '手动创建',
      total_shipments: matchedShipments?.length || 0,
      status: 'draft',
      remark: selectedStrategy?.remark || '',
    }).select().single();

    if (error) return alert('创建波次失败：' + error.message);

    // 2. 写入 wave_items
    const itemRows = (matchedShipments || []).map((s: any) => ({
      user_id: user!.id,
      wave_id: data.id,
      shipment_id: s.id,
      shipment_no: s.shipment_no,
      total_items: s.total_items || 0,
      total_qty: s.total_qty || 0,
    }));

    if (itemRows.length) {
      const { error: ie } = await supabase.from('wms_wave_items').insert(itemRows);
      if (ie) return alert('明细保存失败：' + ie.message);
    }

    qc.invalidateQueries();
    alert(`波次已创建，包含 ${itemRows.length} 个发货单`);
    onSaved();
  }

  return (
    <Modal title="新建波次" onClose={onClose}>
      <Grid>
        <Field label="仓库 *">
          <select className="inp" value={f.warehouse_id} onChange={(e) => setF({ ...f, warehouse_id: e.target.value })}>
            {warehouses?.map((w: any) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>
        </Field>
        <Field label="波次号 *"><input className="inp" value={f.wave_no} onChange={(e) => setF({ ...f, wave_no: e.target.value })} /></Field>
      </Grid>

      <div className="mt-4 border-t pt-4">
        <div className="text-sm font-medium mb-2 flex items-center gap-1">
          <Settings className="w-4 h-4 text-brand-500" /> 选择波次策略
        </div>
        <select
          className="inp mb-3"
          value={f.strategy_id}
          onChange={(e) => applyStrategy(e.target.value)}
        >
          <option value="">手动创建（无策略）</option>
          {(strategies || []).map((s: any) => (
            <option key={s.id} value={s.id}>
              {s.name} — {s.strategy_type === 'auto' ? '自动' : '手动'}
              {s.is_default ? ' (默认)' : ''}
            </option>
          ))}
        </select>

        {selectedStrategy?.strategy_type === 'auto' && (
          <>
            <div className="text-xs text-gray-500 mb-2 bg-brand-50 p-2 rounded flex items-center gap-1">
              <Filter className="w-3 h-3" /> 该策略为自动策略，以下参数已自动填充，可微调
            </div>
            <Grid>
              <Field label="最大订单数">
                <input type="number" className="inp" value={f.max_orders} onChange={(e) => setF({ ...f, max_orders: +e.target.value })} />
              </Field>
              <Field label="最大重量 kg">
                <input type="number" className="inp" step="0.01" value={f.max_weight_kg} onChange={(e) => setF({ ...f, max_weight_kg: +e.target.value })} />
              </Field>
              <Field label="最大体积 cm³">
                <input type="number" className="inp" value={f.max_volume_cm3} onChange={(e) => setF({ ...f, max_volume_cm3: +e.target.value })} />
              </Field>
              <Field label="库区过滤">
                <input className="inp" value={f.zone_filter} onChange={(e) => setF({ ...f, zone_filter: e.target.value })} placeholder="如 A,B（逗号分隔）" />
              </Field>
              <Field label="承运商过滤">
                <input className="inp" value={f.carrier_filter} onChange={(e) => setF({ ...f, carrier_filter: e.target.value })} placeholder="carrier_id" />
              </Field>
            </Grid>
          </>
        )}

        {(!selectedStrategy || selectedStrategy.strategy_type === 'manual') && (
          <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded">
            手动策略将由你自己选择发货单（不自动按条件筛选）
          </div>
        )}
      </div>

      {/* 预览 */}
      <div className="mt-4 border-t pt-3">
        <div className="text-xs text-gray-500 mb-2 flex items-center gap-1">
          <Package className="w-3 h-3" /> 策略匹配预览（{matchedShipments?.length || 0} 个发货单）
        </div>
        <div className="max-h-40 overflow-y-auto border border-gray-100 rounded">
          {(matchedShipments || []).slice(0, 10).map((s: any) => (
            <div key={s.id} className="px-3 py-1.5 flex justify-between text-xs border-b border-gray-50">
              <span className="font-mono">{s.shipment_no}</span>
              <span>{s.total_items || 0} SKU / {s.total_qty || 0} 件</span>
            </div>
          ))}
          {!matchedShipments?.length && <div className="px-3 py-2 text-gray-400 text-xs">暂无匹配的已释放发货单</div>}
          {(matchedShipments?.length || 0) > 10 && <div className="px-3 py-1 text-xs text-gray-400">+ {(matchedShipments.length - 10)} 更多...</div>}
        </div>
      </div>

      <Footer onClose={onClose} onSave={save} saveLabel="创建波次" />
    </Modal>
  );
}
