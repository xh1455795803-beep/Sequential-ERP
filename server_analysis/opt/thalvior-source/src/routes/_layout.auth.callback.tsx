import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { completeOAuth } from "@/services/shopOAuth";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";

export const Route = createFileRoute("/_layout/auth/callback")({
  component: AuthCallback,
});

function AuthCallback() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState(t("authCallback.authorizing"));
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const shop = params.get("shop");
    const error = params.get("error");

    if (error) {
      setStatus("error");
      setMessage(`${t("authCallback.denied")}：${error}`);
      return;
    }

    if (!code || !shop) {
      setStatus("error");
      setMessage(t("authCallback.missing"));
      return;
    }

    completeOAuth(shop, code)
      .then(() => {
        setStatus("success");
        setMessage(t("authCallback.success", { shop }));
        toast.success(t("authCallback.shopSuccess"));
        setTimeout(() => navigate({ to: "/auth" }), 1200);
      })
      .catch((e) => {
        setStatus("error");
        setMessage(e instanceof Error ? e.message : t("authCallback.fail"));
      });
  }, [navigate]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card px-10 py-12 text-center shadow-soft">
        {status === "loading" && (
          <>
            <Loader2 size={32} className="animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">{message}</p>
          </>
        )}
        {status === "success" && (
          <>
            <CheckCircle2 size={32} className="text-emerald-500" />
            <p className="text-sm font-medium">{message}</p>
            <p className="text-xs text-muted-foreground">{t("authCallback.redirecting")}</p>
          </>
        )}
        {status === "error" && (
          <>
            <XCircle size={32} className="text-rose-500" />
            <p className="text-sm font-medium text-rose-600">{message}</p>
            <button
              onClick={() => navigate({ to: "/auth" })}
              className="mt-2 text-sm text-primary hover:underline"
            >
              {t("authCallback.back")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}