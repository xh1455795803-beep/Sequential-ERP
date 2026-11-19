import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Warehouse, Boxes, Download, Upload, Clock, TrendingUp, AlertTriangle, Barcode, Search, Truck, PackageCheck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';

async function getStats() {
  // 并行拉所有统计数据
  const [whCount, invProducts, invTotal, receiptCount, labelCount, pendingReceipts, pendingLabels, tasks, logs] = await Promise.all([
    supabase.from('wms_warehouses').select('id', { count: 'exact', head: true }),
    supabase.from('wms_inventory').select('product_id', { count: 'exact', head: true }),
    supabase.from('wms_inventory').select('qty_onhand'),
    supabase.from('wms_inbound_receipts').select('id', { count: 'exact', head: true }),
    supabase.from('wms_shipment_labels').select('id', { count: 'exact', head: true }),
    supabase.from('wms_inbound_receipts').select('*').in('status', [1, 2]),     // 1待收货 2收货中
    supabase.from('wms_shipment_labels').select('*').in('status', [1, 2]),      // 1已生成 2已打印
    supabase.from('wms_work_tasks').select('*').eq('status', 1),               // 1待领取
    supabase.from('wms_inventory_txn')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  // 汇总在库总数
  const total = (invTotal.data || []).reduce((s, r: any) => s + (r.qty_onhand || 0), 0);

  return {
    warehouses: whCount.count || 0,
    skuTypes: invProducts.count || 0,
    total,
    receipts: receiptCount.count || 0,
    labels: labelCount.count || 0,
    pendingReceipts: pendingReceipts.data?.length || 0,
    pendingLabels: pendingLabels.data?.length || 0,
    taskCount: tasks.data?.length || 0,
    recentLogs: logs.data || [],
  };
}

const TXN_TYPE_LABEL: Record<string, string> = {
  INBOUND: '入库', OUTBOUND: '出库', LOCK: '锁定',
  UNLOCK: '解锁', ADJUST: '调整', TRANSFER: '调拨', DEFECTIVE: '次品',
};

export function DashboardPage() {
  const { data, isLoading } = useQuery({ queryKey: ['wms-dash'], queryFn: getStats, refetchInterval: 15000 });
  const [barcode, setBarcode] = useState('');
  const [scanResult, setScanResult] = useState<any>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const nav = useNavigate();

  const cards = [
    { label: '仓库数量',   value: data?.warehouses,    icon: Warehouse,  color: 'bg-sea-500' },
    { label: 'SKU 种类',  value: data?.skuTypes,     icon: Boxes,     color: 'bg-brand-500' },
    { label: '在库总数',  value: data?.total,        icon: TrendingUp, color: 'bg-deep-700' },
    { label: '入库待处理', value: data?.pendingReceipts, icon: Download,  color: 'bg-green-500' },
    { label: '出库待处理', value: data?.pendingLabels,  icon: Upload,    color: 'bg-purple-500' },
    { label: '作业任务',   value: data?.taskCount,      icon: Clock,     color: 'bg-orange-500' },
  ];

  async function handleScan() {
    const code = barcode.trim();
    if (!code) { setScanResult({ error: '请输入或扫码' }); return; }
    setScanLoading(true);
    setScanResult(null);

    try {
      // 1. 先按条码查 product_id
      const { data: barcodeMatch } = await supabase
        .from('wms_product_barcodes').select('product_id, sku').eq('barcode', code).limit(1);
      const productId = barcodeMatch?.[0]?.product_id;

      // 2. 查 SKU
      const { data: skuMatch } = await supabase
        .from('wms_products').select('id, sku_code, name').eq('sku_code', code).limit(1);
      const finalProductId = productId || skuMatch?.[0]?.id;

      // 3. 查库存（按 product_id）
      let invWithLoc: any[] = [];
      if (finalProductId) {
        const { data: inv } = await supabase
          .from('wms_inventory')
          .select('id, product_id, bin_id, qty_onhand, qty_locked, warehouse_id')
          .eq('product_id', finalProductId);

        if (inv?.length) {
          const binIds = [...new Set(inv.map((r: any) => r.bin_id))];
          const { data: bins } = await supabase.from('wms_bins').select('id, bin_code').in('id', binIds);
          const binMap = Object.fromEntries((bins || []).map((b: any) => [b.id, b.bin_code]));
          invWithLoc = inv.map((r: any) => ({
            ...r,
            bin_code: binMap[r.bin_id] || '?',
            sku_code: skuMatch?.[0]?.sku_code || barcodeMatch?.[0]?.sku || code,
          }));
        }
      }

      setScanResult({ query: code, inventory: invWithLoc });
    } catch (e: any) {
      setScanResult({ error: e.message });
    } finally {
      setScanLoading(false);
    }
  }

  const quickActions = [
    { label: '新建入库', icon: PackageCheck, onClick: () => nav({ to: '/asns' }) },
    { label: '库存查询', icon: Search,      onClick: () => nav({ to: '/inventory' }) },
    { label: '新建出库', icon: Truck,       onClick: () => nav({ to: '/shipments' }) },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">工作台</h2>
        <p className="text-sm text-gray-500 mt-1">实时掌握仓库运行状态</p>
      </div>

      {/* 扫码入口 */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <div className="flex items-center gap-2 mb-3">
          <Barcode className="w-5 h-5 text-brand-500" />
          <span className="font-medium text-gray-800">快速扫码</span>
          <span className="text-xs text-gray-400 ml-2">支持 SKU / 条码 → 查到库存位置</span>
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
          <button onClick={handleScan} disabled={scanLoading}
            className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600 disabled:opacity-50">
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
                    {scanResult.inventory.map((inv: any) => (
                      <div key={inv.id} className="text-gray-600 flex justify-between">
                        <span>{inv.sku_code} → 库位 {inv.bin_code}</span>
                        <span className="text-gray-800 font-medium">{inv.qty_onhand} 件</span>
                      </div>
                    ))}
                  </div>
                )}
                {!scanResult.inventory?.length && (
                  <div className="text-gray-400">未找到 "{scanResult.query}" 的库存</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 快捷操作 */}
      <div className="flex gap-3">
        {quickActions.map(a => (
          <button key={a.label} onClick={a.onClick}
            className="flex items-center gap-2 px-4 py-2.5 bg-white rounded-xl shadow-sm border border-gray-100 hover:border-brand-200 hover:shadow transition text-sm text-gray-700 font-medium">
            <a.icon className="w-4 h-4 text-brand-500" />
            {a.label}
          </button>
        ))}
      </div>

      {/* 统计卡片 */}
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

      {/* 待办提醒 */}
      {data && (data.pendingReceipts > 0 || data.pendingLabels > 0 || data.taskCount > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-sm text-amber-800">
            <div className="font-medium mb-1">待处理任务</div>
            <div>有 <b>{data.pendingReceipts}</b> 个入库单待收货，
                 <b>{data.pendingLabels}</b> 个出库单待发货，
                 <b>{data.taskCount}</b> 个作业任务待领取。</div>
          </div>
        </div>
      )}

      {/* 最近库存流水 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 font-medium text-gray-700">最近库存流水</div>
        {isLoading ? (
          <div className="p-8 text-center text-gray-400">加载中...</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="text-left px-5 py-2.5">时间</th>
                <th className="text-left px-5 py-2.5">类型</th>
                <th className="text-right px-5 py-2.5">变动</th>
                <th className="text-left px-5 py-2.5">关联</th>
              </tr>
            </thead>
            <tbody>
              {((data?.recentLogs as any[]) || []).map((l) => (
                <tr key={l.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                  <td className="px-5 py-2.5 text-gray-500">{new Date(l.created_at).toLocaleString('zh-CN')}</td>
                  <td className="px-5 py-2.5">
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      ['INBOUND','LOCK','UNLOCK','TRANSFER'].includes(l.txn_type) ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
                    }`}>{TXN_TYPE_LABEL[l.txn_type] || l.txn_type}</span>
                  </td>
                  <td className={`px-5 py-2.5 text-right font-medium ${(l.qty_delta || 0) > 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {(l.qty_delta || 0) > 0 ? '+' : ''}{l.qty_delta ?? 0}
                  </td>
                  <td className="px-5 py-2.5 text-gray-400 text-xs">{l.ref_type || ''} · {l.ref_no || ''}</td>
                </tr>
              ))}
              {(!data?.recentLogs?.length) && (
                <tr><td colSpan={4} className="p-8 text-center text-gray-400">暂无流水</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
