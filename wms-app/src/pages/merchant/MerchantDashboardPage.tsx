import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { supabase, getAuthContext } from '../../lib/supabase';
import { Wallet, Box, Store, Package, ArrowRight, TrendingUp, TrendingDown } from 'lucide-react';

export function MerchantDashboardPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState(0);
  const [invQty, setInvQty] = useState(0);
  const [pendingInbound, setPendingInbound] = useState(0);
  const [pendingOutbound, setPendingOutbound] = useState(0);
  const [inbound, setInbound] = useState<any[]>([]);
  const [outbound, setOutbound] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const { merchantId } = await getAuthContext();
      if (!merchantId) { setLoading(false); return; }
      const [
        { count: invQtyR },
        { count: piR },
        { count: poR },
        { data: merchant },
        { data: inboundR },
        { data: outboundR },
      ] = await Promise.all([
        supabase.from('tlv_merchant_inventory').select('id', { count: 'exact', head: true }).eq('merchant_id', merchantId),
        supabase.from('tlv_inbound_orders').select('id', { count: 'exact', head: true }).eq('merchant_id', merchantId).in('status', ['pending', 'received', 'inspecting']),
        supabase.from('tlv_outbound_orders').select('id', { count: 'exact', head: true }).eq('merchant_id', merchantId).in('status', ['pending', 'picking', 'packing']),
        supabase.from('tlv_merchants').select('balance').eq('id', merchantId).maybeSingle(),
        supabase.from('tlv_inbound_orders').select('*').eq('merchant_id', merchantId).order('created_at', { ascending: false }).limit(5),
        supabase.from('tlv_outbound_orders').select('*').eq('merchant_id', merchantId).order('created_at', { ascending: false }).limit(5),
      ]);
      setInvQty(invQtyR ?? 0);
      setPendingInbound(piR ?? 0);
      setPendingOutbound(poR ?? 0);
      setBalance(Number((merchant as any)?.balance) || 0);
      setInbound(inboundR || []);
      setOutbound(outboundR || []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="p-12 text-center text-ink-300">加载中...</div>;

  const cards = [
    { label: '账户余额', value: '¥' + balance.toLocaleString('zh-CN', { minimumFractionDigits: 2 }), icon: Wallet,
      blobs: [['#bae0fd', '-right-4', '-top-6', 'w-32', 'h-32'], ['#dcfce7', '-left-2', '-bottom-4', 'w-24', 'h-24']],
      iconBg: 'from-sky-100 to-cyan-50', iconColor: 'text-sky-600', trend: { up: true, text: '+12.4%' }, route: '/merchant/wallet' },
    { label: '库存 SKU', value: String(invQty), icon: Box,
      blobs: [['#f3e8ff', '-right-6', '-top-4', 'w-28', 'h-28'], ['#fce7f3', '-left-4', '-bottom-6', 'w-20', 'h-20']],
      iconBg: 'from-lilac-100 to-violet-50', iconColor: 'text-violet-600', trend: { up: true, text: '+3' }, route: '/merchant/inventory' },
    { label: '待处理入库', value: String(pendingInbound), icon: Store,
      blobs: [['#fed7aa', '-right-4', '-bottom-2', 'w-24', 'h-24'], ['#fef3c7', '-left-2', '-top-4', 'w-20', 'h-20']],
      iconBg: 'from-coral-100 to-orange-50', iconColor: 'text-orange-600', trend: { up: false, text: '-1' }, route: '/merchant/inbound' },
    { label: '待出库订单', value: String(pendingOutbound), icon: Package,
      blobs: [['#bbf7d0', '-right-5', '-top-5', 'w-28', 'h-28'], ['#a7f3d0', '-left-3', '-bottom-5', 'w-22', 'h-22']],
      iconBg: 'from-mint-100 to-emerald-50', iconColor: 'text-emerald-600', trend: { up: true, text: '+2' }, route: '/merchant/orders' },
  ];

  return (
    <div className="space-y-6">
      {/* 顶部问候 */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">你好 👋</h1>
          <p className="text-sm text-ink-500 mt-0.5">让我们看看今天的业务情况</p>
        </div>
      </div>

      {/* 4 大数字卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(c => (
          <button key={c.label} onClick={() => navigate({ to: c.route as any })}
            className="glass glass-hover group relative overflow-hidden p-5 text-left">
            {/* 背景渐变 blob */}
            {c.blobs.map((b, i) => (
              <div key={i} className={`blob ${b[1]} ${b[2]} ${b[3]} ${b[4]}`} style={{ background: b[0] }} />
            ))}
            <div className="relative z-10">
              <div className={`inline-flex w-10 h-10 items-center justify-center rounded-xl bg-gradient-to-br ${c.iconBg} ${c.iconColor} mb-4`}>
                <c.icon className="w-5 h-5" />
              </div>
              <div className="text-3xl font-bold text-ink-900 tabular-nums leading-tight">{c.value}</div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-sm text-ink-500">{c.label}</span>
                {c.trend && (
                  <span className={`inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full ${c.trend.up ? 'bg-mint-100 text-emerald-600' : 'bg-coral-100 text-orange-600'}`}>
                    {c.trend.up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {c.trend.text}
                  </span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* 双面板 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="最近入库单" rows={inbound} colKey="inbound" navigate={navigate} route="/merchant/inbound" />
        <Panel title="最新出库订单" rows={outbound} colKey="outbound" navigate={navigate} route="/merchant/orders" />
      </div>
    </div>
  );
}

function Panel({ title, rows, colKey, navigate, route }: any) {
  const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
    pending:    { label: '待处理', cls: 'bg-slate-100 text-slate-600' },
    received:   { label: '已收货', cls: 'bg-sky-100 text-sky-700' },
    inspecting: { label: '检验中', cls: 'bg-coral-100 text-orange-700' },
    picking:    { label: '拣货中', cls: 'bg-indigo-100 text-indigo-700' },
    packing:    { label: '打包中', cls: 'bg-lilac-100 text-violet-700' },
    shipped:    { label: '已出库', cls: 'bg-mint-100 text-emerald-700' },
    completed:  { label: '已完成', cls: 'bg-mint-100 text-emerald-700' },
  };
  return (
    <div className="glass overflow-hidden">
      <div className="px-5 py-3.5 flex items-center justify-between border-b border-white/60">
        <h3 className="font-semibold text-ink-700">{title}</h3>
        <button onClick={() => navigate({ to: route })} className="text-xs text-sky-600 hover:text-sky-700 flex items-center gap-0.5">
          查看全部 <ArrowRight className="w-3 h-3" />
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="p-10 text-center text-sm text-ink-300">暂无数据</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-ink-300">
              <th className="text-left px-5 py-2.5 font-medium">单号</th>
              <th className="text-left px-5 py-2.5 font-medium">{colKey === 'inbound' ? '创建时间' : '收件人'}</th>
              <th className="text-left px-5 py-2.5 font-medium">状态</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any) => {
              const st = STATUS_LABEL[r.status || 'pending'] || { label: r.status, cls: 'bg-slate-100 text-slate-600' };
              return (
                <tr key={r.id} className="transition-colors hover:bg-white/50">
                  <td className="px-5 py-3 font-mono font-medium text-ink-700">{r.order_no || r.inbound_no || r.id}</td>
                  <td className="px-5 py-3 text-ink-500">
                    {colKey === 'inbound'
                      ? (r.created_at?.slice(0, 16).replace('T', ' ') || '-')
                      : (r.receiver_name || '-')}
                  </td>
                  <td className="px-5 py-3"><span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${st.cls}`}>{st.label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
