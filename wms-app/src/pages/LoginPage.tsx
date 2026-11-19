import { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { supabase } from '../lib/supabase';
import { Warehouse, Globe, Moon, Sun, Monitor, Shield, Lock, Mail, Eye, EyeOff, Loader2, CheckCircle2 } from 'lucide-react';

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
  const [showThemeMenu, setShowThemeMenu] = useState(false);
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
    <div className="min-h-screen flex flex-col bg-surface text-fg">
      {/* ============ 顶部 Header ============ */}
      <header className="sticky top-0 z-50 border-b border-border bg-card/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-brand-ink">
              <Warehouse className="h-4 w-4" strokeWidth={2.5} />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-base font-semibold tracking-tight text-foreground">Thalvior</span>
              <span className="hidden text-xs text-fg-muted sm:inline">WMS · 仓库管理系统</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button className="flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-fg-muted hover:bg-surface-hover hover:text-fg transition" aria-label="English">
              <Globe className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">English</span>
            </button>
            <div className="relative">
              <button
                onClick={() => setShowThemeMenu(!showThemeMenu)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg transition"
              >
                {theme === 'dark' ? <Moon className="h-4 w-4" />
                 : theme === 'light' ? <Sun className="h-4 w-4" />
                 : <Monitor className="h-4 w-4" />}
              </button>
              {showThemeMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowThemeMenu(false)} />
                  <div className="absolute right-0 z-50 mt-1 w-32 rounded-md border border-border bg-popover p-1 shadow-lift">
                    {(['light', 'dark', 'system'] as const).map((t) => (
                      <button key={t}
                        onClick={() => { setThemeState(t); setShowThemeMenu(false); }}
                        className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition ${
                          theme === t ? 'bg-accent text-accent-foreground' : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
                        }`}>
                        {t === 'light' && <Sun className="h-3.5 w-3.5" />}
                        {t === 'dark' && <Moon className="h-3.5 w-3.5" />}
                        {t === 'system' && <Monitor className="h-3.5 w-3.5" />}
                        <span>{t === 'light' ? '浅色' : t === 'dark' ? '深色' : '跟随系统'}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ============ 主内容 ============ */}
      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:py-16">
        <div className="w-full max-w-md">
          {/* 品牌区 */}
          <div className="mb-7 text-center">
            <div className="mb-2 text-[10.5px] font-medium uppercase tracking-[0.14em] text-brand">WMS PORTAL</div>
            <h1 className="font-display text-lg font-semibold tracking-tight text-fg">仓库管理系统</h1>
            <p className="mt-1.5 text-sm text-fg-muted">商家端 · 仓库端 · 货代端 三端联动</p>
          </div>

          {/* 登录卡片 */}
          <div className="rounded-2xl border border-border bg-card p-6 shadow-soft sm:p-8">
            {/* 模式切换 */}
            <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
              <button
                onClick={() => { setMode('login'); setErr(''); }}
                className={`rounded-md py-2 text-sm font-medium transition-colors ${
                  mode === 'login' ? 'bg-card text-fg shadow-soft' : 'text-fg-muted hover:text-fg'
                }`}>登录</button>
              <button
                onClick={() => { setMode('signup'); setErr(''); }}
                className={`rounded-md py-2 text-sm font-medium transition-colors ${
                  mode === 'signup' ? 'bg-card text-fg shadow-soft' : 'text-fg-muted hover:text-fg'
                }`}>注册账号</button>
            </div>

            {/* 表单 */}
            <div className="space-y-4">
              {/* 邮箱（meoo 风格：前置 Mail 图标 + 相对定位 + pl-9） */}
              <div className="space-y-2">
                <label htmlFor="account" className="text-sm font-medium text-fg">邮箱</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-fg-muted" />
                  <input
                    id="account"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="h-9 w-full rounded-md border border-input bg-card pl-9 pr-3 text-sm text-fg placeholder:text-text-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-ring/30 transition"
                  />
                </div>
              </div>

              {/* 密码（meoo 风格：前置 Lock 图标 + 忘记密码链接） */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="password" className="text-sm font-medium text-fg">密码</label>
                  {mode === 'login' && (
                    <a href="mailto:support@thalvior.icu" className="text-xs font-medium text-harbor hover:text-brand hover:underline transition">
                      忘记密码？
                    </a>
                  )}
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-fg-muted" />
                  <input
                    id="password"
                    type={showPwd ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === 'login' ? '至少 6 位' : '至少 6 位'}
                    className="h-9 w-full rounded-md border border-input bg-card pl-9 pr-9 text-sm text-fg placeholder:text-text-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-ring/30 transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(!showPwd)}
                    className="absolute right-2 top-1/2 flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:text-fg transition"
                    aria-label={showPwd ? '隐藏密码' : '显示密码'}
                  >
                    {showPwd ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {/* 错误提示（meoo 风格） */}
              {err && (
                <p className="rounded-md bg-destructive/8 px-3 py-2 text-sm text-destructive">{err}</p>
              )}

              {/* 提交按钮（meoo 风格：带 loading spinner） */}
              <button
                onClick={submit}
                disabled={loading || !email || !password}
                className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-medium text-brand-ink transition hover:bg-brand-hover focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:opacity-50 disabled:hover:bg-brand"
              >
                {loading && <Loader2 className="h-[15px] w-[15px] animate-spin" />}
                <span>{loading ? '处理中...' : mode === 'login' ? '登录' : '注册账号'}</span>
              </button>
            </div>

            {/* 底部栏（meoo 风格：remember me + 登录/注册切换链接） */}
            <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
              {mode === 'login' ? (
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs text-fg-muted select-none">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                      className="h-3.5 w-3.5 accent-brand"
                    />
                    记住我
                  </label>
                </div>
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
          </div>
        </div>
      </main>

      {/* 底部法律页脚 */}
      <footer className="border-t border-border bg-surface-sunken py-4">
        <div className="mx-auto flex max-w-[1400px] flex-col items-center justify-center gap-2 px-4 text-xs text-fg-subtle sm:flex-row sm:gap-4">
          <span>© 2026 Thalvior Technology Co., Ltd.</span>
          <span className="hidden sm:inline">·</span>
          <a href="#" className="hover:text-fg-muted transition">隐私政策</a>
          <span className="hidden sm:inline">·</span>
          <a href="#" className="hover:text-fg-muted transition">用户服务协议</a>
          <span className="hidden sm:inline">·</span>
          <a href="#" className="hover:text-fg-muted transition">退款规则</a>
          <span className="hidden sm:inline">·</span>
          <span>粤ICP备XXXXXXXX号</span>
        </div>
      </footer>
    </div>
  );
}
