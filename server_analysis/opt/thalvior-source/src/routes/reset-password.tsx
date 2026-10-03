import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Smartphone, Lock, KeyRound, Loader2, MessageSquare } from "lucide-react";
import { normalizePhone, isPhone } from "@/lib/phone";
import { sendSmsCode, resetPasswordBySms } from "@/lib/sms";
import { useLanguage } from "@/i18n/LanguageContext";

export const Route = createFileRoute("/reset-password")({
  component: ResetPassword,
});

type ResetStep = "send" | "verify" | "set";

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

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  async function handleSendCode() {
    setError("");
    if (!isPhone(account)) {
      setError(t("reset.phoneOnly"));
      return;
    }
    setLoading(true);
    try {
      const phone = normalizePhone(account);
      await sendSmsCode(phone);
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
    setLoading(true);
    try {
      const phone = normalizePhone(account);
      await resetPasswordBySms(phone, token, newPassword);
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
          <h1 className="font-display text-2xl font-semibold tracking-tight">{t("reset.title")}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{t("reset.desc")}</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-lift sm:p-7">
          {step === "send" ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="account">{t("auth.phone")}</Label>
                <div className="relative">
                  <Smartphone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="account"
                      value={account}
                    onChange={(e) => setAccount(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              {error && <p className="rounded-md bg-destructive/8 px-3 py-2 text-sm text-destructive">{error}</p>}

              <Button className="w-full" onClick={handleSendCode} disabled={loading || !account}>
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
                <h2 className="text-sm font-semibold">{t("reset.resetTitle")}</h2>
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

              <Button className="w-full" onClick={handleVerify} disabled={loading || !token || newPassword.length < 6}>
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