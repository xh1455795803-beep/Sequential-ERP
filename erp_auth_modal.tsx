import { useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Mail, Lock, Loader2, MessageSquare, ShieldCheck, UserPlus, LogIn } from "lucide-react";

import { isEmail } from "@/lib/phone";
import { sendEmailCode } from "@/lib/email-otp";
import { sendSystemMail } from "@/lib/mailer";
import { applySessionPersistence } from "@/lib/session";
import { getRememberPreference, beginLoginAttempt } from "@/lib/auth-storage";
import { useLanguage } from "@/i18n/LanguageContext";
import { devLog } from "@/lib/devlog";

import {
  LEGAL_DOC_LABEL_KEY,
  LEGAL_DOC_PATH,
  SIGNUP_CONSENT_KINDS,
  legalText,
  recordSignupConsents,
} from "@/lib/legal-versions";
import { tt } from "@/i18n/tts";

type Tab = "login" | "register";

export function AuthModal({
  open,
  defaultTab = "login",
  onOpenChange,
}: {
  open: boolean;
  defaultTab?: Tab;
  onOpenChange: (o: boolean) => void;
}) {
  const [tab, setTab] = useState<Tab>(defaultTab);
  const navigate = useNavigate();

  useEffect(() => {
    if (open) setTab(defaultTab);
  }, [open, defaultTab]);

  const close = () => onOpenChange(false);

  function onLoginSuccess() {
    close();
    navigate({ to: "/dashboard" });
  }

  function onRegisterSuccess() {
    close();
    navigate({ to: "/dashboard" });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 overflow-hidden [&>button]:top-3 [&>button]:right-3">
        {/* 渐变装饰头 */}
        <div className="relative h-20 bg-gradient-to-br from-sky-100 via-cyan-50 to-emerald-50 flex items-center justify-center">
          <div className="absolute -bottom-7 w-16 h-16 rounded-2xl bg-white shadow-lg shadow-sky-100 flex items-center justify-center ring-4 ring-white">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-sky-400 via-cyan-400 to-emerald-400 flex items-center justify-center shadow-inner">
              {tab === "login" ? (
                <LogIn className="w-5 h-5 text-white" />
              ) : (
                <UserPlus className="w-5 h-5 text-white" />
              )}
            </div>
          </div>
        </div>

        <div className="pt-11 pb-6 px-6">
          {/* Tabs */}
          <div className="flex grid-cols-2 gap-1 rounded-lg bg-muted p-1 mb-5">
            <button
              onClick={() => setTab("login")}
              className={`rounded-md py-2 text-sm font-medium transition-colors ${
                tab === "login" ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              登录
            </button>
            <button
              onClick={() => setTab("register")}
              className={`rounded-md py-2 text-sm font-medium transition-colors ${
                tab === "register" ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              免费注册
            </button>
          </div>

          {tab === "login" ? (
            <LoginForm onSuccess={onLoginSuccess} onSwitchRegister={() => setTab("register")} />
          ) : (
            <RegisterForm onSuccess={onRegisterSuccess} onSwitchLogin={() => setTab("login")} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============ LOGIN FORM ============
type LoginMode = "password" | "code";

function mapAuthError(e: unknown, t: (key: string) => string): string {
  const msg = e instanceof Error ? e.message : "";
  if (/invalid login credentials/i.test(msg)) return t("auth.invalidCredentials");
  if (/email not confirmed/i.test(msg)) return t("auth.emailNotConfirmed");
  if (/user not found/i.test(msg)) return t("auth.userNotFound");
  if (/rate limit/i.test(msg)) return t("auth.rateLimit");
  if (/otp_disabled|signups not allowed/i.test(msg)) return t("auth.phoneOtpDisabled");
  if (/invalid.*otp|invalid.*code|otp_expired|expired or is invalid|invalid token/i.test(msg)) {
    return t("auth.invalidCode");
  }
  return msg || t("auth.loginFail");
}

function LoginForm({
  onSuccess,
  onSwitchRegister,
}: {
  onSuccess: () => void;
  onSwitchRegister: () => void;
}) {
  const { t, lang } = useLanguage();
  const [mode, setMode] = useState<LoginMode>("password");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [remember, setRemember] = useState(() => getRememberPreference());

  const accountIsEmail = isEmail(account);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  async function handlePasswordLogin() {
    setError("");
    if (!account.trim()) { setError(t("auth.accountRequired")); return; }
    if (!password) { setError(t("auth.passwordRequired")); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.trim())) { setError(t("auth.emailInvalid")); return; }
    setLoading(true);
    try {
      beginLoginAttempt();
      const { error } = await supabase.auth.signInWithPassword({ email: account.trim(), password });
      if (error) throw error;
      devLog("[modal-login] 密码登录成功", { remember });
      await applySessionPersistence(remember);
      void sendSystemMail("login_alert", { lang, dedupeHours: 24 });
      onSuccess();
    } catch (e) {
      setError(mapAuthError(e, t));
    } finally { setLoading(false); }
  }

  async function handleSendCode() {
    setError(""); setNotice("");
    if (!accountIsEmail) { setError(t("auth.emailInvalid")); return; }
    setLoading(true);
    try {
      await sendEmailCode(account.trim(), "login");
      setNotice(t("auth.emailCodeSent", { account: account.trim() }));
      setCountdown(60);
    } catch (e) {
      setError(mapAuthError(e, t));
      setCountdown(0);
    } finally { setLoading(false); }
  }

  async function handleCodeLogin() {
    setError("");
    if (!accountIsEmail) { setError(t("auth.emailInvalid")); return; }
    if (!token.trim()) { setError(t("auth.codeRequired")); return; }
    setLoading(true);
    try {
      beginLoginAttempt();
      const { error } = await supabase.auth.verifyOtp({ email: account.trim(), token: token.trim(), type: "email" });
      if (error) throw error;
      devLog("[modal-login] 验证码登录成功", { remember });
      await applySessionPersistence(remember);
      void sendSystemMail("login_alert", { lang, dedupeHours: 24 });
      onSuccess();
    } catch (e) {
      setError(mapAuthError(e, t));
    } finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      {/* 登录方式切换 */}
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        <button
          onClick={() => { setMode("password"); setError(""); setNotice(""); }}
          className={`rounded-md py-2 text-sm font-medium transition-colors ${mode === "password" ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"}`}
        >
          密码登录
        </button>
        <button
          onClick={() => { setMode("code"); setError(""); setNotice(""); }}
          className={`rounded-md py-2 text-sm font-medium transition-colors ${mode === "code" ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"}`}
        >
          验证码登录
        </button>
      </div>

      {mode === "password" ? (
        <div className="space-y-3.5">
          <div className="space-y-2">
            <Label htmlFor="m-account">{t("auth.account")}</Label>
            <div className="relative">
              <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input id="m-account" type="email" placeholder="you@example.com"
                value={account} onChange={(e) => setAccount(e.target.value)} className="pl-9" />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="m-password">{t("auth.password")}</Label>
            </div>
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input id="m-password" type="password"
                value={password} onChange={(e) => setPassword(e.target.value)} className="pl-9" />
            </div>
          </div>
          {error && <p className="rounded-md bg-destructive/8 px-3 py-2 text-sm text-destructive">{error}</p>}
          <Button className="w-full" onClick={handlePasswordLogin} disabled={loading || !account || !password}>
            {loading && <Loader2 size={15} className="animate-spin" />}
            {t("auth.login")}
          </Button>
        </div>
      ) : (
        <div className="space-y-3.5">
          <div className="space-y-2">
            <Label htmlFor="m-account2">{t("auth.account")}</Label>
            <div className="relative">
              <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input id="m-account2" type="email" placeholder="you@example.com"
                value={account} onChange={(e) => setAccount(e.target.value)} className="pl-9" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="m-token">{t("auth.code")}</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <MessageSquare size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input id="m-token" value={token} onChange={(e) => setToken(e.target.value)} maxLength={6}
                  className="pl-9 font-data tracking-[0.3em]" />
              </div>
              <Button type="button" variant="outline" onClick={handleSendCode}
                disabled={loading || countdown > 0 || !accountIsEmail} className="shrink-0">
                {countdown > 0 ? `${countdown}s` : t("auth.getCode")}
              </Button>
            </div>
          </div>
          {notice && <p className="rounded-md bg-primary/8 px-3 py-2 text-xs text-primary">{notice}</p>}
          {error && <p className="rounded-md bg-destructive/8 px-3 py-2 text-sm text-destructive">{error}</p>}
          <Button className="w-full" onClick={handleCodeLogin} disabled={loading || !account || !token}>
            {loading && <Loader2 size={15} className="animate-spin" />}
            {t("auth.login")}
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border pt-3">
        <div className="flex items-center gap-2">
          <Checkbox id="m-remember" checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
          <label htmlFor="m-remember" className="cursor-pointer text-xs text-muted-foreground select-none">
            {t("auth.remember")}
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("auth.noAccount")}{" "}
          <button onClick={onSwitchRegister} className="font-medium text-primary hover:underline">
            {t("auth.registerNow")}
          </button>
        </p>
      </div>
    </div>
  );
}

// ============ REGISTER FORM ============
type RegisterStep = "form" | "verify";

function mapRegisterError(e: unknown, t: (key: string) => string, isEmail: boolean): string {
  const msg = e instanceof Error ? e.message : "";
  if (/already registered|already exists|user_already_exists/i.test(msg)) return t("auth.emailRegistered");
  if (/invalid.*email/i.test(msg)) return t("auth.emailInvalid");
  if (/password/i.test(msg)) return t("auth.passwordMinHint");
  if (/otp_disabled|signups not allowed/i.test(msg)) return t("auth.phoneOtpDisabled");
  if (/invalid.*otp|invalid.*code|expired/i.test(msg)) return t("auth.invalidCode");
  return msg || t("auth.registerFail");
}

function resolveProfileUsername(inputUsername: string | undefined, account: string) {
  const explicit = inputUsername?.trim();
  if (explicit) return explicit;
  if (account.includes("@")) {
    const prefix = account.split("@")[0]?.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 20);
    return `${prefix || "user"}_${Math.random().toString(36).slice(2, 8)}`;
  }
  const digits = account.replace(/\D/g, "").slice(-4);
  return `user${digits || "0000"}_${Math.random().toString(36).slice(2, 8)}`;
}

function RegisterForm({
  onSuccess,
  onSwitchLogin,
}: {
  onSuccess: () => void;
  onSwitchLogin: () => void;
}) {
  const { t, lang } = useLanguage();
  const [step, setStep] = useState<RegisterStep>("form");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [pendingUsername, setPendingUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [remember, setRemember] = useState(true);
  const [countdown, setCountdown] = useState(0);
  const [agree, setAgree] = useState(false);
  const [consentFail, setConsentFail] = useState("");

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  async function handleRegister() {
    setError(""); setConsentFail("");
    if (!account.trim()) { setError(t("auth.accountRequired")); return; }
    if (password.length < 8 || /^\d+$/.test(password)) { setError(t("auth.passwordMinHint")); return; }
    if (!agree) { setError(legalText(lang, "agreeRequired")); return; }
    setLoading(true);
    try {
      const profileUsername = resolveProfileUsername(undefined, account);
      setPendingUsername(profileUsername);
      const { error: signUpError } = await supabase.auth.signUp({
        email: account.trim(), password,
        options: { data: { username: profileUsername } },
      });
      if (signUpError) throw signUpError;
      await sendEmailCode(account.trim(), "register");
      setCountdown(60);
      setStep("verify");
    } catch (e) {
      setError(mapRegisterError(e, t, true));
    } finally { setLoading(false); }
  }

  async function handleResend() {
    setError("");
    try {
      await sendEmailCode(account.trim(), "register");
      setCountdown(60);
    } catch (e) { setError(mapRegisterError(e, t, true)); }
  }

  async function handleVerify() {
    setError(""); setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ email: account.trim(), token: token.trim(), type: "email" });
      if (error) throw error;
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error(tt("auth.stateNotSynced"));
      await supabase.from("profiles").upsert({ id: user.id, username: pendingUsername }).select("id").single();
      await applySessionPersistence(remember);
      void sendSystemMail("welcome", { lang, vars: { account: account.trim() } });

      const consent = await recordSignupConsents(lang);
      if (!consent.ok) {
        setConsentFail(legalText(lang, "recordFail"));
        return;
      }
      onSuccess();
    } catch (e) { setError(mapRegisterError(e, t, true)); }
    finally { setLoading(false); }
  }

  async function handleConsentRetry() {
    setError(""); setLoading(true);
    try {
      const consent = await recordSignupConsents(lang);
      if (!consent.ok) { setConsentFail(legalText(lang, "recordFail")); return; }
      setConsentFail("");
      onSuccess();
    } catch (e) { setError(mapRegisterError(e, t, true)); }
    finally { setLoading(false); }
  }

  if (step === "form") {
    return (
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="r-account">{t("auth.email")}</Label>
          <div className="relative">
            <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input id="r-account" type="email" placeholder="you@example.com"
              value={account} onChange={(e) => setAccount(e.target.value)} className="pl-9" />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="r-password">{t("auth.setPassword")}</Label>
          <div className="relative">
            <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input id="r-password" type="password"
              value={password} onChange={(e) => setPassword(e.target.value)} className="pl-9" />
          </div>
        </div>

        <div className="flex items-start gap-2">
          <Checkbox id="r-agree" className="mt-0.5" checked={agree} onCheckedChange={(v) => setAgree(v === true)} />
          <div className="text-xs leading-relaxed text-muted-foreground">
            <label htmlFor="r-agree" className="cursor-pointer select-none">
              {legalText(lang, "agreeLine")}
            </label>{" "}
            {SIGNUP_CONSENT_KINDS.map((kind, i) => (
              <span key={kind}>
                {i > 0 && <>{legalText(lang, "agreeAnd")} </>}
                <a href={LEGAL_DOC_PATH[kind]} target="_blank" rel="noopener noreferrer"
                  className="font-medium text-primary underline-offset-2 hover:underline">
                  {tt(LEGAL_DOC_LABEL_KEY[kind])}
                </a>
              </span>
            ))}
          </div>
        </div>

        {error && <p className="rounded-md bg-destructive/8 px-3 py-2 text-sm text-destructive">{error}</p>}

        <Button className="w-full" onClick={handleRegister}
          disabled={loading || !account || password.length < 8 || /^\d+$/.test(password) || !agree}>
          {loading && <Loader2 size={15} className="animate-spin" />}
          {t("auth.registerSend")}
        </Button>

        <div className="flex items-center justify-between border-t border-border pt-3">
          <div className="flex items-center gap-2">
            <Checkbox id="r-remember" checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
            <label htmlFor="r-remember" className="cursor-pointer text-xs text-muted-foreground select-none">
              {t("auth.remember")}
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("auth.haveAccount")}{" "}
            <button onClick={onSwitchLogin} className="font-medium text-primary hover:underline">
              {t("auth.goLogin")}
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-center">
        <ShieldCheck size={28} className="mx-auto mb-2 text-primary" />
        <h2 className="text-base font-medium">{t("auth.verifyTitle")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("auth.verifyEmailSent", { account })}</p>
        <p className="mt-2 rounded-lg bg-primary/5 px-3 py-2 text-xs text-muted-foreground">{t("auth.spamHint")}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="r-token">{t("auth.code")}</Label>
        <Input id="r-token" value={token} onChange={(e) => setToken(e.target.value)} maxLength={6}
          className="font-data tracking-[0.3em]" />
      </div>

      <div className="flex justify-end">
        <button type="button" onClick={handleResend} disabled={countdown > 0 || loading}
          className="text-xs font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline">
          {countdown > 0 ? tt("auth.resendIn", { countdown }) : t("auth.resendCode")}
        </button>
      </div>

      {error && <p className="rounded-md bg-destructive/8 px-3 py-2 text-sm text-destructive">{error}</p>}
      {consentFail && (
        <div className="space-y-2">
          <p className="rounded-md bg-primary/8 px-3 py-2 text-sm text-foreground">{consentFail}</p>
          <Button variant="outline" className="w-full" onClick={handleConsentRetry} disabled={loading}>
            {loading && <Loader2 size={15} className="animate-spin" />}
            {legalText(lang, "recordRetry")}
          </Button>
        </div>
      )}

      <Button className="w-full" onClick={handleVerify} disabled={loading || !token}>
        {loading && <Loader2 size={15} className="animate-spin" />}
        {t("auth.completeRegister")}
      </Button>

      <button onClick={() => setStep("form")}
        className="w-full text-center text-sm text-muted-foreground hover:text-foreground">
        {t("auth.back")}
      </button>
    </div>
  );
}
