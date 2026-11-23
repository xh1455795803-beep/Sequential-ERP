import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useNavigate } from '@tanstack/react-router';
import {
  Download, Upload, RotateCcw, RefreshCw, Truck, Wrench, XCircle,
  Boxes, Package, BarChart3, CalendarClock, DollarSign, FileText, ArrowRight
} from 'lucide-react';

// ========================================================
// 领星 WMS Dashboard — 7大模块 + 库存 + 图表 + 费用 + 流水
// ========================================================

async function fetchDash() {
  const { data: { user } } = await supabase.auth.getUser();
  const uid = user?.id;

  // ---------- 7 大待办 ----------
  const [
    { count: pendingAsn },
    { count: pendingShip },
    { count: pendingReturn },
    { count: pendingFbaReturn },
    { count: pendingTransfer },
    { count: pendingWo },
    { count: pendingCancel },
  ] = await Promise.all([
    supabase.from('wms_asns').select('id', { count: 'exact', head: true })
      .in('status', ['draft', 'receiving']).eq('user_id', uid!),
    supabase.from('wms_shipments').select('id', { count: 'exact', head: true })
      .in('status', ['draft', 'released', 'picking']).eq('user_id', uid!),
    supabase.from('wms_returns').select('id', { count: 'exact', head: true })
      .in('status', ['pending', 'received']).eq('user_id', uid!),
    supabase.from('wms_fba_returns').select('id', { count: 'exact', head: true })
      .in('status', ['pending', 'received']).eq('user_id', uid!),
    supabase.from('wms_transfers').select('id', { count: 'exact', head: true })
      .in('status', ['shipped', 'in_transit']).eq('user_id', uid!),
    supabase.from('wms_work_orders').select('id', { count: 'exact', head: true })
      .in('status', ['pending', 'assigned']).eq('user_id', uid!),
    supabase.from('wms_shipment_cancellations').select('id', { count: 'exact', head: true })
      .in('status', ['pending', 'approved']).eq('user_id', uid!),
  ]);

  // ---------- 库存 ----------
  const { data: invSum } = await supabase.from('wms_inventory')
    .select('qty_on_hand,qty_reserved')
    .eq('user_id', uid!);
  const totalOnHand = (invSum || []).reduce((s, r: any) => s + (r.qty_on_hand || 0), 0);
  const skuKinds = new Set((invSum || []).map((r: any) => r.sku)).size;
  const totalReserved = (invSum || []).reduce((s, r: any) => s + (r.qty_reserved || 0), 0);
  const availableStock = totalOnHand - totalReserved;

  // 低库存预警
  const { count: lowStock } = await supabase.from('wms_inventory')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', uid!).lt('qty_on_hand', 10);

  // ---------- 累计单量 ----------
  const [{ count: asnTotal }, { count: shipTotal }, { count: returnTotal }, { count: stockTotal }] = await Promise.all([
    supabase.from('wms_asns').select('id', { count: 'exact', head: true }).eq('user_id', uid!),
    supabase.from('wms_shipments').select('id', { count: 'exact', head: true }).eq('user_id', uid!),
    supabase.from('wms_returns').select('id', { count: 'exact', head: true }).eq('user_id', uid!),
    supabase.from('wms_stocktaking').select('id', { count: 'exact', head: true }).eq('user_id', uid!),
  ]);

  // ---------- 费用 ----------
  const now = new Date();
  const mStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const { data: bills } = await supabase.from('wms_bills')
    .select('total_amount,bill_type,created_at')
    .eq('user_id', uid!).gte('created_at', mStart);
  let monthStorage = 0, monthShipping = 0;
  let totalFee = 0;
  (bills || []).forEach((b: any) => {
    const amt = Number(b.total_amount) || 0;
    totalFee += amt;
    if (b.bill_type === 'storage') monthStorage += amt;
    if (b.bill_type === 'shipping') monthShipping += amt;
  });
  // 累计：从全部 bills
  const { data: allBills } = await supabase.from('wms_bills')
    .select('total_amount').eq('user_id', uid!);
  const cumulativeFee = (allBills || []).reduce((s: number, b: any) => s + (Number(b.total_amount) || 0), 0);

  // ---------- 7天柱线图 ----------
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const inboundCounts = await Promise.all(days.map(d =>
    supabase.from('wms_asns').select('id', { count: 'exact', head: true })
      .eq('user_id', uid!).like('created_at', `${d}%`)
  ));
  const outboundCounts = await Promise.all(days.map(d =>
    supabase.from('wms_shipments').select('id', { count: 'exact', head: true })
      .eq('user_id', uid!).like('created_at', `${d}%`)
  ));

  // ---------- 近 20 条流水 ----------
  const { data: logs } = await supabase.from('wms_inventory_logs')
    .select('*').eq('user_id', uid!)
    .order('created_at', { ascending: false }).limit(20);

  return {
    pendingAsn: pendingAsn || 0, pendingShip: pendingShip || 0,
    pendingReturn: pendingReturn || 0, pendingFbaReturn: pendingFbaReturn || 0,
    pendingTransfer: pendingTransfer || 0, pendingWo: pendingWo || 0,
    pendingCancel: pendingCancel || 0,
    totalOnHand, skuKinds, availableStock, lowStock: lowStock || 0,
    asnTotal: asnTotal || 0, shipTotal: shipTotal || 0,
    returnTotal: returnTotal || 0, stockTotal: stockTotal || 0,
    monthStorage, monthShipping, totalFee, cumulativeFee,
    days,
    inbound: inboundCounts.map(r => r.count || 0),
    outbound: outboundCounts.map(r => r.count || 0),
    logs: (logs || []) as any[],
  };
}

