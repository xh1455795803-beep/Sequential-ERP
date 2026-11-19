import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { QrScanner } from '../../components/QrScanner';
import { Download, CheckCircle, AlertCircle, Loader2, ArrowLeft } from 'lucide-react';

interface Product {
  id: string;
  sku: string;
  name: string;
  barcode: string[] | null;
}

interface Location {
  id: string;
  code: string;
}

export default function PdaReceive() {
  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [matchedProduct, setMatchedProduct] = useState<Product | null>(null);
  const [scanQty, setScanQty] = useState(1);
  const [targetLocation, setTargetLocation] = useState<Location | null>(null);
  const [status, setStatus] = useState<'idle' | 'matching' | 'received' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from('wms_products').select('id, sku, name, barcode').then(({ data }) => {
      setProducts(data || []);
    });
    supabase.from('wms_bins').select('id, code').then(({ data }) => {
      setLocations(data || []);
    });
  }, []);

  const handleScan = (code: string) => {
    setStatus('matching');
    setMsg(`扫描中: ${code}`);

    const match = products.find(
      (p) => p.sku === code || (p.barcode && p.barcode.includes(code)),
    );

    if (match) {
      setMatchedProduct(match);
      setStatus('received');
      setMsg(`✓ 匹配成功: ${match.sku} ${match.name}`);
      if (!targetLocation && locations.length === 1) {
        setTargetLocation(locations[0]);
      } else if (!targetLocation && locations.length > 1) {
        setMsg(`✓ ${match.sku} ${match.name} — 请先选择或扫描库位`);
        setStatus('error');
      }
    } else {
      setStatus('error');
      setMsg(`✗ 未匹配任何商品: ${code}`);
      setMatchedProduct(null);
    }
  };

  const handleLocationScan = (code: string) => {
    const loc = locations.find((l) => l.code === code);
    if (loc) {
      setTargetLocation(loc);
      setMsg(`库位: ${loc.code} — 现在扫商品`);
      setStatus('idle');
    } else {
      setMsg(`✗ 未找到库位: ${code}`);
      setStatus('error');
    }
  };

  const doPutaway = async () => {
    if (!matchedProduct || !targetLocation) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: wh } = await supabase
        .from('wms_warehouses')
        .select('id')
        .eq('user_id', user!.id)
        .limit(1)
        .single();

      // 查现有库存
      const { data: inv } = await supabase
        .from('wms_inventory')
        .select('id, qty_on_hand')
        .eq('product_id', matchedProduct.id)
        .eq('location_id', targetLocation.id)
        .eq('user_id', user!.id)
        .maybeSingle();

      if (inv) {
        await supabase
          .from('wms_inventory')
          .update({ qty_on_hand: inv.qty_on_hand + scanQty, last_moved_at: new Date().toISOString() })
          .eq('id', inv.id);
      } else {
        await supabase.from('wms_inventory').insert({
          user_id: user!.id,
          warehouse_id: wh!.id,
          location_id: targetLocation.id,
          product_id: matchedProduct.id,
          sku: matchedProduct.sku,
          qty_on_hand: scanQty,
          qty_reserved: 0,
          inbound_at: new Date().toISOString(),
        });
      }

      // 写流水
      await supabase.from('wms_inventory_txn').insert({
        user_id: user!.id,
        warehouse_id: wh!.id,
        product_id: matchedProduct.id,
        sku: matchedProduct.sku,
        location_id: targetLocation.id,
        qty_change: scanQty,
        qty_after: (inv?.qty_on_hand || 0) + scanQty,
        type: 'receive',
        ref_type: 'pda_receive',
        remark: `PDA 扫码收货 ${matchedProduct.sku} @ ${targetLocation.code}`,
      });

      // 震动反馈
      if (navigator.vibrate) navigator.vibrate([50, 30, 50]);

      setStatus('received');
      setMsg(`✓ 入库成功！${matchedProduct.sku} +${scanQty} @ ${targetLocation.code}`);
      setMatchedProduct(null);
      setScanQty(1);
    } catch (e: any) {
      setStatus('error');
      setMsg(`✗ 操作失败: ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setMatchedProduct(null);
    setStatus('idle');
    setMsg('');
    setScanQty(1);
  };

  const isScanningLocation = !matchedProduct && !!targetLocation === false; // 默认先扫位置或商品都行

  return (
    <div className="p-4 max-w-md mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => window.history.back()}
          className="p-2 rounded-lg hover:bg-gray-100"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-lg font-bold text-gray-800">扫码收货</h1>
          <p className="text-xs text-gray-500">先扫库位 → 再扫商品 → 确认数量</p>
        </div>
      </div>

      {/* 状态消息 */}
      {msg && (
        <div className={`mb-4 p-3 rounded-xl flex items-start gap-2 ${
          status === 'error' ? 'bg-red-50 text-red-700' :
          status === 'received' ? 'bg-emerald-50 text-emerald-700' :
          'bg-blue-50 text-blue-700'
        }`}>
          {status === 'error' ? <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" /> :
           status === 'received' ? <CheckCircle className="w-5 h-5 shrink-0 mt-0.5" /> :
           <Download className="w-5 h-5 shrink-0 mt-0.5" />}
          <span className="text-sm flex-1">{msg}</span>
        </div>
      )}

      {/* 步骤1: 库位 */}
      {!targetLocation && (
        <div className="mb-4">
          <div className="text-xs text-gray-500 mb-2">① 扫描/选择库位</div>
          <select
            value=""
            onChange={(e) => {
              const loc = locations.find((l) => l.id === e.target.value);
              if (loc) {
                setTargetLocation(loc);
                setMsg(`库位: ${loc.code}`);
                setStatus('idle');
              }
            }}
            className="w-full px-3 py-3 border border-gray-300 rounded-xl text-base bg-white mb-3"
          >
            <option value="">选择库位...</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.code}</option>
            ))}
          </select>
          <QrScanner onDetected={handleLocationScan} placeholder="扫描库位条码" />
        </div>
      )}

      {/* 已选库位 */}
      {targetLocation && (
        <div className="mb-4 p-3 bg-gray-100 rounded-xl flex items-center justify-between">
          <div>
            <div className="text-[10px] text-gray-500">当前库位</div>
            <div className="font-semibold text-gray-800">{targetLocation.code}</div>
          </div>
          <button
            onClick={() => setTargetLocation(null)}
            className="text-xs text-brand-500 hover:underline"
          >
            清除
          </button>
        </div>
      )}

      {/* 步骤2: 商品扫描 */}
      {targetLocation && (
        <div className="mb-4">
          <div className="text-xs text-gray-500 mb-2">② 扫描商品条码</div>
          <QrScanner onDetected={handleScan} placeholder="扫描商品条码或手动输入 SKU" />
        </div>
      )}

      {/* 已匹配商品 + 数量 + 确认 */}
      {matchedProduct && (
        <div className="space-y-4 p-4 border-2 border-brand-500 rounded-xl bg-brand-50">
          <div>
            <div className="font-semibold text-gray-800 text-lg">{matchedProduct.sku}</div>
            <div className="text-sm text-gray-600">{matchedProduct.name}</div>
          </div>

          <div>
            <div className="text-xs text-gray-500 mb-1">数量</div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setScanQty((q) => Math.max(1, q - 1))}
                className="w-12 h-12 bg-white border border-gray-300 rounded-xl text-xl font-bold active:bg-gray-100"
              >−</button>
              <input
                type="number"
                value={scanQty}
                onChange={(e) => setScanQty(Math.max(1, parseInt(e.target.value) || 1))}
                className="flex-1 h-12 text-center text-xl font-semibold border border-gray-300 rounded-xl bg-white"
              />
              <button
                onClick={() => setScanQty((q) => q + 1)}
                className="w-12 h-12 bg-white border border-gray-300 rounded-xl text-xl font-bold active:bg-gray-100"
              >+</button>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={reset}
              className="flex-1 py-3 border border-gray-300 rounded-xl font-medium text-gray-700 active:bg-gray-100"
            >
              重扫
            </button>
            <button
              onClick={doPutaway}
              disabled={saving}
              className="flex-1 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl font-medium active:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              {saving ? '入库中...' : '确认入库'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
