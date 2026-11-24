import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { supabase } from '../../lib/supabase';
import { Warehouse, Lock, Mail } from 'lucide-react';

export function WmsLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      navigate({ to: '/wms/dashboard' });
    } catch (e: any) { setErr(e.message || '登录失败，请检查邮箱和密码'); }
    finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      <div className="blob w-[480px] h-[480px] -top-20 -right-20" style={{ background: '#bbf7d0' }} />
      <div className="blob w-[400px] h-[400px] -bottom-16 -left-16" style={{ background: '#bae0fd' }} />
      <div className="blob w-[320px] h-[320px] top-1/3 left-1/4" style={{ background: '#fed7aa' }} />

      <div className="glass w-full max-w-md relative z-10 overflow-hidden">
        <div className="relative h-24 bg-gradient-to-br from-mint-100 via-emerald-50 to-sky-50 flex items-center justify-center">
          <div className="absolute -bottom-8 w-20 h-20 rounded-2xl bg-white shadow-lg shadow-mint-100 flex items-center justify-center ring-4 ring-white">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-mint-400 to-emerald-300 flex items-center justify-center shadow-inner">
              <Warehouse className="w-7 h-7 text-white" />
            </div>
          </div>
        </div>

        <form onSubmit={submit} className="pt-14 pb-8 px-8">
          <div className="text-center mb-7">
            <h1 className="text-xl font-bold text-ink-900">仓库操作后台</h1>
            <p className="text-xs text-ink-500 mt-1">Thalvior WMS · 跨境电商代打包</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-ink-500 mb-1.5 block">邮箱</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-ink-300 absolute left-3 top-1/2 -translate-y-1/2" />
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="wms@thalvior.icu"
                  className="w-full pl-9 pr-3 py-2.5 bg-white/70 border border-white focus:border-emerald-300 rounded-xl focus:ring-2 focus:ring-emerald-200/50 outline-none text-sm transition" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-ink-500 mb-1.5 block">密码</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-ink-300 absolute left-3 top-1/2 -translate-y-1/2" />
                <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  className="w-full pl-9 pr-3 py-2.5 bg-white/70 border border-white focus:border-emerald-300 rounded-xl focus:ring-2 focus:ring-emerald-200/50 outline-none text-sm transition" />
              </div>
            </div>
            {err && <div className="text-xs text-rose-600 bg-rose-50/80 border border-rose-100 px-3 py-2 rounded-xl">{err}</div>}
            <button type="submit" disabled={loading}
              className="w-full py-2.5 bg-gradient-to-r from-mint-500 to-emerald-500 hover:from-mint-600 hover:to-emerald-600 disabled:opacity-50 text-white font-semibold rounded-xl transition shadow-md shadow-mint-200/50">
              {loading ? '登录中...' : '登 录'}
            </button>
          </div>

          <div className="mt-6 pt-5 border-t border-white/60 text-center text-xs text-ink-300">
            © Thalvior · 仓库端 · 仅授权员工登录
          </div>
        </form>
      </div>
    </div>
  );
}
