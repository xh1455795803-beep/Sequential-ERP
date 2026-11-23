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
    if (!email || !password) {
      setErr('请输入邮箱和密码');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      navigate({ to: '/admin/dashboard' });
    } catch (e: any) {
      setErr(e?.message || '登录失败，请检查账号');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#8b5cf6] via-indigo-800 to-slate-900 relative overflow-hidden">
      {/* 背景装饰 */}
      <div className="absolute top-0 left-0 w-96 h-96 bg-purple-400/20 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-indigo-400/20 rounded-full blur-3xl translate-x-1/2 translate-y-1/2" />

      <div className="relative w-full max-w-md p-8 bg-white/95 backdrop-blur rounded-2xl shadow-2xl mx-4">
        <div className="flex items-center gap-3 mb-7">
          <div className="w-12 h-12 rounded-xl bg-[#8b5cf6] flex items-center justify-center shadow-lg shadow-purple-500/30">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-800">Thalvior 管理控制台</h1>
            <p className="text-xs text-slate-500">Platform Admin · 跨境 SaaS</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-slate-600 mb-1.5 block font-medium">管理员邮箱</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="email"
                placeholder="admin@thalvior.icu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#8b5cf6] focus:border-[#8b5cf6] transition"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-600 mb-1.5 block font-medium">密码</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="password"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#8b5cf6] focus:border-[#8b5cf6] transition"
              />
            </div>
          </div>

          {err && (
            <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg border border-red-100">
              {err}
            </div>
          )}

          <button
            onClick={submit}
            disabled={loading}
            className="w-full py-2.5 bg-[#8b5cf6] hover:bg-[#7c3aed] text-white rounded-lg font-medium transition disabled:opacity-60 shadow-md shadow-purple-500/20 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> 登录中...
              </>
            ) : (
              '进入控制台'
            )}
          </button>
        </div>

        <div className="mt-6 pt-4 border-t border-slate-100 text-center text-xs text-slate-400">
          Thalvior Cross-Border SaaS · v6.0 · 仅限授权管理员
        </div>
      </div>
    </div>
  );
}
