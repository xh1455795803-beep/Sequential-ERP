import { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { supabase } from '../lib/supabase';
import { Warehouse, Globe, Moon, Sun, Monitor, Shield, Lock } from 'lucide-react';

/** 主题切换（和 meoo 共用同一个 localStorage key） */
type ThemeMode = 'light' | 'dark' | 'system';

function getTheme(): ThemeMode {
  try { return (localStorage.getItem('thalvior_theme') as ThemeMode) || 'system'; }
  catch { return 'system'; }
}
function setTheme(m: ThemeMode) {
  localStorage.setItem('thalvior_theme', m);
  const isDark = m === 'dark' || (m === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.classList.toggle('light', !isDark);
}

/** 登录页 — 完全对齐 meoo /portal/forwarder 的设计结构 */
export function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [theme, setThemeState] = useState<ThemeMode>(getTheme());
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const [lang, setLang] = useState<'zh' | 'en'>('zh');

  useEffect(() => {
    setTheme(theme);
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
    <div className="min-h-screen flex flex-col bg-surface">
      {/* ============ 顶部 Header（和 meoo 完全一致：sticky + 毛玻璃 + 品牌 ============） */}
      <header className="sticky top-0 z-50 border-b border-border bg-card/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-4 sm:px-6">
          {/* 左：品牌 */}
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-brand-ink">
              <Warehouse className="h-4 w-4" strokeWidth={2.5} />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-base font-semibold tracking-tight text-foreground">Thalvior</span>
              <span className="hidden text-xs text-muted-foreground sm:inline">仓库管理系统</span>
            </div>
          </div>

          {/* 右：语言 + 主题切换 */}
          <div className="flex items-center gap-1">
            {/* 语言切换（和 meoo 一致） */}
            <button
              onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
              className="flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-surface-hover hover:text-foreground transition"
              aria-label="切换语言"
            >
              <Globe className="h-3.5 w-3.5" />
              <span>{lang === 'zh' ? 'English' : '中文'}</span>
            </button>

            {/* 主题切换下拉（和 meoo 一致：light/dark/system 三态） */}
            <div className="relative">
              <button
                onClick={() => setShowThemeMenu(!showThemeMenu)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-hover hover:text-foreground transition"
                aria-label="切换主题"
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
                      <button
                        key={t}
                        onClick={() => { setThemeState(t); setShowThemeMenu(false); }}
                        className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition ${
                          theme === t ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground'
                        }`}
                      >
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
          <div className="mb-6 text-center">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-brand">WMS PORTAL</div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Thalvior · 仓库管理系统</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              商家端 · 仓库端(PDA扫码) · 货代端 三端联动的一站式仓库解决方案
            </p>
          </div>

          {/* 登录卡片 */}
          <div className="rounded-xl border border-border bg-card p-6 shadow-soft sm:p-8">
            {/* 登录 / 注册 切换 */}
            <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm">
              <button
                onClick={() => { setMode('login'); setErr(''); }}
                className={`h-8 rounded-md transition font-medium ${
                  mode === 'login'
                    ? 'bg-card shadow text-brand'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >登录</button>
              <button
                onClick={() => { setMode('signup'); setErr(''); }}
                className={`h-8 rounded-md transition font-medium ${
                  mode === 'signup'
                    ? 'bg-card shadow text-brand'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >注册</button>
            </div>

            {/* 表单 */}
            <div className="space-y-4">
              {/* 邮箱（带 label） */}
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-sm font-medium text-foreground">
                  邮箱
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground placeholder:text-text-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-ring/30 transition"
                />
              </div>

              {/* 密码（带 label） */}
              <div className="space-y-1.5">
                <label htmlFor="password" className="text-sm font-medium text-foreground">
                  密码
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="至少 6 位"
                  className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground placeholder:text-text-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-ring/30 transition"
                />
              </div>

              {/* 错误提示 */}
              {err && (
                <div className="flex items-start gap-2 rounded-md border border-danger-subtle bg-danger-subtle/50 p-2.5 text-sm text-danger">
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{err}</span>
                </div>
              )}

              {/* 提交按钮 */}
              <button
                onClick={submit}
                disabled={loading || !email || !password}
                className="h-9 w-full rounded-md bg-brand px-4 text-sm font-medium text-brand-ink transition hover:bg-brand-hover focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:opacity-50 disabled:hover:bg-brand"
              >
                {loading ? '处理中...' : mode === 'login' ? '登录' : '注册账号'}
              </button>
            </div>

            {/* 安全提示（和 meoo 一致，增强信任感） */}
            <div className="mt-5 space-y-2 border-t border-border pt-4 text-xs text-muted-foreground">
              <div className="flex items-start gap-1.5">
                <Shield className="mt-0.5 h-3 w-3 shrink-0 text-success" />
                <span>口令只在提交时用于校验，不进日志、不进令牌、不回显</span>
              </div>
              <div className="flex items-start gap-1.5">
                <Lock className="mt-0.5 h-3 w-3 shrink-0 text-brand" />
                <span>与 thalvior.icu 主站共用同一账号体系，所有请求通过 HTTPS 加密传输</span>
              </div>
            </div>
          </div>

          {/* 页脚链接（和 meoo 一致） */}
          <div className="mt-5 text-center text-xs text-muted-foreground">
            <a href="https://thalvior.icu" target="_blank" rel="noreferrer"
               className="text-brand hover:text-brand-hover transition">返回 Thalvior 主站</a>
          </div>
        </div>
      </main>

      {/* ============ 底部法律页脚（和 meoo 一致） ============ */}
      <footer className="border-t border-border bg-surface-sunken py-4">
        <div className="mx-auto flex max-w-[1400px] flex-col items-center justify-center gap-2 px-4 text-xs text-text-subtle sm:flex-row sm:gap-4">
          <span>© 2026 Thalvior Technology Co., Ltd.</span>
          <span className="hidden sm:inline">·</span>
          <a href="#" className="hover:text-muted-foreground transition">隐私政策</a>
          <span className="hidden sm:inline">·</span>
          <a href="#" className="hover:text-muted-foreground transition">用户服务协议</a>
          <span className="hidden sm:inline">·</span>
          <a href="#" className="hover:text-muted-foreground transition">退款规则</a>
          <span className="hidden sm:inline">·</span>
          <span>ICP 备案号: 粤ICP备XXXXXXXX号</span>
        </div>
      </footer>
    </div>
  );
}
