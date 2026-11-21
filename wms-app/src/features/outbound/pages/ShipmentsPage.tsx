import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useNavigate, useParams } from '@tanstack/react-router';
import { ArrowLeft, Upload } from 'lucide-react';
import { useState } from 'react';

// 面单状态 1-5
const LABEL_STATUS: Record<number, { label: string; cls: string }> = {
  1: { label: '已生成', cls: 'bg-muted text-muted-foreground' },
  2: { label: '已打印', cls: 'bg-brand-subtle text-brand' },
  3: { label: '已出库', cls: 'bg-success-bg text-success' },
  4: { label: '有轨迹', cls: 'bg-success-bg text-success' },
  5: { label: '已退件', cls: 'bg-danger-bg text-destructive' },
};

// -------- 列表页 --------
export function ShipmentsPage() {
  const nav = useNavigate();
  const { data: labels } = useQuery({
    queryKey: ['wms_labels_all'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_shipment_labels').select('*').order('created_at', { ascending: false });
      return data || [];
    },
  });
  const { data: orders } = useQuery({
    queryKey: ['wms_orders_map'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_orders').select('id,order_no,receiver_name,receiver_country,total_qty,channel_code');
      return data || [];
    },
  });
  const { data: channels } = useQuery({
    queryKey: ['wms_channels_map'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_shipping_channels').select('id,channel_code,channel_name');
      return data || [];
    },
  });

  const orderMap = Object.fromEntries((orders || []).map((o: any) => [o.id, o]));
  const chMap = Object.fromEntries((channels || []).map((c: any) => [c.id, c]));

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">面单 / 出库</h2>
          <p className="text-sm text-muted-foreground mt-1">出库订单 → 面单 → 运单号 → 出库（真实发货在订单详情）</p>
        </div>
      </div>

      <div className="bg-card rounded-xl shadow-soft border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground text-xs">
            <tr>
              <th className="text-left px-5 py-2.5">面单号</th>
              <th className="text-left px-5 py-2.5">关联订单</th>
              <th className="text-left px-5 py-2.5">收件人/国家</th>
              <th className="text-left px-5 py-2.5">渠道</th>
              <th className="text-left px-5 py-2.5">运单号</th>
              <th className="text-left px-5 py-2.5">状态</th>
              <th className="text-right px-5 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {labels?.map((l: any) => {
              const st = LABEL_STATUS[l.status] || { label: l.status, cls: 'bg-muted' };
              const o = orderMap[l.order_id];
              const ch = chMap[l.channel_id];
              return (
                <tr key={l.id} onClick={() => nav({ to: `/shipments/$id`, params: { id: l.id } })}
                  className="border-t border-transparent hover:bg-brand-50/30 cursor-pointer">
                  <td className="px-5 py-3 font-mono text-brand-600">{l.label_no}</td>
                  <td className="px-5 py-3 font-mono text-xs">{o?.order_no || '-'}</td>
                  <td className="px-5 py-3">
                    {o?.receiver_name || '-'}
                    {o?.receiver_country && <span className="text-xs text-muted-foreground ml-1">· {o.receiver_country}</span>}
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{ch?.channel_code || '-'}</td>
                  <td className="px-5 py-3 font-mono text-xs">{l.tracking_no || '-'}</td>
                  <td className="px-5 py-3"><span className={`px-2 py-0.5 rounded text-xs ${st.cls}`}>{st.label}</span></td>
                  <td className="px-5 py-3 text-right text-brand-500 text-xs">点击查看 →</td>
                </tr>
              );
            })}
            {!labels?.length && <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">暂无面单（请先在订单详情页打包后申请面单）</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// -------- 详情页 --------
export function ShipmentDetailPage() {
  const params = useParams({ strict: false }) as any;
  const id = params?.id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const [manualTracking, setManualTracking] = useState(false);

  const { data: l } = useQuery({
    queryKey: ['wms_label', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from('wms_shipment_labels').select('*').eq('id', id).single();
      return data;
    },
  });
  const { data: order } = useQuery({
    queryKey: ['wms_order_by_label', id],
    enabled: !!l?.order_id,
    queryFn: async () => {
      const { data } = await supabase.from('wms_orders').select('*').eq('id', l!.order_id).single();
      return data;
    },
  });
  const { data: items } = useQuery({
    queryKey: ['wms_label_items', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from('wms_shipment_items').select('*').eq('label_id', id).order('id');
      return data || [];
    },
  });
  const { data: channels } = useQuery({
    queryKey: ['wms_channels_map'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_shipping_channels').select('id,channel_code,channel_name');
      return data || [];
    },
  });

  async function markPrinted() {
    await supabase.from('wms_shipment_labels').update({ status: 2, printed_at: new Date().toISOString() }).eq('id', id);
    qc.invalidateQueries();
  }
  async function markShipped(tracking: string, pdfUrl: string) {
    await supabase.from('wms_shipment_labels').update({
      status: 3, tracking_no: tracking || null,
      label_pdf_url: pdfUrl || null, ship_at: new Date().toISOString(),
    }).eq('id', id);
    // 同步订单状态
    if (order) {
      await supabase.from('wms_orders').update({ status: 5, shipped_at: new Date().toISOString() }).eq('id', order.id);
    }
    qc.invalidateQueries();
    setManualTracking(false);
  }

  if (!l) return <div className="p-8 text-center text-muted-foreground">加载中...</div>;
  const st = LABEL_STATUS[l.status] || { label: l.status, cls: 'bg-muted' };
  const ch = (channels as any[])?.find((c: any) => c.id === l.channel_id);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <button onClick={() => nav({ to: '/shipments' })} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-fg mb-3">
        <ArrowLeft className="w-4 h-4" /> 返回面单列表
      </button>

      <div className="bg-card rounded-xl shadow-soft border border-border p-6 mb-4">
        <div className="flex items-center gap-3 mb-4">
          <Upload className="w-6 h-6 text-brand-500" />
          <div>
            <div className="text-lg font-bold">{l.label_no}</div>
            <div className="text-xs text-muted-foreground">渠道 {ch?.channel_code || '-'} · 关联订单 {order?.order_no || '-'}</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className={`px-2 py-1 rounded text-xs ${st.cls}`}>{st.label}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs text-muted-foreground mb-1">收件信息</div>
            <div className="font-medium">{order?.receiver_name || '-'}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{order?.receiver_phone}</div>
            <div className="text-xs text-muted-foreground">
              {order?.receiver_address1}{order?.receiver_address2 ? ' ' + order?.receiver_address2 : ''},
              {order?.receiver_city} {order?.receiver_state} {order?.receiver_zip} {order?.receiver_country}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">运单号</div>
            <div className="font-mono text-brand-600">{l.tracking_no || '-'}</div>
            {l.label_pdf_url && <div className="text-xs text-blue-500 mt-1">📎 面单 PDF 已上传</div>}
          </div>
        </div>

        <div className="flex gap-2 pt-4 border-t border-border mt-4">
          {l.status === 1 && (
            <button onClick={markPrinted} className="px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary">
              标记为已打印
            </button>
          )}
          {(l.status === 1 || l.status === 2) && (
            <button onClick={() => setManualTracking(true)} className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600 flex items-center gap-1">
              <Upload className="w-3.5 h-3.5" /> 填运单号并出库
            </button>
          )}
          {l.status === 3 && (
            <button onClick={async () => {
              await supabase.from('wms_shipment_labels').update({ status: 4, track_at: new Date().toISOString() }).eq('id', id);
              qc.invalidateQueries();
            }} className="px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary">
              模拟有轨迹更新
            </button>
          )}
        </div>
      </div>

      {/* 面单明细 */}
      <div className="bg-card rounded-xl shadow-soft border border-border overflow-hidden">
        <div className="px-5 py-3 border-b border-border font-medium">面单明细（{items?.length || 0} 项）</div>
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground text-xs">
            <tr>
              <th className="text-left px-4 py-2">SKU</th>
              <th className="text-right px-4 py-2">数量</th>
              <th className="text-left px-4 py-2">库位</th>
            </tr>
          </thead>
          <tbody>
            {items?.map((it: any) => (
              <tr key={it.id} className="border-t border-transparent">
                <td className="px-4 py-2 font-mono text-xs">{it.sku_code}</td>
                <td className="px-4 py-2 text-right">{it.qty}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{it.bin_id || '-'}</td>
              </tr>
            ))}
            {!items?.length && <tr><td colSpan={3} className="p-6 text-center text-muted-foreground">无明细</td></tr>}
          </tbody>
        </table>
      </div>

      {/* 手填弹窗 */}
      {manualTracking && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-card rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="font-bold mb-4">填运单号出库</h3>
            <label className="block text-xs text-muted-foreground mb-1">运单号</label>
            <input id="trk" className="inp mb-2" defaultValue={l.tracking_no || ''} />
            <label className="block text-xs text-muted-foreground mb-1">面单 PDF 链接（可留空）</label>
            <input id="pdf" className="inp mb-3" defaultValue={l.label_pdf_url || ''} />
            <div className="flex gap-2">
              <button onClick={() => setManualTracking(false)} className="flex-1 py-2 bg-muted text-muted-foreground rounded-lg">取消</button>
              <button onClick={() => {
                const trk = (document.getElementById('trk') as HTMLInputElement).value;
                const pdf = (document.getElementById('pdf') as HTMLInputElement).value;
                markShipped(trk, pdf);
              }} className="flex-1 py-2 bg-brand-500 text-white rounded-lg">确认出库</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
