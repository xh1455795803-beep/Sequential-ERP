/**
 * /ai/listing-cn — 国内电商 Listing 工作台（2026-10-28）
 * Tab1 铺货生成：选平台 → 选商品 → 生成中文 Listing（标题/卖点/描述/关键词/规格/类目）
 *   → 自动合规体检（违禁词 + 类目资质 + 标题规则）+ 评分 → 可优化/改写 → 应用到商品
 * Tab2 合规体检：纯规则校验，不调 LLM，不计费；输出问题清单 + 官方规则来源
 * Tab3 历史记录：cn_listing_generations 筛选 → 查看/重评分/应用
 * 数据真实铁律：规则与词库来自 DB（cn_platform_rules / cn_sensitive_words / cn_category_qualifications），
 *   每条带官方 source_url；生成结果来自真实 LLM 输出，无硬编码文案。
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Sparkles, Loader2, Coins, ListChecks, ShieldCheck, History, Search,
  Check, RefreshCcw, PlayCircle, Eye, X, AlertTriangle, Info, ExternalLink, Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import { supabase } from "@/supabase/client";
import { fmtDateTime } from "@/lib/datetime";
import { useLanguage } from "@/i18n/LanguageContext";
import {
  generateCnListing, refineCnListing, scoreCnListing, checkCnCompliance,
  listCnGenerations, applyCnListingToProduct, fetchCnPlatforms,
  CnListingError,
  type CnListingResult, type CnListingGeneration, type CnPlatformRule,
  type CnCompliance, type CnComplianceIssue, type CnScoreDetail,
} from "@/services/cnListingService";
import { getPoolBalances, getServicePricing } from "@/services/aiService";

const TOAST_MS = 2500;

// EF 错误码 → i18n 词条（无码错误在英文界面走通用兜底，避免弹出中文）
const ERR_I18N_BY_CODE: Record<string, string> = {
  INSUFFICIENT_CREDITS: "ai.cn.err.credits",
  NO_CN_RULES: "ai.cn.err.NO_CN_RULES",
  UNKNOWN_PLATFORM: "ai.cn.err.UNKNOWN_PLATFORM",
  PARSE_FAILED: "ai.cn.err.PARSE_FAILED",
  EMPTY_RESPONSE: "ai.cn.err.EMPTY_RESPONSE",
  NO_KEY: "ai.cn.err.NO_KEY",
  UPSTREAM_TIMEOUT: "ai.cn.err.UPSTREAM_TIMEOUT",
  RATE_LIMITED: "ai.cn.err.RATE_LIMITED",
  UPSTREAM_ERROR: "ai.cn.err.UPSTREAM_ERROR",
  UNAUTHORIZED: "ai.cn.err.UNAUTHORIZED",
  UNSUPPORTED_ACTION: "ai.cn.err.UNSUPPORTED_ACTION",
  RULE_LOAD_FAILED: "ai.cn.err.RULE_LOAD_FAILED",
  MISSING_PLATFORM_KEY: "ai.cn.err.MISSING_PLATFORM_KEY",
  MISSING_LISTING_CONTENT: "ai.cn.err.MISSING_LISTING_CONTENT",
  MISSING_LISTING_ID: "ai.cn.err.MISSING_LISTING_ID",
  RECORD_NOT_FOUND: "ai.cn.err.RECORD_NOT_FOUND",
  RECORD_CONTENT_INVALID: "ai.cn.err.RECORD_CONTENT_INVALID",
  AI_DISABLED: "ai.cn.err.AI_DISABLED",
  SCORE_SAVE_FAILED: "ai.cn.err.SCORE_SAVE_FAILED",
  MISSING_PRODUCT_ID: "ai.cn.err.MISSING_PRODUCT_ID",
  PRODUCT_NOT_FOUND: "ai.cn.err.PRODUCT_NOT_FOUND",
  PRODUCT_EMPTY: "ai.cn.err.PRODUCT_EMPTY",
  GENERATE_SAVE_FAILED: "ai.cn.err.GENERATE_SAVE_FAILED",
  REFINE_SAVE_FAILED: "ai.cn.err.REFINE_SAVE_FAILED",
  INTERNAL_ERROR: "ai.cn.err.INTERNAL_ERROR",
};

interface ProductLite {
  id: string;
  name: string;
  sku: string;
  source_platform: string | null;
}

function ScoreBadge({ score }: { score: number | null | undefined }) {
  const { t } = useLanguage();
  if (score == null) return <span className="text-xs text-fg-muted">—</span>;
  const cls =
    score >= 80 ? "bg-success-bg text-success border-success/30"
    : score >= 60 ? "bg-warning-bg text-warning border-warning/30"
    : "bg-danger-bg text-destructive border-destructive/30";
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold", cls)}>{score.toFixed(0)}</span>;
}

type IssueVars = Record<string, string | number>;

// 业务数据参数（中文属用户输入/词库内容，英文界面原样保留，不计入硬编码中文）
const ISSUE_DATA_PARAMS: Record<string, string[]> = {
  SENSITIVE_WORD: ["word"],
  CATEGORY_QUALIFICATION_REQUIRED: ["name", "category_path"],
  TITLE_KEYWORD_STUFFING: ["word"],
};

const DATA_MARK = "\uE000";

/** EF 只回 code + params；界面文案模板全部在前端 i18n 渲染 */
function buildIssueVars(
  issue: CnComplianceIssue,
  lang: string,
  t: (key: string, vars?: Record<string, string | number>) => string,
): IssueVars {
  const p = issue.params ?? {};
  const vars: IssueVars = {};
  for (const [k, v] of Object.entries(p)) {
    if (k.endsWith("_en")) continue;
    vars[k] = v;
  }
  if (issue.code === "SENSITIVE_WORD") {
    vars.category = t(`ai.cn.cat.${String(p.category ?? "")}`);
    if (lang === "en") vars.suggestion = String(p.suggestion_en || vars.suggestion || "");
  }
  if (issue.code === "CATEGORY_QUALIFICATION_REQUIRED" && lang === "en") {
    vars.name = String(p.name_en || vars.name || "");
  }
  return vars;
}

