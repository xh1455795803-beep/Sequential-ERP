import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Plus, ScanLine, CheckCircle, PackageCheck, Send, FileDown, Printer, Search } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Modal, Grid, Field, Footer } from './LocationsPage';

// ========================================================
// FBA 退货换标 — Tab1 退货入库 / Tab2 换标出库
// ========================================================

const RETURN_STATUSES = ['pending', 'received', 'inspected', 'restocked', 'disposed', 'completed'];
const RETURN_STATUS_LABEL: any = {
  pending: '待入库', received: '已收货', inspected: '已质检',
  restocked: '已良品回库', disposed: '已报废', completed: '已完成',
};
const RELABEL_STATUSES = ['pending', 'labeling', 'packing', 'shipped', 'completed'];
const RELABEL_STATUS_LABEL: any = {
  pending: '待处理', labeling: '标签生成中', packing: '打包中',
  shipped: '已发货', completed: '已完成',
};

export function FbaReturnsPage() {
  const [tab, setTab] = useState<'returns' | 'relabels'>('returns');
  const [retStatus, setRetStatus] = useState<string>('all');
  const [relStatus, setRelStatus] = useState<string>('all');
  const [showRetForm, setShowRetForm] = useState(false);
  const [showRelForm, setShowRelForm] = useState(false);
  const [scanReturn, setScanReturn] = useState<any>(null);
  const [qcReturn, setQcReturn] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">FBA 退货换标</h2>
          <p className="text-sm text-gray-500 mt-1">领星 WMS v5 · Amazon 退货入库 → 质检 → 换标 → 出库</p>
        </div>
        <div className="flex gap-2">
          {tab === 'returns' && (
            <button onClick={() => setShowRetForm(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 text-sm">
              <Plus className="w-4 h-4" /> 新建退货单
            </button>
          )}
          {tab === 'relabels' && (
            <button onClick={() => setShowRelForm(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 text-sm">
              <Plus className="w-4 h-4" /> 新建换标单
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-4">
        {[
          { k: 'returns', label: '退货入库', icon: PackageCheck },
          { k: 'relabels', label: '换标出库', icon: Send },
        ].map(t => (
          <button key={t.k} onClick={() => setTab(t.k as any)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-1.5 transition-colors ${
              tab === t.k ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'returns' ? (
        <ReturnsList statusFilter={retStatus} setStatusFilter={setRetStatus}
          onScan={setScanReturn} onQc={setQcReturn} onDetail={setDetail} />
      ) : (
        <RelabelsList statusFilter={relStatus} setStatusFilter={setRelStatus} onDetail={setDetail} />
      )}

      {/* ---------- Modals ---------- */}
      {showRetForm && <ReturnForm onClose={() => setShowRetForm(false)} />}
      {showRelForm && <RelabelForm onClose={() => setShowRelForm(false)} />}
      {scanReturn && <ScanReturnModal fbaReturn={scanReturn} onClose={() => setScanReturn(null)} />}
      {qcReturn && <QcReturnModal fbaReturn={qcReturn} onClose={() => setQcReturn(null)} />}
      {detail && <FbaReturnDetail fbaReturn={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

// ========================================================
// Tab 1: Returns List
// ========================================================

function ReturnsList({ statusFilter, setStatusFilter, onScan, onQc, onDetail }: any) {
  const qc = useQueryClient();
  const { data: warehouses } = useQuery({
    queryKey: ['wms_warehouses'],
    queryFn: async () => { const { data } = await supabase.from('wms_warehouses').select('*'); return data || []; },
  });
  const { data: returns, isLoading } = useQuery({
    queryKey: ['wms_fba_returns', statusFilter],
    queryFn: async () => {
      const { data } = await supabase.from('wms_fba_returns').select('*')
        .eq('user_id', (await supabase.auth.getUser()).data.user?.id)
        .order('created_at', { ascending: false });
      if (statusFilter === 'all') return data || [];
      return (data || []).filter((r: any) => r.status === statusFilter);
    },
  });

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Status filter */}
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500 mr-1">状态：</span>
        {['all', ...RETURN_STATUSES].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1 rounded-full text-xs transition ${
              statusFilter === s ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {s === 'all' ? '全部' : RETURN_STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 text-xs">
          <tr>
            <th className="text-left px-5 py-2.5">退货单号</th>
            <th className="text-left px-5 py-2.5">仓库</th>
            <th className="text-left px-5 py-2.5">订单 / Amazon ID</th>
            <th className="text-right px-5 py-2.5">总数 / 良品 / 不良</th>
            <th className="text-left px-5 py-2.5">原因</th>
            <th className="text-left px-5 py-2.5">状态</th>
            <th className="text-right px-5 py-2.5">操作</th>
          </tr>
        </thead>
        <tbody>
          {returns?.map((r: any) => (
            <tr key={r.id} className="border-t border-gray-50 hover:bg-gray-50/50">
              <td className="px-5 py-3 font-mono text-brand-600">{r.fba_return_no}</td>
              <td className="px-5 py-3">{(warehouses as any[])?.find((w: any) => w.id === r.warehouse_id)?.name || '-'}</td>
              <td className="px-5 py-3">
                <div className="text-xs">{r.order_id || '-'}</div>
                {r.amazon_return_id && <div className="text-[10px] text-gray-400">{r.amazon_return_id}</div>}
              </td>
              <td className="px-5 py-3 text-right tabular-nums">
                <span className="font-medium">{r.qty_total || 0}</span>
                <span className="text-gray-400 mx-1">/</span>
                <span className="text-green-600">{r.qty_good || 0}</span>
                <span className="text-gray-400 mx-1">/</span>
                <span className="text-red-500">{r.qty_bad || 0}</span>
              </td>
              <td className="px-5 py-3 text-gray-600 text-xs max-w-[160px] truncate">{r.reason || '-'}</td>
              <td className="px-5 py-3">
                <span className={`px-2 py-0.5 rounded text-xs ${returnBadge(r.status)}`}>{RETURN_STATUS_LABEL[r.status] || r.status}</span>
              </td>
              <td className="px-5 py-3 text-right">
                <div className="flex justify-end gap-1">
                  {(r.status === 'pending' || r.status === 'received') && (
                    <button onClick={() => onScan(r)}
                      className="px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100 flex items-center gap-1">
                      <ScanLine className="w-3 h-3" /> 扫码入库
                    </button>
                  )}
                  {r.status === 'received' && (
                    <button onClick={() => onQc(r)}
                      className="px-2 py-1 text-xs bg-amber-50 text-amber-600 rounded hover:bg-amber-100 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> 质检
                    </button>
                  )}
                  <button onClick={() => onDetail(r)}
                    className="px-2 py-1 text-xs bg-gray-50 text-gray-600 rounded hover:bg-gray-100">详情</button>
                </div>
              </td>
            </tr>
          ))}
          {!returns?.length && <tr><td colSpan={7} className="p-10 text-center text-gray-400">{isLoading ? '加载中...' : '暂无退货单'}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ========================================================
// Tab 2: Relabels List
// ========================================================

function RelabelsList({ statusFilter, setStatusFilter, onDetail }: any) {
  const { data: warehouses } = useQuery({
    queryKey: ['wms_warehouses'],
    queryFn: async () => { const { data } = await supabase.from('wms_warehouses').select('*'); return data || []; },
  });
  const { data: relabels } = useQuery({
    queryKey: ['wms_fba_relabels', statusFilter],
    queryFn: async () => {
      const { data } = await supabase.from('wms_fba_relabels').select('*')
        .eq('user_id', (await supabase.auth.getUser()).data.user?.id)
        .order('created_at', { ascending: false });
      if (statusFilter === 'all') return data || [];
      return (data || []).filter((r: any) => r.status === statusFilter);
    },
  });

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500 mr-1">状态：</span>
        {['all', ...RELABEL_STATUSES].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1 rounded-full text-xs transition ${
              statusFilter === s ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {s === 'all' ? '全部' : RELABEL_STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 text-xs">
          <tr>
            <th className="text-left px-5 py-2.5">换标单号</th>
            <th className="text-left px-5 py-2.5">仓库</th>
            <th className="text-right px-5 py-2.5">SKU / 数量</th>
            <th className="text-left px-5 py-2.5">追踪号</th>
            <th className="text-left px-5 py-2.5">状态</th>
            <th className="text-right px-5 py-2.5">操作</th>
          </tr>
        </thead>
        <tbody>
          {relabels?.map((r: any) => (
            <tr key={r.id} className="border-t border-gray-50 hover:bg-gray-50/50">
              <td className="px-5 py-3 font-mono text-brand-600">{r.relabel_no}</td>
              <td className="px-5 py-3">{(warehouses as any[])?.find((w: any) => w.id === r.warehouse_id)?.name || '-'}</td>
              <td className="px-5 py-3 text-right">{r.total_skus || 0} / {r.total_qty || 0}</td>
              <td className="px-5 py-3 font-mono text-xs text-gray-600">{r.tracking_no || '-'}</td>
              <td className="px-5 py-3">
                <span className={`px-2 py-0.5 rounded text-xs ${relabelBadge(r.status)}`}>{RELABEL_STATUS_LABEL[r.status] || r.status}</span>
              </td>
              <td className="px-5 py-3 text-right">
                <div className="flex justify-end gap-1">
                  {r.status === 'pending' && (
                    <button onClick={() => generateLabels(r)}
                      className="px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100 flex items-center gap-1">
                      <Printer className="w-3 h-3" /> 生成标签
                    </button>
                  )}
                  {r.status === 'labeling' && (
                    <button onClick={() => shipRelabel(r)}
                      className="px-2 py-1 text-xs bg-green-50 text-green-600 rounded hover:bg-green-100 flex items-center gap-1">
                      <Send className="w-3 h-3" /> 标记发货
                    </button>
                  )}
                  <button onClick={() => onDetail(r)}
                    className="px-2 py-1 text-xs bg-gray-50 text-gray-600 rounded hover:bg-gray-100">详情</button>
                </div>
              </td>
            </tr>
          ))}
          {!relabels?.length && <tr><td colSpan={6} className="p-10 text-center text-gray-400">暂无换标单</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ========================================================
// Actions (shared by tabs)
// ========================================================

async function generateLabels(r: any) {
  const { data: { user } } = await supabase.auth.getUser();
  const items = await supabase.from('wms_fba_relabel_items').select('*').eq('relabel_id', r.id);
  // 模拟标签生成 — 实际应调外部 API / Edge Function
  await supabase.from('wms_fba_relabel_items').update({ label_status: 'generated' }).eq('relabel_id', r.id);
  await supabase.from('wms_fba_relabels').update({ status: 'labeling' }).eq('id', r.id);
  alert(`已为 ${items.data?.length || 0} 个 SKU 生成换标标签 (relabel_no=${r.relabel_no})`);
}

async function shipRelabel(r: any) {
  const tracking = prompt('输入最终追踪号', r.tracking_no || '');
  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from('wms_fba_relabels').update({
    status: 'shipped',
    tracking_no: tracking || r.tracking_no,
    shipped_at: new Date().toISOString(),
  }).eq('id', r.id);
  alert('已标记发货');
}

// ========================================================
// Form: New FBA Return
// ========================================================

function ReturnForm({ onClose }: any) {
  const qc = useQueryClient();
  const { data: warehouses } = useQuery({
    queryKey: ['wms_warehouses'],
    queryFn: async () => { const { data } = await supabase.from('wms_warehouses').select('*'); return data || []; },
  });
  const [f, setF] = useState<any>({
    warehouse_id: '', fba_return_no: 'FBR' + Date.now().toString().slice(-8),
    order_id: '', amazon_return_id: '', reason: 'customer_return', remark: '',
  });
  const [items, setItems] = useState<any[]>([{ sku: '', sku_name: '', amazon_asin: '', qty_expected: 1 }]);

  async function save() {
    if (!f.warehouse_id) return alert('请选择仓库');
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('wms_fba_returns').insert({
      ...f, user_id: user!.id, status: 'pending',
      qty_total: items.reduce((s, i) => s + (+i.qty_expected || 0), 0),
    }).select().single();
    if (error) return alert(error.message);
    const rows = items.map(i => ({
      ...i, fba_return_id: data.id, user_id: user!.id, qty_expected: +i.qty_expected || 0,
    }));
    const { error: ie } = await supabase.from('wms_fba_return_items').insert(rows);
    if (ie) return alert(ie.message);
    qc.invalidateQueries({ queryKey: ['wms_fba_returns'] });
    alert(`已创建 FBA 退货单 ${data.fba_return_no}，下一步请扫码入库`);
    onClose();
  }

  return (
    <Modal title="新建 FBA 退货入库单" onClose={onClose}>
      <Grid>
        <Field label="仓库 *">
          <select className="inp" value={f.warehouse_id} onChange={(e) => setF({ ...f, warehouse_id: e.target.value })}>
            <option value="">请选择</option>
            {(warehouses as any[])?.map((w: any) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>
        </Field>
        <Field label="退货单号"><input className="inp" value={f.fba_return_no} onChange={(e) => setF({ ...f, fba_return_no: e.target.value })} /></Field>
        <Field label="订单号"><input className="inp" value={f.order_id} onChange={(e) => setF({ ...f, order_id: e.target.value })} /></Field>
        <Field label="Amazon Return ID"><input className="inp" value={f.amazon_return_id} onChange={(e) => setF({ ...f, amazon_return_id: e.target.value })} /></Field>
        <Field label="原因">
          <select className="inp" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>
            <option value="customer_return">买家退货</option>
            <option value="damaged">运输损坏</option>
            <option value="defect">产品缺陷</option>
            <option value="wrong_item">发错货</option>
            <option value="other">其他</option>
          </select>
        </Field>
        <Field label="备注" full><textarea className="inp" rows={2} value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} /></Field>
      </Grid>
      <div className="mt-5 border-t pt-4">
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium text-sm">退货明细</span>
          <button onClick={() => setItems([...items, { sku: '', sku_name: '', amazon_asin: '', qty_expected: 1 }])}
            className="text-xs text-brand-500">+ 添加 SKU</button>
        </div>
        <table className="w-full text-xs">
          <thead className="text-gray-400"><tr>
            <th className="text-left py-1">SKU</th><th className="text-left py-1">名称</th>
            <th className="text-left py-1">ASIN</th><th className="text-right py-1">预期数量</th>
          </tr></thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx}>
                <td className="py-1"><input className="inp" value={it.sku} onChange={(e) => u(idx, 'sku', e.target.value)} /></td>
                <td className="py-1"><input className="inp" value={it.sku_name} onChange={(e) => u(idx, 'sku_name', e.target.value)} /></td>
                <td className="py-1"><input className="inp" value={it.amazon_asin} onChange={(e) => u(idx, 'amazon_asin', e.target.value)} /></td>
                <td className="py-1 w-24"><input className="inp text-right" type="number" value={it.qty_expected} onChange={(e) => u(idx, 'qty_expected', +e.target.value)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Footer onClose={onClose} onSave={save} />
    </Modal>
  );

  function u(idx: number, k: string, v: any) {
    setItems(items.map((it, i) => i === idx ? { ...it, [k]: v } : it));
  }
}

// ========================================================
// Form: New FBA Relabel
// ========================================================

function RelabelForm({ onClose }: any) {
  const qc = useQueryClient();
  const { data: warehouses } = useQuery({
    queryKey: ['wms_warehouses'],
    queryFn: async () => { const { data } = await supabase.from('wms_warehouses').select('*'); return data || []; },
  });
  const { data: carriers } = useQuery({
    queryKey: ['wms_carriers'],
    queryFn: async () => { const { data } = await supabase.from('wms_carriers').select('*'); return data || []; },
  });
  const [f, setF] = useState<any>({
    warehouse_id: '', relabel_no: 'FBRL' + Date.now().toString().slice(-8),
    carrier_id: '', tracking_no: '', remark: '',
  });
  const [items, setItems] = useState<any[]>([{ sku: '', new_sku: '', amazon_asin: '', qty: 1 }]);

  async function save() {
    if (!f.warehouse_id) return alert('请选择仓库');
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('wms_fba_relabels').insert({
      ...f, user_id: user!.id, status: 'pending',
      total_skus: items.length,
      total_qty: items.reduce((s, i) => s + (+i.qty || 0), 0),
    }).select().single();
    if (error) return alert(error.message);
    const rows = items.map(i => ({
      ...i, relabel_id: data.id, user_id: user!.id, qty: +i.qty || 0,
    }));
    const { error: ie } = await supabase.from('wms_fba_relabel_items').insert(rows);
    if (ie) return alert(ie.message);
    qc.invalidateQueries({ queryKey: ['wms_fba_relabels'] });
    alert(`已创建换标单 ${data.relabel_no}`);
    onClose();
  }

  return (
    <Modal title="新建 FBA 换标出库单" onClose={onClose}>
      <Grid>
        <Field label="仓库 *">
          <select className="inp" value={f.warehouse_id} onChange={(e) => setF({ ...f, warehouse_id: e.target.value })}>
            <option value="">请选择</option>
            {(warehouses as any[])?.map((w: any) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>
        </Field>
        <Field label="换标单号"><input className="inp" value={f.relabel_no} onChange={(e) => setF({ ...f, relabel_no: e.target.value })} /></Field>
        <Field label="承运商">
          <select className="inp" value={f.carrier_id} onChange={(e) => setF({ ...f, carrier_id: e.target.value })}>
            <option value="">请选择</option>
            {(carriers as any[])?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="追踪号"><input className="inp" value={f.tracking_no} onChange={(e) => setF({ ...f, tracking_no: e.target.value })} /></Field>
        <Field label="备注" full><textarea className="inp" rows={2} value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} /></Field>
      </Grid>
      <div className="mt-5 border-t pt-4">
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium text-sm">换标明细</span>
          <button onClick={() => setItems([...items, { sku: '', new_sku: '', amazon_asin: '', qty: 1 }])}
            className="text-xs text-brand-500">+ 添加 SKU</button>
        </div>
        <table className="w-full text-xs">
          <thead className="text-gray-400"><tr>
            <th className="text-left py-1">原 SKU</th><th className="text-left py-1">新 SKU</th>
            <th className="text-left py-1">ASIN</th><th className="text-right py-1">数量</th>
          </tr></thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx}>
                <td className="py-1"><input className="inp" value={it.sku} onChange={(e) => u(idx, 'sku', e.target.value)} /></td>
                <td className="py-1"><input className="inp" value={it.new_sku} onChange={(e) => u(idx, 'new_sku', e.target.value)} /></td>
                <td className="py-1"><input className="inp" value={it.amazon_asin} onChange={(e) => u(idx, 'amazon_asin', e.target.value)} /></td>
                <td className="py-1 w-24"><input className="inp text-right" type="number" value={it.qty} onChange={(e) => u(idx, 'qty', +e.target.value)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Footer onClose={onClose} onSave={save} />
    </Modal>
  );

  function u(idx: number, k: string, v: any) {
    setItems(items.map((it, i) => i === idx ? { ...it, [k]: v } : it));
  }
}

// ========================================================
// Scan Return Modal — 扫码入库
// ========================================================

function ScanReturnModal({ fbaReturn, onClose }: any) {
  const qc = useQueryClient();
  const { data: items } = useQuery({
    queryKey: ['fba_return_items', fbaReturn.id],
    queryFn: async () => {
      const { data } = await supabase.from('wms_fba_return_items').select('*')
        .eq('fba_return_id', fbaReturn.id);
      return data || [];
    },
  });
  const [scanSku, setScanSku] = useState('');

  async function scanItem() {
    if (!scanSku.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    // 找第一个匹配且未完全收货的 item
    const target = (items as any[])?.find((it: any) => it.sku.toLowerCase() === scanSku.trim().toLowerCase() && (it.qty_received || 0) < (it.qty_expected || 0));
    if (!target) {
      // 如果找不到匹配 item，自动新建一条
      await supabase.from('wms_fba_return_items').insert({
        fba_return_id: fbaReturn.id, user_id: user!.id,
        sku: scanSku.trim(), sku_name: scanSku.trim(), qty_expected: 1, qty_received: 1,
      });
    } else {
      const newQty = (target.qty_received || 0) + 1;
      await supabase.from('wms_fba_return_items').update({ qty_received: newQty }).eq('id', target.id);
    }
    setScanSku('');
    qc.invalidateQueries({ queryKey: ['fba_return_items', fbaReturn.id] });
    qc.invalidateQueries({ queryKey: ['wms_fba_returns'] });
  }

  async function finish() {
    const totalReceived = (items as any[]).reduce((s: number, it: any) => s + (it.qty_received || 0), 0);
    await supabase.from('wms_fba_returns').update({
      status: 'received',
      qty_total: totalReceived,
      received_at: new Date().toISOString(),
    }).eq('id', fbaReturn.id);
    qc.invalidateQueries({ queryKey: ['wms_fba_returns'] });
    alert(`收货完成，共 ${totalReceived} 件`);
    onClose();
  }

  return (
    <Modal title={`扫码入库 — ${fbaReturn.fba_return_no}`} onClose={onClose}>
      <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700">
        <strong>扫码：</strong>扫描或输入 SKU，自动 +1。未在预期列表中的 SKU 会自动创建新条目。
      </div>
      <div className="flex gap-2 mb-4">
        <input className="inp flex-1" autoFocus placeholder="扫描 SKU 后回车"
          value={scanSku} onChange={(e) => setScanSku(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && scanItem()} />
        <button onClick={scanItem} className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm">+1</button>
      </div>
      <div className="max-h-64 overflow-auto border border-gray-100 rounded divide-y">
        {(items as any[])?.map((it: any) => {
          const done = (it.qty_received || 0) >= (it.qty_expected || 0);
          return (
            <div key={it.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <div>
                <span className="font-mono font-medium">{it.sku}</span>
                {done && <CheckCircle className="inline-block w-3.5 h-3.5 text-green-500 ml-1" />}
              </div>
              <div className="text-xs text-gray-500 tabular-nums">
                {it.qty_received || 0} / {it.qty_expected || 0}
              </div>
            </div>
          );
        })}
      </div>
      <Footer onClose={onClose} onSave={finish} />
    </Modal>
  );
}

// ========================================================
// QC Return Modal — 质检 + 良品自动回 wms_inventory
// ========================================================

function QcReturnModal({ fbaReturn, onClose }: any) {
  const qc = useQueryClient();
  const { data: warehouses } = useQuery({
    queryKey: ['wms_warehouses'],
    queryFn: async () => { const { data } = await supabase.from('wms_warehouses').select('*'); return data || []; },
  });
  const { data: locations } = useQuery({
    queryKey: ['wms_locations_for_qc', fbaReturn.warehouse_id],
    queryFn: async () => {
      const { data } = await supabase.from('wms_locations').select('*')
        .eq('warehouse_id', fbaReturn.warehouse_id).order('code');
      return data || [];
    },
  });
  const { data: items } = useQuery({
    queryKey: ['fba_return_items_qc', fbaReturn.id],
    queryFn: async () => {
      const { data } = await supabase.from('wms_fba_return_items').select('*')
        .eq('fba_return_id', fbaReturn.id);
      return data || [];
    },
  });
  const [good, setGood] = useState<Record<string, number>>({});
  const [bad, setBad] = useState<Record<string, number>>({});
  const [locMap, setLocMap] = useState<Record<string, string>>({});

  useEffect(() => {
    const g: any = {}, b: any = {};
    (items as any[])?.forEach((it: any) => {
      g[it.id] = it.qty_good ?? it.qty_received ?? 0;
      b[it.id] = it.qty_bad ?? 0;
    });
    setGood(g); setBad(b);
  }, [items]);

  async function save() {
    const { data: { user } } = await supabase.auth.getUser();
    let totalGood = 0, totalBad = 0;
    const goodLogs: any[] = [];

    for (const it of (items as any[])) {
      const g = good[it.id] ?? 0;
      const b = bad[it.id] ?? 0;
      totalGood += g; totalBad += b;
      const newGood = (it.qty_good || 0) + g;
      const newBad = (it.qty_bad || 0) + b;
      await supabase.from('wms_fba_return_items').update({
        qty_good: newGood, qty_bad: newBad,
      }).eq('id', it.id);

      // 良品回 wms_inventory（指定库位）
      if (g > 0) {
        const locId = locMap[it.id];
        if (!locId) { alert(`SKU ${it.sku} 请选择库位`); return; }
        await supabase.from('wms_inventory').upsert(
          {
            user_id: user!.id, warehouse_id: fbaReturn.warehouse_id, location_id: locId,
            sku: it.sku, qty_on_hand: g,
          },
          { onConflict: 'warehouse_id,location_id,sku,batch_no', ignoreDuplicates: false }
        );
        await supabase.from('wms_inventory_logs').insert({
          user_id: user!.id, warehouse_id: fbaReturn.warehouse_id, location_id: locId,
          sku: it.sku, qty_change: g, qty_after: g,
          type: 'fba_return', ref_type: 'fba_return', ref_id: fbaReturn.id,
          operator: user?.email, remark: `FBA 退货良品回库 ${fbaReturn.fba_return_no}`,
        });
      }
    }

    await supabase.from('wms_fba_returns').update({
      status: 'inspected',
      qty_good: totalGood, qty_bad: totalBad,
      qty_disposed: totalBad,
      inspected_at: new Date().toISOString(),
    }).eq('id', fbaReturn.id);

    qc.invalidateQueries();
    alert(`质检完成：良品 ${totalGood} / 不良 ${totalBad}`);
    onClose();
  }

  return (
    <Modal title={`质检 — ${fbaReturn.fba_return_no}`} onClose={onClose}>
      <div className="text-xs text-gray-500 mb-3">
        输入每个 SKU 的良品 / 不良数量；良品将自动回到所选库位库存，不良品计入报废。
      </div>
      <div className="max-h-72 overflow-auto border border-gray-100 rounded divide-y">
        {(items as any[])?.map((it: any) => (
          <div key={it.id} className="px-3 py-2 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-mono font-medium">{it.sku}</span>
              <span className="text-xs text-gray-400">已收 {it.qty_received || 0}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <div className="text-[10px] text-gray-500 mb-0.5">良品</div>
                <input className="inp text-xs py-1" type="number" min="0"
                  value={good[it.id] ?? 0}
                  onChange={(e) => setGood({ ...good, [it.id]: +e.target.value })} />
              </div>
              <div>
                <div className="text-[10px] text-gray-500 mb-0.5">不良</div>
                <input className="inp text-xs py-1" type="number" min="0"
                  value={bad[it.id] ?? 0}
                  onChange={(e) => setBad({ ...bad, [it.id]: +e.target.value })} />
              </div>
              <div>
                <div className="text-[10px] text-gray-500 mb-0.5">回库位</div>
                <select className="inp text-xs py-1" value={locMap[it.id] || ''}
                  onChange={(e) => setLocMap({ ...locMap, [it.id]: e.target.value })}>
                  <option value="">选择库位</option>
                  {(locations as any[])?.map((l: any) => (
                    <option key={l.id} value={l.id}>{l.code}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ))}
      </div>
      <Footer onClose={onClose} onSave={save} />
    </Modal>
  );
}

// ========================================================
// FBA Return Detail
// ========================================================

function FbaReturnDetail({ fbaReturn, onClose }: any) {
  const { data: items } = useQuery({
    queryKey: ['fba_return_items', fbaReturn.id, 'detail'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_fba_return_items').select('*')
        .eq('fba_return_id', fbaReturn.id);
      return data || [];
    },
  });

  return (
    <Modal title={`详情 — ${fbaReturn.fba_return_no}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3 text-sm mb-3">
        <div><div className="text-xs text-gray-400">仓库</div><div>{fbaReturn.warehouse_id}</div></div>
        <div><div className="text-xs text-gray-400">状态</div>
          <span className={`px-2 py-0.5 rounded text-xs ${returnBadge(fbaReturn.status)}`}>
            {RETURN_STATUS_LABEL[fbaReturn.status] || fbaReturn.status}
          </span>
        </div>
        <div><div className="text-xs text-gray-400">订单号</div><div>{fbaReturn.order_id || '-'}</div></div>
        <div><div className="text-xs text-gray-400">Amazon Return ID</div><div>{fbaReturn.amazon_return_id || '-'}</div></div>
        <div><div className="text-xs text-gray-400">原因</div><div>{fbaReturn.reason || '-'}</div></div>
        <div><div className="text-xs text-gray-400">操作人</div><div>{fbaReturn.operator || '-'}</div></div>
      </div>
      <div className="max-h-64 overflow-auto border border-gray-100 rounded divide-y">
        {(items as any[])?.map((it: any) => (
          <div key={it.id} className="flex items-center justify-between px-3 py-2 text-xs">
            <div>
              <div className="font-mono font-medium">{it.sku}</div>
              {it.sku_name && <div className="text-gray-500">{it.sku_name}</div>}
            </div>
            <div className="text-right text-gray-600 tabular-nums">
              预期 {it.qty_expected || 0} · 已收 {it.qty_received || 0} ·
              <span className="text-green-600"> 良品 {it.qty_good || 0}</span> ·
              <span className="text-red-500"> 不良 {it.qty_bad || 0}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex justify-end">
        <button onClick={onClose} className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm">关闭</button>
      </div>
    </Modal>
  );
}

// ---------- helpers ----------
function returnBadge(s: string) {
  const m: any = {
    pending: 'bg-gray-100 text-gray-500',
    received: 'bg-blue-50 text-blue-600',
    inspected: 'bg-amber-50 text-amber-600',
    restocked: 'bg-green-50 text-green-600',
    disposed: 'bg-red-50 text-red-500',
    completed: 'bg-green-100 text-green-700',
  };
  return m[s] || 'bg-gray-100';
}
function relabelBadge(s: string) {
  const m: any = {
    pending: 'bg-gray-100 text-gray-500',
    labeling: 'bg-blue-50 text-blue-600',
    packing: 'bg-amber-50 text-amber-600',
    shipped: 'bg-green-50 text-green-600',
    completed: 'bg-green-100 text-green-700',
  };
  return m[s] || 'bg-gray-100';
}
