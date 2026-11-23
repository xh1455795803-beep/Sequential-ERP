import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { supabase } from '../lib/supabase';
import { PackageCheck } from 'lucide-react';

export function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    setErr('');
    setLoading(true);
    try {
      const { error } = mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
      if (error) throw error;
      navigate({ to: '/dashboard' });
    } catch (e: any) {
      setErr(e.message || '登录失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-deep-800 via-deep-700 to-sea-600">
      <div className="w-full max-w-md p-8 bg-white rounded-2xl shadow-2xl">
        <div className="flex items-center gap-2 mb-6">
          <PackageCheck className="w-7 h-7 text-brand-500" />
          <h1 className="text-xl font-bold">Thalvior · WMS 仓库管理系统</h1>
        </div>
        <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg text-sm">
          <button
            onClick={() => setMode('login')}
            className={`flex-1 py-1.5 rounded-md transition ${mode === 'login' ? 'bg-white shadow text-brand-600 font-medium' : 'text-gray-500'}`}
          >登录</button>
          <button
            onClick={() => setMode('signup')}
            className={`flex-1 py-1.5 rounded-md transition ${mode === 'signup' ? 'bg-white shadow text-brand-600 font-medium' : 'text-gray-500'}`}
          >注册</button>
        </div>
        <div className="space-y-3">
          <input
            type="email" placeholder="邮箱" value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <input
            type="password" placeholder="密码（至少 6 位）" value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {err && <div className="text-sm text-red-500 bg-red-50 p-2 rounded">{err}</div>}
          <button
            onClick={submit} disabled={loading}
            className="w-full py-2.5 bg-brand-500 hover:bg-brand-600 text-white rounded-lg font-medium transition disabled:opacity-50"
          >
            {loading ? '处理中...' : mode === 'login' ? '登 录' : '注册账号'}
          </button>
        </div>
        <div className="mt-5 text-center text-xs text-gray-400">
          与 thalvior.icu 主站共用同一账号体系
        </div>
      </div>
    </div>
  );
}