export function DashboardPage() {
  const nav = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['wms-dash-v5'], queryFn: fetchDash, refetchInterval: 20000,
  });

  const moduleCards = [
    { label: '入库', value: data?.pendingAsn, icon: Download, color: 'from-blue-500 to-blue-600', badge: '待入库', route: '/asns' },
    { label: '出库', value: data?.pendingShip, icon: Upload, color: 'from-purple-500 to-purple-600', badge: '待发货', route: '/shipments' },
    { label: '退件', value: data?.pendingReturn, icon: RotateCcw, color: 'from-teal-500 to-teal-600', badge: '待入库', route: '/returns' },
    { label: 'FBA退货', value: data?.pendingFbaReturn, icon: RefreshCw, color: 'from-amber-500 to-amber-600', badge: '待入库', route: '/wms/fba-returns' },
    { label: '转运', value: data?.pendingTransfer, icon: Truck, color: 'from-rose-500 to-rose-600', badge: '待收货', route: '/transfers' },
    { label: '工单', value: data?.pendingWo, icon: Wrench, color: 'from-orange-500 to-orange-600', badge: '待处理', route: '/wms/work-orders' },
    { label: '截单', value: data?.pendingCancel, icon: XCircle, color: 'from-red-500 to-red-600', badge: '待审批', route: '/wms/shipment-cancellations' },
  ];

  const maxChart = Math.max(1, ...(data?.inbound || []), ...(data?.outbound || []));

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-800">工作台</h2>
        <p className="text-sm text-gray-500 mt-1">领星 WMS v5 · 实时掌握仓库七大模块运行状态</p>
      </div>

      {/* ============ 7 大模块待办 ============ */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {moduleCards.map((m) => (
          <button key={m.label}
            onClick={() => m.route && nav({ to: m.route as any })}
            className="group relative overflow-hidden rounded-xl p-4 text-left shadow-sm border border-gray-100 bg-white hover:shadow-md hover:-translate-y-0.5 transition-all"
          >
            <div className={`absolute -right-4 -top-4 w-20 h-20 rounded-full bg-gradient-to-br ${m.color} opacity-10 group-hover:opacity-20 transition`} />
            <div className={`inline-flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br ${m.color} text-white mb-3 shadow-sm`}>
              <m.icon className="w-4 h-4" />
            </div>
            <div className="text-3xl font-bold text-gray-800 tracking-tight">
              {isLoading ? '-' : (m.value ?? 0)}
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-sm font-medium text-gray-700">{m.label}</span>
              <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">{m.badge}</span>
            </div>
          </button>
        ))}
      </div>

      {/* ============ 库存 + 费用 ============ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 库存 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Boxes className="w-5 h-5 text-brand-500" />
            <h3 className="font-semibold text-gray-800">库存总览</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <BigStat label="在库总数" value={data?.totalOnHand || 0} color="text-brand-600" />
            <BigStat label="SKU 种类" value={data?.skuKinds || 0} color="text-sea-600" />
            <BigStat label="可用库存" value={data?.availableStock || 0} color="text-gray-700" />
            <BigStat label="低库存预警" value={data?.lowStock || 0} color="text-red-500" />
          </div>
        </div>

        {/* 累计单量 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-5 h-5 text-sea-500" />
            <h3 className="font-semibold text-gray-800">累计单量</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <BigStat label="入库累计" value={data?.asnTotal || 0} color="text-blue-600" />
            <BigStat label="出库累计" value={data?.shipTotal || 0} color="text-purple-600" />
            <BigStat label="退件累计" value={data?.returnTotal || 0} color="text-amber-600" />
            <BigStat label="盘点累计" value={data?.stockTotal || 0} color="text-green-600" />
          </div>
        </div>

        {/* 费用 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="w-5 h-5 text-green-600" />
            <h3 className="font-semibold text-gray-800">费用</h3>
          </div>
          <div className="space-y-3">
            <FeeRow label="本月仓储费" value={data?.monthStorage || 0} />
            <FeeRow label="本月运费" value={data?.monthShipping || 0} />
            <div className="pt-3 border-t border-gray-100">
              <FeeRow label="累计费用" value={data?.cumulativeFee || 0} highlight />
            </div>
          </div>
        </div>
      </div>

      {/* ============ 单量分析（7天柱线图） ============ */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center gap-2 mb-4">
          <CalendarClock className="w-5 h-5 text-brand-500" />
          <h3 className="font-semibold text-gray-800">近 7 天出入库趋势</h3>
          <div className="ml-auto flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-blue-500 inline-block" /> 入库
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-purple-500 inline-block" /> 出库
            </span>
          </div>
        </div>

        {isLoading ? (
          <div className="h-48 flex items-center justify-center text-gray-400 text-sm">加载中...</div>
        ) : (
          <div className="flex items-end justify-between gap-2 h-52 px-2">
            {(data?.days || []).map((d, i) => {
              const iv = (data?.inbound || [])[i] || 0;
              const ov = (data?.outbound || [])[i] || 0;
              const iH = maxChart ? (iv / maxChart) * 100 : 0;
              const oH = maxChart ? (ov / maxChart) * 100 : 0;
              const shortLabel = d.slice(5); // MM-DD
              return (
                <div key={d} className="flex-1 flex flex-col items-center gap-1 group">
                  <div className="text-[10px] text-gray-400 group-hover:text-gray-700">
                    {iv + ov > 0 ? `${iv + ov}` : ''}
                  </div>
                  <div className="w-full flex items-end gap-1 h-40">
                    <div className="flex-1 bg-gradient-to-t from-blue-500 to-blue-400 rounded-t transition-all hover:opacity-80"
                      style={{ height: `${Math.max(iH, 2)}%` }}
                      title={`入库: ${iv}`} />
                    <div className="flex-1 bg-gradient-to-t from-purple-500 to-purple-400 rounded-t transition-all hover:opacity-80"
                      style={{ height: `${Math.max(oH, 2)}%` }}
                      title={`出库: ${ov}`} />
                  </div>
                  <div className="text-[11px] text-gray-500">{shortLabel}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ============ 近 7 天出入库流水 (Timeline) ============ */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-gray-500" />
            <span className="font-medium text-gray-700">最近库存流水</span>
          </div>
          <span className="text-xs text-gray-400">按时间倒序 · 前 20 条</span>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 text-sm">加载中...</div>
        ) : !(data?.logs?.length) ? (
          <div className="p-10 text-center text-gray-400 text-sm">暂无流水记录</div>
        ) : (
          <ol className="relative divide-y divide-gray-50">
            {(data?.logs || []).map((l: any) => (
              <li key={l.id} className="flex items-start gap-4 px-5 py-3 hover:bg-gray-50/50">
                <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${l.qty_change >= 0 ? 'bg-green-500' : 'bg-red-500'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-medium text-gray-800 text-sm">{l.sku}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${typeBadge(l.type)}`}>{typeLabel(l.type)}</span>
                    {l.ref_type && <span className="text-[10px] text-gray-400">· {l.ref_type}: {l.ref_id?.slice(0, 8)}</span>}
                  </div>
                  {l.remark && <div className="text-xs text-gray-500 mt-0.5 truncate">{l.remark}</div>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className={`text-sm font-semibold tabular-nums ${l.qty_change >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {l.qty_change > 0 ? '+' : ''}{l.qty_change}
                  </div>
                  <div className="text-xs text-gray-400 tabular-nums w-24 text-right">
                    {new Date(l.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

// ---------- helpers ----------
function BigStat({ label, value, color }: any) {
  return (
    <div>
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}

function FeeRow({ label, value, highlight }: any) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-sm ${highlight ? 'font-semibold text-gray-700' : 'text-gray-600'}`}>{label}</span>
      <span className={`tabular-nums ${highlight ? 'text-xl font-bold text-green-600' : 'text-sm font-medium text-gray-800'}`}>
        ¥ {Number(value || 0).toFixed(2)}
      </span>
    </div>
  );
}

function typeLabel(t: string) {
  const m: Record<string, string> = {
    inbound_putaway: '上架入库', outbound_pick: '出库拣货', move: '库位移动',
    adjust_in: '盘盈', adjust_out: '盘亏', cancellation_rollback: '截单回滚',
    fba_relabel: 'FBA 换标', fba_return: 'FBA 退货',
  };
  return m[t] || t;
}

function typeBadge(t: string) {
  const m: Record<string, string> = {
    inbound_putaway: 'bg-green-50 text-green-600',
    outbound_pick: 'bg-red-50 text-red-500',
    move: 'bg-blue-50 text-blue-600',
    adjust_in: 'bg-amber-50 text-amber-600',
    adjust_out: 'bg-amber-50 text-amber-600',
    cancellation_rollback: 'bg-rose-50 text-rose-600',
  };
  return m[t] || 'bg-gray-100 text-gray-600';
}
