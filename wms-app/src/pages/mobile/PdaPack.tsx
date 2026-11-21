import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { QrScanner } from '../../components/QrScanner';
import { ArrowLeft, PackageCheck, Boxes, CheckCircle, Truck } from 'lucide-react';

interface Order {
  id: string;
  erp_order_no: string;
  status: string;
  receiver_name: string;
  receiver_address: string;
  channel_code: string;
}

interface OrderItem {
  id: string;
  product_id: string;
  sku: string;
  qty: number;
  packed_qty: number;
  picked_qty: number;
}

export default function PdaPack() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [scanResult, setScanResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [trackingNo, setTrackingNo] = useState('');
  const [weight, setWeight] = useState('');
  const [labelUrl, setLabelUrl] = useState<string | null>(null);
  const [step, setStep] = useState<'scan' | 'verify' | 'ship'>('scan');

  useEffect(() => { loadOrders(); }, []);

  async function loadOrders() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data } = await supabase
      .from('erp_orders')
      .select('id, erp_order_no, status, receiver_name, receiver_address, channel_code')
      .eq('user_id', user!.id)
      .in('status', ['picking', 'packing', 'ready_to_ship']);
    setOrders(data || []);
  }

  async function openOrder(order: Order) {
    setCurrentOrder(order);
    setStep('scan');
    setLabelUrl(null);
    setTrackingNo('');
    setWeight('');
    const { data } = await supabase
      .from('erp_order_items')
      .select('id, product_id, sku, qty, packed_qty, picked_qty')
      .eq('order_id', order.id);
    setItems((data as any) || []);
  }

  const handleScan = async (code: string) => {
    setError('');
    setScanResult('');
    if (!currentOrder) return;

    const { data: prods } = await supabase
      .from('wms_products')
      .select('id, sku, name, barcode')
      .eq('sku', code);

    const prod = prods?.[0] || null;
    if (!prod) {
      // 试试 barcode
      const { data: byBarcode } = await supabase
        .from('wms_products')
        .select('id, sku, name, barcode');
      const match = (byBarcode || []).find(
        (p) => p.barcode && p.barcode.includes(code),
      );
      if (match) return handleScan(match.sku);
      setError(`✗ 未找到商品: ${code}`);
      return;
    }

    const item = items.find((i) => i.product_id === prod.id);
    if (!item) {
      setError(`✗ 订单中无此商品: ${prod.sku}`);
      return;
    }
    if (item.packed_qty >= item.picked_qty && item.picked_qty >= item.qty) {
      setScanResult(`✓ ${prod.sku} 已打包完`);
      return;
    }

    const nextPacked = item.packed_qty + 1;
    await supabase.from('erp_order_items').update({ packed_qty: nextPacked }).eq('id', item.id);

    setItems((prev) => prev.map((i) =>
      i.id === item.id ? { ...i, packed_qty: nextPacked } : i,
    ));

    if (navigator.vibrate) navigator.vibrate(40);
    setScanResult(`✓ 已打包: ${prod.sku} (${nextPacked}/${item.qty})`);

    const allPacked = items.every((i) =>
      (i.id === item.id ? nextPacked : i.packed_qty) >= i.qty,
    );
    if (allPacked) {
      setScanResult('🎉 全部打包完！点击下一步申请运单');
      setStep('verify');
    }
  };

  const generateLabel = () => {
    if (!currentOrder) return;
    // 生成面单 PDF（HTML 打印 → 手动保存）
    const label = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>面单 - ${currentOrder.erp_order_no}</title>
<style>
  body { font-family: monospace; padding: 20px; }
  .box { border: 2px solid #333; padding: 15px; width: 380px; }
  .qr { font-size: 20px; font-weight: bold; letter-spacing: 2px; }
  .line { border-top: 1px dashed #333; margin: 10px 0; }
  h2 { margin: 0 0 8px; }
  .big { font-size: 14px; line-height: 1.5; }
</style></head>
<body>
  <div class="box">
    <h2>🚚 Thalvior WMS · 出库面单</h2>
    <div class="line"></div>
    <div><b>订单号：</b>${currentOrder.erp_order_no}</div>
    <div><b>收件人：</b>${currentOrder.receiver_name}</div>
    <div class="big"><b>地址：</b>${currentOrder.receiver_address}</div>
    <div><b>渠道：</b>${currentOrder.channel_code || 'MANUAL'}</div>
    ${trackingNo ? `<div class="big"><b>运单号：</b><span style="font-size:18px;font-weight:bold;color:#c00">${trackingNo}</span></div>` : ''}
    <div class="line"></div>
    <div class="qr">${currentOrder.erp_order_no}</div>
  </div>
  <script>window.print();</script>
</body></html>`;
    const blob = new Blob([label], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    setLabelUrl(url);
  };

  const doShip = async () => {
    if (!currentOrder) return;
    setStep('ship');

    const { data: { user } } = await supabase.auth.getUser();
    const status = trackingNo ? 'shipped' : 'ready_to_ship';

    const updates: any = { status };
    if (trackingNo) {
      updates.tracking_no = trackingNo;
      updates.shipped_at = new Date().toISOString();
    }

    await supabase.from('erp_orders').update(updates).eq('id', currentOrder.id);

    if (trackingNo) {
      // 写 shipment 记录
      await supabase.from('wms_shipment_labels').insert({
        user_id: user!.id,
        erp_order_id: currentOrder.id,
        warehouse_id: (await supabase.from('wms_warehouses').select('id').eq('user_id', user!.id).limit(1)).data?.[0]?.id,
        shipment_no: 'SHP-' + Date.now(),
        tracking_no: trackingNo,
        receiver_name: currentOrder.receiver_name,
        receiver_address: currentOrder.receiver_address,
        weight_kg: parseFloat(weight) || 0.1,
        status: 'shipped',
      });
    }

    await loadOrders();
  };

  // === 渲染 ===

  if (!currentOrder) {
    return (
      <div className="p-4 max-w-md mx-auto">
        <h1 className="text-lg font-bold text-fg mb-4">扫码打包</h1>

        {orders.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Boxes className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">暂无待打包订单</p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((o) => (
              <button
                key={o.id}
                onClick={() => openOrder(o)}
                className="w-full bg-card border border-border rounded-2xl p-4 text-left active:bg-muted"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="font-semibold text-fg">{o.erp_order_no}</div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                    o.status === 'packing' ? 'bg-brand-subtle text-brand' :
                    o.status === 'ready_to_ship' ? 'bg-success-bg text-success' :
                    'bg-warning-bg text-warning'
                  }`}>{o.status}</span>
                </div>
                <div className="text-sm text-muted-foreground">{o.receiver_name}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const allPacked = items.length > 0 && items.every((i) => i.packed_qty >= i.qty);

  return (
    <div className="p-4 max-w-md mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => { setCurrentOrder(null); loadOrders(); }} className="p-2 rounded-lg hover:bg-muted">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-fg truncate">{currentOrder.erp_order_no}</h1>
          <p className="text-xs text-muted-foreground">{currentOrder.receiver_name}</p>
        </div>
      </div>

      {/* 打包进度 */}
      {step === 'scan' && (
        <>
          <div className="mb-4 space-y-2">
            {items.map((item) => {
              const done = item.packed_qty >= item.qty;
              return (
                <div key={item.id} className={`p-3 rounded-xl ${done ? 'bg-success-bg border border-success' : 'bg-card border border-border'}`}>
                  <div className="flex justify-between">
                    <span className={`font-medium ${done ? 'text-success' : 'text-fg'}`}>{item.sku}</span>
                    <span className={`text-sm ${done ? 'text-success' : 'text-muted-foreground'}`}>{item.packed_qty}/{item.qty}</span>
                  </div>
                  <div className="mt-1 h-1.5 bg-border rounded-full overflow-hidden">
                    <div className={`h-full transition-all ${done ? 'bg-success-bg0' : 'bg-brand-subtle0'}`}
                      style={{ width: `${(item.packed_qty / item.qty) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          {(scanResult || error) && (
            <div className={`mb-3 p-3 rounded-xl text-sm ${error ? 'bg-danger-bg text-danger' : 'bg-brand-subtle text-brand'}`}>
              {error || scanResult}
            </div>
          )}
          <QrScanner onDetected={handleScan} placeholder="扫描商品条码或 SKU" />
          {allPacked && (
            <button
              onClick={() => setStep('verify')}
              className="w-full mt-4 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl font-medium active:opacity-90"
            >
              下一步：申请运单 →
            </button>
          )}
        </>
      )}

      {/* 步骤2: 申请运单 */}
      {step === 'verify' && (
        <div className="space-y-4">
          <div className="bg-brand-subtle rounded-xl p-4">
            <div className="text-sm text-brand mb-3">
              <Truck className="w-5 h-5 inline mr-1" />
              全部 {items.length} 件商品已打包完成
            </div>
            <label className="block text-xs text-muted-foreground mb-1">实际称重 (kg)</label>
            <input type="number" step="0.01" value={weight} onChange={(e) => setWeight(e.target.value)}
              placeholder="0.00"
              className="w-full px-3 py-2 border border-input rounded-lg bg-card mb-3" />
            <label className="block text-xs text-muted-foreground mb-1">运单号（手动填或等渠道返回）</label>
            <input type="text" value={trackingNo} onChange={(e) => setTrackingNo(e.target.value)}
              placeholder="例如 4PX1234567890"
              className="w-full px-3 py-2 border border-input rounded-lg bg-card" />
          </div>

          <div className="flex gap-2">
            <button onClick={() => setStep('scan')} className="flex-1 py-3 border border-input rounded-xl font-medium">← 返回</button>
            <button onClick={doShip} className="flex-1 py-3 bg-gradient-to-r from-brand-500 to-brand-600 text-white rounded-xl font-medium">
              确认出库
            </button>
          </div>
        </div>
      )}

      {/* 步骤3: 面单 */}
      {step === 'ship' && (
        <div className="space-y-4">
          <div className="bg-success-bg rounded-xl p-4 text-center">
            <CheckCircle className="w-10 h-10 mx-auto mb-2 text-success" />
            <div className="text-success font-semibold text-lg">🎉 出库成功！</div>
            {trackingNo && <div className="text-sm text-success mt-1">运单号: {trackingNo}</div>}
          </div>
          <button
            onClick={generateLabel}
            className="w-full py-3 bg-gradient-to-r from-brand-500 to-brand-600 text-white rounded-xl font-medium"
          >
            🖨️ 生成面单
          </button>
          {labelUrl && (
            <a href={labelUrl} target="_blank" className="block text-center py-3 bg-fg text-white rounded-xl">
              打开/下载面单
            </a>
          )}
          <button
            onClick={() => { setCurrentOrder(null); loadOrders(); }}
            className="w-full py-3 border border-input rounded-xl"
          >
            返回订单列表
          </button>
        </div>
      )}
    </div>
  );
}
