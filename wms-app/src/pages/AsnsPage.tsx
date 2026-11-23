import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Plus, ArrowLeft, PackageCheck, Calendar, Clock, CheckCircle2, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Modal, Grid, Field, Footer } from './LocationsPage';

// -------- 列表页 --------
export function AsnsPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');

  const { data: warehouses } = useQuery({
    queryKey: ['wms_warehouses'],
    queryFn: async () => { const { data } = await supabase.from('wms_warehouses').select('*'); return data || []; },
  });

  const { data: asns } = useQuery({
    queryKey: ['wms_asns', statusFilter],
    queryFn: async () => {
      let q = supabase.from('wms_asns').select('*').order('created_at', { ascending: false });
      if (statusFilter) q = q.eq('status', statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  const statusLabel: any = {
    draft: '草稿', submitted: '已提交', in_transit: '在途', arrived: '已到港',
    receiving: '收货中', putaway: '上架中', completed: '已完成', cancelled: '已取消',
  };

  const tabs = [
    { v: '', l: '全部' }, { v: 'draft', l: '草稿' }, { v: 'submitted', l: '已提交' },
    { v: 'receiving', l: '收货中' }, { v: 'putaway', l: '上架中' }, { v: 'completed', l: '已完成' },
  ];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">入库管理</h2>
          <p className="text-sm text-gray-500 mt-1">ASN → 入库预约 → 收货 → 上架</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 text-sm">
          <Plus className="w-4 h-4" /> 新建 ASN
        </button>
      </div>

      {/* 状态 Tab 过滤 */}
      <div className="flex items-center gap-2 mb-4 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.v} onClick={() => setStatusFilter(t.v)}
            className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors
              ${statusFilter === t.v ? 'bg-brand-500 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-brand-300'}`}>
            {t.l}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-5 py-2.5">ASN 单号</th>
              <th className="text-left px-5 py-2.5">仓库</th>
              <th className="text-right px-5 py-2.5">SKU 数</th>
              <th className="text-right px-5 py-2.5">到货量</th>
              <th className="text-left px-5 py-2.5">预约状态</th>
              <th className="text-left px-5 py-2.5">状态</th>
              <th className="text-right px-5 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {asns?.map((a: any) => (
              <tr key={a.id} onClick={() => nav({ to: `/asns/$id`, params: { id: a.id } })}
                className="border-t border-gray-50 hover:bg-brand-50/30 cursor-pointer">
                <td className="px-5 py-3 font-mono text-brand-600">{a.asn_no}</td>
                <td className="px-5 py-3">{(warehouses as any[])?.find(w => w.id === a.warehouse_id)?.name || '-'}</td>
                <td className="px-5 py-3 text-right">{a.total_items || 0}</td>
                <td className="px-5 py-3 text-right">{a.received_qty || 0}/{a.total_qty || 0}</td>
                <td className="px-5 py-3">
                  {appointmentBadge(a)}
                </td>
                <td className="px-5 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs ${asnStatusBadge(a.status)}`}>{statusLabel[a.status] || a.status}</span>
                </td>
                <td className="px-5 py-3 text-right text-brand-500 text-xs">点击查看 →</td>
              </tr>
            ))}
            {!asns?.length && <tr><td colSpan={7} className="p-10 text-center text-gray-400">暂无 ASN，点击右上角新建</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && <AsnForm warehouses={warehouses!} onClose={() => setShowForm(false)}
        onSaved={(id) => { setShowForm(false); qc.invalidateQueries({ queryKey: ['wms_asns'] }); nav({ to: `/asns/$id`, params: { id } }); }} />}
    </div>
  );
}

// 预约状态徽章
function appointmentBadge(a: any) {
  if (a.appointment_confirmed) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-green-50 text-green-600">
        <CheckCircle2 className="w-3 h-3" /> 已确认 · {a.appointment_date} {a.appointment_slot}
      </span>
    );
  }
  if (a.appointment_date) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-amber-50 text-amber-600">
        <Calendar className="w-3 h-3" /> 已预约 · {a.appointment_date} {a.appointment_slot}
      </span>
    );
  }
  return <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-400">未预约</span>;
}

function asnStatusBadge(s: string) {
  const m: any = {
    draft: 'bg-gray-100 text-gray-500', submitted: 'bg-blue-50 text-blue-600',
    in_transit: 'bg-amber-50 text-amber-600', arrived: 'bg-amber-50 text-amber-700',
    receiving: 'bg-amber-50 text-amber-600', putaway: 'bg-purple-50 text-purple-600',
    completed: 'bg-green-50 text-green-600', cancelled: 'bg-gray-100 text-gray-400',
  };
  return m[s] || 'bg-gray-100 text-gray-500';
}

