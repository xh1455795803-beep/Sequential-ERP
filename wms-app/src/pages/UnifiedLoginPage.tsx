import { useState } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { supabase, getAuthContext, PortalRole } from '../lib/supabase';
import { LogIn, Loader2, ArrowLeft } from 'lucide-react';

export function UnifiedLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function login() {
    setLoading(true); setErr('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setErr(error.message); setLoading(false); return; }
    const ctx = await getAuthContext();
    const role: PortalRole = ctx.portalRole || 'merchant';
    const target = role === 'warehouse' ? '/wms/dashboard' : role === 'admin' ? '/admin/dashboard' : '/merchant/dashboard';
    navigate({ to: target });
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      {/* 装饰 blob */}
      <div className="blob w-[480px] h-[480px] -top-20 -left-24" style={{ background: '#bae0fd' }} />
      <div className="blob w-[400px] h-[400px] -bottom-16 -right-20" style={{ background: '#fce7f3' }} />
      <div className="blob w-[320px] h-[320px] top-1/3 right-1/4" style={{ background: '#dcfce7' }} />

      <div className="glass w-full max-w-md relative z-10 overflow-hidden">
        {/* 顶部装饰条 */}
        <div className="relative h-24 bg-gradient-to-br from-sky-100 via-cyan-50 to-mint-50 flex items-center justify-center">
          <Link to="/" className="absolute top-4 left-4 text-xs text-ink-500 hover:text-ink-700 flex items-center gap-1">
            <ArrowLeft className="w-3 h-3" /> 返回首页
          </Link>
          <div className="absolute -bottom-8 w-20 h-20 rounded-2xl bg-white shadow-lg shadow-sky-100 flex items-center justify-center ring-4 ring-white">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-sky-400 via-cyan-400 to-mint-400 flex items-center justify-center shadow-inner">
              <LogIn className="w-7 h-7 text-white" />
            </div>
          </div>
        </div>

        <div className="pt-14 pb-8 px-8">
          <div className="text-center mb-7">
            <h1 className="text-xl font-bold text-ink-900">Thalvior 登录</h1>
            <p className="text-xs text-ink-500 mt-1">跨境代打包管理平台</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-ink-500 mb-1.5 block">邮箱</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full px-3 py-2.5 bg-white/70 border border-white focus:border-sky-300 rounded-xl focus:ring-2 focus:ring-sky-200/50 outline-none text-sm transition" />
            </div>
            <div>
              <label className="text-xs font-medium text-ink-500 mb-1.5 block">密码</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && login()}
                placeholder="••••••••"
                className="w-full px-3 py-2.5 bg-white/70 border border-white focus:border-sky-300 rounded-xl focus:ring-2 focus:ring-sky-200/50 outline-none text-sm transition" />
            </div>
            {err && <div className="text-xs text-rose-600 bg-rose-50/80 px-3 py-2 rounded-xl border border-rose-100">{err}</div>}
            <button onClick={login} disabled={loading}
              className="w-full py-2.5 bg-gradient-to-r from-sky-500 via-cyan-500 to-mint-500 hover:opacity-90 disabled:opacity-50 text-white font-semibold rounded-xl transition flex items-center justify-center gap-2 shadow-md shadow-sky-200/50">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? '登录中...' : '登 录'}
            </button>
          </div>

          <div className="mt-6 pt-5 border-t border-white/60 text-center">
            <p className="text-xs text-ink-400 mb-3">还没有账号？</p>
            <Link to="/merchant/register" className="text-xs font-medium text-sky-600 hover:text-sky-700">
              免费注册商家账号 →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
