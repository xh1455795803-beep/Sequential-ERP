import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Wallet, Loader2, Info } from 'lucide-react';

const WH_ID = '00000000-0000-0000-0000-000000000001';

const FALLBACK = [
  { rule_name: '标准仓租 (FIFO)', charge_type: 'storage_fee', unit: 'cbm_per_day', rate: 2.5, condition: { min_cbm: 1, tier_cbm: [0, 5, 20], tier_rate: [2.5, 2.0, 1.5] } },
  { rule_name: '入库处理费', charge_type: 'inbound_fee', unit: 'per_sku', rate: 0.5, condition: { free_threshold_orders: 10 } },
  { rule_name: '出库打包费-小件', charge_type: 'outbound_fee', unit: 'per_order', rate: 3.5, condition: { max_weight_kg: 2 } },
  { rule_name: '出库打包费-大件', charge_type: 'outbound_fee', unit: 'per_order', rate: 8.0, condition: { min_weight_kg: 2, max_weight_kg: 10 } },
  { rule_name: '国际运费-东南亚', charge_type: 'shipping_fee', unit: 'per_kg', rate: 22.0, condition: { zones: ['ID', 'MY', 'TH', 'VN', 'PH', 'SG'] } },
  { rule_name: 'COD 手续费', charge_type: 'cod_fee', unit: 'pct', rate: 2.5, condition: { min_cod_amount: 0, max_cod_amount: 10000 } },
  { rule_name: '平台上架代操作费', charge_type: 'listing_fee', unit: 'per_sku', rate: 5.0, condition: { platforms: ['Shopee', 'Lazada', 'TikTok'] } },
];

const CHARGE_LABEL: Record<string, string> = {
  storage_fee: '仓租',
  inbound_fee: '入库处理',
  outbound_fee: '出库打包',
  shipping_fee: '国际运费',
  cod_fee: 'COD 手续费',
  listing_fee: '代上架',
};

export function WmsBillingPage() {
  const [rows, setRows] = useState<any[]>(FALLBACK);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from('tlv_billing_rules')
          .select('rule_name, charge_type, unit, rate, condition, description')
          .eq('warehouse_id', WH_ID)
          .order('charge_type', { ascending: true });
        if (error) throw error;
        if (data && data.length) setRows(data);
      } catch (e: any) {
        setErr(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Wallet className="w-5 h-5 text-emerald-600" /> 计费规则
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">当前仓库生效中的收费标准</p>
        </div>
      </div>

      {loading && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-12 flex items-center justify-center text-slate-400 text-sm">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载中...
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-5 py-3 font-medium">计费项目</th>
                <th className="text-left px-5 py-3 font-medium">类型</th>
                <th className="text-left px-5 py-3 font-medium">单位</th>
                <th className="text-right px-5 py-3 font-medium">单价 / 比率</th>
                <th className="text-left px-5 py-3 font-medium">条件</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map((r: any, idx: number) => {
                const cond = typeof r.condition === 'string' ? r.condition : JSON.stringify(r.condition);
                const expandedKey = `r${idx}`;
                const showCond = expanded[expandedKey];
                return (
                  <tr key={idx} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-800">{r.rule_name}</td>
                    <td className="px-5 py-3">
                      <span className="text-[11px] px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full">
                        {CHARGE_LABEL[r.charge_type] || r.charge_type}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-600 font-mono text-xs">{r.unit || '-'}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-semibold text-emerald-700">
                      {r.rate}
                      {r.unit === 'pct' ? '%' : ''}
                    </td>
                    <td className="px-5 py-3 text-slate-600 max-w-xs">
                      <button
                        onClick={() => setExpanded((s) => ({ ...s, [expandedKey]: !s[expandedKey] }))}
                        className="text-xs text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
                      >
                        <Info className="w-3.5 h-3.5" /> {showCond ? '收起' : '查看条件'}
                      </button>
                      {showCond && (
                        <pre className="mt-2 p-2 bg-slate-50 text-[10px] text-slate-600 rounded overflow-x-auto font-mono">
                          {cond || '无'}
                        </pre>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {err && (
        <div className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          查询异常，展示示例数据 · {err}
        </div>
      )}
    </div>
  );
}
