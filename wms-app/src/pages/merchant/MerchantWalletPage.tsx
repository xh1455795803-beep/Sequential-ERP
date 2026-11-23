import { supabase, getAuthContext } from '../../lib/supabase';
import { Wallet, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';

export async function MerchantWalletPage() {
  const { merchantId } = await getAuthContext();
  if (!merchantId) return <div>未登录</div>;
  const [{ data: m }, { data: tx }] = await Promise.all([
    supabase.from('tlv_merchants').select('balance').eq('id', merchantId).maybeSingle(),
    supabase.from('tlv_merchant_wallets').select('*').eq('merchant_id', merchantId).order('created_at', { ascending: false }).limit(30),
  ]);
  const balance = Number((m as any)?.balance) || 0;
  const rows = tx || [];

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-700 rounded-xl p-6 text-white shadow-md relative overflow-hidden">
        <div className="absolute right-0 top-0 w-40 h-40 bg-white/10 rounded-full -translate-y-10 translate-x-10" />
        <div className="relative">
          <div className="flex items-center gap-2 text-blue-100 text-sm">
            <Wallet className="w-4 h-4" /> 账户余额
          </div>
          <div className="mt-2 text-4xl font-bold tabular-nums">
            ¥{balance.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
          </div>
          <div className="mt-4 text-xs text-blue-200">请通过线下充值或财务转账完成余额补充</div>
        </div>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-slate-700">最近交易记录</h3>
        </div>
        {rows.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">暂无交易记录</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-5 py-3 font-medium">类型</th>
                <th className="text-left px-5 py-3 font-medium">交易号</th>
                <th className="text-left px-5 py-3 font-medium">备注</th>
                <th className="text-left px-5 py-3 font-medium">时间</th>
                <th className="text-right px-5 py-3 font-medium">金额</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map((r: any) => {
                const isPositive = Number(r.amount) >= 0;
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      {isPositive
                        ? <ArrowUpCircle className="w-4 h-4 inline-block text-green-600 mr-1" />
                        : <ArrowDownCircle className="w-4 h-4 inline-block text-red-500 mr-1" />}
                      <span className="text-slate-700">{r.type || '-'}</span>
                    </td>
                    <td className="px-5 py-3 font-mono text-slate-600 text-xs">{r.transaction_id || '-'}</td>
                    <td className="px-5 py-3 text-slate-600">{r.note || '-'}</td>
                    <td className="px-5 py-3 text-slate-500 text-xs">{r.created_at?.slice(0, 16).replace('T', ' ')}</td>
                    <td className={`px-5 py-3 text-right tabular-nums font-medium ${isPositive ? 'text-green-600' : 'text-red-500'}`}>
                      {isPositive ? '+' : ''}{Number(r.amount).toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
