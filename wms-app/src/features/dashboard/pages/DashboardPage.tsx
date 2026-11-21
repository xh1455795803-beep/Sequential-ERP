import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { Warehouse, Boxes, Download, Upload, Clock, PackageCheck, Search, AlertTriangle, TrendingUp } from 'lucide-react';
import { PageHeader, StatCard, DataTable, Badge, TableColumn } from '../../../components/shared/ui';
import { useState } from 'react';

async function getStats() {
  const [whCount, invProducts, invTotal, receiptCount, labelCount, pendingReceipts, pendingLabels, tasks, logs] = await Promise.all([
    supabase.from('wms_warehouses').select('id', { count: 'exact', head: true }),
    supabase.from('wms_inventory').select('product_id', { count: 'exact', head: true }),
    supabase.from('wms_inventory').select('qty_onhand'),
    supabase.from('wms_inbound_receipts').select('id', { count: 'exact', head: true }),
    supabase.from('wms_shipment_labels').select('id', { count: 'exact', head: true }),
    supabase.from('wms_inbound_receipts').select('*').in('status', [1, 2]),
    supabase.from('wms_shipment_labels').select('*').in('status', [1, 2]),
    supabase.from('wms_work_tasks').select('*').eq('status', 1),
    supabase.from('wms_inventory_txn').select('*').order('created_at', { ascending: false }).limit(10),
  ]);
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

const TXN_TONE: Record<string, 'success' | 'danger'> = {
  INBOUND: 'success', OUTBOUND: 'danger', LOCK: 'info',
  UNLOCK: 'info', ADJUST: 'warning', TRANSFER: 'warning', DEFECTIVE: 'danger',
};
const TXN_LABEL: Record<string, string> = {
  INBOUND: '入库', OUTBOUND: '出库', LOCK: '锁定',
  UNLOCK: '解锁', ADJUST: '调整', TRANSFER: '调拨', DEFECTIVE: '次品',
};

export function DashboardPage() {
  const { data, isLoading } = useQuery({ queryKey: ['wms-dash'], queryFn: getStats, refetchInterval: 15000 });
  const [barcode, setBarcode] = useState('');
  const [scanResult, setScanResult] = useState<any>(null);
  const [scanLoading, setScanLoading] = useState(false);

  async function handleScan() {
    const code = barcode.trim();
    if (!code) { setScanResult({ error: '请输入或扫码' }); return; }
    setScanLoading(true); setScanResult(null);
    try {
      const { data: barcodeMatch } = await supabase.from('wms_product_barcodes').select('product_id, sku').eq('barcode', code).limit(1);
      const productId = barcodeMatch?.[0]?.product_id;
      const { data: skuMatch } = await supabase.from('wms_products').select('id, sku_code, name').eq('sku_code', code).limit(1);
      const finalProductId = productId || skuMatch?.[0]?.id;
      let invWithLoc: any[] = [];
      if (finalProductId) {
        const { data: inv } = await supabase.from('wms_inventory')
          .select('id, product_id, bin_id, qty_onhand, qty_locked, warehouse_id').eq('product_id', finalProductId);
        if (inv?.length) {
          const binIds = [...new Set(inv.map((r: any) => r.bin_id))];
          const { data: bins } = await supabase.from('wms_bins').select('id, bin_code').in('id', binIds);
          const binMap = Object.fromEntries((bins || []).map((b: any) => [b.id, b.bin_code]));
          invWithLoc = inv.map((r: any) => ({
            ...r, bin_code: binMap[r.bin_id] || '?',
            sku_code: skuMatch?.[0]?.sku_code || barcodeMatch?.[0]?.sku || code,
          }));
        }
      }
      setScanResult({ query: code, inventory: invWithLoc });
    } catch (e: any) {
      setScanResult({ error: e.message });
    } finally { setScanLoading(false); }
  }

  const txnCols: TableColumn<any>[] = [
    { key: 'created_at', label: '时间', align: 'left',
      render: (r) => <span className="text-fg-muted font-data tabular-nums text-xs">{new Date(r.created_at).toLocaleString('zh-CN')}</span> },
    { key: 'txn_type', label: '类型', align: 'left',
      render: (r) => <Badge tone={TXN_TONE[r.txn_type] ?? 'info'}>{TXN_LABEL[r.txn_type] || r.txn_type}</Badge> },
    { key: 'qty_delta', label: '变动', align: 'right',
      render: (r) => <span className={`font-data tabular-nums font-medium ${(r.qty_delta || 0) > 0 ? 'text-success' : 'text-destructive'}`}>
        {(r.qty_delta || 0) > 0 ? '+' : ''}{r.qty_delta ?? 0}
      </span> },
    { key: 'ref', label: '关联', align: 'left',
      render: (r) => <span className="text-xs text-fg-subtle">{r.ref_type || ''} · {r.ref_no || ''}</span> },
  ];

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      {/* 页面头部 */}
      <PageHeader
        code="WMS PORTAL"
        title="工作台"
        description="实时掌握仓库运行状态"
      />

      {/* StatCard 网格（meoo 风格） */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <StatCard label="仓库数量"   value={isLoading ? '-' : data?.warehouses ?? 0}  icon={Warehouse}  tone="primary" />
        <StatCard label="SKU 种类"  value={isLoading ? '-' : data?.skuTypes ?? 0}   icon={Boxes}      tone="info" />
        <StatCard label="在库总数"  value={isLoading ? '-' : data?.total ?? 0}       icon={TrendingUp} tone="success" />
        <StatCard label="入库待处理" value={isLoading ? '-' : data?.pendingReceipts ?? 0} icon={Download} tone="warning" />
        <StatCard label="出库待处理" value={isLoading ? '-' : data?.pendingLabels ?? 0}   icon={Upload}   tone="danger" />
        <StatCard label="作业任务"   value={isLoading ? '-' : data?.taskCount ?? 0}      icon={Clock}    tone="info" />
      </div>

      {/* 快速扫码（meoo 风格：shadow-soft 卡片） */}
      <div className="rounded-xl border border-border bg-card shadow-soft p-4">
        <div className="flex items-center gap-2 mb-3">
          <Search className="h-4 w-4 text-brand" />
          <span className="font-medium text-fg">快速扫码</span>
          <span className="text-xs text-fg-subtle ml-2">支持 SKU / 条码 → 查到库存位置</span>
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
            className="h-9 px-4 rounded-md bg-brand text-brand-ink text-sm hover:bg-brand-hover transition disabled:opacity-50">
            {scanLoading ? '查询中...' : '查询'}
          </button>
        </div>
        {scanResult && (
          <div className="mt-4 rounded-md bg-surface-hover/70 p-3 text-sm">
            {scanResult.error ? (
              <div className="text-destructive">{scanResult.error}</div>
            ) : scanResult.inventory?.length > 0 ? (
              <div className="space-y-2">
                <div className="font-medium text-fg-muted mb-1">📦 库存位置 ({scanResult.inventory.length})</div>
                {scanResult.inventory.map((inv: any) => (
                  <div key={inv.id} className="flex justify-between text-fg">
                    <span>{inv.sku_code} → 库位 {inv.bin_code}</span>
                    <span className="font-medium">{inv.qty_onhand} 件</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-fg-muted">未找到 "{scanResult.query}" 的库存</div>
            )}
          </div>
        )}
      </div>

      {/* 待办提醒（meoo 风格：rounded-xl + bg-warn-subtle） */}
      {data && (data.pendingReceipts > 0 || data.pendingLabels > 0 || data.taskCount > 0) && (
        <div className="flex items-start gap-3 rounded-xl border border-warn-subtle bg-warn-subtle/50 p-4">
          <AlertTriangle className="h-5 w-5 text-warn mt-0.5 shrink-0" />
          <div className="text-sm text-warn-ink">
            <div className="font-medium mb-1">待处理任务</div>
            <div>有 <b>{data.pendingReceipts}</b> 个入库单待收货，
                 <b>{data.pendingLabels}</b> 个出库单待发货，
                 <b>{data.taskCount}</b> 个作业任务待领取。</div>
          </div>
        </div>
      )}

      {/* 最近库存流水（DataTable） */}
      <div>
        <div className="mb-3">
          <h2 className="font-display text-lg font-semibold tracking-tight text-fg">最近库存流水</h2>
          <p className="mt-0.5 text-xs text-fg-muted">实时同步仓库变动</p>
        </div>
        <DataTable
          columns={txnCols}
          rows={(data?.recentLogs as any[]) || []}
          rowKey={(r) => r.id}
          loading={isLoading}
          emptyState={<div className="p-8 text-center text-fg-muted text-sm">暂无流水</div>}
        />
      </div>
    </div>
  );
}
