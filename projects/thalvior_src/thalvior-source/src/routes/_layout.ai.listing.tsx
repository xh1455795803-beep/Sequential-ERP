/**
 * /ai/listing — AI Listing 工作台（2026-10-22）
 * Tab1 批量生成：多选商品 × 平台 × 语言 → 顺序排队生成 → 结果列表（状态/评分/查看/应用）
 * Tab2 历史记录：listing_generations 筛选（商品/平台/语言/时间）→ 查看/重评分/应用
 * 联动：批量完成写站内通知（type='AI'）；应用写入商品多语言资料（publish-listing 按店铺语言取用）
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Sparkles, Loader2, Coins, ListChecks, History, Search,
  Check, RefreshCcw, PlayCircle, ChevronDown, ChevronUp, Eye, X,
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
import { useAuth } from "@/lib/auth";
import { fmtDateTime } from "@/lib/datetime";
import { useLanguage } from "@/i18n/LanguageContext";
import {
  generateListing, scoreListing, listGenerations, applyListingToI18n, fetchPlatformNames,
  LISTING_LANGS, AiListingError,
  type ListingGeneration, type ListingResult, type ScoreDetail,
} from "@/services/aiListingService";
import { getPoolBalances, getServicePricing } from "@/services/aiService";

const TOAST_MS = 2500;

interface ProductLite {
  id: string;
  name: string;
  sku: string;
  source_platform: string | null;
}

interface QueueItem {
  productId: string;
  name: string;
  status: "pending" | "running" | "success" | "failed";
  score?: number | null;
  rowId?: string;
  error?: string;
}

function ScoreBadge({ score }: { score: number | null | undefined }) {
  const { t } = useLanguage();
  if (score == null) return <span className="text-xs text-fg-muted">—</span>;
  const cls =
    score >= 80 ? "bg-success-bg text-success border-success/30"
    : score >= 60 ? "bg-warning-bg text-warning border-warning/30"
    : "bg-danger-bg text-destructive border-destructive/30";
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${cls}`}>{score.toFixed(0)}</span>;
}

function statusChip(status: QueueItem["status"], t: (k: string) => string) {
  const map: Record<QueueItem["status"], string> = {
    pending: "bg-muted text-muted-foreground",
    running: "bg-primary/10 text-primary",
    success: "bg-success-bg text-success",
    failed: "bg-danger-bg text-destructive",
  };
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", map[status])}>{t(`ai.listing.st.${status}`)}</span>;
}

export const Route = createFileRoute("/_layout/ai/listing")({
  component: AiListingWorkbench,
});

function AiListingWorkbench() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();

  // 公共：平台 / 语言 / 积分
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [platform, setPlatform] = useState("Amazon US");
  const [language, setLanguage] = useState("en");
  const [credits, setCredits] = useState(4);
  const [balance, setBalance] = useState<number | null>(null);

  // 批量
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [prodSearch, setProdSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const [viewRow, setViewRow] = useState<ListingGeneration | null>(null);

  // 历史
  const [history, setHistory] = useState<ListingGeneration[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [fProduct, setFProduct] = useState("");
  const [fPlatform, setFPlatform] = useState("");
  const [fLang, setFLang] = useState("");
  const [fRange, setFRange] = useState<"all" | "7d" | "30d">("all");
  const [rescoringId, setRescoringId] = useState<string | null>(null);

  const loadProducts = useCallback(async () => {
    const { data } = await supabase.from("products").select("id, name, sku, source_platform").order("updated_at", { ascending: false }).limit(300);
    setProducts((data ?? []) as ProductLite[]);
  }, []);

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    try {
      const since =
        fRange === "7d" ? new Date(Date.now() - 7 * 86400000).toISOString()
        : fRange === "30d" ? new Date(Date.now() - 30 * 86400000).toISOString()
        : undefined;
      const rows = await listGenerations({
        productId: fProduct || undefined,
        platform: fPlatform || undefined,
        language: fLang || undefined,
        since,
        limit: 100,
      });
      setHistory(rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("ai.listing.err.generic"), { duration: TOAST_MS });
    } finally {
      setHistLoading(false);
    }
  }, [fProduct, fPlatform, fLang, fRange, t]);

  useEffect(() => {
    fetchPlatformNames()
      .then((names) => {
        setPlatforms(names);
        if (names.length && !names.includes("Amazon US")) setPlatform(names[0]);
      })
      .catch(() => setPlatforms(["Amazon US", "AliExpress", "Shopee", "Temu", "eBay", "TikTok Shop", "Shopify", "WooCommerce"]));
    void loadProducts();
    (async () => {
      try {
        const p = await getServicePricing("ai_listing");
        if (p?.credits_per_use != null) setCredits(Number(p.credits_per_use));
        const b = await getPoolBalances();
        setBalance(b.workbench.total);
      } catch { /* 静默 */ }
    })();
  }, [loadProducts]);

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
    if (e instanceof AiListingError) {
      if (e.code === "INSUFFICIENT_CREDITS") toast.error(t("ai.listing.err.credits"), { duration: TOAST_MS });
      else if (e.code === "UPSTREAM_TIMEOUT") toast.error(t("ai.listing.err.timeout"), { duration: TOAST_MS });
      else if (e.code === "RATE_LIMITED") toast.error(t("ai.listing.err.rate"), { duration: TOAST_MS });
      else toast.error(e.message || t("ai.listing.err.generic"), { duration: TOAST_MS });
    } else {
      toast.error(e instanceof Error ? e.message : t("ai.listing.err.generic"), { duration: TOAST_MS });
    }
  };

  // ── 批量生成（顺序排队，避免限流） ──
  const runBatch = async () => {
    if (!selected.size) {
      toast.error(t("ai.listing.needProducts"), { duration: TOAST_MS });
      return;
    }
    const items: QueueItem[] = [...selected].map((pid) => ({
      productId: pid,
      name: products.find((p) => p.id === pid)?.name ?? pid.slice(0, 8),
      status: "pending",
    }));
    setQueue(items);
    setRunning(true);
    let okCount = 0;
    let failCount = 0;
    for (let i = 0; i < items.length; i++) {
      setQueue((q) => q.map((it, idx) => (idx === i ? { ...it, status: "running" } : it)));
      try {
        const r = await generateListing({ productId: items[i].productId, platform, language });
        okCount++;
        setQueue((q) => q.map((it, idx) => (idx === i ? { ...it, status: "success", score: r.score ?? null, rowId: r.id } : it)));
        if (typeof r.balance === "number") setBalance(r.balance);
      } catch (e) {
        failCount++;
        const msg = e instanceof AiListingError && e.code === "INSUFFICIENT_CREDITS" ? t("ai.listing.err.credits") : e instanceof Error ? e.message : t("ai.listing.err.generic");
        setQueue((q) => q.map((it, idx) => (idx === i ? { ...it, status: "failed", error: msg } : it)));
        if (e instanceof AiListingError && e.code === "INSUFFICIENT_CREDITS") break; // 积分不足终止队列
      }
    }
    setRunning(false);
    // 站内通知（联动）
    if (user) {
      await supabase.from("notifications").insert({
        user_id: user.id,
        title: t("ai.listing.batchDoneTitle"),
        content: t("ai.listing.batchDoneContent", { ok: okCount, fail: failCount, platform, lang: t(LISTING_LANGS.find((l) => l.code === language)?.key ?? "ai.listing.lang.zh") }),
        type: "AI",
      }).then(undefined, () => { /* 通知失败不阻断 */ });
    }
    toast.success(t("ai.listing.batchDoneContent", { ok: okCount, fail: failCount, platform, lang: language }), { duration: TOAST_MS });
    void loadHistory();
  };

  const retryItem = async (idx: number) => {
    const item = queue[idx];
    if (!item || running) return;
    setQueue((q) => q.map((it, i) => (i === idx ? { ...it, status: "running", error: undefined } : it)));
    try {
      const r = await generateListing({ productId: item.productId, platform, language });
      setQueue((q) => q.map((it, i) => (i === idx ? { ...it, status: "success", score: r.score ?? null, rowId: r.id } : it)));
      if (typeof r.balance === "number") setBalance(r.balance);
      void loadHistory();
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("ai.listing.err.generic");
      setQueue((q) => q.map((it, i) => (i === idx ? { ...it, status: "failed", error: msg } : it)));
    }
  };

  // ── 应用（工作台内直接写商品多语言资料 / 中文名称描述） ──
  const applyGeneration = async (row: ListingGeneration) => {
    if (!row.product_id) {
      toast.error(t("ai.listing.err.noProduct"), { duration: TOAST_MS });
      return;
    }
    try {
      if (row.language === "zh") {
        const { error } = await supabase
          .from("products")
          .update({ name: row.result.title, description: row.result.description, updated_at: new Date().toISOString() })
          .eq("id", row.product_id);
        if (error) throw new Error(error.message);
        toast.success(t("ai.listing.applyDbZh"), { duration: TOAST_MS });
      } else {
        await applyListingToI18n(row.product_id, row.language, row.result);
        toast.success(t("ai.listing.applyDb"), { duration: TOAST_MS });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("ai.listing.err.generic"), { duration: TOAST_MS });
    }
  };

  const rescoreHistory = async (row: ListingGeneration) => {
    setRescoringId(row.id);
    try {
      const r = await scoreListing(row.id);
      setHistory((h) => h.map((x) => (x.id === row.id ? { ...x, score: r.score ?? null, score_detail: (r.score_detail ?? null) as ScoreDetail | null } : x)));
      if (viewRow?.id === row.id) setViewRow({ ...row, score: r.score ?? null, score_detail: (r.score_detail ?? null) as ScoreDetail | null });
      if (typeof r.balance === "number") setBalance(r.balance);
      toast.success(t("ai.listing.scored"), { duration: TOAST_MS });
    } catch (e) {
      handleError(e);
    } finally {
      setRescoringId(null);
    }
  };

  const done = queue.filter((q) => q.status === "success" || q.status === "failed").length;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 md:p-6">
      <PageHeader title={t("ai.listing.title")} description={t("ai.listing.desc")} />

      <p className="flex items-center gap-1.5 text-xs text-fg-muted">
        <Coins size={13} className="text-warning" />
        {t("ai.listing.creditsNote", { credits, balance: balance == null ? "—" : balance })}
      </p>

      <Tabs defaultValue="batch">
        <TabsList>
          <TabsTrigger value="batch"><ListChecks size={14} className="mr-1.5" />{t("ai.listing.tab.batch")}</TabsTrigger>
          <TabsTrigger value="history"><History size={14} className="mr-1.5" />{t("ai.listing.tab.history")}</TabsTrigger>
        </TabsList>

        {/* ═══ 批量生成 ═══ */}
        <TabsContent value="batch" className="mt-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-fg-muted">{t("ai.listing.platform")}</label>
              <select
                value={platform} onChange={(e) => setPlatform(e.target.value)} disabled={running}
                className="w-full rounded-xl border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-primary"
              >
                {(platforms.length ? platforms : [platform]).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-fg-muted">{t("ai.listing.language")}</label>
              <select
                value={language} onChange={(e) => setLanguage(e.target.value)} disabled={running}
                className="w-full rounded-xl border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-primary"
              >
                {LISTING_LANGS.map((l) => <option key={l.code} value={l.code}>{t(l.key)}</option>)}
              </select>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <label className="text-sm font-medium text-fg">{t("ai.listing.pickProducts")}</label>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
                  <input
                    value={prodSearch} onChange={(e) => setProdSearch(e.target.value)}
                    placeholder={t("ai.listing.searchProducts")}
                    className="w-56 rounded-xl border border-border bg-background py-1.5 pl-8 pr-2 text-xs outline-none focus:border-primary"
                  />
                </div>
                <span className="text-xs text-fg-muted">{t("ai.listing.selected", { n: selected.size })}</span>
              </div>
            </div>
            {filteredProducts.length === 0 ? (
              <EmptyState text={t("ai.listing.noProducts")} iconSize={32} />
            ) : (
              <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
                {filteredProducts.map((p) => {
                  const on = selected.has(p.id);
                  return (
                    <label
                      key={p.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-sm transition-colors",
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
                      <span className="min-w-0 flex-1 truncate text-fg">{p.name}</span>
                      {p.source_platform ? <span className="shrink-0 rounded bg-surface-sunken px-1.5 py-0.5 text-[10px] text-fg-muted">{p.source_platform}</span> : null}
                      <span className="shrink-0 text-xs text-fg-muted">{p.sku}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={runBatch} disabled={running || !selected.size}>
              {running ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <PlayCircle size={14} className="mr-1.5" />}
              {running ? t("ai.listing.batchRunning") : t("ai.listing.startBatch")}
            </Button>
            {running && (
              <div className="flex-1">
                <div className="h-2 overflow-hidden rounded-full bg-surface-sunken">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${queue.length ? (done / queue.length) * 100 : 0}%` }} />
                </div>
                <p className="mt-1 text-[11px] text-fg-muted">{t("ai.listing.progress", { done, total: queue.length })}</p>
              </div>
            )}
          </div>

          {queue.length > 0 && (
            <div id="batch-queue" className="space-y-1.5 rounded-xl border border-border bg-card p-3">
              {queue.map((it, i) => (
                <div key={it.productId} className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm hover:bg-surface-hover">
                  <span className="min-w-0 flex-1 truncate text-fg">{it.name}</span>
                  {statusChip(it.status, t)}
                  {it.status === "success" && <ScoreBadge score={it.score ?? null} />}
                  {it.status === "failed" && <span className="max-w-48 truncate text-[11px] text-destructive">{it.error}</span>}
                  {it.status === "success" && it.rowId && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => {
                      const row = history.find((h) => h.id === it.rowId);
                      if (row) setViewRow(row);
                      else void supabase.from("listing_generations").select("*").eq("id", it.rowId!).maybeSingle().then(({ data }) => data && setViewRow(data as unknown as ListingGeneration));
                    }}>
                      <Eye size={12} className="mr-1" />{t("ai.listing.view")}
                    </Button>
                  )}
                  {it.status === "failed" && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void retryItem(i)} disabled={running}>
                      <RefreshCcw size={12} className="mr-1" />{t("ai.listing.retry")}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ═══ 历史记录 ═══ */}
        <TabsContent value="history" className="mt-4 space-y-3">
          <div className="grid gap-2 md:grid-cols-4">
            <select
              value={fProduct} onChange={(e) => setFProduct(e.target.value)}
              className="rounded-xl border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="">{t("ai.listing.filter.allProducts")}</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select
              value={fPlatform} onChange={(e) => setFPlatform(e.target.value)}
              className="rounded-xl border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="">{t("ai.listing.platformAll")}</option>
              {[...new Set(history.map((h) => h.platform))].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <select
              value={fLang} onChange={(e) => setFLang(e.target.value)}
              className="rounded-xl border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="">{t("ai.listing.langAll")}</option>
              {LISTING_LANGS.map((l) => <option key={l.code} value={l.code}>{t(l.key)}</option>)}
            </select>
            <select
              value={fRange} onChange={(e) => setFRange(e.target.value as "all" | "7d" | "30d")}
              className="rounded-xl border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="all">{t("ai.listing.filter.all")}</option>
              <option value="7d">{t("ai.listing.filter.7d")}</option>
              <option value="30d">{t("ai.listing.filter.30d")}</option>
            </select>
          </div>

          {histLoading ? (
            <div className="space-y-2" aria-hidden>
              <div className="h-10 animate-pulse rounded-xl bg-surface-sunken" />
              <div className="h-10 animate-pulse rounded-xl bg-surface-sunken" />
              <div className="h-10 animate-pulse rounded-xl bg-surface-sunken" />
            </div>
          ) : history.length === 0 ? (
            <EmptyState text={t("ai.listing.empty")} hint={t("ai.listing.emptyHint")} />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-sunken text-left text-xs text-fg-muted">
                    <th className="px-3 py-2.5 font-medium whitespace-nowrap">{t("ai.listing.h.product")}</th>
                    <th className="px-3 py-2.5 font-medium whitespace-nowrap">{t("ai.listing.h.platform")}</th>
                    <th className="px-3 py-2.5 font-medium whitespace-nowrap">{t("ai.listing.h.lang")}</th>
                    <th className="px-3 py-2.5 font-medium whitespace-nowrap">{t("ai.listing.h.type")}</th>
                    <th className="px-3 py-2.5 font-medium whitespace-nowrap">{t("ai.listing.h.score")}</th>
                    <th className="px-3 py-2.5 font-medium whitespace-nowrap">{t("ai.listing.h.time")}</th>
                    <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">{t("ai.listing.h.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr key={row.id} className="border-b border-border/60 last:border-0 hover:bg-surface-hover">
                      <td className="max-w-48 truncate px-3 py-2.5 text-fg align-middle">
                        {row.product_id ? (
                          <Link to="/products/$id" params={{ id: row.product_id }} className="hover:text-primary hover:underline">
                            {prodName(row.product_id)}
                          </Link>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2.5 align-middle">{row.platform}</td>
                      <td className="px-3 py-2.5 align-middle">{t(LISTING_LANGS.find((l) => l.code === row.language)?.key ?? row.language)}</td>
                      <td className="px-3 py-2.5 align-middle">{t(`ai.listing.gt.${row.generation_type}`)}</td>
                      <td className="px-3 py-2.5 align-middle"><ScoreBadge score={row.score} /></td>
                      <td className="px-3 py-2.5 text-xs text-fg-muted align-middle">{fmtDateTime(row.created_at, lang)}</td>
                      <td className="px-3 py-2.5 align-middle">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setViewRow(row)}>
                            <Eye size={12} className="mr-1" />{t("ai.listing.view")}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void rescoreHistory(row)} disabled={rescoringId === row.id}>
                            {rescoringId === row.id ? <Loader2 size={12} className="mr-1 animate-spin" /> : <RefreshCcw size={12} className="mr-1" />}{t("ai.listing.rescore")}
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void applyGeneration(row)}>
                            <Check size={12} className="mr-1" />{t("ai.listing.apply")}
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

      {/* 详情弹窗 */}
      <Dialog open={!!viewRow} onOpenChange={(o) => { if (!o) setViewRow(null); }}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles size={15} className="text-primary" /> {t("ai.listing.detailTitle")}
              <ScoreBadge score={viewRow?.score ?? null} />
            </DialogTitle>
            <DialogDescription>
              {viewRow ? `${viewRow.platform} · ${t(LISTING_LANGS.find((l) => l.code === viewRow.language)?.key ?? viewRow.language)} · ${t(`ai.listing.gt.${viewRow.generation_type}`)}` : ""}
            </DialogDescription>
          </DialogHeader>
          {viewRow && (
            <div className="space-y-3 text-sm">
              <div>
                <p className="mb-1 text-xs font-medium text-fg-muted">{t("ai.listing.rTitle")}</p>
                <p className="rounded-xl bg-surface-sunken/40 px-3 py-2">{viewRow.result?.title || "—"}</p>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-fg-muted">{t("ai.listing.rBullets")}</p>
                <ol className="list-inside list-decimal space-y-1 rounded-xl bg-surface-sunken/40 px-3 py-2">
                  {(viewRow.result?.bullet_points ?? []).map((b, i) => <li key={i}>{b}</li>)}
                </ol>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-fg-muted">{t("ai.listing.rDesc")}</p>
                <p className="whitespace-pre-wrap rounded-xl bg-surface-sunken/40 px-3 py-2">{viewRow.result?.description || "—"}</p>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-fg-muted">{t("ai.listing.rTerms")}</p>
                <p className="rounded-xl bg-surface-sunken/40 px-3 py-2">{(viewRow.result?.search_terms ?? []).join(", ") || "—"}</p>
              </div>
              {viewRow.score_detail && !viewRow.score_detail.error && (
                <div>
                  <p className="mb-1 text-xs font-medium text-fg-muted">{t("ai.listing.expandScores")}</p>
                  <div className="space-y-2 rounded-xl bg-surface-sunken/40 px-3 py-2">
                    {Object.entries(viewRow.score_detail.dimensions ?? {}).map(([k, d]) => (
                      <div key={k} className="flex items-center justify-between gap-3 text-xs">
                        <span className="shrink-0">{t(`ai.listing.dim.${k}`)}</span>
                        <span className="flex-1 truncate text-fg-muted">{d.comment}</span>
                        <span className="font-semibold">{d.score}</span>
                      </div>
                    ))}
                    {viewRow.score_detail.suggestions?.length > 0 && (
                      <ul className="list-inside list-disc text-xs text-fg-muted">
                        {viewRow.score_detail.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    )}
                  </div>
                </div>
              )}
              <p className="text-[11px] text-fg-muted">
                {t("ai.listing.model")}: {viewRow.model || "—"} · {t("ai.listing.tokens", { n: viewRow.tokens_used ?? 0 })}
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setViewRow(null)}><X size={13} className="mr-1" />{t("common.close")}</Button>
                <Button size="sm" onClick={() => { void applyGeneration(viewRow); setViewRow(null); }}>
                  <Check size={13} className="mr-1" />{t("ai.listing.apply")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
