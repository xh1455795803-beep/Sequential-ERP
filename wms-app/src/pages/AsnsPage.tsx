import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Plus, ArrowLeft, Download, Search } from 'lucide-react';
import { useState, useRef } from 'react';
import { Modal, Grid, Field, Footer } from '../components/ui';

// 入库状态 smallint 1-5
const RECEIPT_STATUS: Record<number, { label: string; cls: string }> = {
  1: { label: '待收货', cls: 'bg-muted text-muted-foreground' },
  2: { label: '收货中', cls: 'bg-warning-bg text-warning' },
  3: { label: '已完成', cls: 'bg-success-bg text-success' },
  4: { label: '有差异', cls: 'bg-danger-bg text-destructive' },
  5: { label: '已取消', cls: 'bg-muted text-muted-foreground' },
};

// -------- 列表页 --------
export function AsnsPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: warehouses } = useQuery({
    queryKey: ['wms_warehouses'],
    queryFn: async () => { const { data } = await supabase.from('wms_warehouses').select('*'); return data || []; },
  });

  const { data: receipts } = useQuery({
    queryKey: ['wms_inbound_receipts_all'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_inbound_receipts').select('*').order('created_at', { ascending: false });
      return data || [];
    },
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">入库管理</h2>
          <p className="text-sm text-muted-foreground mt-1">收货 → 上架（库存自动 +，流水自动写）</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 text-sm">
          <Plus className="w-4 h-4" /> 新建入库单
        </button>
      </div>

      <div className="bg-card rounded-xl shadow-soft border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground text-xs">
            <tr>
              <th className="text-left px-5 py-2.5">入库单号</th>
              <th className="text-left px-5 py-2.5">仓库</th>
              <th className="text-left px-5 py-2.5">来源</th>
              <th className="text-left px-5 py-2.5">物流单号</th>
              <th className="text-left px-5 py-2.5">收货量</th>
              <th className="text-left px-5 py-2.5">状态</th>
              <th className="text-right px-5 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {receipts?.map((r: any) => {
              const wh = (warehouses as any[])?.find(w => w.id === r.warehouse_id);
              const st = RECEIPT_STATUS[r.status] || { label: r.status, cls: 'bg-muted' };
              return (
                <tr key={r.id} onClick={() => nav({ to: `/asns/$id`, params: { id: r.id } })}
                  className="border-t border-transparent hover:bg-brand-50/30 cursor-pointer">
                  <td className="px-5 py-3 font-mono text-brand-600">{r.receipt_no}</td>
                  <td className="px-5 py-3">{wh?.warehouse_code || '-'}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{r.source_type}{r.source_order_no ? ` · ${r.source_order_no}` : ''}</td>
                  <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{r.express_no || '-'}</td>
                  <td className="px-5 py-3 text-right">
                    {r.receipted_qty || 0} <span className="text-muted-foreground">/ {r.expected_qty || 0}</span>
                  </td>
                  <td className="px-5 py-3"><span className={`px-2 py-0.5 rounded text-xs ${st.cls}`}>{st.label}</span></td>
                  <td className="px-5 py-3 text-right text-brand-500 text-xs">点击查看 →</td>
                </tr>
              );
            })}
            {!receipts?.length && <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">暂无入库单</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && <ReceiptForm warehouses={warehouses!} onClose={() => setShowForm(false)}
        onSaved={(id) => { setShowForm(false); qc.invalidateQueries(); nav({ to: `/asns/$id`, params: { id } }); }} />}
    </div>
  );
}

