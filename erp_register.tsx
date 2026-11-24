import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Lock, ShieldCheck, Loader2 } from "lucide-react";

import { sendEmailCode } from "@/lib/email-otp";
import { sendSystemMail } from "@/lib/mailer";
import { applySessionPersistence } from "@/lib/session";
import { Checkbox } from "@/components/ui/checkbox";
import { AuthShell } from "@/components/auth-shell";
import { useLanguage } from "@/i18n/LanguageContext";

// Wave A/T10：注册必须留下「同意了哪一版法务文档」的证据
import {
  LEGAL_DOC_LABEL_KEY,
  LEGAL_DOC_PATH,
  SIGNUP_CONSENT_KINDS,
  legalText,
  recordSignupConsents,
} from "@/lib/legal-versions";

import { tt } from "@/i18n/tts";
import { devLog } from "@/lib/devlog";

export const Route = createFileRoute("/register")({
  component: Register,
});

type RegisterStep = "form" | "verify";

// 将 Supabase 原始错误映射为友好中文提示
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

function Register() {
  const navigate = useNavigate();
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
  // Wave A/T10：agree = 用户勾了法务条款；consentFail = 勾了、账号也建好了，但记账没写成功
  const [agree, setAgree] = useState(false);
  const [consentFail, setConsentFail] = useState("");

  const isEmail = true; // 已改为纯邮箱注册

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  async function handleRegister() {
    setError("");
    setConsentFail("");
    if (!account.trim()) {
      setError(t("auth.accountRequired"));
      return;
    }
    if (password.length < 8 || /^\d+$/.test(password)) {
      setError(t("auth.passwordMinHint"));
      return;
    }
    // Wave A/T10：没勾同意就不发验证码、不建号（闸门在第一次外呼之前，别留下半截账号）
    if (!agree) {
      setError(legalText(lang, "agreeRequired"));
      return;
    }
    setLoading(true);
    try {
      const profileUsername = resolveProfileUsername(undefined, account);
      setPendingUsername(profileUsername);
      devLog("[register] 发起注册", { isEmail, account, username: profileUsername });
      // 邮箱注册两步走：
      // 1) auth.signUp 建号并写入密码（autoconfirm 下不发信，GoTrue 自带邮件在本环境不可达）
      // 2) 自建邮件通道真发验证码，用户填码完成邮箱归属确认
      const { error: signUpError } = await supabase.auth.signUp({
        email: account.trim(),
        password,
        options: { data: { username: profileUsername } },
      });
      if (signUpError) throw signUpError;
      await sendEmailCode(account.trim(), "register");
      devLog("[register] 注册请求成功，进入验证步骤", { isEmail });
      setCountdown(60);
      setStep("verify");
    } catch (e) {
      setError(mapRegisterError(e, t, isEmail));
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setError("");
    try {
      await sendEmailCode(account.trim(), "register");
      setCountdown(60);
    } catch (e) {
      setError(mapRegisterError(e, t, isEmail));
    }
  }

  async function handleVerify() {
    setError("");
    setLoading(true);
    try {
      devLog("[register] 提交验证码", { isEmail, account, tokenLength: token.length });
      const { error } = await supabase.auth.verifyOtp({ email: account.trim(), token: token.trim(), type: "email" });
      if (error) throw error;

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error(tt('auth.stateNotSynced'));

      await supabase.from("profiles").upsert({ id: user.id, username: pendingUsername }).select("id").single();
      devLog("[register] 验证成功，写入 profiles 完成", { userId: user.id });

      await applySessionPersistence(remember);

      // 注册成功欢迎邮件（走统一邮件模板；失败不影响注册结果）
      void sendSystemMail("welcome", {
        lang,
        vars: { account: account.trim() },
      });

      // Wave A/T10：把「同意了哪一版」落成证据。此时账号已建好、会话已生效，
      // 记账失败只是证据缺失 —— 停在验证页给一个只重试记账的按钮，
      // 不回滚账号、不重复建号，也绝不因为写不进而把用户关在门外。
      const consent = await recordSignupConsents(lang);
      if (!consent.ok) {
        devLog("[register] 同意记录写入失败",
          consent.recorded.filter((r) => !r.ok).map((r) => `${r.kind}@${r.version}: ${String(r.error).slice(0, 120)}`));
        setConsentFail(legalText(lang, "recordFail"));
        return;
      }
      devLog("[register] 同意记录已写入", consent.recorded.map((r) => `${r.kind}@${r.version}`));

      navigate({ to: "/dashboard" });
    } catch (e) {
      setError(mapRegisterError(e, t, isEmail));
    } finally {
      setLoading(false);
    }
  }

  // 只补写同意记录：验证步骤已经走完，这里不再碰 auth，成功就直接进控制台
  async function handleConsentRetry() {
    setError("");
    setLoading(true);
    try {
      const consent = await recordSignupConsents(lang);
      if (!consent.ok) {
        devLog("[register] 同意记录重试仍失败",
          consent.recorded.filter((r) => !r.ok).map((r) => `${r.kind}@${r.version}: ${String(r.error).slice(0, 120)}`));
        setConsentFail(legalText(lang, "recordFail"));
        return;
      }
      setConsentFail("");
      devLog("[register] 同意记录重试成功", consent.recorded.map((r) => `${r.kind}@${r.version}`));
      navigate({ to: "/dashboard" });
    } catch (e) {
      setError(mapRegisterError(e, t, isEmail));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell panelTitle={t("auth.registerTitle")} panelDesc={t("auth.registerDesc")}>
      <div className="mb-7 hidden lg:block">
        <h1 className="font-display text-lg font-semibold tracking-tight text-foreground">
          {t("auth.registerMobileTitle")}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t("auth.registerTitle")}</p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-soft sm:p-8">
        {step === "form" ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="account">{t("auth.email")}</Label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="account"
                  type="email"
                  placeholder="you@example.com"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{t("auth.setPassword")}</Label>
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

            {/* Wave A/T10：同意闸门 + 可追溯的法务版本（链接新开窗口，别丢掉填了一半的表单）
                只在纯文案上做 label，链接留在 label 外，否则点链接会顺手把勾也打上 */}
            <div className="flex items-start gap-2">
              <Checkbox
                id="agree"
                className="mt-0.5"
                checked={agree}
                onCheckedChange={(v) => setAgree(v === true)}
              />
              <div className="text-xs leading-relaxed text-muted-foreground">
                <label htmlFor="agree" className="cursor-pointer select-none">
                  {legalText(lang, "agreeLine")}
                </label>{" "}
                {SIGNUP_CONSENT_KINDS.map((kind, i) => (
                  <span key={kind}>
                    {i > 0 && <>{legalText(lang, "agreeAnd")} </>}
                    <a
                      href={LEGAL_DOC_PATH[kind]}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {tt(LEGAL_DOC_LABEL_KEY[kind])}
                    </a>
                  </span>
                ))}
              </div>
            </div>

            {error && (
              <p className="rounded-md bg-destructive/8 px-3 py-2 text-sm text-destructive">{error}</p>
            )}

            <Button className="w-full" onClick={handleRegister} disabled={loading || !account || password.length < 8 || /^\d+$/.test(password) || !agree}>
              {loading && <Loader2 size={15} className="animate-spin" />}
              {t("auth.registerSend")}
            </Button>

            <div className="flex items-center justify-between border-t border-border pt-4">
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
                {t("auth.haveAccount")}{" "}
                <button onClick={() => navigate({ to: "/login" })} className="font-medium text-primary hover:underline">
                  {t("auth.goLogin")}
                </button>
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-center">
              <ShieldCheck size={28} className="mx-auto mb-2 text-primary" />
              <h2 className="text-base font-medium">{t("auth.verifyTitle")}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("auth.verifyEmailSent", { account })}
              </p>
              <p className="mt-2 rounded-lg bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                {t("auth.spamHint")}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="token">{t("auth.code")}</Label>
              <Input
                id="token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                maxLength={6}
                className="font-data tracking-[0.3em]"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleResend}
                disabled={countdown > 0 || loading}
                className="text-xs font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
              >
                {countdown > 0 ? tt('auth.resendIn', { countdown: countdown }) : t("auth.resendCode")}
              </button>
            </div>

            {error && (
              <p className="rounded-md bg-destructive/8 px-3 py-2 text-sm text-destructive">{error}</p>
            )}

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

            <button
              onClick={() => setStep("form")}
              className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
            >
              {t("auth.back")}
            </button>
          </div>
        )}
      </div>
    </AuthShell>
  );
}