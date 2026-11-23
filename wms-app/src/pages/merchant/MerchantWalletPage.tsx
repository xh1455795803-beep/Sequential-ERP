import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Wallet, Plus, Loader2, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';

const MERCHANT_ID = '00000000-0000-0000-0000-000000000101';

export function MerchantWalletPage() {
  const [balance, setBalance] = useState<number>(0);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [rechargeAmt, setRechargeAmt] = useState('');
  const [recharging, setRecharging] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [{ data: m }, { data: tx }] = await Promise.all([
        supabase.from('tlv_merchants').select('balance').eq('id', MERCHANT_ID).maybeSingle(),
        supabase.from('tlv_merchant_wallets').select('*').eq('merchant_id', MERCHANT_ID).order('created_at', { ascending: false }).limit(30),
      ]);
      setBalance(Number((m as any)?.balance) || 0);
      setRows(tx || []);
    } finally { setLoading(false); }
  }

  async function recharge() {
    const amt = Number(rechargeAmt);
    if (!amt || amt <= 0) { setMsg('请输入有效金额'); return; }
    setRecharging(true); setMsg('');
    try {
      const tx_id = 'TX' + Date.now();
      const { error } = await supabase.from('tlv_merchant_wallets').insert({
        merchant_id: MERCHANT_ID, transaction_id: tx_id, type: 'RECHARGE',
        amount: amt, balance_after: balance + amt, note: '手动充值 (模拟)',
      });
      if (error) throw error;
      await supabase.from('tlv_merchants').update({ balance: balance + amt }).eq('id', MERCHANT_ID);
      setMsg(`充值成功 +¥${amt.toFixed(2)}`);
      setRechargeAmt('');
      await load();
    } catch (e: any) { setMsg(e?.message || '充值失败'); }
    finally { setRecharging(false); }
  }

  return (
    <div className="space-y-4">
      {/* Balance card */}
      <div className="bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-700 rounded-xl p-6 text-white shadow-md relative overflow-hidden">
        <div className="absolute right-0 top-0 w-40 h-40 bg-white/10 rounded-full -translate-y-10 translate-x-10" />
        <div className="relative">
          <div className="flex items-center gap-2 text-blue-100 text-sm">
            <Wallet className="w-4 h-4" /> 账户余额
          </div>
          <div className="mt-2 text-4xl font-bold tabular-nums">
            {loading ? '---' : `¥${balance.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <input type="number" min={1} value={rechargeAmt} onChange={(e) => setRechargeAmt(e.target.value)}
              placeholder="充值金额"
              className="px-3 py-2 rounded-lg bg-white/20 placeholder:text-blue-200 text-white border border-white/30 w-40 focus:outline-none focus:ring-2 focus:ring-white/50" />
            <button onClick={recharge} disabled={recharging}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-white text-blue-700 rounded-lg font-medium hover:bg-blue-50 disabled:opacity-60">
              {recharging ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {recharging ? '处理中...' : '充值'}
            </button>
          </div>
          {msg && <div className="mt-3 text-sm bg-white/20 px-3 py-1.5 rounded-lg inline-block">{msg}</div>}
        </div>
      </div>

      {/* Transactions */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-slate-700">最近交易记录</h3>
        </div>
        {loading ? (
          <div className="p-12 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载中...</div>
        ) : rows.length === 0 ? (
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