function ReceiptForm({ warehouses, onClose, onSaved }: any) {
  const [f, setF] = useState({
    warehouse_id: warehouses?.[0]?.id || '',
    source_type: 'SELF_INGEST',
    source_order_no: '', express_no: '',
    carrier_name: '', expected_date: '', remark: '',
  });
  const [items, setItems] = useState<any[]>([{ sku_code: '', expected_qty: 1 }]);

  async function save() {
    if (!f.warehouse_id) return alert('请选择仓库');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return alert('请先登录');

    // tenant
    const { data: acc } = await supabase.from('wms_accounts').select('tenant_id').eq('email', user.email).maybeSingle();
    const tenant_id = acc?.tenant_id;
    if (!tenant_id) return alert('账户未绑定租户');

    const receipt_no = 'IN' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + Math.floor(Math.random() * 9000 + 1000);

    let expected_qty = 0;
    const itemRows: any[] = [];
    for (const it of items) {
      const qty = +it.expected_qty || 0;
      if (!it.sku_code || qty <= 0) continue;
      const { data: prod } = await supabase.from('wms_products').select('id').eq('sku_code', it.sku_code).eq('tenant_id', tenant_id).maybeSingle();
      if (!prod) { alert(`SKU ${it.sku_code} 不存在`); return; }
      itemRows.push({
        tenant_id, receipt_id: 0, // will fill after insert
        product_id: prod.id, sku_code: it.sku_code,
        expected_qty: qty, received_qty: 0,
      });
      expected_qty += qty;
    }
    if (itemRows.length === 0) return alert('请至少填写一条有效明细');

    const { data: ins, error } = await supabase.from('wms_inbound_receipts').insert({
      tenant_id, warehouse_id: f.warehouse_id, receipt_no,
      source_type: f.source_type, source_order_no: f.source_order_no || null,
      express_no: f.express_no || null, carrier_name: f.carrier_name || null,
      expected_date: f.expected_date || null,
      expected_qty, receipted_qty: 0,
      status: 1, diff_flag: 0, remark: f.remark || null,
    }).select().single();
    if (error) return alert(error.message);

    for (const r of itemRows) {
      await supabase.from('wms_inbound_items').insert({ ...r, receipt_id: ins!.id });
    }

    onSaved(ins!.id);
  }

  return (
    <Modal title="新建入库单" onClose={onClose}>
      <Grid>
        <Field label="仓库 *">
          <select className="inp" value={f.warehouse_id} onChange={(e) => setF({ ...f, warehouse_id: e.target.value })}>
            {warehouses?.map((w: any) => <option key={w.id} value={w.id}>{w.warehouse_code} · {w.name}</option>)}
          </select>
        </Field>
        <Field label="来源 *">
          <select className="inp" value={f.source_type} onChange={(e) => setF({ ...f, source_type: e.target.value })}>
            <option value="SELF_INGEST">手动录入</option>
            <option value="ERP_PUSH">ERP 推送</option>
            <option value="PURCHASE">采购入库</option>
            <option value="RETURN">退件回仓</option>
          </select>
        </Field>
        <Field label="关联单号"><input className="inp" value={f.source_order_no} onChange={(e) => setF({ ...f, source_order_no: e.target.value })} placeholder="PO / ERP 单号" /></Field>
        <Field label="物流单号"><input className="inp" value={f.express_no} onChange={(e) => setF({ ...f, express_no: e.target.value })} /></Field>
        <Field label="承运商"><input className="inp" value={f.carrier_name} onChange={(e) => setF({ ...f, carrier_name: e.target.value })} /></Field>
        <Field label="预计到货"><input className="inp" type="date" value={f.expected_date} onChange={(e) => setF({ ...f, expected_date: e.target.value })} /></Field>
        <Field label="备注" full><textarea className="inp" rows={2} value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} /></Field>
      </Grid>

      <div className="mt-5 border-t pt-4">
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium text-sm">入库明细</span>
          <button onClick={() => setItems([...items, { sku_code: '', expected_qty: 1 }])}
            className="text-xs text-brand-500 hover:text-brand-600">+ 添加一行</button>
        </div>
        <table className="w-full text-xs">
          <thead className="text-muted-foreground"><tr><th className="text-left py-1">SKU *</th><th className="text-right py-1">预期数量</th></tr></thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx}>
                <td className="py-1"><input className="inp" value={it.sku_code} onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, sku_code: e.target.value } : x))} /></td>
                <td className="py-1 w-24"><input className="inp text-right" type="number" value={it.expected_qty} onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, expected_qty: +e.target.value } : x))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Footer onClose={onClose} onSave={save} />
    </Modal>
  );
}