// 新建 ASN 表单
function AsnForm({ warehouses, onClose, onSaved }: any) {
  const [f, setF] = useState({
    warehouse_id: warehouses?.[0]?.id || '',
    asn_no: 'ASN' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + Math.floor(Math.random() * 9000 + 1000),
    expected_date: '', po_no: '', supplier_id: '', tracking_no: '', remark: '',
  });
  const [items, setItems] = useState<any[]>([{ sku: '', sku_name: '', expected_qty: 1, unit_cost: 0, barcode: '' }]);

  async function save() {
    if (!f.warehouse_id) return alert('请选择仓库');
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('wms_asns').insert({
      ...f, user_id: user!.id,
      total_items: items.length,
      total_qty: items.reduce((s, i) => s + (+i.expected_qty || 0), 0),
    }).select().single();
    if (error) return alert(error.message);

    const itemRows = items.map((i) => ({
      ...i, asn_id: data.id, user_id: user!.id,
      expected_qty: +i.expected_qty || 0, unit_cost: +i.unit_cost || 0,
    }));
    const { error: ie } = await supabase.from('wms_asn_items').insert(itemRows);
    if (ie) return alert('明细保存失败：' + ie.message);
    onSaved(data.id);
  }

  return (
    <Modal title="新建 ASN 入库通知" onClose={onClose}>
      <Grid>
        <Field label="仓库 *">
          <select className="inp" value={f.warehouse_id} onChange={(e) => setF({ ...f, warehouse_id: e.target.value })}>
            {warehouses?.map((w: any) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>
        </Field>
        <Field label="ASN 单号 *"><input className="inp" value={f.asn_no} onChange={(e) => setF({ ...f, asn_no: e.target.value })} /></Field>
        <Field label="预计到货日期"><input className="inp" type="date" value={f.expected_date} onChange={(e) => setF({ ...f, expected_date: e.target.value })} /></Field>
        <Field label="关联 PO 单号"><input className="inp" value={f.po_no} onChange={(e) => setF({ ...f, po_no: e.target.value })} /></Field>
        <Field label="跟踪号" full><input className="inp" value={f.tracking_no} onChange={(e) => setF({ ...f, tracking_no: e.target.value })} /></Field>
        <Field label="备注" full><textarea className="inp" rows={2} value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} /></Field>
      </Grid>

      <div className="mt-5 border-t pt-4">
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium text-sm">ASN 明细</span>
          <button onClick={() => setItems([...items, { sku: '', sku_name: '', expected_qty: 1, unit_cost: 0, barcode: '' }])}
            className="text-xs text-brand-500 hover:text-brand-600">+ 添加一行</button>
        </div>
        <table className="w-full text-xs">
          <thead className="text-gray-400">
            <tr>
              <th className="text-left py-1">SKU *</th>
              <th className="text-left py-1">名称</th>
              <th className="text-left py-1">条码</th>
              <th className="text-right py-1">数量</th>
              <th className="text-right py-1">单价</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx}>
                <td className="py-1"><input className="inp" value={it.sku} onChange={(e) => updateItem(idx, 'sku', e.target.value)} /></td>
                <td className="py-1"><input className="inp" value={it.sku_name} onChange={(e) => updateItem(idx, 'sku_name', e.target.value)} /></td>
                <td className="py-1"><input className="inp" value={it.barcode} onChange={(e) => updateItem(idx, 'barcode', e.target.value)} /></td>
                <td className="py-1 w-20"><input className="inp text-right" type="number" value={it.expected_qty} onChange={(e) => updateItem(idx, 'expected_qty', +e.target.value)} /></td>
                <td className="py-1 w-20"><input className="inp text-right" type="number" step="0.01" value={it.unit_cost} onChange={(e) => updateItem(idx, 'unit_cost', +e.target.value)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Footer onClose={onClose} onSave={save} />
    </Modal>
  );

  function updateItem(idx: number, key: string, val: any) {
    setItems(items.map((it, i) => (i === idx ? { ...it, [key]: val } : it)));
  }
}

// -------- 详情页（收货 + 上架 + 入库预约 + 🧠智能上架建议） --------
export function AsnDetailPage() {
  const params = useParams({ strict: false }) as any;
  const id = params?.id;
  const nav = useNavigate();
  const qc = useQueryClient();

  const { data: asn } = useQuery({
    queryKey: ['asn', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from('wms_asns').select('*').eq('id', id).single();
      return data;
    },
  });

  const { data: items } = useQuery({
    queryKey: ['asn_items', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from('wms_asn_items').select('*').eq('asn_id', id);
      return data || [];
    },
  });

  const { data: locations } = useQuery({
    queryKey: ['wms_locations_simple'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_locations').select('id,code,warehouse_id,status').eq('status', 'empty');
      return data || [];
    },
  });

  const [receivedMap, setReceivedMap] = useState<Record<string, number>>({});
  const [putawayMap, setPutawayMap] = useState<Record<string, any>>({});
  const [suggestions, setSuggestions] = useState<Record<string, any[]>>({});
  const [suggestLoading, setSuggestLoading] = useState(false);

  // 预约信息本地状态
  const [apptDate, setApptDate] = useState('');
  const [apptSlot, setApptSlot] = useState('AM');
  const [apptConfirmed, setApptConfirmed] = useState(false);
  const [savingAppt, setSavingAppt] = useState(false);

  // ASN 加载后同步预约字段
  useEffect(() => {
    if (asn) {
      setApptDate(asn.appointment_date || '');
      setApptSlot(asn.appointment_slot || 'AM');
      setApptConfirmed(!!asn.appointment_confirmed);
    }
  }, [asn?.id]);

  useEffect(() => {
    if (!asn?.warehouse_id || !items?.length || asn.status !== 'putaway') return;
    fetchSuggestions();
  }, [asn?.warehouse_id, items?.length, asn?.status]);

  async function fetchSuggestions() {
    if (!asn?.warehouse_id || !items?.length) return;
    setSuggestLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) { setSuggestLoading(false); return; }

    const results: Record<string, any[]> = {};
    for (const it of items) {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wms-putaway-suggest`,
          {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              warehouse_id: asn.warehouse_id,
              sku: it.sku,
              expected_qty: it.expected_qty,
            }),
          }
        );
        const json = await res.json();
        if (json.success && json.suggestions?.length) {
          results[it.id] = json.suggestions;
          if (!putawayMap[it.id]) {
            setPutawayMap(prev => ({
              ...prev,
              [it.id]: { location_id: json.suggestions[0].location_id, qty: it.expected_qty - (it.putaway_qty || 0) },
            }));
          }
        }
      } catch { /* Edge Function 未部署静默失败 */ }
    }
    setSuggestions(results);
    setSuggestLoading(false);
  }

  // 保存预约信息
  async function saveAppointment() {
    if (!asn) return;
    setSavingAppt(true);
    const { error } = await supabase.from('wms_asns').update({
      appointment_date: apptDate || null,
      appointment_slot: apptDate ? apptSlot : null,
      appointment_confirmed: apptConfirmed,
    }).eq('id', id);
    setSavingAppt(false);
    if (error) return alert('保存预约失败：' + error.message);
    qc.invalidateQueries({ queryKey: ['asn', id, 'wms_asns'] });
    alert('预约信息已保存');
  }

  async function receiveAll() {
    const { data: { user } } = await supabase.auth.getUser();
    let received = 0;
    for (const it of items!) {
      const inc = receivedMap[it.id] ?? (it.expected_qty - (it.received_qty || 0));
      if (inc <= 0) continue;
      await supabase.from('wms_asn_items').update({ received_qty: (it.received_qty || 0) + inc }).eq('id', it.id);
      received += inc;
    }
    await supabase.from('wms_asns').update({
      status: 'putaway',
      received_date: new Date().toISOString().slice(0, 10),
      received_qty: (asn?.received_qty || 0) + received,
      operator: user?.email,
    }).eq('id', id);
    qc.invalidateQueries();
  }

  async function putawayAll() {
    const { data: { user } } = await supabase.auth.getUser();
    let putawayCount = 0;
    const invRows: any[] = [];
    const logRows: any[] = [];

    for (const it of items!) {
      const target = putawayMap[it.id];
      if (!target || !target.location_id || !target.qty) continue;
      const loc = (locations as any[])?.find(l => l.id === target.location_id);

      invRows.push({
        user_id: user!.id, warehouse_id: asn.warehouse_id, location_id: target.location_id,
        product_id: it.product_id, sku: it.sku, qty_on_hand: target.qty,
      });
      logRows.push({
        user_id: user!.id, warehouse_id: asn.warehouse_id, product_id: it.product_id,
        sku: it.sku, location_id: target.location_id,
        qty_change: target.qty, qty_after: target.qty, type: 'inbound_putaway',
        ref_type: 'asn', ref_id: id, operator: user?.email, remark: `ASN ${asn.asn_no} 上架至 ${loc?.code}`,
      });
      await supabase.from('wms_asn_items').update({ putaway_qty: (it.putaway_qty || 0) + target.qty }).eq('id', it.id);
      await supabase.from('wms_putaway_tasks').insert({
        user_id: user!.id, asn_id: id, asn_item_id: it.id,
        product_id: it.product_id, sku: it.sku, qty: target.qty,
        target_location_id: target.location_id, status: 'done', operator: user?.email, done_at: new Date().toISOString(),
      });
      await supabase.from('wms_locations').update({ status: 'occupied' }).eq('id', target.location_id);

      putawayCount += target.qty;
    }

    for (const row of invRows) {
      await supabase.from('wms_inventory').upsert(
        { ...row, location_id: row.location_id, qty_on_hand: row.qty_on_hand },
        { onConflict: 'warehouse_id,location_id,sku,batch_no', ignoreDuplicates: false }
      );
    }

    await supabase.from('wms_inventory_logs').insert(logRows);
    await supabase.from('wms_asns').update({
      status: 'completed',
      putaway_qty: (asn?.putaway_qty || 0) + putawayCount,
    }).eq('id', id);
    qc.invalidateQueries();
    alert(`上架完成：${putawayCount} 件`);
  }

  if (!asn) return <div className="p-8 text-center text-gray-400">加载中...</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <button onClick={() => nav({ to: '/asns' })} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <ArrowLeft className="w-4 h-4" /> 返回 ASN 列表
      </button>

      {/* 主信息卡片 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-4">
        <div className="flex items-center gap-3 mb-4">
          <PackageCheck className="w-6 h-6 text-brand-500" />
          <div>
            <div className="text-lg font-bold">{asn.asn_no}</div>
            <div className="text-xs text-gray-500">状态：<span className={asnStatusBadge(asn.status)}>{asn.status}</span> · 仓库 {asn.warehouse_id}</div>
          </div>
          <div className="ml-auto flex gap-2">
            {(asn.status === 'submitted' || asn.status === 'in_transit' || asn.status === 'arrived') && (
              <button onClick={receiveAll} className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm hover:bg-amber-600">
                一键到货并收货
              </button>
            )}
            {asn.status === 'putaway' && (
              <button onClick={putawayAll} className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600">
                确认上架
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-4 text-sm">
          <Info label="SKU 种类" value={asn.total_items} />
          <Info label="预期到货量" value={asn.total_qty} />
          <Info label="已收货" value={`${asn.received_qty || 0}/${asn.total_qty || 0}`} />
          <Info label="已上架" value={`${asn.putaway_qty || 0}/${asn.total_qty || 0}`} />
        </div>
      </div>

      {/* 🆕 预约信息区 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="w-5 h-5 text-brand-500" />
          <div className="font-semibold">入库预约</div>
          {asn.appointment_confirmed && (
            <span className="ml-auto px-2 py-0.5 rounded text-xs bg-green-50 text-green-600 inline-flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> 已确认
            </span>
          )}
          {!asn.appointment_date && (
            <span className="ml-auto px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-400">未预约</span>
          )}
        </div>
        <div className="grid grid-cols-4 gap-4 items-end">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">预约日期</label>
            <input
              type="date"
              className="inp"
              value={apptDate}
              onChange={(e) => setApptDate(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">时间段</label>
            <div className="flex items-center gap-1">
              <select className="inp" value={apptSlot} onChange={(e) => setApptSlot(e.target.value)} disabled={!apptDate}>
                <option value="AM">上午 (09:00-12:00)</option>
                <option value="PM">下午 (14:00-17:00)</option>
              </select>
              <Clock className="w-4 h-4 text-gray-400" />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-2 block">&nbsp;</label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={apptConfirmed}
                onChange={(e) => setApptConfirmed(e.target.checked)}
                disabled={!apptDate}
                className="w-4 h-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
              />
              <span className="text-sm">确认为正式预约</span>
            </label>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-2 block">&nbsp;</label>
            <button
              onClick={saveAppointment}
              disabled={savingAppt}
              className="w-full px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600 disabled:opacity-50 flex items-center justify-center gap-1"
            >
              {savingAppt && <Loader2 className="w-3 h-3 animate-spin" />}
              保存预约
            </button>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-gray-50 text-xs text-gray-400">
          预约后仓库将按排期收货，确认后不可随意修改。收货时请向仓库提供预约号。
        </div>
      </div>

      {/* ASN 明细 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 font-medium flex items-center justify-between">
          <span>ASN 明细</span>
          {asn.status === 'putaway' && (
            <button onClick={fetchSuggestions} disabled={suggestLoading}
              className="text-xs flex items-center gap-1 px-3 py-1.5 bg-gradient-to-r from-brand-500 to-amber-500 text-white rounded-lg hover:opacity-90 disabled:opacity-50">
              {suggestLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : '✨'}
              智能建议库位
            </button>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-4 py-2">SKU</th>
              <th className="text-left px-4 py-2">名称</th>
              <th className="text-right px-4 py-2">预期</th>
              <th className="text-right px-4 py-2">已收</th>
              <th className="text-right px-4 py-2">已上</th>
              <th className="text-left px-4 py-2">推荐库位</th>
              <th className="text-left px-4 py-2">上架库位</th>
              <th className="text-right px-4 py-2">数量</th>
            </tr>
          </thead>
          <tbody>
            {items?.map((it: any) => {
              const suggs = suggestions[it.id] || [];
              return (
                <tr key={it.id} className="border-t border-gray-50">
                  <td className="px-4 py-2 font-mono text-xs">{it.sku}</td>
                  <td className="px-4 py-2">{it.sku_name}</td>
                  <td className="px-4 py-2 text-right">{it.expected_qty}</td>
                  <td className="px-4 py-2 text-right text-amber-600">{it.received_qty || 0}</td>
                  <td className="px-4 py-2 text-right text-green-600">{it.putaway_qty || 0}</td>
                  <td className="px-4 py-2">
                    {suggests.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        {suggests.slice(0, 3).map((s: any, idx: number) => (
                          <button
                            key={s.location_id}
                            onClick={() => setPutawayMap(prev => ({
                              ...prev,
                              [it.id]: { ...(prev[it.id] || {}), location_id: s.location_id },
                            }))}
                            title={s.reason}
                            className={`text-xs px-2 py-0.5 rounded text-left border transition-colors
                              ${idx === 0 ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-600 hover:border-brand-300'}
                              ${putawayMap[it.id]?.location_id === s.location_id ? 'ring-2 ring-brand-500' : ''}`}
                          >
                            <span className="font-mono font-semibold">{s.code}</span>
                            <span className="text-gray-400 ml-1">({s.zone_code})</span>
                            <span className="text-[10px] text-brand-500 ml-1">★{Math.round(s.score)}</span>
                          </button>
                        ))}
                      </div>
                    ) : suggestLoading ? (
                      <span className="text-xs text-gray-400">加载中...</span>
                    ) : (
                      <span className="text-xs text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <select
                      className="inp text-xs py-1 px-2"
                      value={putawayMap[it.id]?.location_id || ''}
                      onChange={(e) => setPutawayMap({ ...putawayMap, [it.id]: { ...(putawayMap[it.id] || {}), location_id: e.target.value } })}
                      disabled={asn.status === 'completed'}
                    >
                      <option value="">选择库位</option>
                      {(locations as any[])?.filter(l => l.warehouse_id === asn.warehouse_id).map((l: any) =>
                        <option key={l.id} value={l.id}>{l.code}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-2 text-right w-20">
                    <input type="number" min="0"
                      className="inp text-right text-xs py-1 px-2"
                      value={putawayMap[it.id]?.qty || ''}
                      placeholder={String(it.expected_qty - (it.putaway_qty || 0))}
                      onChange={(e) => setPutawayMap({ ...putawayMap, [it.id]: { ...(putawayMap[it.id] || {}), qty: +e.target.value } })}
                      disabled={asn.status === 'completed'}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <style>{`.inp{width:100%;padding:6px 8px;border:1px solid #e5e7eb;border-radius:6px;outline:none;background:#fff;font-size:12px}.inp:focus{border-color:#f97316}`}</style>
    </div>
  );
}

function Info({ label, value }: any) {
  return (
    <div>
      <div className="text-xs text-gray-400">{label}</div>
      <div className="font-medium text-gray-800 mt-0.5">{value}</div>
    </div>
  );
}
