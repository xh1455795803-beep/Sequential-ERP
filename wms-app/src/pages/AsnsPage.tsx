import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Plus, ArrowLeft, PackageCheck, Download, Upload } from 'lucide-react';
import { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Modal, Grid, Field, Footer } from '../components/ui';

// -------- 列表页 --------
export function AsnsPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [importMsg, setImportMsg] = useState<{ ok: number; err: number; errors: string[] } | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onImportExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true); setImportMsg(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      const ok: number[] = [];
      const errs: string[] = [];
      const { data: { user } } = await supabase.auth.getUser();

      // 尝试识别 warehouse_id（支持 code 或直接传 id）
      const { data: warehouses } = await supabase.from('wms_warehouses').select('id, code');
      const byCode = Object.fromEntries((warehouses || []).map(w => [w.code, w.id]));

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const sku = String(row['SKU'] || row['sku'] || '').trim();
        if (!sku) continue;
        const warehouse_id = row['仓库'] || row['warehouse_id'] || row['warehouse'];
        const whId = byCode[warehouse_id] || warehouse_id;
        if (!whId) { errs.push(`第 ${i + 2} 行：缺少仓库/warehouse_id`); continue; }

        const expected_qty = +(row['数量'] || row['qty'] || row['qty_in'] || row['Qty'] || 1);
        const asn_no = row['ASN单号'] || row['asn_no'] || row['PO'] || ('ASN' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + Math.floor(Math.random() * 9000 + 1000));

        // 找或创建 ASN
        let { data: exist }: any = await supabase.from('wms_inbound_receipts').select('id').eq('asn_no', asn_no).maybeSingle();
        let asnId = exist?.id;
        if (!asnId) {
          const { data: ins }: any = await supabase.from('wms_inbound_receipts').insert({
            user_id: user!.id, warehouse_id: whId, asn_no,
            expected_date: row['预计到货'] || row['expected_date'] || null,
            po_no: row['PO'] || row['po_no'] || null,
            supplier_id: row['供应商ID'] || null,
          }).select().single();
          asnId = ins.id;
        }

        const { error: ie } = await supabase.from('wms_asn_items').insert({
          asn_id: asnId, user_id: user!.id, sku,
          sku_name: row['名称'] || row['sku_name'] || '',
          expected_qty,
          unit_cost: +(row['单价'] || row['unit_cost'] || 0),
          barcode: row['条码'] || row['barcode'] || '',
          batch_no: row['批次'] || row['batch_no'] || '',
          expiry_date: row['效期'] || row['expiry_date'] || null,
        });
        if (ie) errs.push(`第 ${i + 2} 行 ${sku}: ${ie.message}`);
        else ok.push(asnId);
      }

      // 更新 ASN 汇总字段
      for (const asnId of [...new Set(ok)]) {
        const { count } = await supabase.from('wms_asn_items').select('id', { count: 'exact', head: true }).eq('asn_id', asnId);
        const { data: sum } = await supabase.from('wms_asn_items').select('expected_qty').eq('asn_id', asnId);
        const total = (sum || []).reduce((s, r: any) => s + (r.expected_qty || 0), 0);
        await supabase.from('wms_inbound_receipts').update({ total_items: count, total_qty: total }).eq('id', asnId);
      }

      qc.invalidateQueries({ queryKey: ['wms_inbound_receipts'] });
      setImportMsg({ ok: ok.length, err: errs.length, errors: errs.slice(0, 10) });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const { data: warehouses } = useQuery({
    queryKey: ['wms_warehouses'],
    queryFn: async () => { const { data } = await supabase.from('wms_warehouses').select('*'); return data || []; },
  });

  const { data: asns } = useQuery({
    queryKey: ['wms_inbound_receipts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('wms_inbound_receipts').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const statusLabel: any = {
    draft: '草稿', submitted: '已提交', in_transit: '在途', arrived: '已到港',
    receiving: '收货中', putaway: '上架中', completed: '已完成', cancelled: '已取消',
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">入库管理</h2>
          <p className="text-sm text-gray-500 mt-1">ASN（预先发货通知）→ 收货 → 上架</p>
        </div>
        <div className="flex items-center gap-2">
          {/* 🆕 Excel 导入 */}
          <button onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-1.5 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 text-sm disabled:opacity-50">
            <Upload className="w-4 h-4" /> {importing ? '导入中...' : 'Excel 导入'}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onImportExcel} />
          {/* 新建 ASN */}
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 text-sm">
            <Plus className="w-4 h-4" /> 新建 ASN
          </button>
        </div>
      </div>

      {/* 导入结果反馈 */}
      {importMsg && (
        <div className={`mb-4 p-3 rounded-lg text-sm border ${importMsg.err === 0 ? 'bg-green-50 border-green-200 text-green-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
          ✅ 成功 {importMsg.ok} 条 {importMsg.err > 0 && `| ❌ 失败 ${importMsg.err} 条`}
          {importMsg.errors.map((e, i) => <div key={i} className="text-xs mt-1">• {e}</div>)}
          <button onClick={() => setImportMsg(null)} className="ml-3 underline text-xs">关闭</button>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-5 py-2.5">ASN 单号</th>
              <th className="text-left px-5 py-2.5">仓库</th>
              <th className="text-right px-5 py-2.5">SKU 数</th>
              <th className="text-right px-5 py-2.5">到货量</th>
              <th className="text-left px-5 py-2.5">预计到货</th>
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
                <td className="px-5 py-3 text-gray-500">{a.expected_date || '-'}</td>
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
        onSaved={(id) => { setShowForm(false); qc.invalidateQueries({ queryKey: ['wms_inbound_receipts'] }); nav({ to: `/asns/$id`, params: { id } }); }} />}
    </div>
  );
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
    const { data, error } = await supabase.from('wms_inbound_receipts').insert({
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

// -------- 详情页（收货 + 上架） --------
export function AsnDetailPage() {
  const params = useParams({ strict: false }) as any;
  const id = params?.id;
  const nav = useNavigate();
  const qc = useQueryClient();

  const { data: asn } = useQuery({
    queryKey: ['asn', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from('wms_inbound_receipts').select('*').eq('id', id).single();
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
    queryKey: ['wms_bins_simple'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_bins').select('id,code,warehouse_id,status').eq('status', 'empty');
      return data || [];
    },
  });

  const [receivedMap, setReceivedMap] = useState<Record<string, number>>({});
  const [putawayMap, setPutawayMap] = useState<Record<string, any>>({}); // item_id -> { location_id, qty }

  async function receiveAll() {
    const { data: { user } } = await supabase.auth.getUser();
    let received = 0;
    for (const it of items!) {
      const inc = receivedMap[it.id] ?? (it.expected_qty - (it.received_qty || 0));
      if (inc <= 0) continue;
      await supabase.from('wms_asn_items').update({ received_qty: (it.received_qty || 0) + inc }).eq('id', it.id);
      received += inc;
    }
    await supabase.from('wms_inbound_receipts').update({
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

    for (const it of items!) {
      const target = putawayMap[it.id];
      if (!target || !target.location_id || !target.qty) continue;
      const loc = (locations as any[])?.find(l => l.id === target.location_id);
      const sku = it.sku;
      const locId = target.location_id;
      const addQty = target.qty;

      // 🔧 修复：先查后累加（原来直接 upsert 会覆盖库存）
      const { data: existing, error: e2 } = await supabase
        .from('wms_inventory')
        .select('id, qty_on_hand, qty_reserved')
        .eq('warehouse_id', asn.warehouse_id)
        .eq('location_id', locId)
        .eq('sku', sku)
        .maybeSingle();

      if (e2) { console.error('库存查询失败', e2); continue; }

      if (existing) {
        // 已存在：update 累加
        await supabase.from('wms_inventory').update({
          qty_on_hand: (existing.qty_on_hand || 0) + addQty,
          last_moved_at: new Date().toISOString(),
        }).eq('id', existing.id);
      } else {
        // 不存在：insert 新行
        await supabase.from('wms_inventory').insert({
          user_id: user!.id,
          warehouse_id: asn.warehouse_id,
          location_id: locId,
          product_id: it.product_id,
          sku,
          qty_on_hand: addQty,
        });
      }

      // 写库存日志
      await supabase.from('wms_inventory_txn').insert({
        user_id: user!.id, warehouse_id: asn.warehouse_id, product_id: it.product_id,
        sku, location_id: locId,
        qty_change: addQty,
        qty_after: (existing?.qty_on_hand || 0) + addQty,
        type: 'inbound_putaway',
        ref_type: 'asn', ref_id: id, operator: user?.email,
        remark: `ASN ${asn.asn_no} 上架至 ${loc?.code}`,
      });

      // 更新 ASN item putaway_qty
      await supabase.from('wms_asn_items').update({ putaway_qty: (it.putaway_qty || 0) + addQty }).eq('id', it.id);

      // 新增上架任务
      await supabase.from('wms_work_tasks').insert({
        user_id: user!.id, asn_id: id, asn_item_id: it.id,
        product_id: it.product_id, sku, qty: addQty,
        target_location_id: locId, status: 'done', operator: user?.email,
        done_at: new Date().toISOString(),
      });

      // 库位改为 occupied
      await supabase.from('wms_bins').update({ status: 'occupied' }).eq('id', locId);

      putawayCount += addQty;
    }

    if (putawayCount === 0) {
      qc.invalidateQueries();
      alert('⚠️ 未选择任何上架库位或数量，请先为需要上架的 SKU 选择库位和数量');
      return;
    }

    // 检查是否所有 item 都已上架完成
    const allDone = items!.every((it: any) => {
      const target = putawayMap[it.id];
      const remaining = (it.expected_qty || 0) - (it.putaway_qty || 0);
      return remaining <= 0 || (target && target.location_id && target.qty >= remaining);
    });

    await supabase.from('wms_inbound_receipts').update({
      status: allDone ? 'completed' : 'putaway',
      putaway_qty: (asn?.putaway_qty || 0) + putawayCount,
    }).eq('id', id);
    qc.invalidateQueries();
    alert(`✅ 上架完成：${putawayCount} 件${allDone ? '，ASN 已完成' : ''}`);
  }

  if (!asn) return <div className="p-8 text-center text-gray-400">加载中...</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <button onClick={() => nav({ to: '/asns' })} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <ArrowLeft className="w-4 h-4" /> 返回 ASN 列表
      </button>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-4">
        <div className="flex items-center gap-3 mb-4">
          <Download className="w-6 h-6 text-brand-500" />
          <div>
            <div className="text-lg font-bold">{asn.asn_no}</div>
            <div className="text-xs text-gray-500">状态：<span className={asnStatusBadge(asn.status)}>{asn.status}</span> · 仓库 {asn.warehouse_id}</div>
          </div>
          <div className="ml-auto flex gap-2">
            {(asn.status === 'submitted' || asn.status === 'in_transit' || asn.status === 'arrived' || asn.status === 'receiving') && (
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

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 font-medium">ASN 明细</div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-4 py-2">SKU</th>
              <th className="text-left px-4 py-2">名称</th>
              <th className="text-right px-4 py-2">预期</th>
              <th className="text-right px-4 py-2">已收</th>
              <th className="text-right px-4 py-2">已上</th>
              <th className="text-left px-4 py-2">上架库位</th>
              <th className="text-right px-4 py-2">数量</th>
            </tr>
          </thead>
          <tbody>
            {items?.map((it: any) => (
              <tr key={it.id} className="border-t border-gray-50">
                <td className="px-4 py-2 font-mono text-xs">{it.sku}</td>
                <td className="px-4 py-2">{it.sku_name}</td>
                <td className="px-4 py-2 text-right">{it.expected_qty}</td>
                <td className="px-4 py-2 text-right text-amber-600">{it.received_qty || 0}</td>
                <td className="px-4 py-2 text-right text-green-600">{it.putaway_qty || 0}</td>
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
            ))}
          </tbody>
        </table>
      </div>

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