function buildHintVars(issue: CnComplianceIssue, lang: string): IssueVars {
  const hp = issue.hintParams ?? {};
  const vars: IssueVars = {};
  for (const [k, v] of Object.entries(hp)) {
    if (k.endsWith("_en")) continue;
    vars[k] = v;
  }
  if (lang === "en") {
    if (issue.hintCode === "SENSITIVE_SUGGESTION") vars.suggestion = String(hp.suggestion_en || vars.suggestion || "");
    if (issue.hintCode === "QUALIFICATION_NOTE") vars.note = String(hp.note_en || vars.note || "");
  }
  return vars;
}

/** 业务数据段单独打 data-cn-biz 标记，QA 中文扫描据此区分「硬编码文案」与「业务数据」 */
function MessageParts({ text, vars }: { text: string; vars: IssueVars }) {
  const parts = text.split(/\uE000(\w+)\uE000/g);
  return (
    <>
      {parts.map((seg, i) =>
        i % 2 === 1 ? (
          <span key={i} data-cn-biz="1">{String(vars[seg] ?? seg)}</span>
        ) : (
          <span key={i}>{seg}</span>
        ),
      )}
    </>
  );
}

function IssueChip({ issue }: { issue: CnComplianceIssue }) {
  const { t, lang } = useLanguage();
  const isErr = issue.level === "error";
  const code = issue.code || "UNKNOWN";
  const vars = buildIssueVars({ ...issue, code }, lang, t);
  const dataParams = ISSUE_DATA_PARAMS[code] ?? [];
  const tplVars: IssueVars = { ...vars };
  for (const k of dataParams) {
    if (k in tplVars) tplVars[k] = `${DATA_MARK}${k}${DATA_MARK}`;
  }
  const text = t(`ai.cn.issue.${code}`, tplVars);
  return (
    <span
      className={cn(
        "inline-flex items-start gap-1 rounded-lg border px-2 py-1 text-[11px] leading-snug",
        isErr
          ? "border-destructive/30 bg-danger-bg text-destructive"
          : "border-warning/30 bg-warning-bg text-warning",
      )}
    >
      {isErr ? <AlertTriangle size={11} className="mt-0.5 shrink-0" /> : <Info size={11} className="mt-0.5 shrink-0" />}
      <span><MessageParts text={text} vars={vars} /></span>
    </span>
  );
}

