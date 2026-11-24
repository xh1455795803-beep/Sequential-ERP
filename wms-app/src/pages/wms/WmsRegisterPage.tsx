import { useState } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { supabase } from '../../lib/supabase';
import { Warehouse, Mail, Lock, ArrowLeft, Loader2 } from 'lucide-react';

export function WmsRegisterPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setOk(''); setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { data: { full_name: name, portal_role: 'warehouse' } },
      });
      if (error) throw error;
      if (data.user && !data.user.identities?.length) {
        setOk('注册成功！请查收邮件确认邮箱后登录。');
      } else {
        setOk('注册成功！正在跳转...');
        setTimeout(() => navigate({ to: '/login' }), 1500);
      }
    } catch (e: any) {
      setErr(e.message || '注册失败');
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      {/* 装饰 blob */}
      <div className="blob w-[480px] h-[480px] -top-20 -right-20" style={{ background: '#bbf7d0' }} />
      <div className="blob w-[400px] h-[400px] -bottom-16 -left-16" style={{ background: '#bae0fd' }} />
      <div className="blob w-[320px] h-[320px] top-1/3 left-1/4" style={{ background: '#fed7aa' }} />

      <div className="glass w-full max-w-md relative z-10 overflow-hidden">
        <div className="relative h-24 bg-gradient-to-br from-emerald-100 via-teal-50 to-cyan-50 flex items-center justify-center">
          <Link to="/login" className="absolute top-4 left-4 text-xs text-ink-500 hover:text-ink-700 flex items-center gap-1">
            <ArrowLeft className="w-3 h-3" /> 返回登录
          </Link>
          <div className="absolute -bottom-8 w-20 h-20 rounded-2xl bg-white shadow-lg shadow-emerald-100 flex items-center justify-center ring-4 ring-white">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-emerald-400 via-teal-400 to-cyan-400 flex items-center justify-center shadow-inner">
              <Warehouse className="w-7 h-7 text-white" />
            </div>
          </div>
        </div>

        <div className="pt-14 pb-8 px-8">
          <div className="text-center mb-7">
            <h1 className="text-xl font-bold text-ink-900">注册仓库操作员</h1>
            <p className="text-xs text-ink-500 mt-1">Thalvior WMS · 智能仓储管理系统</p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-ink-500 mb-1.5 block">姓名</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="张三"
                className="w-full px-3 py-2.5 bg-white/70 border border-white focus:border-emerald-300 rounded-xl focus:ring-2 focus:ring-emerald-200/50 outline-none text-sm transition" />
            </div>
            <div>
              <label className="text-xs font-medium text-ink-500 mb-1.5 block">邮箱</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="your@warehouse.com"
                className="w-full px-3 py-2.5 bg-white/70 border border-white focus:border-emerald-300 rounded-xl focus:ring-2 focus:ring-emerald-200/50 outline-none text-sm transition" />
            </div>
            <div>
              <label className="text-xs font-medium text-ink-500 mb-1.5 block">密码（至少 8 位）</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8}
                placeholder="••••••••"
                className="w-full px-3 py-2.5 bg-white/70 border border-white focus:border-emerald-300 rounded-xl focus:ring-2 focus:ring-emerald-200/50 outline-none text-sm transition" />
            </div>
            {err && <div className="text-xs text-rose-600 bg-rose-50/80 px-3 py-2 rounded-xl border border-rose-100">{err}</div>}
            {ok && <div className="text-xs text-emerald-600 bg-emerald-50/80 px-3 py-2 rounded-xl border border-emerald-100">{ok}</div>}
            <button type="submit" disabled={loading}
              className="w-full py-2.5 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 hover:opacity-90 disabled:opacity-50 text-white font-semibold rounded-xl transition flex items-center justify-center gap-2 shadow-md shadow-emerald-200/50">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? '注册中...' : '免费注册'}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-white/60 text-center">
            <p className="text-xs text-ink-400">已有账号？</p>
            <Link to="/login" className="text-xs font-medium text-emerald-600 hover:text-emerald-700">
              返回登录 →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
