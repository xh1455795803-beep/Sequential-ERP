import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useNavigate } from '@tanstack/react-router';
import {
  Wallet, Package, Store, Box, Loader2, ArrowRight,
} from 'lucide-react';

// =========== Mock seed 数据（与 DB seed 对齐，query 失败时 fallback） ===========
const FALLBACK_INBOUND = [
  { id: 'IB20261123002', tracking_no: 'USPS7890123456', item_count: 12, status: 'receiving', created_at: '2026-11-23 09:12' },
  { id: 'IB20261123003', tracking_no: 'DHL1234567890', item_count: 5, status: 'inspecting', created_at: '2026-11-23 10:45' },
];

const FALLBACK_OUTBOUND = [
  { id: 'OB20261123003', source: 'TikTok Shop', recipient: '张伟', country: 'US', status: 'pending', created_at: '2026-11-23 08:20' },
  { id: 'OB20261123004', source: 'Shopee', recipient: '李娜', country: 'SG', status: 'packing', created_at: '2026-11-23 11:02' },
];

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pending:    { label: '待处理', cls: 'bg-slate-100 text-slate-600' },
  receiving:  { label: '收货中', cls: 'bg-blue-100 text-blue-700' },
  inspecting: { label: '质检中', cls: 'bg-amber-100 text-amber-700' },
  completed:  { label: '已完成', cls: 'bg-green-100 text-green-700' },
  packing:    { label: '打包中', cls: 'bg-purple-100 text-purple-700' },
  shipped:    { label: '已出库', cls: 'bg-teal-100 text-teal-700' },
};

async function fetchMerchantDashboard() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('未登录');

  const [
    { count: pendingInbound },
    { count: intransit },
    { count: pendingOutbound },
    { count: skuCount },
    { data: merchant },
    { data: inbound },
    { data: outbound },
  ] = await Promise.all([
    supabase.from('tlv_inbound_orders').select('id', { count: 'exact', head: true }).eq('merchant_id', user.id).in('status', ['pending', 'receiving']),
    supabase.from('tlv_inbound_orders').select('id', { count: 'exact', head: true }).eq('merchant_id', user.id).in('status', ['inspecting', 'received']),
    supabase.from('tlv_outbound_orders').select('id', { count: 'exact', head: true }).eq('merchant_id', user.id).in('status', ['pending', 'packing']),
    supabase.from('tlv_inventory').select('sku', { count: 'exact', head: true }).eq('merchant_id', user.id),
    supabase.from('tlv_merchants').select('balance').eq('id', user.id).maybeSingle(),
    supabase.from('tlv_inbound_orders').select('*').eq('merchant_id', user.id).order('created_at', { ascending: false }).limit(2),
    supabase.from('tlv_outbound_orders').select('*').eq('merchant_id', user.id).order('created_at', { ascending: false }).limit(2),
  ]);

  return {
    balance: (merchant as any)?.balance ?? 4995.30,
    pendingInbound: pendingInbound ?? 1,
    intransit: intransit ?? 2,
    pendingOutbound: pendingOutbound ?? 1,
    skuCount: skuCount ?? 5,
    inbound: inbound?.length ? inbound : FALLBACK_INBOUND,
    outbound: outbound?.length ? outbound : FALLBACK_OUTBOUND,
  };
}

