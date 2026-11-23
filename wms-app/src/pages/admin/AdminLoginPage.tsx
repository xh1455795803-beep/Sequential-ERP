import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { supabase } from '../../lib/supabase';
import { Shield } from 'lucide-react';

export function AdminLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    setErr('');
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      navigate({ to: '/admin/dashboard' });
    } catch (e: any) {
      setErr(e.message || '登录失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-900 via-indigo-900 to-slate-900">
      <div className="w-full max-w-md p-8 bg-white rounded-2xl shadow-2xl">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center shadow-lg">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-800">Thalvior SaaS 管理控制台</h1>
            <p className="text-xs text-slate-500">Platform Admin · 仅限平台运营方</p>
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">管理员邮箱</label>
            <input
              type="email"
              placeholder="admin@thalvior.icu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-400"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">密码</label>
            <input
              type="password"
              placeholder="至少 6 位"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-400"
            />
          </div>
          {err && <div className="text-sm text-red-500 bg-red-50 p-2 rounded">{err}</div>}
          <button
            onClick={submit} disabled={loading}
            className="w-full py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-lg font-medium transition disabled:opacity-50 shadow-md"
          >
            {loading ? '登录中...' : '进入控制台'}
          </button>
        </div>
        <div className="mt-5 pt-4 border-t border-slate-100 text-center text-xs text-slate-400">
          Thalvior Platform · v6.0 · All Rights Reserved
        </div>
      </div>
    </div>
  );
}
