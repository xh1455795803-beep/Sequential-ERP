import { useEffect, useState } from 'react';
import { supabase, getAuthContext } from '../../lib/supabase';
import { Wallet, ArrowDownCircle, ArrowUpCircle, CreditCard, PlusCircle, Coins } from 'lucide-react';

export function MerchantWalletPage() {
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState(0);
  const [rows, setRows] = useState<any[]>([]);
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [topupAmount, setTopupAmount] = useState('100');
  const [topupSubmitting, setTopupSubmitting] = useState(false);
  const [topupMsg, setTopupMsg] = useState('');

  useEffect(() => {
    (async () => {
      const { merchantId } = await getAuthContext();
      if (!merchantId) { setLoading(false); return; }
      setMerchantId(merchantId);
      const [{ data: m }, { data: tx }] = await Promise.all([
        supabase.from('tlv_merchants').select('balance').eq('id', merchantId).maybeSingle(),
        supabase.from('tlv_merchant_wallets').select('*').eq('merchant_id', merchantId).order('created_at', { ascending: false }).limit(30),
      ]);
      setBalance(Number((m as any)?.balance) || 0);
      setRows(tx || []);
      setLoading(false);
    })();
  }, []);

  async function doTopup() {
    if (!merchantId) return;
    const amt = Number(topupAmount);
    if (!amt || amt <= 0) { setTopupMsg('请输入有效金额'); return; }
    setTopupSubmitting(true); setTopupMsg('');
    try {
      const { data, error } = await supabase.functions.invoke('recharge-wallet', {
        body: { merchant_id: merchantId, amount: amt, currency: 'CNY' },
      });
      if (error) throw error;
      setTopupMsg(data?.mock
        ? `✓ DEV 模式模拟充值 ¥${amt} 成功（真实 Stripe 请配置 STRIPE_SECRET_KEY）`
        : `✓ 充值成功，余额 ¥${data?.balance ?? '...'}`);
      // 刷新
      const { data: m } = await supabase.from('tlv_merchants').select('balance').eq('id', merchantId).maybeSingle();
      setBalance(Number((m as any)?.balance) || 0);
      const { data: tx } = await supabase.from('tlv_merchant_wallets').select('*').eq('merchant_id', merchantId).order('created_at', { ascending: false }).limit(30);
      setRows(tx || []);
    } catch (e: any) { setTopupMsg(`✗ 充值失败：${e?.message || e}`); }
    finally { setTopupSubmitting(false); }
  }

  if (loading) return <div className="p-12 text-center text-slate-400">加载中...</div>;

  return (
    <div className="space-y-4">
      {/* 余额卡 */}
      <div className="bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-700 rounded-xl p-6 text-white shadow-md relative overflow-hidden">
        <div className="absolute right-0 top-0 w-40 h-40 bg-white/10 rounded-full -translate-y-10 translate-x-10" />
        <div className="relative">
          <div className="flex items-center gap-2 text-blue-100 text-sm">
            <Wallet className="w-4 h-4" /> 账户余额
          </div>
          <div className="mt-2 text-4xl font-bold tabular-nums">
            ¥{balance.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {/* 充值 */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
        <div className="flex items-center gap-2 mb-4">
          <CreditCard className="w-5 h-5 text-blue-600" />
          <h3 className="font-semibold text-slate-800">在线充值</h3>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          <div className="flex gap-2">
            {[50, 100, 500, 1000].map((q) => (
              <button key={q} onClick={() => setTopupAmount(String(q))}
                className={`px-3 py-1.5 text-xs rounded-lg border tabular-nums ${
                  topupAmount === String(q) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-400'
                }`}>¥{q}</button>
            ))}
          </div>
          <div className="flex-1 flex gap-2">
            <div className="relative flex-1">
              <Coins className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="number" min={1} value={topupAmount} onChange={(e) => setTopupAmount(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 tabular-nums"
                placeholder="自定义金额" />
            </div>
            <button onClick={doTopup} disabled={topupSubmitting}
              className="inline-flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium shrink-0">
              <PlusCircle className="w-4 h-4" /> {topupSubmitting ? '处理中...' : '立即充值'}
            </button>
          </div>
        </div>
        {topupMsg && <div className={`mt-3 text-sm p-2.5 rounded-lg border ${
          topupMsg.startsWith('✓') ? 'bg-green-50 border-green-100 text-green-700' :
          topupMsg.startsWith('✗') ? 'bg-red-50 border-red-100 text-red-700' :
          'bg-amber-50 border-amber-100 text-amber-700'
        }`}>{topupMsg}</div>}
        <div className="mt-3 text-[11px] text-slate-400">
          充值方式：Stripe · WeChat Pay · Alipay · 线下转账（线下请联系仓库管理员）。
          单笔最高 ¥50,000，到账一般 1-5 分钟。
        </div>
      </div>

      {/* 流水 */}
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
