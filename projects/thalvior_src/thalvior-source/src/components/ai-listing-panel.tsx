/**
 * AiListingPanel — 商品详情页「AI Listing」区块（2026-10-22）
 * 平台/语言选择 → 生成 → 结构化结果可编辑 → 评分徽章 → 一键应用到产品草稿
 * 联动：zh 写名称/描述主字段；非 zh 写 products.i18n（publish-listing 按店铺语言取用）；
 *      绑定店铺时同步写入站点刊登草稿字段（site_title/site_bullets/site_description）
 */
import { useEffect, useMemo, useState } from "react";
import { Sparkles, Loader2, Coins, Wand2, Check, ClipboardCheck, ChevronDown, ChevronUp, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { useLanguage } from "@/i18n/LanguageContext";
import {
  generateListing, scoreListing, applyListingToI18n, fetchPlatformNames,
  LISTING_LANGS, AiListingError,
  type ListingResult, type ScoreDetail, type AiListingResponse,
} from "@/services/aiListingService";
import { getPoolBalances, getServicePricing } from "@/services/aiService";

// UI 规范：Toast 2500ms
const TOAST_MS = 2500;

function ScoreBadge({ score, label }: { score: number | null; label: string }) {
  const { t } = useLanguage();
  if (score == null) return null;
  const cls =
    score >= 80 ? "bg-success-bg text-success border-success/30"
    : score >= 60 ? "bg-warning-bg text-warning border-warning/30"
    : "bg-danger-bg text-destructive border-destructive/30";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {label} {score.toFixed(0)}
    </span>
  );
}