// -------- 详情页（收货 + 上架） --------
export function AsnDetailPage() {
  const params = useParams({ strict: false }) as any;
  const id = params?.id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const [scanSku, setScanSku] = useState('');

  const { data: r } = useQuery({
    queryKey: ['wms_receipt', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from('wms_inbound_receipts').select('*').eq('id', id).single();
      return data;
    },
  });
  const { data: items } = useQuery({
    queryKey: ['wms_inbound_items', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from('wms_inbound_items').select('*').eq('receipt_id', id).order('id');
      return data || [];
    },
  });
  const { data: bins } = useQuery({
    queryKey: ['wms_bins_by_wh'],
    enabled: !!r?.warehouse_id,
    queryFn: async () => {
      const { data } = await supabase.from('wms_bins').select('*').eq('warehouse_id', r?.warehouse_id).order('bin_code');
      return data || [];
    },
  });

  async function scanReceive() {
    const sku = scanSku.trim();
    if (!sku || !items?.length) return;
    // 找到第一个 sku_code 匹配且 received_qty < expected_qty 的 item
    const target = (items as any[]).find((it: any) => it.sku_code === sku && (+it.received_qty || 0) < +it.expected_qty);
    if (!target) { alert(`SKU ${sku} 无待收货项`); return; }
    await supabase.from('wms_inbound_items').update({ received_qty: +target.received_qty + 1 }).eq('id', target.id);
    setScanSku('');
    await refreshReceiptQty();
    qc.invalidateQueries();
  }

  async function oneClickReceive() {
    if (!confirm('一键全部收货？（全部 received_qty = expected_qty）')) return;
    for (const it of items!) {
      await supabase.from('wms_inbound_items').update({ received_qty: it.expected_qty }).eq('id', it.id);
    }
    await supabase.from('wms_inbound_receipts').update({
      status: 2, // 收货中 → 其实已全收完，但还没上架
      received_at: new Date().toISOString(),
    }).eq('id', id);
    await refreshReceiptQty();
    qc.invalidateQueries();
  }

  async function putaway() {
    // 把已收未上架的 SKU 放到第一个 bin（简化）；生产应该 PDA 扫 bin
    if (!confirm('确认自动上架到 B-01-02（简化演示）？')) return;
    const binPick = bins?.[0];
    if (!binPick) { alert('仓库没有库位'); return; }

    let anyPut = false;
    for (const it of items!) {
      const still = +it.expected_qty - (+it.received_qty || 0);
      if (still > 0) continue; // 未收完的先不上架
      // 查库存
      const { data: exist } = await supabase.from('wms_inventory')
        .select('id, qty_onhand').eq('warehouse_id', r!.warehouse_id).eq('product_id', it.product_id).eq('bin_id', binPick.id).maybeSingle();
      if (exist) {
        await supabase.from('wms_inventory').update({ qty_onhand: +exist.qty_onhand + (+it.received_qty || 0), last_move_at: new Date().toISOString() }).eq('id', exist.id);
      } else {
        await supabase.from('wms_inventory').insert({
          tenant_id: r!.tenant_id, warehouse_id: r!.warehouse_id,
          zone_id: binPick.zone_id, bin_id: binPick.id, product_id: it.product_id,
          qty_onhand: +it.received_qty || 0, qty_locked: 0, qty_inbound: 0, qty_defective: 0,
        });
      }
      // 把 item.bin_id 填上
      await supabase.from('wms_inbound_items').update({ bin_id: binPick.id }).eq('id', it.id);
      anyPut = true;
    }

    if (anyPut) {
      await supabase.from('wms_inbound_receipts').update({
        status: 3,
        received_at: new Date().toISOString(),
      }).eq('id', id);
      alert('✅ 上架完成');
    } else {
      alert('没有可上架项');
    }
    qc.invalidateQueries();
  }

  async function refreshReceiptQty() {
    if (!items?.length) return;
    const total = items.reduce((s: number, it: any) => s + (+it.received_qty || 0), 0);
    const st = total >= (r!.expected_qty || 0) ? 2 : r!.status;
    await supabase.from('wms_inbound_receipts').update({
      receipted_qty: total,
      status: st,
    }).eq('id', id);
  }

  async function cancelReceipt() {
    if (!confirm('确认取消此入库单？')) return;
    await supabase.from('wms_inbound_receipts').update({ status: 5, diff_flag: 1 }).eq('id', id);
    qc.invalidateQueries();
  }

  if (!r) return <div className="p-8 text-center text-muted-foreground">加载中...</div>;
  const st = RECEIPT_STATUS[r.status] || { label: r.status, cls: 'bg-muted' };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <button onClick={() => nav({ to: '/asns' })} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-fg mb-3">
        <ArrowLeft className="w-4 h-4" /> 返回入库列表
      </button>

      {/* 入库单卡片 */}
      <div className="bg-card rounded-xl shadow-soft border border-border p-6 mb-4">
        <div className="flex items-center gap-3 mb-4">
          <Download className="w-6 h-6 text-brand-500" />
          <div>
            <div className="text-lg font-bold">{r.receipt_no}</div>
            <div className="text-xs text-muted-foreground">来源 {r.source_type} · {r.source_order_no || '-'} · {r.express_no || '-'}</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className={`px-2 py-1 rounded text-xs ${st.cls}`}>{st.label}</span>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4 text-sm mb-3">
          <div><div className="text-xs text-muted-foreground">预期到货</div><div className="font-medium">{r.expected_qty || 0}</div></div>
          <div><div className="text-xs text-muted-foreground">已收货</div><div className="font-medium text-warning">{r.receipted_qty || 0}</div></div>
          <div><div className="text-xs text-muted-foreground">仓号</div><div className="font-medium">{r.warehouse_id}</div></div>
          <div><div className="text-xs text-muted-foreground">预计日期</div><div className="font-medium">{r.expected_date || '-'}</div></div>
        </div>

        <div className="flex gap-2 pt-3 border-t border-border">
          {r.status !== 3 && r.status !== 5 && (
            <button onClick={oneClickReceive} className="px-4 py-2 bg-warning text-white rounded-lg text-sm hover:bg-warning">
              一键全部收货
            </button>
          )}
          {(r.status === 2 || r.status === 3) && items?.some(it => it.bin_id == null) && (
            <button onClick={putaway} className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600">
              一键上架
            </button>
          )}
          {r.status !== 5 && r.status !== 3 && (
            <button onClick={cancelReceipt} className="px-4 py-2 bg-border text-muted-foreground rounded-lg text-sm hover:bg-input">取消</button>
          )}
        </div>
      </div>

      {/* 扫码收货 */}
      {(r.status === 1 || r.status === 2) && (
        <div className="bg-card rounded-xl shadow-soft border border-border p-4 mb-4 flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
            <input value={scanSku} onChange={(e) => setScanSku(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && scanReceive()}
              placeholder="扫码 / 输入 SKU → Enter 收一件"
              className="w-full pl-9 pr-3 py-2 border border-border rounded-lg text-sm" />
          </div>
          <button onClick={scanReceive} className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm">收一件</button>
        </div>
      )}

      {/* 入库明细 */}
      <div className="bg-card rounded-xl shadow-soft border border-border overflow-hidden">
        <div className="px-5 py-3 border-b border-border font-medium">入库明细（{items?.length || 0} 项）</div>
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground text-xs">
            <tr>
              <th className="text-left px-4 py-2">SKU</th>
              <th className="text-right px-4 py-2">预期</th>
              <th className="text-right px-4 py-2">已收</th>
              <th className="text-right px-4 py-2">差异</th>
              <th className="text-left px-4 py-2">上架库位</th>
              <th className="text-right px-4 py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {items?.map((it: any) => (
              <tr key={it.id} className="border-t border-transparent">
                <td className="px-4 py-2 font-mono text-xs">{it.sku_code}</td>
                <td className="px-4 py-2 text-right">{it.expected_qty}</td>
                <td className="px-4 py-2 text-right text-warning">{it.received_qty || 0}</td>
                <td className={`px-4 py-2 text-right ${(it.received_qty || 0) !== +it.expected_qty ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {(+it.expected_qty - (+it.received_qty || 0)) !== 0 ? `-${+it.expected_qty - (+it.received_qty || 0)}` : '-'}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-brand-600">
                  {bins?.find((b: any) => b.id === it.bin_id)?.bin_code || '-'}
                </td>
                <td className="px-4 py-2 text-right">
                  {(r.status === 1 || r.status === 2) && (+it.received_qty || 0) < +it.expected_qty && (
                    <button onClick={async () => {
                      await supabase.from('wms_inbound_items').update({ received_qty: +it.received_qty + 1 }).eq('id', it.id);
                      await refreshReceiptQty(); qc.invalidateQueries();
                    }} className="text-xs text-brand-500">+1</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
