import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Smartphone, Lock, ShieldCheck, Loader2 } from "lucide-react";
import { normalizePhone, isPhone } from "@/lib/phone";
import { sendEmailCode } from "@/lib/email-otp";
import { sendSystemMail } from "@/lib/mailer";
import { applySessionPersistence } from "@/lib/session";
import { Checkbox } from "@/components/ui/checkbox";
import { AuthShell } from "@/components/auth-shell";
import { useLanguage } from "@/i18n/LanguageContext";

export const Route = createFileRoute("/register")({
  component: Register,
});

type RegisterStep = "form" | "verify";

// 将 Supabase 原始错误映射为友好中文提示
function mapRegisterError(e: unknown, t: (key: string) => string, isEmail: boolean): string {
  const msg = e instanceof Error ? e.message : "";
  if (/already registered|already exists|user_already_exists/i.test(msg)) return isEmail ? t("auth.emailRegistered") : t("auth.phoneRegistered");
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

  const isEmail = !isPhone(account);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  async function handleRegister() {
    setError("");
    if (!account.trim()) {
      setError(t("auth.accountRequired"));
      return;
    }
    if (password.length < 8 || /^\d+$/.test(password)) {
      setError(t("auth.passwordMinHint"));
      return;
    }
    setLoading(true);
    try {
      const profileUsername = resolveProfileUsername(undefined, account);
      setPendingUsername(profileUsername);
      console.log("[register] 发起注册", { isEmail, account, username: profileUsername });
      if (isEmail) {
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
      } else {
        const { error } = await supabase.auth.signUp({
          phone: normalizePhone(account),
          password,
          options: { data: { username: profileUsername } },
        });
        if (error) throw error;
      }
      console.log("[register] 注册请求成功，进入验证步骤", { isEmail });
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
      if (isEmail) {
        await sendEmailCode(account.trim(), "register");
      } else {
        const { error } = await supabase.auth.signInWithOtp({ phone: normalizePhone(account) });
        if (error) throw error;
      }
      setCountdown(60);
    } catch (e) {
      setError(mapRegisterError(e, t, isEmail));
    }
  }

  async function handleVerify() {
    setError("");
    setLoading(true);
    try {
      console.log("[register] 提交验证码", { isEmail, account, tokenLength: token.length });
      const { error } = isEmail
        ? await supabase.auth.verifyOtp({ email: account.trim(), token: token.trim(), type: "email" })
        : await supabase.auth.verifyOtp({ phone: normalizePhone(account), token: token.trim(), type: "sms" });
      if (error) throw error;

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error("登录状态尚未同步，请稍后重试");

      await supabase.from("profiles").upsert({ id: user.id, username: pendingUsername }).select("id").single();
      console.log("[register] 验证成功，写入 profiles 完成", { userId: user.id });

      await applySessionPersistence(remember);

      // 注册成功欢迎邮件（走统一邮件模板；失败不影响注册结果）
      void sendSystemMail("welcome", {
        lang,
        vars: { account: account.trim() },
      });

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
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          {t("auth.registerMobileTitle")}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t("auth.registerTitle")}</p>
      </div>

      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm sm:p-8">
        {step === "form" ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="account">{t("auth.emailOrPhone")}</Label>
              <div className="relative">
                {isEmail ? (
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

            {error && (
              <p className="rounded-md bg-destructive/8 px-3 py-2 text-sm text-destructive">{error}</p>
            )}

            <Button className="w-full" onClick={handleRegister} disabled={loading || !account || password.length < 8 || /^\d+$/.test(password)}>
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
              <h2 className="text-sm font-semibold">{t("auth.verifyTitle")}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {isEmail
                  ? t("auth.verifyEmailSent", { account })
                  : t("auth.verifyPhoneSent", { account })}
              </p>
              {isEmail && (
                <p className="mt-2 rounded-lg bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                  {t("auth.spamHint")}
                </p>
              )}
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
                {countdown > 0 ? `${countdown}s 后可重发` : t("auth.resendCode")}
              </button>
            </div>

            {error && (
              <p className="rounded-md bg-destructive/8 px-3 py-2 text-sm text-destructive">{error}</p>
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