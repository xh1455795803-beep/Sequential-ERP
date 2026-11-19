import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { QrScanner } from '../../components/QrScanner';
import { QrCode, ArrowLeft, PackageCheck, Boxes, Loader2 } from 'lucide-react';

interface Order {
  id: string;
  erp_order_no: string;
  status: string;
  receiver_name: string;
}

interface OrderItem {
  id: string;
  product_id: string;
  sku: string;
  qty: number;
  picked_qty: number;
  location_code?: string;
}

interface InventoryItem {
  id: string;
  product_id: string;
  sku: string;
  qty_on_hand: number;
  bin_id: string;
  location_code: string;
}

export default function PdaPick() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [scanResult, setScanResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadOrders();
  }, []);

  async function loadOrders() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data } = await supabase
      .from('erp_orders')
      .select('id, erp_order_no, status, receiver_name')
      .eq('user_id', user!.id)
      .in('status', ['pending', 'confirmed', 'picking'])
      .order('created_at', { ascending: true });
    setOrders(data || []);
  }

  async function openOrder(order: Order) {
    setCurrentOrder(order);
    setLoading(true);
    const [{ data: oi }, { data: inv }] = await Promise.all([
      supabase
        .from('erp_order_items')
        .select('id, product_id, sku, qty, picked_qty')
        .eq('order_id', order.id),
      supabase
        .from('wms_inventory')
        .select('id, product_id, sku, qty_on_hand, bin_id, locations!inner(code)')
        .eq('user_id', order.id.startsWith('6f') ? order.id.substring(0, 0) : '')
        .limit(1),
    ]);

    // 带库位的库存
    const { data: fullInv } = await supabase
      .from('wms_inventory')
      .select(`
        id, product_id, sku, qty_on_hand, bin_id,
        locations!inner ( code )
      `);

    const invList: InventoryItem[] = (fullInv || []).map((row: any) => ({
      id: row.id,
      product_id: row.product_id,
      sku: row.sku,
      qty_on_hand: row.qty_on_hand,
      bin_id: row.bin_id,
      location_code: row.locations?.code || '-',
    }));

    setItems((oi as any) || []);
    setInventory(invList);
    setLoading(false);
  }

  const handleScan = async (code: string) => {
    setError('');
    setScanResult('');
    if (!currentOrder) return;

    // 找匹配的 item（按 SKU 或 barcode）
    const productIds = items.map((i) => i.product_id).filter(Boolean);
    const { data: prods } = await supabase
      .from('wms_products')
      .select('id, sku, name, barcode')
      .in('id', productIds.length ? productIds : ['00000000-0000-0000-0000-000000000000']);

    const matchProd = (prods || []).find(
      (p) => p.sku === code || (p.barcode && p.barcode.includes(code)),
    );

    if (!matchProd) {
      setError(`✗ 订单中无此商品: ${code}`);
      if (navigator.vibrate) navigator.vibrate(100);
      return;
    }

    const item = items.find((i) => i.product_id === matchProd.id);
    if (!item) {
      setError(`✗ 订单中无 SKU: ${matchProd.sku}`);
      return;
    }

    if (item.picked_qty >= item.qty) {
      setScanResult(`✓ ${matchProd.sku} 已拣完 (${item.qty}/${item.qty})`);
      return;
    }

    // 扣库存 + 更新 picked_qty
    const needPick = item.qty - item.picked_qty;
    const { data: { user } } = await supabase.auth.getUser();

    // 找有库存的库位
    const stock = inventory.find((s) => s.product_id === matchProd.id && s.qty_on_hand > 0);
    if (!stock) {
      setError(`✗ ${matchProd.sku} 库存不足`);
      return;
    }

    const pickQty = Math.min(needPick, stock.qty_on_hand);

    // 事务：扣库存 + 写流水 + 更新 picked_qty
    await supabase.rpc('do_pick', {
      p_user_id: user!.id,
      p_order_item_id: item.id,
      p_inventory_id: stock.id,
      p_qty: pickQty,
    }).catch(async () => {
      // RPC 不存在就手动做
      const { data: inv } = await supabase.from('wms_inventory').select('qty_on_hand').eq('id', stock.id).single();
      await supabase.from('wms_inventory').update({ qty_on_hand: inv!.qty_on_hand - pickQty }).eq('id', stock.id);
      await supabase.from('erp_order_items').update({ picked_qty: item.picked_qty + pickQty }).eq('id', item.id);
      await supabase.from('wms_inventory_txn').insert({
        user_id: user!.id,
        warehouse_id: (await supabase.from('wms_warehouses').select('id').eq('user_id', user!.id).limit(1)).data?.[0]?.id,
        product_id: matchProd.id,
        sku: matchProd.sku,
        bin_id: stock.bin_id,
        qty_change: -pickQty,
        qty_after: inv!.qty_on_hand - pickQty,
        type: 'pick',
        ref_type: 'erp_order',
        ref_id: currentOrder.id,
        remark: `PDA 拣货 ${matchProd.sku}`,
      });
    });

    // 更新本地状态
    setItems((prev) => prev.map((i) =>
      i.id === item.id ? { ...i, picked_qty: i.picked_qty + pickQty } : i,
    ));
    setInventory((prev) => prev.map((s) =>
      s.id === stock.id ? { ...s, qty_on_hand: s.qty_on_hand - pickQty } : s,
    ));

    if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
    setScanResult(`✓ 拣货成功: ${matchProd.sku} -${pickQty} @ ${stock.location_code}`);

    // 检查是否全拣完
    const allDone = items.every((i) => (i.id === item.id ? item.picked_qty + pickQty : i.picked_qty) >= i.qty);
    if (allDone && currentOrder) {
      await supabase.from('erp_orders').update({ status: 'packing' }).eq('id', currentOrder.id);
      setScanResult((s) => s + '\n🎉 全部拣完！订单已进入打包状态');
    }
  };

  // === 渲染 ===

  if (!currentOrder) {
    // 订单列表
    return (
      <div className="p-4 max-w-md mx-auto">
        <div className="mb-4">
          <h1 className="text-lg font-bold text-gray-800">扫码拣货</h1>
          <p className="text-xs text-gray-500">选择一张待拣货订单</p>
        </div>

        {orders.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <Boxes className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">暂无待拣货订单</p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((o) => {
              const totalItems = orders.length; // 简化
              return (
                <button
                  key={o.id}
                  onClick={() => openOrder(o)}
                  className="w-full bg-white border border-gray-200 rounded-2xl p-4 text-left active:bg-gray-50"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-semibold text-gray-800">{o.erp_order_no}</div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                      o.status === 'picking' ? 'bg-orange-100 text-orange-700' :
                      o.status === 'confirmed' ? 'bg-blue-100 text-blue-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>{o.status}</span>
                  </div>
                  <div className="text-sm text-gray-500">{o.receiver_name}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // 拣货界面
  const allDone = items.length > 0 && items.every((i) => i.picked_qty >= i.qty);

  return (
    <div className="p-4 max-w-md mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => { setCurrentOrder(null); loadOrders(); }}
          className="p-2 rounded-lg hover:bg-gray-100"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-gray-800 truncate">{currentOrder.erp_order_no}</h1>
          <p className="text-xs text-gray-500">{currentOrder.receiver_name}</p>
        </div>
      </div>

      {/* 商品清单 */}
      <div className="mb-4 space-y-2">
        {items.map((item) => {
          const remaining = item.qty - item.picked_qty;
          const done = remaining === 0;
          return (
            <div key={item.id} className={`p-3 rounded-xl ${
              done ? 'bg-emerald-50 border border-emerald-200' : 'bg-white border border-gray-200'
            }`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className={`font-medium ${done ? 'text-emerald-700' : 'text-gray-800'}`}>
                    {item.sku}
                  </div>
                  <div className="text-xs text-gray-500">
                    已拣 {item.picked_qty}/{item.qty}
                  </div>
                </div>
                <div className={`text-lg font-bold ${done ? 'text-emerald-600' : 'text-orange-500'}`}>
                  {done ? '✓' : `剩${remaining}`}
                </div>
              </div>
              {/* 进度条 */}
              <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${done ? 'bg-emerald-500' : 'bg-brand-500'}`}
                  style={{ width: `${(item.picked_qty / item.qty) * 100}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* 扫码区 */}
      {allDone ? (
        <div className="p-6 bg-emerald-50 rounded-2xl text-center">
          <PackageCheck className="w-12 h-12 mx-auto mb-2 text-emerald-600" />
          <div className="text-emerald-700 font-semibold">🎉 全部拣完！</div>
          <div className="text-xs text-emerald-600 mt-1">订单已进入打包状态</div>
          <button
            onClick={() => { setCurrentOrder(null); loadOrders(); }}
            className="mt-4 px-6 py-2 bg-emerald-500 text-white rounded-xl"
          >
            返回订单列表
          </button>
        </div>
      ) : (
        <>
          {/* 反馈区 */}
          {(scanResult || error) && (
            <div className={`mb-3 p-3 rounded-xl text-sm ${
              error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
            }`}>
              {error || scanResult}
            </div>
          )}
          <QrScanner onDetected={handleScan} placeholder="扫描商品条码或 SKU" />
        </>
      )}
    </div>
  );
}