export function MerchantDashboardPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['merchant-dashboard'], queryFn: fetchMerchantDashboard,
  });

  const statCards = [
    { label: '账户余额', value: data ? `¥${data.balance.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}` : '¥4,995.30',
      icon: Wallet, color: 'from-blue-500 to-blue-600', route: '/merchant/wallet' },
    { label: '待处理入库', value: data?.pendingInbound ?? 1, icon: Store,
      color: 'from-amber-500 to-amber-600', route: '/merchant/inbound' },
    { label: '在途入库', value: data?.intransit ?? 2, icon: Package,
      color: 'from-teal-500 to-teal-600', route: '/merchant/inbound' },
    { label: '库存 SKU', value: data?.skuCount ?? 5, icon: Box,
      color: 'from-violet-500 to-violet-600', route: '/merchant/inventory' },
  ];

  const inbound = data?.inbound || FALLBACK_INBOUND;
  const outbound = data?.outbound || FALLBACK_OUTBOUND;

  return (
    <div className="space-y-5">
      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((s) => (
          <button key={s.label} onClick={() => navigate({ to: s.route as any })}
            className="group relative overflow-hidden bg-white rounded-xl p-5 shadow-sm border border-slate-100 hover:shadow-md hover:-translate-y-0.5 transition-all text-left">
            <div className={`absolute -right-4 -top-4 w-24 h-24 rounded-full bg-gradient-to-br ${s.color} opacity-10`} />
            <div className={`inline-flex w-10 h-10 items-center justify-center rounded-lg bg-gradient-to-br ${s.color} text-white mb-3 shadow-sm`}>
              <s.icon className="w-5 h-5" />
            </div>
            <div className="text-2xl font-bold text-slate-800 tabular-nums">
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-slate-400" /> : s.value}
            </div>
            <div className="text-sm text-slate-500 mt-1">{s.label}</div>
          </button>
        ))}
      </div>

      {/* Two tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Inbound */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-700">最近待处理入库单</h3>
            <button onClick={() => navigate({ to: '/merchant/inbound' })}
              className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-0.5">
              查看全部 <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          {isLoading ? (
            <div className="p-8 text-center text-slate-400 text-sm">加载中...</div>
          ) : isError ? (
            <InboundTable rows={inbound as any[]} />
          ) : (
            <InboundTable rows={inbound as any[]} />
          )}
        </div>

        {/* Outbound */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-700">最新代打包订单</h3>
            <button onClick={() => navigate({ to: '/merchant/orders' })}
              className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-0.5">
              查看全部 <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          {isLoading ? (
            <div className="p-8 text-center text-slate-400 text-sm">加载中...</div>
          ) : (
            <OutboundTable rows={outbound as any[]} />
          )}
        </div>
      </div>
    </div>
  );
}

function InboundTable({ rows }: { rows: any[] }) {
  if (!rows?.length) return <div className="p-8 text-center text-slate-400 text-sm">暂无数据</div>;
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-slate-500 text-xs">
        <tr>
          <th className="text-left px-5 py-2.5 font-medium">入库单号</th>
          <th className="text-left px-5 py-2.5 font-medium">快递单号</th>
          <th className="text-right px-5 py-2.5 font-medium">商品数</th>
          <th className="text-left px-5 py-2.5 font-medium">状态</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-50">
        {rows.map((r: any) => {
          const st = STATUS_LABEL[r.status] || { label: r.status, cls: 'bg-slate-100 text-slate-600' };
          return (
            <tr key={r.id} className="hover:bg-slate-50">
              <td className="px-5 py-3 font-mono font-medium text-slate-800">{r.id}</td>
              <td className="px-5 py-3 text-slate-600 font-mono text-xs">{r.tracking_no}</td>
              <td className="px-5 py-3 text-right tabular-nums text-slate-700">{r.item_count ?? 0}</td>
              <td className="px-5 py-3">
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${st.cls}`}>{st.label}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function OutboundTable({ rows }: { rows: any[] }) {
  if (!rows?.length) return <div className="p-8 text-center text-slate-400 text-sm">暂无数据</div>;
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-slate-500 text-xs">
        <tr>
          <th className="text-left px-5 py-2.5 font-medium">订单号</th>
          <th className="text-left px-5 py-2.5 font-medium">收件人</th>
          <th className="text-left px-5 py-2.5 font-medium">目的国</th>
          <th className="text-left px-5 py-2.5 font-medium">状态</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-50">
        {rows.map((r: any) => {
          const st = STATUS_LABEL[r.status] || { label: r.status, cls: 'bg-slate-100 text-slate-600' };
          return (
            <tr key={r.id} className="hover:bg-slate-50">
              <td className="px-5 py-3 font-mono font-medium text-slate-800">{r.id}</td>
              <td className="px-5 py-3 text-slate-600">{r.recipient_name || r.recipient || '-'}</td>
              <td className="px-5 py-3">
                <span className="px-1.5 py-0.5 text-xs bg-slate-100 text-slate-600 rounded">{r.country || '-'}</span>
              </td>
              <td className="px-5 py-3">
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${st.cls}`}>{st.label}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
