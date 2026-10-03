import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Smartphone, Lock, Loader2, MessageSquare } from "lucide-react";
import { normalizePhone, isPhone, isEmail } from "@/lib/phone";
import { sendEmailCode } from "@/lib/email-otp";
import { sendSystemMail } from "@/lib/mailer";
import { applySessionPersistence } from "@/lib/session";
import { getRememberPreference, beginLoginAttempt } from "@/lib/auth-storage";
import { Checkbox } from "@/components/ui/checkbox";
import { AuthShell } from "@/components/auth-shell";
import { useLanguage } from "@/i18n/LanguageContext";

export const Route = createFileRoute("/login")({
  component: Login,
});

type LoginMode = "password" | "code";

// 将 Supabase 原始错误映射为友好中文提示
function mapAuthError(e: unknown, t: (key: string) => string): string {
  const msg = e instanceof Error ? e.message : "";
  if (/invalid login credentials/i.test(msg)) return t("auth.invalidCredentials");
  if (/email not confirmed/i.test(msg)) return t("auth.emailNotConfirmed");
  if (/user not found/i.test(msg)) return t("auth.userNotFound");
  if (/rate limit/i.test(msg)) return t("auth.rateLimit");
  // GoTrue 未开通手机 OTP 通道时返回 otp_disabled / "Signups not allowed for otp"
  if (/otp_disabled|signups not allowed/i.test(msg)) return t("auth.phoneOtpDisabled");
  // GoTrue 对错误/过期验证码返回 "Token has expired or is invalid"（error_code: otp_expired）
  if (/invalid.*otp|invalid.*code|otp_expired|expired or is invalid|invalid token/i.test(msg)) {
    return t("auth.invalidCode");
  }
  return msg || t("auth.loginFail");
}

