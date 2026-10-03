import { createFileRoute, Link } from "@tanstack/react-router";
import { Lightbulb, ShoppingCart, CheckCircle2, AlertTriangle, Boxes, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader, StatCard } from "@/components/page-header";
import { fetchInventory, fetchPurchaseSuggestions, insertRow, type PurchaseSuggestionRow } from "@/lib/data-access";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/LanguageContext";
import { toast } from "sonner";

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
          if (!stock) return s;
          const available = stock.available;
          const safety = stock.safety_stock;
          const daily = s.daily_sales || 1;
          // 建议采购量 = 安全库存 + 7 天销量 - 当前可用库存（不足则补足）
          const suggest = Math.max(0, Math.ceil(safety + daily * 7 - available));
          return { ...s, available, safety_stock: safety, suggest_qty: suggest };
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
    const g: Record<string, PurchaseSuggestionRow[]> = { 紧急: [], 偏低: [], 正常: [] };
    for (const s of needRestock) {
      const urgency = s.available === 0 ? "紧急" : s.available < s.safety_stock ? "偏低" : "正常";
      g[urgency].push(s);
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
      console.log("[purchase.suggestion] 生成采购计划成功", { count: targets.length, skus: targets.map((s) => s.sku) });
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
              <Boxes size={14} className="mr-1.5" /> {selected.length === needRestock.length && needRestock.length > 0 ? "取消全选" : "全部选择"}
            </Button>
            <Link to="/purchase/plan">
              <Button size="sm" variant="outline">
                <ShoppingCart size={14} className="mr-1.5" /> 查看采购计划
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
        <StatCard label="紧急补货" value={String(grouped["紧急"].length)} icon={<AlertTriangle size={17} />} tone="violet" />
        <StatCard label="库存偏低" value={String(grouped["偏低"].length)} icon={<TrendingUp size={17} />} tone="warning" />
        <StatCard label="建议采购量" value={String(needRestock.reduce((a, s) => a + (s.suggest_qty || 0), 0))} icon={<Lightbulb size={17} />} tone="primary" />
      </div>

      {generated && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 size={16} />
          {t("suggest.generated", { count: selected.length })}
        </div>
      )}

      {/* 补货建议卡片（按紧急度分组） */}
      <div className="space-y-5">
        {needRestock.length === 0 && (
          <div className="rounded-2xl border border-border bg-card py-14 text-center">
            <Lightbulb size={28} className="mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">库存充足，暂无补货建议</p>
          </div>
        )}
        {(["紧急", "偏低", "正常"] as const).map((level) => {
          const list = grouped[level];
          if (list.length === 0) return null;
          const badgeCls =
            level === "紧急" ? "bg-rose-50 text-rose-600"
            : level === "偏低" ? "bg-amber-50 text-amber-600"
            : "bg-emerald-50 text-emerald-600";
          return (
            <div key={level} className="space-y-3">
              <div className="flex items-center gap-2">
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", badgeCls)}>
                  <Lightbulb size={12} /> {level}
                </span>
                <span className="text-xs text-muted-foreground">{list.length} 项</span>
              </div>
              {list.map((s) => {
                const isSelected = selected.includes(s.sku);
                const urgency = s.available === 0 ? "紧急" : s.available < s.safety_stock ? "偏低" : "正常";
                return (
                  <div
                    key={s.id}
                    className={cn(
                      "rounded-xl border bg-card p-4 shadow-sm transition-all",
                      isSelected ? "border-primary ring-2 ring-primary/20" : "border-border hover:shadow-md"
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
                            <span className="text-xs text-muted-foreground">{s.sku}</span>
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {t("suggest.dailySales", { count: s.daily_sales })}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-sm">
                        <div className="text-center">
                          <div className="text-xs text-muted-foreground">{t("suggest.available")}</div>
                          <div className={cn("font-semibold", s.available === 0 ? "text-rose-600" : "")}>{s.available}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs text-muted-foreground">{t("suggest.safety")}</div>
                          <div className="font-semibold">{s.safety_stock}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs text-muted-foreground">{t("suggest.daily")}</div>
                          <div className="font-semibold">{s.daily_sales}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs text-muted-foreground">{t("suggest.suggestQty")}</div>
                          <div className="font-semibold text-primary">{s.suggest_qty}</div>
                        </div>
                        <span className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
                          urgency === "紧急" ? "bg-rose-50 text-rose-600" : urgency === "偏低" ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"
                        )}>
                          <Lightbulb size={12} /> {t(urgency)}
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