function CompliancePanel({
  compliance, sourceUrl,
}: { compliance: CnCompliance | null; sourceUrl?: string | null }) {
  const { t, lang } = useLanguage();
  if (!compliance) return null;
  const { issues, error_count, warning_count, passed } = compliance;
  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium text-fg">
          <ShieldCheck size={14} className={passed ? "text-success" : "text-destructive"} />
          {t("ai.cn.compliance.title")}
        </p>
        <div className="flex items-center gap-2">
          {error_count > 0 && (
            <span className="rounded-full border border-destructive/30 bg-danger-bg px-2 py-0.5 text-[11px] font-medium text-destructive">
              {t("ai.cn.compliance.errors", { n: error_count })}
            </span>
          )}
          {warning_count > 0 && (
            <span className="rounded-full border border-warning/30 bg-warning-bg px-2 py-0.5 text-[11px] font-medium text-warning">
              {t("ai.cn.compliance.warnings", { n: warning_count })}
            </span>
          )}
          {passed && (
            <span className="rounded-full border border-success/30 bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success">
              {t("ai.cn.compliance.passed")}
            </span>
          )}
        </div>
      </div>
      {issues.length === 0 ? (
        <p className="text-xs text-fg-muted">{t("ai.cn.compliance.clean")}</p>
      ) : (
        <div className="space-y-1.5">
          {issues.map((i, idx) => (
            <div key={`${i.code}-${idx}`}>
              <IssueChip issue={i} />
              {i.hintCode ? (
                <p className="mt-0.5 pl-6 text-[11px] text-fg-muted">
                  {t(`ai.cn.hint.${i.hintCode}`, buildHintVars(i, lang))}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {sourceUrl ? (
        <a
          href={sourceUrl} target="_blank" rel="noreferrer"
          className="mt-2.5 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          {t("ai.cn.compliance.source")} <ExternalLink size={10} />
        </a>
      ) : null}
    </div>
  );
}

export const Route = createFileRoute("/_layout/ai/listing-cn")({
  component: CnListingWorkbench,
});

function CnListingWorkbench() {
  const { t, lang } = useLanguage();

  // 公共
  const [platforms, setPlatforms] = useState<CnPlatformRule[]>([]);
  const [platformKey, setPlatformKey] = useState("taobao");
  const [credits, setCredits] = useState(4);
  const [balance, setBalance] = useState<number | null>(null);

  // 铺货生成
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [prodSearch, setProdSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<CnListingGeneration | null>(null);
  const [currentPlatform, setCurrentPlatform] = useState<CnPlatformRule | null>(null);
  const [viewRow, setViewRow] = useState<CnListingGeneration | null>(null);

  // 合规体检
  const [checkTitle, setCheckTitle] = useState("");
  const [checkPoints, setCheckPoints] = useState("");
  const [checkDesc, setCheckDesc] = useState("");
  const [checkCat, setCheckCat] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<CnCompliance | null>(null);

  // 历史
  const [history, setHistory] = useState<CnListingGeneration[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [fProduct, setFProduct] = useState("");
  const [fPlatform, setFPlatform] = useState("");
  const [rescoringId, setRescoringId] = useState<string | null>(null);

  const platform = useMemo(
    () => platforms.find((p) => p.platform_key === platformKey) ?? null,
    [platforms, platformKey],
  );

  // 平台名双语：DB 双列 platform_name / platform_name_en，按当前语言二选一
  const platformLabel = useCallback(
    (key: string) => {
      const p = platforms.find((x) => x.platform_key === key);
      if (!p) return key;
      return lang === "en" ? (p.platform_name_en || p.platform_name) : p.platform_name;
    },
    [platforms, lang],
  );

  const loadProducts = useCallback(async () => {
    const { data } = await supabase
      .from("products")
      .select("id, name, sku, source_platform")
      .order("updated_at", { ascending: false })
      .limit(300);
    setProducts((data ?? []) as ProductLite[]);
  }, []);

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    try {
      const rows = await listCnGenerations({
        productId: fProduct || undefined,
        platformKey: fPlatform || undefined,
        limit: 100,
      });
      setHistory(rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("ai.cn.err.generic"), { duration: TOAST_MS });
    } finally {
      setHistLoading(false);
    }
  }, [fProduct, fPlatform, t]);

  useEffect(() => {
    fetchCnPlatforms()
      .then((ps) => {
        setPlatforms(ps);
        if (ps.length && !ps.some((p) => p.platform_key === platformKey)) setPlatformKey(ps[0].platform_key);
      })
      .catch(() => toast.error(t("ai.cn.err.loadPlatforms"), { duration: TOAST_MS }));
    void loadProducts();
    (async () => {
      try {
        const p = await getServicePricing("cn_listing");
        if (p?.credits_per_use != null) setCredits(Number(p.credits_per_use));
        const b = await getPoolBalances();
        setBalance(b.workbench.total);
      } catch { /* 静默 */ }
    })();
  }, [loadProducts, platformKey, t]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const filteredProducts = useMemo(() => {
    const kw = prodSearch.trim().toLowerCase();
    if (!kw) return products;
    return products.filter((p) => p.name.toLowerCase().includes(kw) || (p.sku ?? "").toLowerCase().includes(kw));
  }, [products, prodSearch]);

  const prodName = useCallback(
    (pid: string | null) => (pid ? products.find((p) => p.id === pid)?.name ?? pid.slice(0, 8) : "—"),
    [products],
  );

  const handleError = (e: unknown) => {
    if (e instanceof CnListingError) {
      const key = ERR_I18N_BY_CODE[e.code];
      if (key) {
        toast.error(t(key), { duration: TOAST_MS });
        return;
      }
      toast.error(lang === "zh" ? (e.message || t("ai.cn.err.generic")) : t("ai.cn.err.generic"), { duration: TOAST_MS });
      return;
    }
    toast.error(e instanceof Error ? e.message : t("ai.cn.err.generic"), { duration: TOAST_MS });
  };

  const runGenerate = async (productId: string) => {
    setRunning(true);
    try {
      const r = await generateCnListing({ productId, platformKey });
      setCurrent({
        id: r.id ?? "",
        user_id: null,
        product_id: productId,
        platform_key: r.platform_key ?? platformKey,
        generation_type: "generate",
        result: r.result ?? ({} as CnListingResult),
        compliance: r.compliance ?? null,
        score: r.score ?? null,
        score_detail: (r.score_detail ?? null) as CnScoreDetail | null,
        model: r.model ?? null,
        tokens_used: r.tokens_used ?? 0,
        created_at: r.created_at ?? new Date().toISOString(),
      });
      setCurrentPlatform(platform);
      if (typeof r.balance === "number") setBalance(r.balance);
      toast.success(t("ai.cn.done"), { duration: TOAST_MS });
      void loadHistory();
    } catch (e) {
      handleError(e);
    } finally {
      setRunning(false);
    }
  };

  const runRefine = async (action: "optimize" | "rewrite") => {
    if (!current) return;
    setRunning(true);
    try {
      const r = await refineCnListing({
        action,
        platformKey: current.platform_key,
        listing: current.result,
      });
      setCurrent({
        ...current,
        id: r.id ?? current.id,
        result: r.result ?? current.result,
        compliance: r.compliance ?? current.compliance,
        score: r.score ?? current.score,
        score_detail: (r.score_detail ?? null) as CnScoreDetail | null,
        tokens_used: (current.tokens_used ?? 0) + (r.tokens_used ?? 0),
      });
      if (typeof r.balance === "number") setBalance(r.balance);
      toast.success(action === "optimize" ? t("ai.cn.optimized") : t("ai.cn.rewritten"), { duration: TOAST_MS });
      void loadHistory();
    } catch (e) {
      handleError(e);
    } finally {
      setRunning(false);
    }
  };

  const runCheck = async () => {
    if (!checkTitle.trim()) {
      toast.error(t("ai.cn.err.needTitle"), { duration: TOAST_MS });
      return;
    }
    setChecking(true);
    try {
      const c = await checkCnCompliance({
        platformKey,
        listing: {
          title: checkTitle.trim(),
          selling_points: checkPoints.split(/[\n，,、]+/).map((s) => s.trim()).filter(Boolean),
          description: checkDesc,
          keywords: [],
          sku_specs: [],
          category_path: checkCat.trim(),
        },
      });
      setCheckResult(c);
    } catch (e) {
      handleError(e);
    } finally {
      setChecking(false);
    }
  };

  const rescore = async (row: CnListingGeneration) => {
    setRescoringId(row.id);
    try {
      const r = await scoreCnListing(row.id);
      setHistory((h) => h.map((x) => (x.id === row.id
        ? { ...x, score: r.score ?? null, score_detail: (r.score_detail ?? null) as CnScoreDetail | null }
        : x)));
      if (viewRow?.id === row.id) {
        setViewRow({ ...row, score: r.score ?? null, score_detail: (r.score_detail ?? null) as CnScoreDetail | null });
      }
      if (typeof r.balance === "number") setBalance(r.balance);
      toast.success(t("ai.cn.scored"), { duration: TOAST_MS });
    } catch (e) {
      handleError(e);
    } finally {
      setRescoringId(null);
    }
  };

  const applyToProduct = async (row: CnListingGeneration) => {
    if (!row.product_id) {
      toast.error(t("ai.cn.err.noProduct"), { duration: TOAST_MS });
      return;
    }
    try {
      await applyCnListingToProduct(row.product_id, row.result);
      toast.success(t("ai.cn.applied"), { duration: TOAST_MS });
    } catch (e) {
      handleError(e);
    }
  };

  const titleUnits = useMemo(() => {
    // 与 EF 同口径：中文/全角按 2 计，ASCII 按 1 计
    let n = 0;
    for (const ch of checkTitle) n += (ch.codePointAt(0) ?? 0) > 0xFF ? 2 : 1;
    return n;
  }, [checkTitle]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 md:p-6">
      <PageHeader title={t("ai.cn.title")} description={t("ai.cn.desc")} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-fg-muted">{t("ai.cn.platform")}</label>
          <select
            value={platformKey} onChange={(e) => setPlatformKey(e.target.value)} disabled={running}
            className="rounded-xl border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
          >
            {platforms.map((p) => <option key={p.platform_key} value={p.platform_key}>{platformLabel(p.platform_key)}</option>)}
          </select>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-fg-muted">
          <Coins size={13} className="text-warning" />
          {t("ai.cn.creditsNote", { credits, balance: balance == null ? "—" : balance })}
        </p>
      </div>

      {platform ? (
        <div className="grid gap-2 rounded-xl border border-border bg-card p-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-fg-muted">{t("ai.cn.rule.titleLimit")}</p>
            <p className="mt-0.5 font-medium text-fg">{platform.title_max_chars} {t("ai.cn.rule.units")}</p>
          </div>
          <div>
            <p className="text-fg-muted">{t("ai.cn.rule.mainImage")}</p>
            <p className="mt-0.5 font-medium text-fg">
              {platform.main_image_count == null ? "—" : `${platform.main_image_count} / ≥${platform.main_image_min_px ?? "—"}px`}
            </p>
          </div>
          <div>
            <p className="text-fg-muted">{t("ai.cn.rule.sku")}</p>
            <p className="mt-0.5 font-medium text-fg">
              {platform.sku_max_count == null ? "—" : platform.sku_max_count}
              {platform.sales_attr_max != null ? ` · ${t("ai.cn.rule.attr", { n: platform.sales_attr_max })}` : ""}
            </p>
          </div>
          <div>
            <p className="text-fg-muted">{t("ai.cn.rule.descLimit")}</p>
            <p className="mt-0.5 font-medium text-fg">{platform.desc_max_chars ?? "—"}</p>
          </div>
        </div>
      ) : null}

      <Tabs defaultValue="publish">
        <TabsList>
          <TabsTrigger value="publish"><ListChecks size={14} className="mr-1.5" />{t("ai.cn.tab.publish")}</TabsTrigger>
          <TabsTrigger value="check"><ShieldCheck size={14} className="mr-1.5" />{t("ai.cn.tab.check")}</TabsTrigger>
          <TabsTrigger value="history"><History size={14} className="mr-1.5" />{t("ai.cn.tab.history")}</TabsTrigger>
        </TabsList>

        {/* ═══ 铺货生成 ═══ */}
        <TabsContent value="publish" className="mt-4 space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <label className="text-sm font-medium text-fg">{t("ai.cn.pickProducts")}</label>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
                  <input
                    value={prodSearch} onChange={(e) => setProdSearch(e.target.value)}
                    placeholder={t("ai.cn.searchProducts")}
                    className="w-56 rounded-xl border border-border bg-background py-1.5 pl-8 pr-2 text-xs outline-none focus:border-primary"
                  />
                </div>
                <span className="text-xs text-fg-muted">{t("ai.cn.selected", { n: selected.size })}</span>
              </div>
            </div>
            {filteredProducts.length === 0 ? (
              <EmptyState text={t("ai.cn.noProducts")} iconSize={32} />
            ) : (
              <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
                {filteredProducts.map((p) => {
                  const on = selected.has(p.id);
                  return (
                    <div
                      key={p.id}
                      className={cn(
                        "flex items-center gap-2.5 rounded-xl border px-3 py-2 text-sm transition-colors",
                        on ? "border-primary/50 bg-primary/5" : "border-transparent hover:bg-surface-hover",
                      )}
                    >
                      <input
                        type="checkbox" className="accent-primary" disabled={running}
                        checked={on}
                        onChange={() => {
                          setSelected((s) => {
                            const n = new Set(s);
                            if (n.has(p.id)) n.delete(p.id);
                            else n.add(p.id);
                            return n;
                          });
                        }}
                      />
                      <span data-cn-biz="1" className="min-w-0 flex-1 truncate text-fg">{p.name}</span>
                      {p.source_platform ? (
                        <span className="shrink-0 rounded bg-surface-sunken px-1.5 py-0.5 text-[10px] text-fg-muted">{p.source_platform}</span>
                      ) : null}
                      <span className="shrink-0 text-xs text-fg-muted">{p.sku}</span>
                      <Button
                        size="sm" variant="outline" className="h-7 shrink-0 text-xs"
                        disabled={running || !on}
                        onClick={() => void runGenerate(p.id)}
                      >
                        {running ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Sparkles size={12} className="mr-1" />}
                        {t("ai.cn.generate")}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {current ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-medium text-fg">{t("ai.cn.resultTitle")}</h3>
                <ScoreBadge score={current.score ?? null} />
                <span data-cn-biz="1" className="text-xs text-fg-muted">{prodName(current.product_id)}</span>
                <div className="ml-auto flex items-center gap-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={running} onClick={() => void runRefine("optimize")}>
                    {running ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Wand2 size={12} className="mr-1" />}
                    {t("ai.cn.optimize")}
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={running} onClick={() => void runRefine("rewrite")}>
                    <RefreshCcw size={12} className="mr-1" />{t("ai.cn.rewrite")}
                  </Button>
                  <Button size="sm" className="h-7 text-xs" onClick={() => void applyToProduct(current)}>
                    <Check size={12} className="mr-1" />{t("ai.cn.apply")}
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <div className="space-y-3 rounded-xl border border-border bg-card p-3.5">
                  <div>
                    <p className="mb-1 text-xs font-medium text-fg-muted">{t("ai.cn.rTitle")}</p>
                    <p data-cn-biz="1" className="rounded-xl bg-surface-sunken/40 px-3 py-2">{current.result?.title || "—"}</p>
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium text-fg-muted">{t("ai.cn.rPoints")}</p>
                    <ol className="list-inside list-decimal space-y-1 rounded-xl bg-surface-sunken/40 px-3 py-2">
                      {(current.result?.selling_points ?? []).map((b, i) => <li key={i} data-cn-biz="1">{b}</li>)}
                    </ol>
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium text-fg-muted">{t("ai.cn.rDesc")}</p>
                    <p data-cn-biz="1" className="whitespace-pre-wrap rounded-xl bg-surface-sunken/40 px-3 py-2">{current.result?.description || "—"}</p>
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium text-fg-muted">{t("ai.cn.rKeywords")}</p>
                    <p data-cn-biz="1" className="rounded-xl bg-surface-sunken/40 px-3 py-2">{(current.result?.keywords ?? []).join("、") || "—"}</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="mb-1 text-xs font-medium text-fg-muted">{t("ai.cn.rSpecs")}</p>
                      <p data-cn-biz="1" className="rounded-xl bg-surface-sunken/40 px-3 py-2">{(current.result?.sku_specs ?? []).join("、") || "—"}</p>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium text-fg-muted">{t("ai.cn.rCategory")}</p>
                      <p data-cn-biz="1" className="rounded-xl bg-surface-sunken/40 px-3 py-2">{current.result?.category_path || "—"}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <CompliancePanel compliance={current.compliance} sourceUrl={currentPlatform?.source_url} />
                  {current.score_detail && !current.score_detail.error ? (
                    <div className="rounded-xl border border-border bg-card p-3.5">
                      <p className="mb-2 text-sm font-medium text-fg">{t("ai.cn.expandScores")}</p>
                      <div className="space-y-2">
                        {Object.entries(current.score_detail.dimensions ?? {}).map(([k, d]) => (
                          <div key={k} className="flex items-center justify-between gap-3 text-xs">
                            <span className="shrink-0">{t(`ai.cn.dim.${k}`)}</span>
                            <span data-cn-biz="1" className="flex-1 truncate text-fg-muted">{d.comment}</span>
                            <span className="font-semibold">{d.score}</span>
                          </div>
                        ))}
                      </div>
                      {current.score_detail.suggestions?.length ? (
                        <ul className="mt-2 list-inside list-disc text-xs text-fg-muted">
                          {current.score_detail.suggestions.map((s, i) => <li key={i} data-cn-biz="1">{s}</li>)}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                  <p className="text-[11px] text-fg-muted">
                    {t("ai.cn.model")}: {current.model || "—"} · {t("ai.cn.tokens", { n: current.tokens_used ?? 0 })}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <EmptyState text={t("ai.cn.emptyResult")} hint={t("ai.cn.emptyResultHint")} />
          )}
        </TabsContent>

        {/* ═══ 合规体检 ═══ */}
        <TabsContent value="check" className="mt-4 space-y-3">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="mb-3 text-xs text-fg-muted">{t("ai.cn.checkDesc")}</p>
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-fg-muted">{t("ai.cn.rTitle")}</label>
                <input
                  value={checkTitle} onChange={(e) => setCheckTitle(e.target.value)}
                  placeholder={t("ai.cn.checkTitlePh")}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <p className={cn(
                  "mt-1 text-[11px]",
                  platform && titleUnits > platform.title_max_chars ? "text-destructive" : "text-fg-muted",
                )}>
                  {t("ai.cn.unitsUsed", { used: titleUnits, max: platform?.title_max_chars ?? 60 })}
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-fg-muted">{t("ai.cn.rPoints")}</label>
                <textarea
                  value={checkPoints} onChange={(e) => setCheckPoints(e.target.value)}
                  placeholder={t("ai.cn.checkPointsPh")}
                  rows={3}
                  className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-fg-muted">{t("ai.cn.rDesc")}</label>
                <textarea
                  value={checkDesc} onChange={(e) => setCheckDesc(e.target.value)}
                  placeholder={t("ai.cn.checkDescPh")}
                  rows={3}
                  className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-fg-muted">{t("ai.cn.rCategory")}</label>
                <input
                  value={checkCat} onChange={(e) => setCheckCat(e.target.value)}
                  placeholder={t("ai.cn.checkCatPh")}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
              <Button onClick={() => void runCheck()} disabled={checking}>
                {checking ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <ShieldCheck size={14} className="mr-1.5" />}
                {checking ? t("ai.cn.checking") : t("ai.cn.doCheck")}
              </Button>
            </div>
          </div>
          {checkResult ? (
            <CompliancePanel compliance={checkResult} sourceUrl={platform?.source_url} />
          ) : null}
        </TabsContent>

        {/* ═══ 历史记录 ═══ */}
        <TabsContent value="history" className="mt-4 space-y-3">
          <div className="grid gap-2 md:grid-cols-3">
            <select
              value={fProduct} onChange={(e) => setFProduct(e.target.value)}
              className="rounded-xl border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="">{t("ai.cn.filter.allProducts")}</option>
              {products.map((p) => <option key={p.id} value={p.id} data-cn-biz="1">{p.name}</option>)}
            </select>
            <select
              value={fPlatform} onChange={(e) => setFPlatform(e.target.value)}
              className="rounded-xl border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="">{t("ai.cn.platformAll")}</option>
              {platforms.map((p) => <option key={p.platform_key} value={p.platform_key}>{platformLabel(p.platform_key)}</option>)}
            </select>
            <Button variant="outline" onClick={() => void loadHistory()}>
              <RefreshCcw size={14} className="mr-1.5" />{t("ai.cn.refresh")}
            </Button>
          </div>

          {histLoading ? (
            <div className="space-y-2" aria-hidden>
              <div className="h-10 animate-pulse rounded-xl bg-surface-sunken" />
              <div className="h-10 animate-pulse rounded-xl bg-surface-sunken" />
            </div>
          ) : history.length === 0 ? (
            <EmptyState text={t("ai.cn.emptyHistory")} hint={t("ai.cn.emptyHistoryHint")} />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-sunken text-left text-xs text-fg-muted">
                    <th className="px-3 py-2.5 font-medium whitespace-nowrap">{t("ai.cn.h.product")}</th>
                    <th className="px-3 py-2.5 font-medium whitespace-nowrap">{t("ai.cn.h.platform")}</th>
                    <th className="px-3 py-2.5 font-medium whitespace-nowrap">{t("ai.cn.h.type")}</th>
                    <th className="px-3 py-2.5 font-medium whitespace-nowrap">{t("ai.cn.h.score")}</th>
                    <th className="px-3 py-2.5 font-medium whitespace-nowrap">{t("ai.cn.h.compliance")}</th>
                    <th className="px-3 py-2.5 font-medium whitespace-nowrap">{t("ai.cn.h.time")}</th>
                    <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">{t("ai.cn.h.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr key={row.id} className="border-b border-border/60 last:border-0 hover:bg-surface-hover">
                      <td data-cn-biz="1" className="max-w-48 truncate px-3 py-2.5 text-fg align-middle">
                        {row.product_id ? (
                          <Link to="/products/$id" params={{ id: row.product_id }} className="hover:text-primary hover:underline">
                            {prodName(row.product_id)}
                          </Link>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        {platformLabel(row.platform_key)}
                      </td>
                      <td className="px-3 py-2.5 align-middle">{t(`ai.cn.gt.${row.generation_type}`)}</td>
                      <td className="px-3 py-2.5 align-middle"><ScoreBadge score={row.score} /></td>
                      <td className="px-3 py-2.5 align-middle">
                        {row.compliance ? (
                          <span className={cn(
                            "inline-flex items-center gap-1 text-[11px] font-medium",
                            row.compliance.error_count > 0 ? "text-destructive" : "text-success",
                          )}>
                            {row.compliance.error_count > 0 ? <AlertTriangle size={11} /> : <ShieldCheck size={11} />}
                            {row.compliance.error_count > 0
                              ? t("ai.cn.compliance.errors", { n: row.compliance.error_count })
                              : t("ai.cn.compliance.passed")}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-fg-muted align-middle">{fmtDateTime(row.created_at, lang)}</td>
                      <td className="px-3 py-2.5 align-middle">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setViewRow(row)}>
                            <Eye size={12} className="mr-1" />{t("ai.cn.view")}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={rescoringId === row.id} onClick={() => void rescore(row)}>
                            {rescoringId === row.id ? <Loader2 size={12} className="mr-1 animate-spin" /> : <RefreshCcw size={12} className="mr-1" />}
                            {t("ai.cn.rescore")}
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void applyToProduct(row)}>
                            <Check size={12} className="mr-1" />{t("ai.cn.apply")}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* 历史详情弹窗 */}
      <Dialog open={!!viewRow} onOpenChange={(o) => { if (!o) setViewRow(null); }}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles size={15} className="text-primary" /> {t("ai.cn.detailTitle")}
              <ScoreBadge score={viewRow?.score ?? null} />
            </DialogTitle>
            <DialogDescription>
              {viewRow ? `${platformLabel(viewRow.platform_key)} · ${t(`ai.cn.gt.${viewRow.generation_type}`)}` : ""}
            </DialogDescription>
          </DialogHeader>
          {viewRow ? (
            <div className="space-y-3 text-sm">
              <div>
                <p className="mb-1 text-xs font-medium text-fg-muted">{t("ai.cn.rTitle")}</p>
                <p data-cn-biz="1" className="rounded-xl bg-surface-sunken/40 px-3 py-2">{viewRow.result?.title || "—"}</p>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-fg-muted">{t("ai.cn.rPoints")}</p>
                <ol className="list-inside list-decimal space-y-1 rounded-xl bg-surface-sunken/40 px-3 py-2">
                  {(viewRow.result?.selling_points ?? []).map((b, i) => <li key={i} data-cn-biz="1">{b}</li>)}
                </ol>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-fg-muted">{t("ai.cn.rDesc")}</p>
                <p data-cn-biz="1" className="whitespace-pre-wrap rounded-xl bg-surface-sunken/40 px-3 py-2">{viewRow.result?.description || "—"}</p>
              </div>
              <CompliancePanel compliance={viewRow.compliance} sourceUrl={platforms.find((p) => p.platform_key === viewRow.platform_key)?.source_url} />
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setViewRow(null)}><X size={13} className="mr-1" />{t("common.close")}</Button>
                <Button size="sm" onClick={() => { void applyToProduct(viewRow); setViewRow(null); }}>
                  <Check size={13} className="mr-1" />{t("ai.cn.apply")}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
