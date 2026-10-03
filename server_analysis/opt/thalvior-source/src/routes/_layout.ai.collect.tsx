import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Link2, Loader2, PackagePlus, Coins, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { toast } from "sonner";
import { projectUrlId, supabase, supabaseUrl } from "@/supabase/client";
import {
  getQuotaBalance,
  getServicePricing,
  formatPricing,
  type ServicePricing,
} from "@/services/aiService";
import { useLanguage } from "@/i18n/LanguageContext";

export const Route = createFileRoute("/_layout/ai/collect")({
  component: AiCollect,
});

interface CollectItem {
  id: string;
  name: string;
  source: string;
  price: number;
  image: string | null;
  sku: string | null;
  status: string;
}

// 调用 collect Edge Function：真实抓取目标网页并解析商品信息
async function collectFromUrl(url: string): Promise<{ name: string; price: number; image: string; sku: string }> {
  const session = (await supabase.auth.getSession()).data.session;
  const authHeaders: Record<string, string> = session
    ? { Authorization: `Bearer ${session.access_token}` }
    : {};
  const response = await fetch(`${supabaseUrl}/functions/v1/collect`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "OneDay-App-Id": projectUrlId,
      ...authHeaders,
    },
    body: JSON.stringify({ url }),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error((result as { error?: string }).error || `采集失败 (${response.status})`);
  }
  return (result as { data: { name: string; price: number; image: string; sku: string } }).data;
}

// 智能采集：输入商品链接，真实抓取目标网页并解析商品信息存入采集箱
function AiCollect() {
  const { t } = useLanguage();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [pricing, setPricing] = useState<ServicePricing | null>(null);
  const [items, setItems] = useState<CollectItem[]>([]);
  const [filter, setFilter] = useState<"全部" | "待处理" | "已处理">("全部");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const refreshBalance = () => {
    getQuotaBalance().then(setBalance).catch(() => setBalance(null));
  };

  useEffect(() => {
    refreshBalance();
    getServicePricing("collect").then(setPricing).catch(() => setPricing(null));
    loadItems();
  }, []);

  const loadItems = () => {
    supabase
      .from("collect_items")
      .select("*")
      .then(({ data }) => setItems((data ?? []) as CollectItem[]));
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("collect_items").delete().eq("id", id).select();
    if (error) {
      toast.error(`${t("collect.deleteFail")}: ${error.message}`);
      return;
    }
    toast.success(t("notif.deleted"));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    loadItems();
  };

  const handleBatchDelete = async () => {
    if (selected.size === 0) {
      toast.error(t("collect.selectFirst"));
      return;
    }
    const ids = Array.from(selected);
    const { error } = await supabase.from("collect_items").delete().in("id", ids).select();
    if (error) {
      toast.error(`${t("collect.batchDeleteFail")}: ${error.message}`);
      return;
    }
    toast.success(t("collect.deletedCount", { count: ids.length }));
    setSelected(new Set());
    loadItems();
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const visibleIds = filteredItems.map((it) => it.id);
    if (visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visibleIds));
    }
  };

  const filteredItems = items.filter((it) => {
    if (filter === "全部") return true;
    return it.status === filter;
  });

  const run = async () => {
    if (!url.trim()) {
      toast.error(t("collect.inputFirst"));
      return;
    }
    setBusy(true);
    try {
      // 真实抓取目标网页并解析商品信息
      const result = await collectFromUrl(url.trim());
      const { error } = await supabase.from("collect_items").insert({
        name: result.name,
        source: url.trim(),
        category: "采集",
        price: result.price,
        image: result.image || null,
        sku: result.sku || null,
        status: "待处理",
      });
      if (error) throw new Error(error.message);
      toast.success(t("collect.success"));
      setUrl("");
      refreshBalance();
      loadItems();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("collect.fail"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("collect.title")}
        description={t("collect.desc")}
        actions={
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm">
            <Coins size={15} className="text-amber-500" />
            <span className="text-muted-foreground">{t("ai.balance")}</span>
            <span className="font-semibold">{balance === null ? "—" : `${balance} 积分`}</span>
          </div>
        }
      />

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Link2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t("collect.placeholder")}
              className="pl-9"
            />
          </div>
          <Button onClick={run} disabled={busy}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <PackagePlus size={15} />}
            {busy ? t("collect.collecting") : t("collect.start")}
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {formatPricing(pricing)
            ? `${formatPricing(pricing)}`
            : t("collect.free")}
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="text-sm font-semibold">{t("collect.box")}</div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-border p-0.5 text-xs">
              {(["全部", "待处理", "已处理"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-md px-2.5 py-1 transition-colors ${
                    filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t(f)}
                </button>
              ))}
            </div>
            {selected.size > 0 && (
              <Button variant="outline" size="sm" className="text-rose-600" onClick={handleBatchDelete}>
                <Trash2 size={14} /> {t("collect.deleteSelected", { count: selected.size })}
              </Button>
            )}
          </div>
        </div>
        {filteredItems.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">{t("collect.empty")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="w-10 px-5 py-3">
                  <input
                    type="checkbox"
                    checked={filteredItems.length > 0 && filteredItems.every((it) => selected.has(it.id))}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 accent-primary"
                  />
                </th>
                <th className="px-3 py-3 font-medium">{t("collect.name")}</th>
                <th className="px-3 py-3 font-medium">{t("collect.price")}</th>
                <th className="px-3 py-3 font-medium">{t("collect.source")}</th>
                <th className="px-3 py-3 font-medium">{t("状态")}</th>
                <th className="px-3 py-3 text-right font-medium">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((it) => (
                <tr key={it.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(it.id)}
                      onChange={() => toggleSelect(it.id)}
                      className="h-4 w-4 accent-primary"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2.5">
                      {it.image ? (
                        <img
                          src={it.image}
                          alt={it.name}
                          className="h-10 w-10 shrink-0 rounded-md border border-border object-cover"
                          onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                        />
                      ) : (
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 text-muted-foreground">
                          <PackagePlus size={16} />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-medium">{it.name}</div>
                        {it.sku && <div className="text-xs text-muted-foreground">SKU: {it.sku}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 font-medium">
                    {it.price ? `¥${Number(it.price).toFixed(2)}` : "—"}
                  </td>
                  <td className="max-w-[200px] truncate px-3 py-3 text-muted-foreground">{it.source}</td>
                  <td className="px-3 py-3 text-muted-foreground">{t(it.status || "待处理")}</td>
                  <td className="px-3 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-rose-600 hover:text-rose-600"
                      onClick={() => handleDelete(it.id)}
                    >
                      <Trash2 size={15} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}