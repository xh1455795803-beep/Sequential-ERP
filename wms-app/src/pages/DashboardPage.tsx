import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Warehouse, Boxes, Download, Upload, Clock, TrendingUp, AlertTriangle, Barcode, Search, PackageOpen, Truck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';

async function getStats() {
  const [warehouses, inv, asns, shipments, pendingAsn, pendingShip, tasks, logs] = await Promise.all([
    supabase.from('wms_warehouses').select('id', { count: 'exact', head: true }),
    supabase.from('wms_inventory').select('qty_on_hand', { count: 'exact', head: true }),
    supabase.from('wms_asns').select('*', { count: 'exact', head: true }),
    supabase.from('wms_shipments').select('*', { count: 'exact', head: true }),
    supabase.from('wms_asns').select('*').in('status', ['arrived', 'receiving', 'putaway']),
    supabase.from('wms_shipments').select('*').in('status', ['released', 'picking', 'packed']),
    supabase.from('wms_putaway_tasks').select('*').eq('status', 'pending'),
    supabase.from('wms_inventory_logs').select('*').order('created_at', { ascending: false }).limit(10),
  ]);

  const { data: invSum } = await supabase.from('wms_inventory')
    .select('qty_on_hand');

  const total = (invSum || []).reduce((s, r) => s + (r.qty_on_hand || 0), 0);

  return {
    warehouses: warehouses.count || 0,
    skuTypes: inv.count || 0,
    total,
    asns: asns.count || 0,
    shipments: shipments.count || 0,
    pendingAsn: pendingAsn.data?.length || 0,
    pendingShip: pendingShip.data?.length || 0,
    taskCount: tasks.data?.length || 0,
    recentLogs: logs.data || [],
  };
}

