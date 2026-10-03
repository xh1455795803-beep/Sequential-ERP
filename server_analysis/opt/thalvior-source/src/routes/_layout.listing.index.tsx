import { createFileRoute } from "@tanstack/react-router";
import { Plus, RefreshCw, CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/LanguageContext";

export const Route = createFileRoute("/_layout/listing/")({
  component: Listing,
});

interface ListingTaskRow {
  id: string;
  product: string;
  source: string;
  target_platforms: string;
  status: string;
  created_at: string;
}

const statusIcon = {
  已刊登: CheckCircle2,
  刊登中: Loader2,
  待刊登: Clock,
  失败: XCircle,
};

const statusColor = {
  已刊登: "text-emerald-600",
  刊登中: "text-blue-600",
  待刊登: "text-amber-600",
  失败: "text-rose-600",
};

const platforms = ["Amazon US", "Amazon JP", "Shopify", "eBay", "TikTok Shop", "Walmart"];

function Listing() {
  const { t } = useLanguage();
  const [tasks, setTasks] = useState<ListingTaskRow[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [selectedProduct, setSelectedProduct] = useState("");

  const load = () => {
    supabase
      .from("listing_tasks")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setTasks((data ?? []) as ListingTaskRow[]);
        setLoading(false);
      });
  };

  const loadProducts = () => {
    supabase
      .from("products")
      .select("id, name")
      .order("created_at", { ascending: false })
      .then(({ data }) => setProducts((data ?? []) as { id: string; name: string }[]));
  };

  useEffect(() => {
    load();
    loadProducts();
  }, []);

  const togglePlatform = (p: string) => {
    setSelectedPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const createTask = async () => {
    if (selectedPlatforms.length === 0) {
      toast.error(t("listing.selectPlatformToast"));
      return;
    }
    if (!selectedProduct) {
      toast.error(t("listing.selectProductToast"));
      return;
    }
    const product = products.find((p) => p.id === selectedProduct);
    const { data, error } = await supabase
      .from("listing_tasks")
      .insert({
        product: product?.name ?? t("listing.unnamed"),
        source: t("listing.ownProduct"),
        target_platforms: selectedPlatforms.join(","),
        status: "待刊登",
      })
      .select();
    if (error) {
      console.error("创建刊登任务失败", error);
      toast.error(`${t("listing.createFail")}: ${error.message}`);
      return;
    }
    if (!data || data.length === 0) {
      toast.error(t("listing.createBlocked"));
      return;
    }
    toast.success(t("listing.created"));
    setSelectedPlatforms([]);
    setSelectedProduct("");
    setDialogOpen(false);
    load();
  };

  const retryTask = async (id: string) => {
    const { error } = await supabase.from("listing_tasks").update({ status: "待刊登" }).eq("id", id);
    if (error) {
      toast.error(`${t("listing.retryFail")}: ${error.message}`);
      return;
    }
    toast.success(t("listing.retried"));
    load();
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("listing.title")}
        description={t("listing.desc")}
        actions={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus size={15} /> {t("listing.newTask")}</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{t("listing.newTask")}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <p className="mb-2 text-sm font-medium">{t("listing.selectProduct")}</p>
                  <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("listing.selectProductPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {products.length === 0 ? (
                        <div className="px-2 py-1.5 text-sm text-muted-foreground">{t("listing.noProduct")}</div>
                      ) : (
                        products.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium">{t("listing.selectPlatform")}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {platforms.map((p) => (
                      <button
                        key={p}
                        onClick={() => togglePlatform(p)}
                        className={cn(
                          "rounded-lg border px-3 py-2 text-sm transition-colors",
                          selectedPlatforms.includes(p)
                            ? "border-primary bg-primary/5 text-primary"
                            : "border-border text-muted-foreground hover:border-primary/40"
                        )}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("common.cancel")}</Button>
                  <Button onClick={createTask} disabled={selectedPlatforms.length === 0}>{t("listing.createTask")}</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      {/* 刊登任务列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 size={20} className="mr-2 animate-spin" /> {t("common.loading")}
        </div>
      ) : tasks.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-16 text-center text-sm text-muted-foreground">
          {t("listing.empty")}
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => {
            const Icon = statusIcon[task.status as keyof typeof statusIcon] ?? Clock;
            const targetPlatforms = task.target_platforms ? task.target_platforms.split(",").filter(Boolean) : [];
            return (
              <div key={task.id} className="rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className={cn("mt-0.5", statusColor[task.status as keyof typeof statusColor] ?? "text-muted-foreground")}>
                      <Icon size={18} className={task.status === "刊登中" ? "animate-spin" : ""} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{task.product}</span>
                        <span className="text-xs text-muted-foreground">{t("listing.source")}：{task.source}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {targetPlatforms.map((p) => (
                          <span key={p} className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">{p}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={cn("text-sm font-medium", statusColor[task.status as keyof typeof statusColor] ?? "text-muted-foreground")}>{t(task.status)}</span>
                    <span className="text-xs text-muted-foreground">{new Date(task.created_at).toLocaleString()}</span>
                    {task.status === "失败" && (
                      <Button variant="outline" size="sm" onClick={() => retryTask(task.id)}><RefreshCw size={13} /> {t("listing.retry")}</Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}