function Login() {
  const navigate = useNavigate();
  const { t, lang } = useLanguage();
  const [mode, setMode] = useState<LoginMode>("password");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [countdown, setCountdown] = useState(0);
  // 勾选框初值必须与实际生效的偏好一致，否则会出现「看着勾了、其实没生效」
  const [remember, setRemember] = useState(() => getRememberPreference());

  const accountIsEmail = isEmail(account);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  async function handlePasswordLogin() {
    setError("");
    if (!account.trim()) {
      setError(t("auth.accountRequired"));
      return;
    }
    if (!password) {
      setError(t("auth.passwordRequired"));
      return;
    }
    if (accountIsEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.trim())) {
      setError(t("auth.emailInvalid"));
      return;
    }
    if (!accountIsEmail && !isPhone(account)) {
      setError(t("auth.phoneInvalid"));
      return;
    }
    setLoading(true);
    try {
      beginLoginAttempt();
      if (accountIsEmail) {
        const { error } = await supabase.auth.signInWithPassword({ email: account.trim(), password });
        if (error) throw error;
      } else {
        const phone = normalizePhone(account);
        const { error } = await supabase.auth.signInWithPassword({ phone, password });
        if (error) throw error;
      }
      console.log("[login] 密码登录成功", { accountIsEmail, remember });
      await applySessionPersistence(remember);

      // 登录安全通知邮件（同一账号 24 小时内只发一次，避免刷屏；失败不影响登录）
      void sendSystemMail("login_alert", { lang, dedupeHours: 24 });

      navigate({ to: "/dashboard" });
    } catch (e) {
      setError(mapAuthError(e, t));
    } finally {
      setLoading(false);
    }
  }

  async function handleSendCode() {
    setError("");
    setNotice("");
    if (!accountIsEmail && !isPhone(account)) {
      setError(t("auth.codeOnlyAccount"));
      return;
    }
    setLoading(true);
    try {
      if (accountIsEmail) {
        // 邮箱：走自建邮件通道（GoTrue 自带邮件在本环境不可达），验证码由 GoTrue 原生签发
        await sendEmailCode(account.trim(), "login");
        setNotice(t("auth.emailCodeSent", { account: account.trim() }));
      } else {
        const phone = normalizePhone(account);
        const { error } = await supabase.auth.signInWithOtp({
          phone,
          options: { shouldCreateUser: false },
        });
        if (error) throw error;
        setNotice(t("auth.phoneCodeSent", { account: phone }));
      }
      setCountdown(60);
    } catch (e) {
      setError(mapAuthError(e, t));
      setCountdown(0);
    } finally {
      setLoading(false);
    }
  }

  async function handleCodeLogin() {
    setError("");
    if (!accountIsEmail && !isPhone(account)) {
      setError(t("auth.codeOnlyAccount"));
      return;
    }
    if (!token.trim()) {
      setError(t("auth.codeRequired"));
      return;
    }
    setLoading(true);
    try {
      beginLoginAttempt();
      if (accountIsEmail) {
        // 邮箱验证码由 GoTrue 签发，用原生 email 类型校验即可直接下发会话
        const { error } = await supabase.auth.verifyOtp({
          email: account.trim(),
          token: token.trim(),
          type: "email",
        });
        if (error) throw error;
      } else {
        const phone = normalizePhone(account);
        const { error } = await supabase.auth.verifyOtp({
          phone,
          token: token.trim(),
          type: "sms",
        });
        if (error) throw error;
      }
      console.log("[login] 验证码登录成功", { accountIsEmail, remember });
      await applySessionPersistence(remember);

      // 登录安全通知邮件（同一账号 24 小时内只发一次，避免刷屏；失败不影响登录）
      void sendSystemMail("login_alert", { lang, dedupeHours: 24 });

      navigate({ to: "/dashboard" });
    } catch (e) {
      setError(mapAuthError(e, t));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      panelTitle={t("auth.shell.loginTitle")}
      panelDesc={t("auth.shell.loginDesc")}
    >
      <div className="mb-7">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          {t("auth.loginTitle")}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t("auth.brandTitle")}</p>
      </div>

      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm sm:p-8">
        {/* 登录方式切换 */}
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
          <button
            onClick={() => { setMode("password"); setError(""); setNotice(""); }}
            className={`rounded-md py-2 text-sm font-medium transition-colors ${mode === "password" ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t("auth.passwordLogin")}
          </button>
          <button
            onClick={() => { setMode("code"); setError(""); setNotice(""); }}
            className={`rounded-md py-2 text-sm font-medium transition-colors ${mode === "code" ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t("auth.codeLogin")}
          </button>
        </div>

        {mode === "password" ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="account">{t("auth.account")}</Label>
              <div className="relative">
                {accountIsEmail ? (
                  <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                ) : (
                  <Smartphone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                )}
                <Input
                  id="account"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">{t("auth.password")}</Label>
                <button
                  onClick={() => navigate({ to: "/reset-password" })}
                  className="text-xs font-medium text-harbor hover:text-primary hover:underline"
                >
                  {t("auth.forgot")}
                </button>
              </div>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            {error && (
              <p className="rounded-md bg-destructive/8 px-3 py-2 text-sm text-destructive">{error}</p>
            )}

            <Button className="w-full" onClick={handlePasswordLogin} disabled={loading || !account || !password}>
              {loading && <Loader2 size={15} className="animate-spin" />}
              {t("auth.login")}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="account">{t("auth.account")}</Label>
              <div className="relative">
                {accountIsEmail ? (
                  <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                ) : (
                  <Smartphone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                )}
                <Input
                  id="account"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="token">{t("auth.code")}</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <MessageSquare size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="token"
                      value={token}
                    onChange={(e) => setToken(e.target.value)}
                    maxLength={6}
                    className="pl-9 font-data tracking-[0.3em]"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSendCode}
                  disabled={loading || countdown > 0 || !(accountIsEmail || isPhone(account))}
                  className="shrink-0"
                >
                  {countdown > 0 ? `${countdown}s` : t("auth.getCode")}
                </Button>
              </div>
            </div>

            {notice && (
              <p className="rounded-md bg-primary/8 px-3 py-2 text-xs text-primary">{notice}</p>
            )}

            {error && (
              <p className="rounded-md bg-destructive/8 px-3 py-2 text-sm text-destructive">{error}</p>
            )}

            <Button className="w-full" onClick={handleCodeLogin} disabled={loading || !account || !token}>
              {loading && <Loader2 size={15} className="animate-spin" />}
              {t("auth.login")}
            </Button>
          </div>
        )}

        <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="remember"
              checked={remember}
              onCheckedChange={(v) => setRemember(v === true)}
            />
            <label htmlFor="remember" className="cursor-pointer text-xs text-muted-foreground select-none">
              {t("auth.remember")}
            </label>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("auth.noAccount")}{" "}
            <button onClick={() => navigate({ to: "/register" })} className="font-medium text-primary hover:underline">
              {t("auth.registerNow")}
            </button>
          </p>
        </div>
      </div>
    </AuthShell>
  );
}