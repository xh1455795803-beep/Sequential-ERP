import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ArrowLeft, MapPin, AlertTriangle, PackageCheck } from 'lucide-react';

interface PutawayTask {
  // 简化：用 ASN items 代替
}

export default function PdaPutaway() {
  const [message, setMessage] = useState('选择一个 ASN 进行上架');
  const [error, setError] = useState('');

  // 直接引导到 receive 页面，因为 receive 已经包含了入库逻辑
  // putaway 区别在于：先有 ASN → 按 ASN item 上架，而 receive 是任意扫码入库
  // 这里做一个简化跳转
  useEffect(() => {
    // 如果访问这个页面，实际上架就是 PdaReceive 的流程
  }, []);

  return (
    <div className="p-4 max-w-md mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => window.history.back()} className="p-2 rounded-lg hover:bg-muted">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-lg font-bold text-fg">扫码上架</h1>
          <p className="text-xs text-muted-foreground">ASN 到货上架流程</p>
        </div>
      </div>

      <div className="bg-brand-subtle rounded-2xl p-6 text-center mb-4">
        <MapPin className="w-12 h-12 mx-auto mb-2 text-blue-600" />
        <h3 className="font-semibold text-fg mb-1">扫码上架 = 扫码入库</h3>
        <p className="text-sm text-muted-foreground mb-4">
          上架与收货共用同一套 PDA 流程：
          <br />先扫库位 → 再扫商品 → 确认数量
        </p>
        <a href="/wms/pda/receive"
          className="inline-flex items-center gap-2 px-6 py-3 bg-brand-subtle0 text-white rounded-xl font-medium">
          前往扫码入库 →
        </a>
      </div>

      <div className="bg-card border border-border rounded-2xl p-4">
        <h3 className="font-semibold text-fg mb-3 flex items-center gap-2">
          <PackageCheck className="w-4 h-4 text-brand-500" />
          上架流程说明
        </h3>
        <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
          <li>货物到达仓库，ASN 已在系统中</li>
          <li>扫描目标库位条码（如 B-01-01-02）</li>
          <li>扫描商品条码或手动输入 SKU</li>
          <li>确认数量 → 系统自动增加该库位库存</li>
          <li>同时写入库存流水 + 震动反馈</li>
        </ol>
      </div>
    </div>
  );
}