export function DashboardPage() {
  const { data, isLoading } = useQuery({ queryKey: ['wms-dash'], queryFn: getStats, refetchInterval: 15000 });
  const [barcode, setBarcode] = useState('');
  const [scanResult, setScanResult] = useState<any>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const nav = useNavigate();

  const cards = [
    { label: '仓库数量', value: data?.warehouses, icon: Warehouse, color: 'bg-sea-500' },
    { label: 'SKU 种类', value: data?.skuTypes, icon: Boxes, color: 'bg-brand-500' },
    { label: '在库总数', value: data?.total, icon: TrendingUp, color: 'bg-deep-700' },
    { label: '入库待处理', value: data?.pendingAsn, icon: Download, color: 'bg-green-500' },
    { label: '出库待处理', value: data?.pendingShip, icon: Upload, color: 'bg-purple-500' },
    { label: '上架任务', value: data?.taskCount, icon: Clock, color: 'bg-orange-500' },
  ];

  async function handleScan() {
    const code = barcode.trim();
    if (!code) { setScanResult({ error: '请输入或扫码' }); return; }
    setScanLoading(true);
    setScanResult(null);

    try {
      // 1. 查库存（简单 select，避免 inner join 的 400 错误）
      const { data: inv } = await supabase
        .from('wms_inventory')
        .select('sku, location_id, qty_on_hand, qty_available, warehouse_id')
        .eq('sku', code)
        .limit(10);

      // 如果有库存，额外查对应的库位 code（如果需要）
      let invWithLoc: any[] = inv || [];
      if (invWithLoc.length > 0) {
        const locIds = [...new Set(invWithLoc.map((r: any) => r.location_id))];
        const { data: locs } = await supabase
          .from('wms_locations')
          .select('id, code')
          .in('id', locIds);
        const locMap = Object.fromEntries((locs || []).map((l: any) => [l.id, l.code]));
        invWithLoc = invWithLoc.map((r: any) => ({ ...r, code: locMap[r.location_id] }));
      }

      // 2. 查待上架 ASN（用 RPC 或分开查 SKU 和 barcode）
      const [{ data: bySku }, { data: byBarcode }] = await Promise.all([
        supabase.from('wms_asns')
          .select('id, asn_no, status, wms_asn_items!inner(sku, putaway_qty, expected_qty)')
          .eq('wms_asn_items.sku', code)
          .in('status', ['submitted', 'in_transit', 'arrived', 'receiving', 'putaway'])
          .limit(5),
        supabase.from('wms_asns')
          .select('id, asn_no, status, wms_asn_items!inner(sku, putaway_qty, expected_qty)')
          .eq('wms_asn_items.barcode', code)
          .in('status', ['submitted', 'in_transit', 'arrived', 'receiving', 'putaway'])
          .limit(5),
      ]);

      // 合并去重
      const seen = new Set();
      const allAsns = [];
      for (const src of [bySku, byBarcode]) {
        for (const a of (src || [])) {
          if (!seen.has(a.id)) {
            seen.add(a.id);
            allAsns.push(a);
          }
        }
      }

      setScanResult({
        query: code,
        inventory: invWithLoc,
        pendingAsns: allAsns.filter((a: any) =>
          (a.wms_asn_items || []).some((it: any) => (it.putaway_qty || 0) < (it.expected_qty || 0))
        ),
      });
    } catch (e: any) {
      setScanResult({ error: e.message });
    } finally {
      setScanLoading(false);
    }
  }

  const quickActions = [
    { label: '新建 ASN', icon: PackageOpen, onClick: () => nav({ to: '/asns' }) },
    { label: '库存查询', icon: Search, onClick: () => nav({ to: '/inventory' }) },
    { label: '新建出库', icon: Truck, onClick: () => nav({ to: '/shipments' }) },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">工作台</h2>
        <p className="text-sm text-gray-500 mt-1">实时掌握仓库运行状态</p>
      </div>

      {/* ========== 🆕 扫码入口 ========== */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <div className="flex items-center gap-2 mb-3">
          <Barcode className="w-5 h-5 text-brand-500" />
          <span className="font-medium text-gray-800">快速扫码</span>
          <span className="text-xs text-gray-400 ml-2">支持 SKU / 条码，查到库存和待上架 ASN</span>
        </div>
        <div className="flex gap-2">
          <input
            className="inp flex-1"
            placeholder="扫码枪扫描 SKU 或条码后回车..."
            value={barcode}
            onChange={e => setBarcode(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleScan(); }}
            autoFocus
          />
          <button
            onClick={handleScan}
            disabled={scanLoading}
            className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600 disabled:opacity-50"
          >
            {scanLoading ? '扫描中...' : '查询'}
          </button>
        </div>

        {scanResult && (
          <div className="mt-4 p-3 bg-gray-50 rounded-lg text-sm">
            {scanResult.error ? (
              <div className="text-red-500">{scanResult.error}</div>
            ) : (
              <div className="space-y-3">
                {scanResult.inventory?.length > 0 && (
                  <div>
                    <div className="font-medium text-gray-700 mb-1">📦 库存位置 ({scanResult.inventory.length})</div>
                    {scanResult.inventory.map((inv: any, i: number) => (
                      <div key={i} className="text-gray-600 flex justify-between">
                        <span>{inv.sku} → 库位 {inv.wms_locations?.code || '?'}</span>
                        <span className="text-gray-800 font-medium">{inv.qty_on_hand} 件</span>
                      </div>
                    ))}
                  </div>
                )}
                {scanResult.pendingAsns?.length > 0 && (
                  <div>
                    <div className="font-medium text-gray-700 mb-1">📥 待上架 ASN ({scanResult.pendingAsns.length})</div>
                    {scanResult.pendingAsns.map((asn: any) => {
                      const item = asn.wms_asn_items?.find((it: any) => it.sku === scanResult.query);
                      const remaining = (item?.qty || 0) - (item?.putaway_qty || 0);
                      return (
                        <div key={asn.id} className="flex justify-between items-center">
                          <span className="text-gray-600">{asn.asn_no} · 剩 {remaining} 件待上架</span>
                          <button
                            onClick={() => nav({ to: '/asns/$id', params: { id: String(asn.id) } })}
                            className="text-brand-500 hover:text-brand-600 text-xs font-medium"
                          >
                            去上架 →
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {!scanResult.inventory?.length && !scanResult.pendingAsns?.length && (
                  <div className="text-gray-400">未找到 "{scanResult.query}" 的库存或待入库记录</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ========== 快捷操作 ========== */}
      <div className="flex gap-3">
        {quickActions.map(a => (
          <button
            key={a.label}
            onClick={a.onClick}
            className="flex items-center gap-2 px-4 py-2.5 bg-white rounded-xl shadow-sm border border-gray-100 hover:border-brand-200 hover:shadow transition text-sm text-gray-700 font-medium"
          >
            <a.icon className="w-4 h-4 text-brand-500" />
            {a.label}
          </button>
        ))}
      </div>

      {/* ========== 统计卡片 ========== */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className={`w-9 h-9 rounded-lg ${c.color} text-white flex items-center justify-center mb-3`}>
              <c.icon className="w-4 h-4" />
            </div>
            <div className="text-2xl font-bold text-gray-800">{isLoading ? '-' : c.value ?? 0}</div>
            <div className="text-xs text-gray-500 mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      {/* ========== 待办提醒 ========== */}
      {data && (data.pendingAsn > 0 || data.pendingShip > 0 || data.taskCount > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-sm text-amber-800">
            <div className="font-medium mb-1">待处理任务</div>
            <div>有 <b>{data.pendingAsn}</b> 个入库单在等待处理，
                 <b>{data.pendingShip}</b> 个出库单在等待发货，
                 <b>{data.taskCount}</b> 个上架任务待执行。</div>
          </div>
        </div>
      )}

      {/* ========== 最近流水 ========== */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 font-medium text-gray-700">最近库存流水</div>
        {isLoading ? (
          <div className="p-8 text-center text-gray-400">加载中...</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="text-left px-5 py-2.5">时间</th>
                <th className="text-left px-5 py-2.5">SKU</th>
                <th className="text-left px-5 py-2.5">类型</th>
                <th className="text-right px-5 py-2.5">变动</th>
                <th className="text-right px-5 py-2.5">变动后</th>
              </tr>
            </thead>
            <tbody>
              {((data?.recentLogs as any[]) || []).map((l) => (
                <tr key={l.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                  <td className="px-5 py-2.5 text-gray-500">{new Date(l.created_at).toLocaleString('zh-CN')}</td>
                  <td className="px-5 py-2.5 font-medium">{l.sku}</td>
                  <td className="px-5 py-2.5">
                    <span className={`px-2 py-0.5 rounded text-xs ${l.qty_change >= 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                      {typeLabel(l.type)}
                    </span>
                  </td>
                  <td className={`px-5 py-2.5 text-right ${l.qty_change >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {l.qty_change > 0 ? '+' : ''}{l.qty_change}
                  </td>
                  <td className="px-5 py-2.5 text-right font-medium">{l.qty_after}</td>
                </tr>
              ))}
              {(!data?.recentLogs?.length) && (
                <tr><td colSpan={5} className="p-8 text-center text-gray-400">暂无数据</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function typeLabel(t: string) {
  const m: Record<string, string> = {
    inbound_putaway: '上架入库', outbound_pick: '出库拣货',
    move: '库位移动', adjust_in: '盘盈', adjust_out: '盘亏',
  };
  return m[t] || t;
}
