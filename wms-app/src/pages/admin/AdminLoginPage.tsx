import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { supabase } from '../../lib/supabase';
import { Shield, Mail, Lock, Loader2 } from 'lucide-react';

export function AdminLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    setErr('');
    if (!email || !password) { setErr('请输入邮箱和密码'); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const role = data.user?.user_metadata?.portal_role;
      if (role !== 'admin') {
        await supabase.auth.signOut();
        setErr('该账号无管理员权限');
        setLoading(false);
        return;
      }
      navigate({ to: '/admin/dashboard' });
    } catch (e: any) { setErr(e?.message || '登录失败'); }
    finally { if (loading) setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      <div className="blob w-[480px] h-[480px] -top-20 left-1/4" style={{ background: '#f3e8ff' }} />
      <div className="blob w-[400px] h-[400px] -bottom-16 right-1/4" style={{ background: '#e0f2fe' }} />
      <div className="blob w-[320px] h-[320px] top-1/2 right-0" style={{ background: '#fce7f3' }} />

      <div className="glass w-full max-w-md relative z-10 overflow-hidden">
        <div className="relative h-24 bg-gradient-to-br from-lilac-100 via-violet-50 to-sky-50 flex items-center justify-center">
          <div className="absolute -bottom-8 w-20 h-20 rounded-2xl bg-white shadow-lg shadow-lilac-100 flex items-center justify-center ring-4 ring-white">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-lilac-400 to-violet-300 flex items-center justify-center shadow-inner">
              <Shield className="w-7 h-7 text-white" />
            </div>
          </div>
        </div>

        <div className="pt-14 pb-8 px-8">
          <div className="text-center mb-7">
            <h1 className="text-xl font-bold text-ink-900">Thalvior 管理控制台</h1>
            <p className="text-xs text-ink-500 mt-1">Platform Admin · 跨境 SaaS</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-ink-500 mb-1.5 block">管理员邮箱</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-300" />
                <input type="email" placeholder="请输入管理员邮箱" value={email} onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 bg-white/70 border border-white focus:border-violet-300 rounded-xl focus:ring-2 focus:ring-violet-200/50 outline-none text-sm transition" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-ink-500 mb-1.5 block">密码</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-300" />
                <input type="password" placeholder="请输入密码" value={password} onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                  className="w-full pl-9 pr-3 py-2.5 bg-white/70 border border-white focus:border-violet-300 rounded-xl focus:ring-2 focus:ring-violet-200/50 outline-none text-sm transition" />
              </div>
            </div>
            {err && <div className="text-xs text-rose-600 bg-rose-50/80 border border-rose-100 px-3 py-2 rounded-xl">{err}</div>}
            <button onClick={submit} disabled={loading}
              className="w-full py-2.5 bg-gradient-to-r from-lilac-500 to-violet-500 hover:from-lilac-600 hover:to-violet-600 disabled:opacity-50 text-white font-semibold rounded-xl transition shadow-md shadow-lilac-200/50 flex items-center justify-center gap-2">
              {loading ? (<><Loader2 className="w-4 h-4 animate-spin" /> 登录中...</>) : '进入控制台'}
            </button>
          </div>

          <div className="mt-6 pt-5 border-t border-white/60 text-center text-xs text-ink-300">
            Thalvior Cross-Border SaaS · v6.0 · 仅限授权管理员
          </div>
        </div>
      </div>
    </div>
  );
}
