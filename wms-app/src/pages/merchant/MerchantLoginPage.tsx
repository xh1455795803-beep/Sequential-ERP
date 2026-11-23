import { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { supabase } from '../../lib/supabase';
import { ShoppingCart, Loader2 } from 'lucide-react';

export function MerchantLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [checking, setChecking] = useState(true);

  // 如已有会话，直接跳转 dashboard
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setChecking(false);
      if (data.user) navigate({ to: '/merchant/dashboard' });
    });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!email || !password) { setErr('请填写邮箱与密码'); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      navigate({ to: '/merchant/dashboard' });
    } catch (e: any) {
      setErr(e?.message || '登录失败');
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-800 via-blue-900 to-slate-900">
        <Loader2 className="w-6 h-6 animate-spin text-blue-300" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-800 via-blue-900 to-slate-900 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-8 py-6 text-white">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-7 h-7 text-yellow-300" />
            <h1 className="text-xl font-bold">Thalvior 商家工作台</h1>
          </div>
          <p className="text-blue-100 text-sm mt-1">跨境电商履约 SaaS · 登录你的账户</p>
        </div>

        <form onSubmit={submit} className="px-8 py-7 space-y-4">
          <div>
            <label className="text-sm text-slate-600 font-medium">邮箱</label>
            <input
              type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="your@company.com"
              className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            />
          </div>
          <div>
            <label className="text-sm text-slate-600 font-medium">密码</label>
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
              className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            />
          </div>

          {err && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 p-2.5 rounded-lg">{err}</div>
          )}

          <button
            type="submit" disabled={loading}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg font-medium transition flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? '登录中...' : '登 录'}
          </button>

          <div className="pt-3 text-center text-sm text-slate-500">
            还没有账号？
            <button
              type="button"
              onClick={() => navigate({ to: '/merchant/register' })}
              className="ml-1 text-blue-600 hover:text-blue-700 font-medium"
            >立即注册</button>
          </div>
        </form>
      </div>
    </div>
  );
}
