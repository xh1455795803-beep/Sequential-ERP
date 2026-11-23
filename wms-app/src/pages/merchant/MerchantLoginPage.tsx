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
    <div className="min-h-screen bg-gradient-to-br from-blue-600 via-blue-700 to-blue-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-blue-500 rounded-xl flex items-center justify-center">
            <ShoppingCart className="w-7 h-7 text-white" />
          </div>
          <div>
            <div className="text-xl font-bold text-slate-800">商家工作台</div>
            <div className="text-xs text-slate-500">Thalvior Seller Portal</div>
          </div>
        </div>
        <div className="flex gap-1 mb-6 bg-slate-100 rounded-lg p-1">
          <button className="flex-1 py-2 text-sm font-semibold bg-white rounded-md shadow text-blue-600">登录</button>
          <button onClick={() => navigate({ to: '/merchant/register' })} className="flex-1 py-2 text-sm text-slate-500 hover:text-slate-700">注册</button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-slate-600 mb-1 block">邮箱</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-600 mb-1 block">密码</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && login()}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm" />
          </div>
          {err && <div className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{err}</div>}
          <button onClick={login} disabled={loading}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold rounded-lg transition flex items-center justify-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? '登录中...' : '登 录'}
          </button>
        </div>
      </div>
    </div>
  );
}
