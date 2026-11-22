/**
 * /products/pricing-templates — 定价模板管理页（P0-2）
 * 列表 / 新建 / 编辑 / 删除 / 设默认；联动：products.cost → 建议售价 → publish-listing
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Star, StarOff, Loader2, Calculator } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLanguage } from "@/i18n/LanguageContext";
import {
  listTemplates, deleteTemplate, setDefaultTemplate, type PricingTemplate,
} from "@/services/pricingService";
import { PricingTemplateDialog } from "@/components/pricing-template-dialog";

export const Route = createFileRoute("/_layout/products/pricing")({
  component: PricingTemplatesPage,
});

function PricingTemplatesPage() {
  const { t } = useLanguage();
  const [items, setItems] = useState<PricingTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PricingTemplate | null>(null);
  const [deleting, setDeleting] = useState<PricingTemplate | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    listTemplates()
      .then(setItems)
      .catch((e) => toast.error(t("pt.loadFail", { msg: e instanceof Error ? e.message : "" })))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const handleDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteTemplate(deleting.id);
      toast.success(t("pt.deleted"));
      setDeleting(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.unknownError"));
    } finally {
      setBusy(false);
    }
  };

  const handleSetDefault = async (tpl: PricingTemplate) => {
    if (tpl.is_default) return;
    try {
      await setDefaultTemplate(tpl.id);
      toast.success(t("pt.defaultSet", { name: tpl.name }));
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.unknownError"));
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("nav.products.pricingTemplates")}
        description={t("pt.pageDesc")}
        actions={
          <Button
            size="sm"
            onClick={() => { setEditing(null); setDialogOpen(true); }}
          >
            <Plus size={14} className="mr-1.5" />{t("pt.newTitle")}
          </Button>
        }
      />

      <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-sm text-fg-muted">
            <Loader2 size={16} className="mr-2 animate-spin" />{t("common.loading")}
          </div>
        ) : items.length === 0 ? (
          <div className="py-10 text-center text-sm text-fg-muted">{t("pt.empty")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs text-fg-muted">
                <tr>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">{t("pt.name")}</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">{t("pt.markupType")}</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">{t("pt.commission")}</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">{t("pt.freight")}</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">{t("pt.currency")}</th>
                  <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((x) => (
                  <tr key={x.id} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-3 align-middle">
                      <span className="font-medium text-fg">{x.name}</span>
                      {x.is_default && (
                        <span className="ml-2 inline-flex items-center rounded-full bg-warning-bg px-2 py-0.5 text-[10px] font-semibold text-warning border border-warning/30">
                          <Star size={10} className="mr-0.5 fill-warning text-warning" />{t("pt.defaultTag")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-fg-muted align-middle">
                      {x.markup_type === "percent" ? `${t("pt.markupPercent")} ${x.markup_value}%` : `${t("pt.markupFixed")} ¥${x.markup_value}`}
                    </td>
                    <td className="px-3 py-3 text-fg-muted align-middle">{x.commission_rate}%</td>
                    <td className="px-3 py-3 text-fg-muted align-middle">¥{x.freight}</td>
                    <td className="px-3 py-3 text-fg-muted align-middle">{x.target_currency}</td>
                    <td className="px-3 py-3 align-middle">
                      <div className="flex items-center justify-end gap-1">
                        {!x.is_default && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" title={t("pt.setDefault")}
                            onClick={() => handleSetDefault(x)}>
                            <StarOff size={14} />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-8 w-8" title={t("common.edit")}
                          onClick={() => { setEditing(x); setDialogOpen(true); }}>
                          <Pencil size={14} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" title={t("common.delete")}
                          onClick={() => setDeleting(x)}>
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-border bg-surface-sunken/40 p-3 text-xs text-fg-muted">
        <Calculator size={14} className="mt-0.5 shrink-0 text-primary" />
        <span>{t("pt.formulaNote")}</span>
      </div>

      <PricingTemplateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={load}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("pt.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("pt.deleteDesc", { name: deleting?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={busy}
              className="bg-destructive hover:bg-destructive"
            >
              {busy ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Trash2 size={14} className="mr-1.5" />}
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
