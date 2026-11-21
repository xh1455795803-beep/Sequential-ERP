import { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { supabase } from '../lib/supabase';
import { Globe, Moon, Sun, Monitor, Shield, Lock, Mail, Eye, EyeOff, Loader2 } from 'lucide-react';
import { AuthShell } from '../components/ui/auth-shell';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Checkbox } from '../components/ui/checkbox';
import { Label, Input } from '../components/ui/input';

/** 主题切换（和 meoo 共用同一个 localStorage key） */
type ThemeMode = 'light' | 'dark' | 'system';
function getTheme(): ThemeMode {
  try { return (localStorage.getItem('thalvior_theme') as ThemeMode) || 'system'; }
  catch { return 'system'; }
}
function applyTheme(m: ThemeMode) {
  const isDark = m === 'dark' || (m === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.classList.toggle('light', !isDark);
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
}

export function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [theme, setThemeState] = useState<ThemeMode>(getTheme());
  const [showPwd, setShowPwd] = useState(false);
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    localStorage.setItem('thalvior_theme', theme);
    applyTheme(theme);
  }, [theme]);

  async function submit() {
    setErr('');
    setLoading(true);
    try {
      const { data, error } = mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
      if (error) throw error;
      
      console.log('[Login] signIn OK, user:', data?.user?.email);
      
      // 硬兜底：直接用 window.location 跳转（绕过 TanStack Router 的任何可能问题）
      // session 已经被 Supabase client 存到 localStorage 了
      setTimeout(() => {
        const target = '/wms/dashboard';
        console.log('[Login] forcing redirect to', target);
        window.location.replace(target);
      }, 50);
    } catch (e: any) {
      console.error('[Login] error:', e);
      setErr(e.message || '登录失败');
      setLoading(false);
    }
  }

  return (
    <AuthShell
      panelTitle={mode === 'login' ? '登录到您的 WMS 仓库' : '创建 WMS 账号'}
      panelDesc={mode === 'login'
        ? '商家端、仓库端、货代端三端联动，一次登录管理所有业务。'
        : 'Thalvior WMS 与货小易 ERP 共用同一账号体系。'}
    >
      {/* 模式切换（meoo Tabs 风格） */}
      <div className="mb-6 text-center">
        <Tabs defaultValue="login" value={mode} onValueChange={(v) => { setMode(v as any); setErr(''); }}>
          <TabsList>
            <TabsTrigger value="login">密码登录</TabsTrigger>
            <TabsTrigger value="signup">注册账号</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* 表单（h-8 rounded-lg 全 meoo 标准） */}
      <div className="space-y-4">
        {/* 邮箱 */}
        <div className="space-y-1.5">
          <Label htmlFor="account">邮箱</Label>
          <div className="relative">
            <Mail className="absolute left-2.5 top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-fg-muted" />
            <Input
              id="account"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="pl-7"
            />
          </div>
        </div>

        {/* 密码 */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">密码</Label>
            {mode === 'login' && (
              <a href="mailto:support@thalvior.icu" className="text-xs font-medium text-brand hover:text-brand-hover hover:underline transition">
                忘记密码？
              </a>
            )}
          </div>
          <div className="relative">
            <Lock className="absolute left-2.5 top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-fg-muted" />
            <Input
              id="password"
              type={showPwd ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
              className="pl-7 pr-7"
            />
            <button
              type="button"
              onClick={() => setShowPwd(!showPwd)}
              className="absolute right-1.5 top-1/2 flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:text-fg transition"
              aria-label={showPwd ? '隐藏密码' : '显示密码'}
            >
              {showPwd ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {/* 错误提示（meoo 风格：无 border，纯 bg） */}
        {err && (
          <p className="rounded-md bg-destructive/8 px-3 py-2 text-sm text-destructive">{err}</p>
        )}

        {/* 提交按钮 */}
        <button
          onClick={submit}
          disabled={loading || !email || !password}
          className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-medium text-brand-ink transition hover:bg-brand-hover focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:opacity-50 disabled:hover:bg-brand"
        >
          {loading && <Loader2 className="h-[15px] w-[15px] animate-spin" />}
          <span>{loading ? '处理中...' : mode === 'login' ? '登录' : '注册账号'}</span>
        </button>
      </div>

      {/* 底部栏 */}
      <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
        {mode === 'login' ? (
          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-fg-muted select-none">
            <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
            记住我
          </label>
        ) : <div />}
        <p className="text-sm text-fg-muted">
          {mode === 'login' ? (
            <>没有账号？<button onClick={() => { setMode('signup'); setErr(''); }} className="font-medium text-brand hover:underline transition">立即注册</button></>
          ) : (
            <>已有账号？<button onClick={() => { setMode('login'); setErr(''); }} className="font-medium text-brand hover:underline transition">立即登录</button></>
          )}
        </p>
      </div>

      {/* 安全提示 */}
      <div className="mt-4 space-y-2 border-t border-border pt-4 text-xs text-fg-muted">
        <div className="flex items-start gap-1.5">
          <Shield className="mt-0.5 h-3 w-3 shrink-0 text-success" />
          <span>口令只在提交时用于校验，不进日志、不进令牌、不回显</span>
        </div>
        <div className="flex items-start gap-1.5">
          <Lock className="mt-0.5 h-3 w-3 shrink-0 text-brand" />
          <span>与 thalvior.icu 主站共用同一账号体系，HTTPS 加密传输</span>
        </div>
      </div>

      {/* 移动端主题/语言切换（lg 以下显示） */}
      <div className="mt-4 flex items-center justify-center gap-3 lg:hidden">
        <button className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg transition">
          <Globe className="h-3.5 w-3.5" /> English
        </button>
        {(['light', 'dark', 'system'] as const).map((t) => (
          <button key={t}
            onClick={() => setThemeState(t)}
            className={`flex h-8 w-8 items-center justify-center rounded-md transition ${theme === t ? 'bg-accent text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg'}`}
            title={t === 'light' ? '浅色' : t === 'dark' ? '深色' : '跟随系统'}
          >
            {t === 'light' && <Sun className="h-3.5 w-3.5" />}
            {t === 'dark' && <Moon className="h-3.5 w-3.5" />}
            {t === 'system' && <Monitor className="h-3.5 w-3.5" />}
          </button>
        ))}
      </div>
    </AuthShell>
  );
}
