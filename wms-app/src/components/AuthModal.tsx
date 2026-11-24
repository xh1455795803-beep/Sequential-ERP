import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { useNavigate } from '@tanstack/react-router';
import { X, Mail, Lock, User, Loader2, Warehouse } from 'lucide-react';

type Props = {
  open: boolean;
  defaultTab?: 'login' | 'register';
  onClose: () => void;
};

export function AuthModal({ open, defaultTab = 'login', onClose }: Props) {
  const [tab, setTab] = useState<'login' | 'register'>(defaultTab);
  const navigate = useNavigate();

  // sync defaultTab when (re)opened
  useEffect(() => {
    if (open) setTab(defaultTab);
  }, [open, defaultTab]);

  // ESC / body scroll lock
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm animate-[fadeIn_.15s_ease-out]"
        onClick={onClose}
      />

      {/* dialog */}
      <div className="relative w-full max-w-md glass animate-[popIn_.18s_ease-out] overflow-hidden">
        {/* close */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-white/60 hover:bg-white flex items-center justify-center text-ink-500 hover:text-ink-900 transition"
          aria-label="关闭"
        >
          <X className="w-4 h-4" />
        </button>

        {/* header */}
        <div className="relative h-20 bg-gradient-to-br from-emerald-100 via-teal-50 to-cyan-50 flex items-center justify-center">
          <div className="absolute -bottom-7 w-16 h-16 rounded-2xl bg-white shadow-lg shadow-emerald-100 flex items-center justify-center ring-4 ring-white">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-400 via-teal-400 to-cyan-400 flex items-center justify-center shadow-inner">
              <Warehouse className="w-5 h-5 text-white" />
            </div>
          </div>
        </div>

        <div className="pt-11 pb-7 px-7">
          {/* title */}
          <div className="text-center mb-5">
            <h2 className="text-lg font-bold text-ink-900">Thalvior WMS</h2>
            <p className="text-xs text-ink-500 mt-0.5">智能仓储管理 · 代打包一站式</p>
          </div>

          {/* Tabs */}
          <div className="flex bg-white/60 rounded-xl p-1 mb-5 border border-white">
            {(['login', 'register'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                  tab === t
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-md shadow-emerald-200/50'
                    : 'text-ink-500 hover:text-ink-800'
                }`}
              >
                {t === 'login' ? '登录' : '免费注册'}
              </button>
            ))}
          </div>

          {tab === 'login' ? (
            <LoginForm onClose={onClose} onSuccess={() => navigate({ to: '/dashboard' })} />
          ) : (
            <RegisterForm onSwitchToLogin={() => setTab('login')} />
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes popIn { from { opacity: 0; transform: translateY(8px) scale(.97) } to { opacity: 1; transform: translateY(0) scale(1) } }
      `}</style>
    </div>,
    document.body
  );
}

function LoginForm({ onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      onSuccess();
    } catch (e: any) {
      setErr(e.message || '登录失败，请检查邮箱和密码');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3.5">
      <div>
        <label className="text-xs font-medium text-ink-500 mb-1.5 block">邮箱</label>
        <div className="relative">
          <Mail className="w-4 h-4 text-ink-300 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="wms@thalvior.icu"
            className="w-full pl-9 pr-3 py-2.5 bg-white/70 border border-white focus:border-emerald-300 rounded-xl focus:ring-2 focus:ring-emerald-200/50 outline-none text-sm transition"
          />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-ink-500 mb-1.5 block">密码</label>
        <div className="relative">
          <Lock className="w-4 h-4 text-ink-300 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入密码"
            className="w-full pl-9 pr-3 py-2.5 bg-white/70 border border-white focus:border-emerald-300 rounded-xl focus:ring-2 focus:ring-emerald-200/50 outline-none text-sm transition"
          />
        </div>
      </div>
      {err && (
        <div className="text-xs text-rose-600 bg-rose-50/80 border border-rose-100 px-3 py-2 rounded-xl">
          {err}
        </div>
      )}
      <button
        type="submit" disabled={loading}
        className="w-full py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 disabled:opacity-50 text-white font-semibold rounded-xl transition shadow-md shadow-emerald-200/50 flex items-center justify-center gap-2"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {loading ? '登录中...' : '登 录'}
      </button>
    </form>
  );
}

function RegisterForm({ onSwitchToLogin }: { onSwitchToLogin: () => void }) {
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
        setOk('注册成功！请查收邮件确认。');
      }
    } catch (e: any) {
      setErr(e.message || '注册失败');
    } finally { setLoading(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="text-xs font-medium text-ink-500 mb-1.5 block">姓名</label>
        <div className="relative">
          <User className="w-4 h-4 text-ink-300 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="张三"
            className="w-full pl-9 pr-3 py-2.5 bg-white/70 border border-white focus:border-emerald-300 rounded-xl focus:ring-2 focus:ring-emerald-200/50 outline-none text-sm transition"
          />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-ink-500 mb-1.5 block">邮箱</label>
        <div className="relative">
          <Mail className="w-4 h-4 text-ink-300 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="your@warehouse.com"
            className="w-full pl-9 pr-3 py-2.5 bg-white/70 border border-white focus:border-emerald-300 rounded-xl focus:ring-2 focus:ring-emerald-200/50 outline-none text-sm transition"
          />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-ink-500 mb-1.5 block">密码（至少 8 位）</label>
        <div className="relative">
          <Lock className="w-4 h-4 text-ink-300 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full pl-9 pr-3 py-2.5 bg-white/70 border border-white focus:border-emerald-300 rounded-xl focus:ring-2 focus:ring-emerald-200/50 outline-none text-sm transition"
          />
        </div>
      </div>
      {err && <div className="text-xs text-rose-600 bg-rose-50/80 px-3 py-2 rounded-xl border border-rose-100">{err}</div>}
      {ok && <div className="text-xs text-emerald-600 bg-emerald-50/80 px-3 py-2 rounded-xl border border-emerald-100">{ok}</div>}
      <button
        type="submit" disabled={loading}
        className="w-full py-2.5 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 hover:opacity-90 disabled:opacity-50 text-white font-semibold rounded-xl transition flex items-center justify-center gap-2 shadow-md shadow-emerald-200/50"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {loading ? '注册中...' : '免费注册'}
      </button>

      <div className="text-center text-xs text-ink-400 pt-1">
        已有账号？
        <button type="button" onClick={onSwitchToLogin} className="ml-1 font-medium text-emerald-600 hover:text-emerald-700">
          返回登录 →
        </button>
      </div>
    </form>
  );
}
