/**
 * AiTranslateDialog — 产品 AI 翻译弹窗（P0-2）
 * 把标题/描述/变体名整体翻译成目标语言 → 落库 products.i18n
 * 计费：service_pricing.product_translate（AI 积分），不足时 402 明确提示
 */
import { useEffect, useMemo, useState } from "react";
import { Languages, Loader2, Coins, ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useLanguage } from "@/i18n/LanguageContext";
import { supabase, supabaseUrl, projectUrlId } from "@/supabase/client";
import { getPoolBalances } from "@/services/aiService";

// 与 EF 白名单、TRANSLATE_TARGET_LANGS 对齐
const TARGET_LANGS = [
  { code: "en", key: "ai.tr.lang.en" },
  { code: "ru", key: "ai.tr.lang.ru" },
  { code: "ja", key: "ai.tr.lang.ja" },
  { code: "ko", key: "ai.tr.lang.ko" },
  { code: "es", key: "ai.tr.lang.es" },
  { code: "fr", key: "ai.tr.lang.fr" },
  { code: "de", key: "ai.tr.lang.de" },
  { code: "it", key: "ai.tr.lang.it" },
  { code: "vi", key: "ai.tr.lang.vi" },
  { code: "th", key: "ai.tr.lang.th" },
  { code: "ar", key: "ai.tr.lang.ar" },
  { code: "pt", key: "ai.tr.lang.pt" },
] as const;

interface TranslateResult {
  name?: string;
  description?: string;
  variants?: Record<string, string>;
}

export function AiTranslateDialog(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  product: { id: string; name: string; description?: string } | null;
  onTranslated?: () => void;
}) {
  const { open, onOpenChange, product, onTranslated } = props;
  const { t } = useLanguage();
  const [lang, setLang] = useState("en");
  const [credits, setCredits] = useState<number>(2);
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TranslateResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setLang("en");
    // 取当前定价与余额展示（失败静默，不打断主流程）
    (async () => {
      try {
        const { data: pricing } = await supabase
          .from("service_pricing")
          .select("credits_per_use")
          .eq("service_key", "product_translate")
          .maybeSingle();
        if (pricing?.credits_per_use != null) setCredits(Number(pricing.credits_per_use));
        const pb = await getPoolBalances();
        setBalance(pb.workbench.total);
      } catch { /* 静默 */ }
    })();
  }, [open]);

  const canSubmit = useMemo(() => Boolean(product && lang && !busy), [product, lang, busy]);

  const handleTranslate = async () => {
    if (!product) return;
    setBusy(true);
    setResult(null);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const resp = await fetch(`${supabaseUrl}/functions/v1/product-translate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "OneDay-App-Id": projectUrlId,
          ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ product_id: product.id, target_lang: lang }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = (j as { error?: string }).error || t("ai.tr.errRequest", { n: resp.status });
        toast.error(msg);
        return;
      }
      setResult((j as { i18n?: TranslateResult }).i18n ?? null);
      if (typeof (j as { credits_charged?: number }).credits_charged === "number") {
        setBalance((b) => (b == null ? b : b - (j as { credits_charged: number }).credits_charged));
      }
      toast.success(t("ai.tr.done"));
      onTranslated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.unknownError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Languages size={16} className="text-primary" />
            {t("ai.tr.title")}
          </DialogTitle>
          <DialogDescription>{t("ai.tr.desc", { credits })}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 block text-sm">{t("ai.tr.targetLang")}</Label>
            <div className="flex flex-wrap gap-1.5">
              {TARGET_LANGS.map((l) => (
                <button
                  key={l.code}
                  onClick={() => setLang(l.code)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    lang === l.code
                      ? "border-primary bg-primary/10 font-semibold text-primary"
                      : "border-border bg-background text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  {t(l.key)}
                </button>
              ))}
            </div>
          </div>

          {result && (
            <div className="space-y-2 rounded-lg border border-success/30 bg-success-bg/60 p-3 text-sm">
              <p className="flex items-center gap-1.5 text-xs font-medium text-success">
                <ArrowRightLeft size={13} /> {t("ai.tr.resultTitle")}
              </p>
              {result.name && (
                <p className="text-sm">
                  <span className="mr-1 text-xs text-muted-foreground">{t("pd.name")}</span>
                  <b>{result.name}</b>
                </p>
              )}
              {result.description && (
                <p className="max-h-24 overflow-y-auto text-xs leading-relaxed text-muted-foreground">
                  {result.description}
                </p>
              )}
              {result.variants && Object.keys(result.variants).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {Object.entries(result.variants).slice(0, 8).map(([k, v]) => (
                    <span key={k} className="rounded bg-card px-1.5 py-0.5 text-[11px] text-muted-foreground shadow-sm">
                      {k} → {v}
                    </span>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-success">{t("ai.tr.savedNote")}</p>
            </div>
          )}

          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Coins size={13} className="text-warning" />
            {t("ai.tr.balanceNote", { credits, balance: balance == null ? "—" : balance })}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.close")}
          </Button>
          <Button onClick={handleTranslate} disabled={!canSubmit}>
            {busy ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Languages size={14} className="mr-1.5" />}
            {busy ? t("ai.tr.translating") : t("ai.tr.start")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
