import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Modal, Grid, Field, Footer } from '../components/ui';

type Zone = any;
type Location = any;

export function LocationsPage() {
  const qc = useQueryClient();
  const [selectedWarehouse, setSelectedWarehouse] = useState<string | null>(null);
  const [editingZone, setEditingZone] = useState<Zone | null>(null);
  const [showZoneForm, setShowZoneForm] = useState(false);
  const [showLocForm, setShowLocForm] = useState(false);
  const [editingLoc, setEditingLoc] = useState<Location | null>(null);

  const { data: warehouses } = useQuery({
    queryKey: ['wms_warehouses'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_warehouses').select('*').order('created_at');
      return data || [];
    },
  });

  const { data: zones } = useQuery({
    queryKey: ['wms_zones', selectedWarehouse],
    enabled: !!selectedWarehouse,
    queryFn: async () => {
      const { data } = await supabase.from('wms_zones').select('*').eq('warehouse_id', selectedWarehouse!).order('code');
      return data || [];
    },
  });

  const { data: locations } = useQuery({
    queryKey: ['wms_bins', selectedWarehouse],
    enabled: !!selectedWarehouse,
    queryFn: async () => {
      const { data } = await supabase.from('wms_bins').select('*').eq('warehouse_id', selectedWarehouse!).order('code');
      return data || [];
    },
  });

  async function generateLocations() {
    if (!selectedWarehouse) return;
    const zoneCode = prompt('要在哪个库区生成库位？（库区编码，如 A）');
    if (!zoneCode) return;
    const zone = zones?.find((z: Zone) => z.code === zoneCode);
    if (!zone) return alert('库区不存在');
    const aisleCount = parseInt(prompt('通道数量：', '3') || '3');
    const rackCount = parseInt(prompt('每通道货架数：', '5') || '5');
    const levelCount = parseInt(prompt('每层位数量：', '4') || '4');
    const { data: { user } } = await supabase.auth.getUser();
    const rows: any[] = [];
    for (let a = 1; a <= aisleCount; a++)
      for (let r = 1; r <= rackCount; r++)
        for (let l = 1; l <= levelCount; l++) {
          rows.push({
            user_id: user!.id, warehouse_id: selectedWarehouse, zone_id: zone.id,
            code: `${zone.code}-${String(a).padStart(2, '0')}-${String(r).padStart(2, '0')}-${String(l).padStart(2, '0')}`,
            aisle: String(a), rack: String(r), level: String(Math.floor((l - 1) / 4) + 1), position: String(l),
          });
        }
    const { error } = await supabase.from('wms_bins').insert(rows);
    if (error) alert(error.message);
    else qc.invalidateQueries({ queryKey: ['wms_bins'] });
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">库位管理</h2>
          <p className="text-sm text-gray-500 mt-1">按仓库 / 库区 / 库位三级维护</p>
        </div>
        <select
          value={selectedWarehouse || ''}
          onChange={(e) => setSelectedWarehouse(e.target.value || null)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
        >
          <option value="">选择仓库</option>
          {warehouses?.map((w: any) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
        </select>
      </div>

      {!selectedWarehouse && <div className="bg-white rounded-xl p-12 text-center text-gray-400 border border-gray-100">请先选择仓库</div>}

      {selectedWarehouse && (
        <>
          {/* 库区 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">库区</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => { setEditingZone(null); setShowZoneForm(true); }}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs bg-brand-500 text-white rounded-md hover:bg-brand-600"
                ><Plus className="w-3 h-3" /> 新增库区</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {zones?.map((z: Zone) => (
                <span key={z.id} className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-50 rounded-lg text-sm border border-gray-100">
                  <b className="text-brand-600">{z.code}</b> · {z.name} · <span className="text-xs text-gray-400">{z.type}</span>
                  <button onClick={() => { setEditingZone(z); setShowZoneForm(true); }} className="ml-1 text-gray-400 hover:text-gray-600"><Pencil className="w-3 h-3" /></button>
                </span>
              ))}
              {!zones?.length && <span className="text-sm text-gray-400 py-2">暂无库区</span>}
            </div>
          </div>

          {/* 库位 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold">库位 ({locations?.length || 0})</h3>
              <div className="flex gap-2">
                <button onClick={generateLocations} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-sea-500 text-white rounded-md hover:bg-sea-600">
                  <Plus className="w-3 h-3" /> 批量生成
                </button>
                <button
                  onClick={() => { setEditingLoc(null); setShowLocForm(true); }}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs bg-brand-500 text-white rounded-md hover:bg-brand-600"
                ><Plus className="w-3 h-3" /> 单个新增</button>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs">
                <tr>
                  <th className="text-left px-5 py-2.5">库区</th>
                  <th className="text-left px-5 py-2.5">库位编码</th>
                  <th className="text-left px-5 py-2.5">通/架/层/位</th>
                  <th className="text-left px-5 py-2.5">状态</th>
                  <th className="text-right px-5 py-2.5">操作</th>
                </tr>
              </thead>
              <tbody>
                {locations?.slice(0, 100).map((l: Location) => (
                  <tr key={l.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                    <td className="px-5 py-2 font-mono text-xs text-brand-600">{(zones as Zone[]).find(z => z.id === l.zone_id)?.code || '-'}</td>
                    <td className="px-5 py-2 font-mono">{l.code}</td>
                    <td className="px-5 py-2 text-gray-500">{l.aisle}/{l.rack}/{l.level}/{l.position}</td>
                    <td className="px-5 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${({
                        empty: 'bg-green-50 text-green-600',
                        occupied: 'bg-red-50 text-red-600',
                        partial: 'bg-amber-50 text-amber-600',
                        disabled: 'bg-gray-100 text-gray-400',
                      } as any)[l.status] || 'bg-gray-100'}`}>
                        {({ empty: '空', occupied: '占用', partial: '部分', disabled: '停用' } as any)[l.status] || l.status}
                      </span>
                    </td>
                    <td className="px-5 py-2 text-right">
                      <button onClick={async () => { if (confirm('删除？')) { await supabase.from('wms_bins').delete().eq('id', l.id); qc.invalidateQueries({ queryKey: ['wms_bins'] }); } }}
                        className="p-1.5 hover:bg-red-50 rounded text-red-500"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
                {(locations?.length || 0) > 100 && (
                  <tr><td colSpan={5} className="p-3 text-center text-gray-400 text-xs">仅显示前 100 条，共 {locations?.length} 个库位</td></tr>
                )}
                {!locations?.length && <tr><td colSpan={5} className="p-10 text-center text-gray-400">暂无库位，请先新增库区或批量生成</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showZoneForm && <ZoneModal zones={zones!} warehouseId={selectedWarehouse!} initial={editingZone}
        onClose={() => setShowZoneForm(false)}
        onSaved={() => { setShowZoneForm(false); qc.invalidateQueries({ queryKey: ['wms_zones', 'wms_bins'] }); }} />}

      {showLocForm && <LocationModal zones={zones!} warehouseId={selectedWarehouse!} initial={editingLoc}
        onClose={() => setShowLocForm(false)}
        onSaved={() => { setShowLocForm(false); qc.invalidateQueries({ queryKey: ['wms_bins'] }); }} />}
    </div>
  );
}

function ZoneModal({ zones, warehouseId, initial, onClose, onSaved }: any) {
  const [f, setF] = useState(initial || { code: '', name: '', type: 'storage', remark: '' });
  async function save() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!initial) {
      const { error } = await supabase.from('wms_zones').insert({ ...f, warehouse_id: warehouseId, user_id: user!.id });
      if (error) return alert(error.message);
    } else {
      const { error } = await supabase.from('wms_zones').update(f).eq('id', initial.id);
      if (error) return alert(error.message);
    }
    onSaved();
  }
  return (
    <Modal title={initial ? '编辑库区' : '新增库区'} onClose={onClose}>
      <Grid>
        <Field label="编码 *"><input className="inp" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field label="名称 *"><input className="inp" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="类型">
          <select className="inp" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            <option value="receiving">收货区</option><option value="storage">存储区</option>
            <option value="picking">拣货区</option><option value="shipping">发货区</option><option value="quarantine">待检区</option>
          </select>
        </Field>
        <Field label="备注" full><textarea className="inp" rows={2} value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} /></Field>
      </Grid>
      <Footer onClose={onClose} onSave={save} />
    </Modal>
  );
}

function LocationModal({ zones, warehouseId, initial, onClose, onSaved }: any) {
  const [f, setF] = useState(initial || { zone_id: zones?.[0]?.id || '', code: '', remark: '' });
  async function save() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!initial) {
      const { error } = await supabase.from('wms_bins').insert({ ...f, warehouse_id: warehouseId, user_id: user!.id });
      if (error) return alert(error.message);
    } else {
      const { error } = await supabase.from('wms_bins').update(f).eq('id', initial.id);
      if (error) return alert(error.message);
    }
    onSaved();
  }
  return (
    <Modal title={initial ? '编辑库位' : '新增库位'} onClose={onClose}>
      <Grid>
        <Field label="库区 *">
          <select className="inp" value={f.zone_id} onChange={(e) => setF({ ...f, zone_id: e.target.value })}>
            {zones?.map((z: Zone) => <option key={z.id} value={z.id}>{z.code} · {z.name}</option>)}
          </select>
        </Field>
        <Field label="库位编码 *"><input className="inp" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="A-01-02-03" /></Field>
        <Field label="备注" full><textarea className="inp" rows={2} value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} /></Field>
      </Grid>
      <Footer onClose={onClose} onSave={save} />
    </Modal>
  );
}


