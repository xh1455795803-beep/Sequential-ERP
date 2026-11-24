import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { supabase } from '../../lib/supabase';
import { ShoppingCart, Loader2 } from 'lucide-react';

export function MerchantLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function login() {
    setLoading(true); setErr('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setErr(error.message); setLoading(false); return; }
    navigate({ to: '/merchant/dashboard' });
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      {/* 装饰 blob */}
      <div className="blob w-[480px] h-[480px] -top-20 -left-24" style={{ background: '#bae0fd' }} />
      <div className="blob w-[400px] h-[400px] -bottom-16 -right-20" style={{ background: '#fce7f3' }} />
      <div className="blob w-[320px] h-[320px] top-1/3 right-1/4" style={{ background: '#dcfce7' }} />

      <div className="glass w-full max-w-md relative z-10 overflow-hidden">
        {/* 顶部柔和装饰条 */}
        <div className="relative h-24 bg-gradient-to-br from-sky-100 via-cyan-50 to-mint-50 flex items-center justify-center">
          <div className="absolute -bottom-8 w-20 h-20 rounded-2xl bg-white shadow-lg shadow-sky-100 flex items-center justify-center ring-4 ring-white">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-sky-300 to-cyan-200 flex items-center justify-center shadow-inner">
              <ShoppingCart className="w-7 h-7 text-white" />
            </div>
          </div>
        </div>

        <div className="pt-14 pb-8 px-8">
          <div className="text-center mb-7">
            <h1 className="text-xl font-bold text-ink-900">商家工作台</h1>
            <p className="text-xs text-ink-500 mt-1">Thalvior Seller Portal</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-ink-500 mb-1.5 block">邮箱</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 bg-white/70 border border-white focus:border-sky-300 rounded-xl focus:ring-2 focus:ring-sky-200/50 outline-none text-sm transition" />
            </div>
            <div>
              <label className="text-xs font-medium text-ink-500 mb-1.5 block">密码</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && login()}
                className="w-full px-3 py-2.5 bg-white/70 border border-white focus:border-sky-300 rounded-xl focus:ring-2 focus:ring-sky-200/50 outline-none text-sm transition" />
            </div>
            {err && <div className="text-xs text-rose-600 bg-rose-50/80 px-3 py-2 rounded-xl border border-rose-100">{err}</div>}
            <button onClick={login} disabled={loading}
              className="w-full py-2.5 bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-600 hover:to-cyan-600 disabled:opacity-50 text-white font-semibold rounded-xl transition flex items-center justify-center gap-2 shadow-md shadow-sky-200/50">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? '登录中...' : '登 录'}
            </button>
          </div>

          <div className="mt-6 pt-5 border-t border-white/60 text-center text-xs text-ink-300">
            © Thalvior · 商家端
          </div>
        </div>
      </div>
    </div>
  );
}
