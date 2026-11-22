import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Lock, KeyRound, Loader2, MessageSquare } from "lucide-react";
import { sendEmailCode } from "@/lib/email-otp";
import { useLanguage } from "@/i18n/LanguageContext";

export const Route = createFileRoute("/reset-password")({
  component: ResetPassword,
});

type ResetStep = "send" | "verify";

function ResetPassword() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [step, setStep] = useState<ResetStep>("send");
  const [account, setAccount] = useState("");
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState(0);

  const isEmailFormat = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.trim());

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  async function handleSendCode() {
    setError("");
    if (!isEmailFormat) {
      setError(t("auth.emailInvalid"));
      return;
    }
    setLoading(true);
    try {
      await sendEmailCode(account.trim(), "reset");
      setCountdown(60);
      setStep("verify");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("auth.sendFail"));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify() {
    setError("");
    if (newPassword.length < 8 || /^\d+$/.test(newPassword)) {
      setError(t("auth.passwordMinHint"));
      return;
    }
    setLoading(true);
    try {
      // 1) 用 recovery 类型 OTP 验证，拿到会话
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: account.trim(),
        token: token.trim(),
        type: "recovery",
      });
      if (verifyError) throw verifyError;

      // 2) 用拿到的会话改密码
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;

      // 3) 改完登出，让用户用新密码重新登录
      await supabase.auth.signOut();
      navigate({ to: "/login" });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("reset.fail"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-ink text-white">
            <KeyRound size={22} />
          </div>
          <h1 className="font-display text-lg font-semibold tracking-tight">{t("reset.title")}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{t("reset.desc")}</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-lift sm:p-7">
          {step === "send" ? (
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

              {error && <p className="rounded-md bg-destructive/8 px-3 py-2 text-sm text-destructive">{error}</p>}

              <Button className="w-full" onClick={handleSendCode} disabled={loading || !isEmailFormat}>
                {loading && <Loader2 size={15} className="animate-spin" />}
                {t("reset.sendCode")}
              </Button>

              <button
                onClick={() => navigate({ to: "/login" })}
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
              >
                {t("reset.backLogin")}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-center">
                <KeyRound size={28} className="mx-auto mb-2 text-primary" />
                <h2 className="text-base font-medium">{t("reset.resetTitle")}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("reset.sent", { account })}
                </p>
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
                      className="pl-9"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSendCode}
                    disabled={loading || countdown > 0}
                    className="shrink-0"
                  >
                    {countdown > 0 ? `${countdown}s` : t("reset.resend")}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="newPassword">{t("reset.newPassword")}</Label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="newPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              {error && <p className="rounded-md bg-destructive/8 px-3 py-2 text-sm text-destructive">{error}</p>}

              <Button className="w-full" onClick={handleVerify} disabled={loading || !token || newPassword.length < 8 || /^\d+$/.test(newPassword)}>
                {loading && <Loader2 size={15} className="animate-spin" />}
                {t("reset.confirm")}
              </Button>

              <button
                onClick={() => setStep("send")}
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
              >
                {t("auth.back")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
