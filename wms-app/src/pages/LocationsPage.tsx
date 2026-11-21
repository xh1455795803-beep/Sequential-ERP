import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Modal, Grid, Field, Footer } from '../components/ui';

// zone type smallint
const ZONE_TYPE: Record<number, string> = {
  1: '收货区', 2: '存储区', 3: '拣货区', 4: '打包区', 5: '退货区',
};

export function LocationsPage() {
  const qc = useQueryClient();
  const [selectedWarehouse, setSelectedWarehouse] = useState<string | null>(null);
  const [editingZone, setEditingZone] = useState<any>(null);
  const [showZoneForm, setShowZoneForm] = useState(false);
  const [showLocForm, setShowLocForm] = useState(false);
  const [editingLoc, setEditingLoc] = useState<any>(null);

  const { data: warehouses } = useQuery({
    queryKey: ['wms_warehouses'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_warehouses').select('*').order('created_at');
      return data || [];
    },
  });

  const { data: zones } = useQuery({
    queryKey: ['wms_zones_all'],
    enabled: !!selectedWarehouse,
    queryFn: async () => {
      const { data } = await supabase.from('wms_zones').select('*').eq('warehouse_id', selectedWarehouse!).order('zone_code');
      return data || [];
    },
  });

  const { data: locations } = useQuery({
    queryKey: ['wms_bins_all'],
    enabled: !!selectedWarehouse,
    queryFn: async () => {
      const { data } = await supabase.from('wms_bins').select('*').eq('warehouse_id', selectedWarehouse!).order('bin_code');
      return data || [];
    },
  });

  async function generateLocations() {
    if (!selectedWarehouse) return;
    const zoneCode = prompt('要在哪个库区生成库位？（库区编码，如 A）');
    if (!zoneCode) return;
    const zone = (zones as any[])?.find((z: any) => z.zone_code === zoneCode);
    if (!zone) return alert(`库区 ${zoneCode} 不存在`);
    const count = parseInt(prompt('生成几个库位？', '10') || '10');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: acc } = await supabase.from('wms_accounts').select('tenant_id').eq('email', user.email).maybeSingle();
    const tenant_id = acc?.tenant_id;
    const wh = (warehouses as any[])?.find((w: any) => w.id === selectedWarehouse);
    const whCode = wh?.warehouse_code || '';

    const rows: any[] = [];
    for (let i = 1; i <= count; i++) {
      rows.push({
        tenant_id, warehouse_id: selectedWarehouse,
        zone_id: zone.id,
        bin_code: `${whCode}-${zoneCode}-${String(i).padStart(2, '0')}`,
        is_pickable: 1, walk_seq: i,
      });
    }
    const { error } = await supabase.from('wms_bins').insert(rows);
    if (error) alert(error.message);
    else qc.invalidateQueries();
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">库位管理</h2>
          <p className="text-sm text-muted-foreground mt-1">按仓库 / 库区 / 库位三级维护</p>
        </div>
        <select
          value={selectedWarehouse || ''}
          onChange={(e) => setSelectedWarehouse(e.target.value || null)}
          className="px-3 py-2 border border-border rounded-lg text-sm"
        >
          <option value="">选择仓库</option>
          {warehouses?.map((w: any) => <option key={w.id} value={w.id}>{w.warehouse_code} · {w.name}</option>)}
        </select>
      </div>

      {!selectedWarehouse && <div className="bg-card rounded-xl p-12 text-center text-muted-foreground border border-border">请先选择仓库</div>}

      {selectedWarehouse && (
        <>
          {/* 库区 */}
          <div className="bg-card rounded-xl shadow-soft border border-border p-5 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">库区</h3>
              <button onClick={() => { setEditingZone(null); setShowZoneForm(true); }}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-brand-500 text-white rounded-md hover:bg-brand-600">
                <Plus className="w-3 h-3" /> 新增库区
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {zones?.map((z: any) => (
                <span key={z.id} className="inline-flex items-center gap-1 px-3 py-1.5 bg-muted rounded-lg text-sm border border-border">
                  <b className="text-brand-600">{z.zone_code}</b> · {z.name} · <span className="text-xs text-muted-foreground">{ZONE_TYPE[z.type] || z.type}</span>
                  <button onClick={() => { setEditingZone(z); setShowZoneForm(true); }} className="ml-1 text-muted-foreground hover:text-muted-foreground"><Pencil className="w-3 h-3" /></button>
                </span>
              ))}
              {!zones?.length && <span className="text-sm text-muted-foreground py-2">暂无库区</span>}
            </div>
          </div>

          {/* 库位 */}
          <div className="bg-card rounded-xl shadow-soft border border-border overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold">库位 ({locations?.length || 0})</h3>
              <div className="flex gap-2">
                <button onClick={generateLocations} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-sea-500 text-white rounded-md hover:bg-sea-600">
                  <Plus className="w-3 h-3" /> 批量生成
                </button>
                <button onClick={() => { setEditingLoc(null); setShowLocForm(true); }}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs bg-brand-500 text-white rounded-md hover:bg-brand-600">
                  <Plus className="w-3 h-3" /> 单个新增
                </button>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground text-xs">
                <tr>
                  <th className="text-left px-5 py-2.5">库区</th>
                  <th className="text-left px-5 py-2.5">库位编码</th>
                  <th className="text-left px-5 py-2.5">可拣货</th>
                  <th className="text-right px-5 py-2.5">操作</th>
                </tr>
              </thead>
              <tbody>
                {locations?.slice(0, 200).map((l: any) => (
                  <tr key={l.id} className="border-t border-transparent hover:bg-muted/50">
                    <td className="px-5 py-2 font-mono text-xs text-brand-600">
                      {(zones as any[]).find((z: any) => z.id === l.zone_id)?.zone_code || '-'}
                    </td>
                    <td className="px-5 py-2 font-mono">{l.bin_code}</td>
                    <td className="px-5 py-2">
                      {l.is_pickable === 1
                        ? <span className="px-2 py-0.5 rounded text-xs bg-success-bg text-success">可拣</span>
                        : <span className="px-2 py-0.5 rounded text-xs bg-muted text-muted-foreground">不可拣</span>}
                    </td>
                    <td className="px-5 py-2 text-right">
                      <button onClick={async () => {
                        if (!confirm('删除？')) return;
                        await supabase.from('wms_bins').delete().eq('id', l.id);
                        qc.invalidateQueries();
                      }} className="p-1.5 hover:bg-danger-bg rounded text-destructive"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
                {(locations?.length || 0) > 200 && (
                  <tr><td colSpan={4} className="p-3 text-center text-muted-foreground text-xs">仅显示前 200 条</td></tr>
                )}
                {!locations?.length && <tr><td colSpan={4} className="p-10 text-center text-muted-foreground">暂无库位</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showZoneForm && <ZoneModal zones={zones!} warehouseId={selectedWarehouse!} initial={editingZone}
        onClose={() => setShowZoneForm(false)}
        onSaved={() => { setShowZoneForm(false); qc.invalidateQueries(); }} />}

      {showLocForm && <LocationModal zones={zones!} warehouseId={selectedWarehouse!} initial={editingLoc}
        onClose={() => setShowLocForm(false)}
        onSaved={() => { setShowLocForm(false); qc.invalidateQueries(); }} />}
    </div>
  );
}

function ZoneModal({ zones, warehouseId, initial, onClose, onSaved }: any) {
  const [f, setF] = useState(initial || { zone_code: '', name: '', type: 2 });
  async function save() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return alert('请先登录');
    const { data: acc } = await supabase.from('wms_accounts').select('tenant_id').eq('email', user.email).maybeSingle();
    const tenant_id = acc?.tenant_id;
    if (!tenant_id) return alert('账户未绑定租户');

    if (!initial) {
      const { error } = await supabase.from('wms_zones').insert({
        tenant_id, warehouse_id: warehouseId,
        zone_code: f.zone_code, name: f.name, type: +f.type,
      });
      if (error) return alert(error.message);
    } else {
      const { error } = await supabase.from('wms_zones').update({
        zone_code: f.zone_code, name: f.name, type: +f.type,
      }).eq('id', initial.id);
      if (error) return alert(error.message);
    }
    onSaved();
  }
  return (
    <Modal title={initial ? '编辑库区' : '新增库区'} onClose={onClose}>
      <Grid>
        <Field label="编码 *"><input className="inp" value={f.zone_code} onChange={(e) => setF({ ...f, zone_code: e.target.value })} placeholder="A / B / C" /></Field>
        <Field label="名称 *"><input className="inp" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="类型">
          <select className="inp" value={f.type} onChange={(e) => setF({ ...f, type: +e.target.value })}>
            <option value={1}>收货区</option><option value={2}>存储区</option>
            <option value={3}>拣货区</option><option value={4}>打包区</option><option value={5}>退货区</option>
          </select>
        </Field>
      </Grid>
      <Footer onClose={onClose} onSave={save} />
    </Modal>
  );
}

function LocationModal({ zones, warehouseId, initial, onClose, onSaved }: any) {
  const [f, setF] = useState(initial || { zone_id: zones?.[0]?.id || '', bin_code: '', is_pickable: 1 });
  async function save() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return alert('请先登录');
    const { data: acc } = await supabase.from('wms_accounts').select('tenant_id').eq('email', user.email).maybeSingle();
    const tenant_id = acc?.tenant_id;
    if (!tenant_id) return alert('账户未绑定租户');

    if (!initial) {
      const { error } = await supabase.from('wms_bins').insert({
        tenant_id, warehouse_id: warehouseId,
        zone_id: f.zone_id, bin_code: f.bin_code, is_pickable: +f.is_pickable,
      });
      if (error) return alert(error.message);
    } else {
      const { error } = await supabase.from('wms_bins').update({
        zone_id: f.zone_id, bin_code: f.bin_code, is_pickable: +f.is_pickable,
      }).eq('id', initial.id);
      if (error) return alert(error.message);
    }
    onSaved();
  }
  return (
    <Modal title={initial ? '编辑库位' : '新增库位'} onClose={onClose}>
      <Grid>
        <Field label="库区 *">
          <select className="inp" value={f.zone_id} onChange={(e) => setF({ ...f, zone_id: e.target.value })}>
            {zones?.map((z: any) => <option key={z.id} value={z.id}>{z.zone_code} · {z.name}</option>)}
          </select>
        </Field>
        <Field label="库位编码 *"><input className="inp" value={f.bin_code} onChange={(e) => setF({ ...f, bin_code: e.target.value })} placeholder="WH-GZ-A-01-01" /></Field>
        <Field label="可拣货">
          <select className="inp" value={f.is_pickable} onChange={(e) => setF({ ...f, is_pickable: +e.target.value })}>
            <option value={1}>可拣</option><option value={0}>不可拣</option>
          </select>
        </Field>
      </Grid>
      <Footer onClose={onClose} onSave={save} />
    </Modal>
  );
}
