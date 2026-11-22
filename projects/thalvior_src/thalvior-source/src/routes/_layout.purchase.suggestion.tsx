import { createFileRoute, Link } from "@tanstack/react-router";
import { Lightbulb, ShoppingCart, CheckCircle2, AlertTriangle, Boxes, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader, StatCard } from "@/components/page-header";
import { fetchInventory, fetchPurchaseSuggestions, insertRow, type PurchaseSuggestionRow } from "@/lib/data-access";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/LanguageContext";
import { toast } from "sonner";

import { tt } from "@/i18n/tts";
import { devLog } from "@/lib/devlog";

export const Route = createFileRoute("/_layout/purchase/suggestion")({
  component: Suggestion,
});

function Suggestion() {
  const { t } = useLanguage();
  const [selected, setSelected] = useState<string[]>([]);
  const [generated, setGenerated] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [suggestions, setSuggestions] = useState<PurchaseSuggestionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 基于真实库存动态计算补货建议：可用库存低于安全库存时，按日均销量补足
    Promise.all([fetchInventory(), fetchPurchaseSuggestions()])
      .then(([stocks, base]) => {
        const merged = base.map((s) => {
          const stock = stocks.find((x) => x.sku === s.sku);
          const available = Number(stock ? stock.available : s.available) || 0;
          const safety = Number(stock ? stock.safety_stock : s.safety_stock) || 0;
          const daily = Number(s.daily_sales) > 0 ? Number(s.daily_sales) : 1;
          // 建议采购量 = 安全库存 + 7 天销量 - 当前可用库存（不足则补足）
          const suggest = Math.max(0, Math.ceil(safety + daily * 7 - available));
          return { ...s, available, safety_stock: safety, daily_sales: daily, suggest_qty: suggest };
        });
        setSuggestions(merged);
      })
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, []);

  const needRestock = suggestions.filter((s) => s.suggest_qty > 0);

  const toggle = (sku: string) => {
    setSelected((prev) => (prev.includes(sku) ? prev.filter((x) => x !== sku) : [...prev, sku]));
  };

  // 紧急度分组
  const grouped = useMemo(() => {
    const g: Record<string, PurchaseSuggestionRow[]> = { urgent: [], low: [], normal: [] };
    for (const s of needRestock) {
      const lv = s.available === 0 ? "urgent" : s.available < s.safety_stock ? "low" : "normal";
      g[lv].push(s);
    }
    return g;
  }, [needRestock]);

  const selectAll = () => {
    if (selected.length === needRestock.length) { setSelected([]); return; }
    setSelected(needRestock.map((s) => s.sku));
  };

  // 生成采购计划：将选中的补货建议真实写入 purchase_plans 表
  const handleGenerate = async () => {
    if (selected.length === 0) return;
    setGenerating(true);
    try {
      const targets = suggestions.filter((s) => selected.includes(s.sku) && s.suggest_qty > 0);
      for (const s of targets) {
        await insertRow("purchase_plans", {
          sku: s.sku,
          product: s.name,
          qty: s.suggest_qty,
          supplier: "",
          status: "待采购",
        });
      }
      devLog("[purchase.suggestion] 生成采购计划成功", { count: targets.length, skus: targets.map((s) => s.sku) });
      setGenerated(true);
      setSelected([]);
      toast.success(t("suggest.generated", { count: targets.length }));
    } catch (e) {
      console.error("[purchase.suggestion] 生成采购计划失败", e);
      toast.error(e instanceof Error ? e.message : t("suggest.generateFail"));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("suggest.title")}
        description={t("suggest.desc")}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={selectAll} disabled={needRestock.length === 0}>
              <Boxes size={14} className="mr-1.5" /> {selected.length === needRestock.length && needRestock.length > 0 ? tt('pur.deselectAll') : tt('pur.selectAll')}
            </Button>
            <Link to="/purchase/plan">
              <Button size="sm" variant="outline">
                <ShoppingCart size={14} className="mr-1.5" />{tt('pur.viewPlan')}
              </Button>
            </Link>
            <Button
              size="sm"
              disabled={selected.length === 0 || generating}
              onClick={handleGenerate}
            >
              <ShoppingCart size={14} /> {t("suggest.generate", { count: selected.length })}
            </Button>
          </div>
        }
      />

      {/* 统计卡 */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label={tt('pur.urgentRestock')} value={String(grouped.urgent.length)} icon={<AlertTriangle size={17} />} tone="violet" />
        <StatCard label={tt('nav.inventory.lowStock')} value={String(grouped.low.length)} icon={<TrendingUp size={17} />} tone="warning" />
        <StatCard label={tt('pur.suggestQty')} value={String(needRestock.reduce((a, s) => a + (s.suggest_qty || 0), 0))} icon={<Lightbulb size={17} />} tone="primary" />
      </div>

      {generated && (
        <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success-bg px-4 py-3 text-sm text-success">
          <CheckCircle2 size={16} />
          {t("suggest.generated", { count: selected.length })}
        </div>
      )}

      {/* 补货建议卡片（按紧急度分组） */}
      <div className="space-y-5">
        {needRestock.length === 0 && (
          <div className="rounded-xl border border-border bg-card py-14 text-center">
            <Lightbulb size={28} className="mx-auto mb-3 text-fg-muted/40" />
            <p className="text-sm text-fg-muted">{tt('pur.stockOk')}，{tt('pur.noSuggestions')}</p>
          </div>
        )}
        {(["urgent", "low", "normal"] as const).map((level) => {
          const list = grouped[level];
          if (list.length === 0) return null;
          const badgeCls =
            level === "urgent" ? "bg-danger-bg text-destructive"
            : level === "low" ? "bg-warning-bg text-warning"
            : "bg-success-bg text-success";
          return (
            <div key={level} className="space-y-3">
              <div className="flex items-center gap-2">
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", badgeCls)}>
                  <Lightbulb size={12} /> {t(level === "urgent" ? "st.urgent" : level === "low" ? "st.low" : "st.normal")}
                </span>
                <span className="text-xs text-fg-muted">{list.length}{t("common.items")}</span>
              </div>
              {list.map((s) => {
                const isSelected = selected.includes(s.sku);
                const uTok = s.available === 0 ? "urgent" : s.available < s.safety_stock ? "low" : "normal";
                return (
                  <div
                    key={s.id}
                    className={cn(
                      "rounded-xl border bg-card p-4 shadow-soft transition-all",
                      isSelected ? "border-primary ring-2 ring-primary/20" : "border-border hover:shadow-lift"
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggle(s.sku)}
                          className="accent-primary"
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{s.name}</span>
                            <span className="text-xs text-fg-muted">{s.sku}</span>
                          </div>
                          <div className="mt-0.5 text-xs text-fg-muted">
                            {t("suggest.dailySales", { count: s.daily_sales })}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-sm">
                        <div className="text-center">
                          <div className="text-xs text-fg-muted">{t("suggest.available")}</div>
                          <div className={cn("font-semibold", s.available === 0 ? "text-destructive" : "")}>{s.available}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs text-fg-muted">{t("suggest.safety")}</div>
                          <div className="font-semibold">{s.safety_stock}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs text-fg-muted">{t("suggest.daily")}</div>
                          <div className="font-semibold">{s.daily_sales}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs text-fg-muted">{t("suggest.suggestQty")}</div>
                          <div className="font-semibold text-primary">{s.suggest_qty}</div>
                        </div>
                        <span className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
                          uTok === "urgent" ? "bg-danger-bg text-destructive" : uTok === "low" ? "bg-warning-bg text-warning" : "bg-success-bg text-success"
                        )}>
                          <Lightbulb size={12} /> {t(uTok === "urgent" ? "st.urgent" : uTok === "low" ? "st.low" : "st.normal")}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