export function AiListingPanel(props: {
  productId: string;
  productName: string;
  collectSource?: string | null;
  shopSelected: boolean;
  onApply: (result: ListingResult, lang: string) => void;
}) {
  const { productId, productName, collectSource, shopSelected, onApply } = props;
  const { t } = useLanguage();
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [platform, setPlatform] = useState("Amazon US");
  const [language, setLanguage] = useState("en");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [rescoring, setRescoring] = useState(false);
  const [genId, setGenId] = useState<string | null>(null);
  const [result, setResult] = useState<ListingResult | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [scoreDetail, setScoreDetail] = useState<ScoreDetail | null>(null);
  const [model, setModel] = useState("");
  const [tokensUsed, setTokensUsed] = useState(0);
  const [ruleLabel, setRuleLabel] = useState("");
  const [credits, setCredits] = useState(4);
  const [balance, setBalance] = useState<number | null>(null);
  const [showScores, setShowScores] = useState(false);

  useEffect(() => {
    fetchPlatformNames()
      .then((names) => {
        setPlatforms(names);
        if (names.length && !names.includes("Amazon US")) setPlatform(names[0]);
      })
      .catch(() => setPlatforms(["Amazon US", "AliExpress", "Shopee", "Temu", "eBay", "TikTok Shop", "Shopify", "WooCommerce"]));
    (async () => {
      try {
        const p = await getServicePricing("ai_listing");
        if (p?.credits_per_use != null) setCredits(Number(p.credits_per_use));
        const b = await getPoolBalances();
        setBalance(b.workbench.total);
      } catch { /* 静默 */ }
    })();
  }, []);

  const notes = useMemo(() => result?.rule_notes ?? [], [result]);

  const handleError = (e: unknown) => {
    if (e instanceof AiListingError) {
      if (e.code === "INSUFFICIENT_CREDITS") toast.error(t("ai.listing.err.credits"), { duration: TOAST_MS });
      else if (e.code === "UPSTREAM_TIMEOUT") toast.error(t("ai.listing.err.timeout"), { duration: TOAST_MS });
      else if (e.code === "RATE_LIMITED") toast.error(t("ai.listing.err.rate"), { duration: TOAST_MS });
      else if (e.code === "REQUEST_FAILED" || e.code === "NO_KEY") toast.error(e.message, { duration: TOAST_MS });
      else toast.error(`${t("ai.listing.err.generic")}（${e.code}）`, { duration: TOAST_MS });
    } else {
      toast.error(e instanceof Error ? e.message : t("ai.listing.err.generic"), { duration: TOAST_MS });
    }
  };

  const handleGenerate = async () => {
    setBusy(true);
    try {
      const r: AiListingResponse = await generateListing({
        productId, platform, language, instruction: instruction || undefined,
      });
      setGenId(r.id ?? null);
      setResult(r.result ?? null);
      setScore(r.score ?? null);
      setScoreDetail(r.score_detail ?? null);
      setModel(r.model ?? "");
      setTokensUsed(r.tokens_used ?? 0);
      setRuleLabel(r.rule_label ?? platform);
      if (typeof r.balance === "number") setBalance(r.balance);
      toast.success(t("ai.listing.done"), { duration: TOAST_MS });
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  };

  const handleRescore = async () => {
    if (!genId) return;
    setRescoring(true);
    try {
      const r = await scoreListing(genId);
      setScore(r.score ?? null);
      setScoreDetail(r.score_detail ?? null);
      if (typeof r.balance === "number") setBalance(r.balance);
      toast.success(t("ai.listing.scored"), { duration: TOAST_MS });
    } catch (e) {
      handleError(e);
    } finally {
      setRescoring(false);
    }
  };

  const handleApply = async () => {
    if (!result) return;
    try {
      const editable: ListingResult = {
        ...result,
        title: result.title,
        bullet_points: result.bullet_points,
        description: result.description,
        search_terms: result.search_terms,
      };
      if (language !== "zh") {
        await applyListingToI18n(productId, language, editable);
      }
      onApply(editable, language);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("ai.listing.err.generic"), { duration: TOAST_MS });
    }
  };

  const copyAll = () => {
    if (!result) return;
    const text = [
      result.title,
      result.bullet_points.map((b, i) => `${i + 1}. ${b}`).join("\n"),
      result.description,
      result.search_terms.join(", "),
    ].filter(Boolean).join("\n\n");
    navigator.clipboard.writeText(text);
    toast.success(t("common.copied"), { duration: TOAST_MS });
  };

  const dimKey = (k: string) => `ai.listing.dim.${k}`;

  return (
    <div className="rounded-2xl border border-primary/25 bg-card p-5 space-y-4" id="ai-listing">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
          <Sparkles size={15} className="text-primary" /> {t("ai.listing.panelTitle")}
          <ScoreBadge score={score} label={t("ai.listing.score")} />
        </h3>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Coins size={13} className="text-warning" />
          {t("ai.listing.creditsNote", { credits, balance: balance == null ? "—" : balance })}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">{t("ai.listing.panelDesc")}</p>
      {collectSource ? (
        <p className="truncate text-xs text-muted-foreground">
          <span className="rounded bg-muted px-1.5 py-0.5">{t("ai.listing.collectSource")}</span> {collectSource}
        </p>
      ) : null}

      {/* 平台 / 语言 / 补充要求 */}
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{t("ai.listing.platform")}</label>
          <select
            value={platform} onChange={(e) => setPlatform(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-primary"
          >
            {(platforms.length ? platforms : [platform]).map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{t("ai.listing.language")}</label>
          <select
            value={language} onChange={(e) => setLanguage(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-primary"
          >
            {LISTING_LANGS.map((l) => (
              <option key={l.code} value={l.code}>{t(l.key)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{t("ai.listing.instruction")}</label>
          <input
            type="text" value={instruction} onChange={(e) => setInstruction(e.target.value)}
            placeholder={t("ai.listing.instructionPh")}
            className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={handleGenerate} disabled={busy || !productId}>
          {busy ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Wand2 size={14} className="mr-1.5" />}
          {busy ? t("ai.listing.generating") : result ? t("ai.listing.regenerate") : t("ai.listing.generate")}
        </Button>
        {result && (
          <>
            <Button size="sm" variant="outline" onClick={handleRescore} disabled={rescoring || !genId}>
              {rescoring ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <RefreshCcw size={14} className="mr-1.5" />}
              {t("ai.listing.rescore")}
            </Button>
            <Button size="sm" variant="outline" onClick={handleApply}>
              <Check size={14} className="mr-1.5" /> {t("ai.listing.apply")}
            </Button>
            <Button size="sm" variant="ghost" onClick={copyAll}>
              <ClipboardCheck size={14} className="mr-1.5" /> {t("ai.listing.copyAll")}
            </Button>
          </>
        )}
        {shopSelected && (
          <span className="text-[11px] text-muted-foreground">{t("ai.listing.applySiteHint")}</span>
        )}
      </div>

      {/* 生成中骨架 */}
      {busy && (
        <div className="space-y-2.5" aria-hidden>
          <div className="h-9 animate-pulse rounded-lg bg-muted" />
          <div className="h-16 animate-pulse rounded-lg bg-muted" />
          <div className="h-24 animate-pulse rounded-lg bg-muted" />
        </div>
      )}

      {/* 结果（结构化 + 可编辑） */}
      {!busy && result && (
        <div className="space-y-3 rounded-xl border border-border bg-background/60 p-3.5">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("ai.listing.rTitle")}</label>
            <input
              type="text" value={result.title}
              onChange={(e) => setResult({ ...result, title: e.target.value })}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-primary"
            />
            <p className="mt-0.5 text-[11px] text-muted-foreground">{t("ai.listing.chars", { n: result.title.length })}</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("ai.listing.rBullets")}</label>
            <textarea
              rows={5} value={result.bullet_points.join("\n")}
              onChange={(e) => setResult({ ...result, bullet_points: e.target.value.split("\n").map((s) => s.trimStart()).filter((s, i, arr) => s || i === arr.length - 1) })}
              className="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("ai.listing.rDesc")}</label>
            <textarea
              rows={4} value={result.description}
              onChange={(e) => setResult({ ...result, description: e.target.value })}
              className="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("ai.listing.rTerms")}</label>
            <input
              type="text" value={result.search_terms.join(", ")}
              onChange={(e) => setResult({ ...result, search_terms: e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) })}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          {notes.length > 0 && (
            <div className="rounded-lg border border-warning/30 bg-warning-bg/70 px-3 py-2 text-xs text-warning">
              <p className="font-medium">{t("ai.listing.ruleNote")} · {ruleLabel}</p>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                {notes.includes("TITLE_TRUNCATED") && <li>{t("ai.listing.noteTitleTruncated")}</li>}
                {notes.includes("BULLETS_CAPPED") && <li>{t("ai.listing.noteBulletsCapped")}</li>}
                {notes.includes("DESC_TRUNCATED") && <li>{t("ai.listing.noteDescTruncated")}</li>}
                {notes.includes("TERMS_TRIMMED") && <li>{t("ai.listing.noteTermsTrimmed")}</li>}
              </ul>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            {t("ai.listing.model")}: {model} · {t("ai.listing.tokens", { n: tokensUsed })}
          </p>

          {/* 评分明细 */}
          {scoreDetail && !scoreDetail.error && (
            <div className="rounded-lg border border-border bg-muted/30">
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-ink"
                onClick={() => setShowScores((s) => !s)}
              >
                {t("ai.listing.expandScores")}
                {showScores ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {showScores && (
                <div className="space-y-2 px-3 pb-3">
                  {Object.entries(scoreDetail.dimensions ?? {}).map(([k, d]) => (
                    <div key={k}>
                      <div className="flex items-center justify-between text-xs">
                        <span>{t(dimKey(k))}</span>
                        <span className="font-semibold">{d.score}</span>
                      </div>
                      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, d.score)}%` }} />
                      </div>
                      {d.comment && <p className="mt-0.5 text-[11px] text-muted-foreground">{d.comment}</p>}
                    </div>
                  ))}
                  {scoreDetail.suggestions?.length > 0 && (
                    <div>
                      <p className="text-xs font-medium">{t("ai.listing.suggestions")}</p>
                      <ul className="mt-1 list-inside list-disc space-y-0.5 text-[11px] text-muted-foreground">
                        {scoreDetail.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!busy && !result && (
        <EmptyState text={t("ai.listing.emptyPanel")} hint={t("ai.listing.emptyPanelHint", { name: productName })} iconSize={32} />
      )}
    </div>
  );
}
