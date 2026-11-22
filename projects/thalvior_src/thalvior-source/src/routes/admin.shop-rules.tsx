/**
 * /admin/shop-rules — 店铺规则配置（统一刊登编辑页配套）
 *
 * 为每一家已绑定店铺预先配置刊登规则：
 * - 字段显隐/必填（SITE_FIELDS 与编辑页一一对应）
 * - 文件上传项开关/必填（SITE_UPLOADS）
 * - 报错提示文字单独配置
 * 配置一次后，统一刊登编辑页选中该店铺即自动套用。
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Store, Loader2, Plus, Settings2, Trash2, Globe, Power } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  fetchShops, fetchShopListingRules, insertRow, updateRow, deleteRow,
  type ShopRow, type ShopListingRuleRow,
} from "@/lib/data-access";
import { cn } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/admin/shop-rules")({
  component: ShopRules,
});

// 站点专属字段（key 与编辑页 SITE_FIELDS / shop_listing_rules.fields 一一对应）
const SITE_FIELDS: { key: string; label: string; hint: string }[] = [
  { key: "site_title", label: "pd.site.site_title", hint: "pd.site.site_title_hint" },
  { key: "site_bullets", label: "pd.site.site_bullets", hint: "adm.rules.bulletsHint" },
  { key: "site_description", label: "pd.site.site_description", hint: "pd.site.site_description_hint" },
  { key: "site_price", label: "pd.site.site_price", hint: "pd.site.site_price_hint" },
  { key: "site_stock", label: "pd.site.site_stock", hint: "pd.site.site_stock_hint" },
  { key: "fulfill_time", label: "pd.site.fulfill_time", hint: "adm.rules.fulfillPh" },
  { key: "shipping_template", label: "pd.site.shipping_template", hint: "pd.site.shipping_template_hint" },
  { key: "ean", label: "pd.site.ean", hint: "adm.rules.eanHint" },
  { key: "ptc", label: "pd.site.ptc", hint: "adm.rules.hsLabel" },
  { key: "manufacturer", label: "pd.site.manufacturer", hint: "pd.manufacturerPh" },
  { key: "eu_responsible", label: "pd.site.eu_responsible", hint: "pd.site.eu_responsible_hint" },
  { key: "eu_doc", label: "pd.upl.eu_doc", hint: "pd.upl.eu_doc_hint" },
  { key: "ce_declaration", label: "pd.upl.ce_declaration", hint: "pd.upl.ce_declaration_hint" },
  { key: "ce_report", label: "pd.upl.ce_report", hint: "adm.rules.certTest" },
  { key: "label_image", label: "pd.upl.label_image", hint: "adm.rules.certManufacturer" },
  { key: "warning_lang", label: "pd.site.warning_lang", hint: "pd.site.warning_lang_hint" },
];

// 文件上传项（存 uploads 规则）
const SITE_UPLOADS: { key: string; label: string; hint: string }[] = [
  { key: "cert_file", label: "pd.upl.cert_file", hint: "adm.rules.certSea" },
  { key: "eu_doc", label: "pd.upl.eu_doc", hint: "pd.upl.eu_doc_hint" },
  { key: "ce_declaration", label: "pd.upl.ce_declaration", hint: "pd.upl.ce_declaration_hint" },
  { key: "ce_report", label: "pd.upl.ce_report", hint: "pd.upl.ce_report_hint" },
  { key: "label_image", label: "pd.upl.label_image", hint: "pd.upl.label_image_hint" },
];

interface EditState {
  shop: ShopRow;
  rule: ShopListingRuleRow | null;
}

function ShopRules() {
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [rules, setRules] = useState<ShopListingRuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // 编辑草稿
  const [enabled, setEnabled] = useState(true);
  const [fieldCfg, setFieldCfg] = useState<Record<string, { visible: boolean; required: boolean; error_text: string }>>({});
  const [uploadCfg, setUploadCfg] = useState<Record<string, { enabled: boolean; required: boolean; error_text: string }>>({});

  const reload = async () => {
    setLoading(true);
    try {
      const [s, r] = await Promise.all([fetchShops(), fetchShopListingRules()]);
      setShops(s);
      setRules(r);
    } catch (e) {
      toast.error(tt('adm.rules.loadFailPrefix') + (e instanceof Error ? e.message : tt('common.unknownError')));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(); }, []);

  const ruleOf = (shopId: string) => rules.find((r) => r.shop_id === shopId) ?? null;

  const openEdit = (shop: ShopRow) => {
    const rule = ruleOf(shop.id);
    setEdit({ shop, rule });
    setEnabled(rule ? rule.enabled !== false : true);
    const fc: Record<string, { visible: boolean; required: boolean; error_text: string }> = {};
    for (const f of SITE_FIELDS) {
      const prev = rule?.fields?.[f.key];
      fc[f.key] = { visible: prev ? prev.visible !== false : true, required: prev?.required === true, error_text: prev?.error_text ?? "" };
    }
    setFieldCfg(fc);
    const uc: Record<string, { enabled: boolean; required: boolean; error_text: string }> = {};
    for (const u of SITE_UPLOADS) {
      const prev = rule?.uploads?.[u.key];
      uc[u.key] = { enabled: prev ? prev.enabled !== false : false, required: prev?.required === true, error_text: prev?.error_text ?? "" };
    }
    setUploadCfg(uc);
    setDialogOpen(true);
  };

  const saveRule = async () => {
    if (!edit) return;
    setSaving(true);
    try {
      const payload = {
        shop_id: edit.shop.id,
        region: edit.shop.region ?? "",
        enabled,
        fields: fieldCfg,
        uploads: uploadCfg,
      };
      if (edit.rule?.id) {
        await updateRow("shop_listing_rules", edit.rule.id, payload);
        toast.success(tt('adm.rules.updated'));
      } else {
        await insertRow("shop_listing_rules", payload);
        toast.success(tt('adm.rules.created'));
      }
      setDialogOpen(false);
      setEdit(null);
      await reload();
    } catch (e) {
      toast.error(tt('adm.rules.saveFailPrefix') + (e instanceof Error ? e.message : tt('common.unknownError')));
    } finally {
      setSaving(false);
    }
  };

  const removeRule = async (shop: ShopRow) => {
    const rule = ruleOf(shop.id);
    if (!rule?.id) return;
    try {
      await deleteRow("shop_listing_rules", rule.id);
      toast.success(tt('adm.rules.deleted'));
      await reload();
    } catch (e) {
      toast.error(tt('adm.rules.deleteFailPrefix') + (e instanceof Error ? e.message : tt('common.unknownError')));
    }
  };

  const enabledCount = useMemo(() => rules.filter((r) => r.enabled !== false).length, [rules]);
  const fieldCountOf = (shopId: string) => {
    const r = ruleOf(shopId);
    if (!r) return 0;
    return Object.values(r.fields ?? {}).filter((f: any) => f.required === true).length +
      Object.values(r.uploads ?? {}).filter((u: any) => u.required === true).length;
  };

  return (
    <div className="space-y-5 p-5">
      <PageHeader title={tt('admin.shopRules')} description={tt('adm.rules.desc')} />

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{tt('common.loading')}</div>
      ) : shops.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-muted-foreground">
          <Store size={32} className="mb-2 text-muted-foreground/40" />
          <p>{tt('adm.plat.noShops')}，{tt('adm.plat.goTo')}「{tt('adm.plat.shopMgmt')}」{tt('adm.plat.addShop')}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/50">
              <tr>
                <th className="px-4 py-3 font-medium text-muted-foreground">{tt('adm.plat.shopShort')}</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">{tt('adm.plat.siteCountry')}</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">{tt('adm.plat.enableStatus')}</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">{tt('adm.plat.requiredCount')}</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">{tt('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shops.map((shop) => {
                const rule = ruleOf(shop.id);
                return (
                  <tr key={shop.id} className="hover:bg-muted/60">
                    <td className="px-4 py-3 font-medium text-ink">{shop.name}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="gap-1"><Globe size={11} />{shop.region || shop.platform || "—"}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {rule ? (
                        <Badge className={cn("gap-1", rule.enabled !== false ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>
                          <Power size={11} />{rule.enabled !== false ? tt('adm.rules.enabled') : tt('adm.rules.disabled')}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-warning">{tt('adm.plat.notConfigured')}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 font-data">{fieldCountOf(shop.id)}{tt("common.items")}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => openEdit(shop)}>
                          <Settings2 size={13} className="mr-1" />{rule ? tt('adm.rules.edit') : tt('adm.rules.configure')}
                        </Button>
                        {rule?.id && (
                          <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive hover:bg-danger-bg" onClick={() => void removeRule(shop)}>
                            <Trash2 size={13} className="mr-1" />{tt('adm.plat.clear')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            {tt('adm.rules.stats', { shops: shops.length, enabled: enabledCount })}
          </div>
        </div>
      )}

      {/* 编辑规则弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) setDialogOpen(false); }}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Store size={16} className="text-primary" />
              {edit?.shop.name} · {tt("adm.rules.listingCfg")}
              {edit?.shop.region && <Badge variant="outline" className="gap-1"><Globe size={11} />{edit.shop.region}</Badge>}
            </DialogTitle>
            <DialogDescription>{tt('adm.plat.autoApplyHint')}、{tt('adm.plat.requiredHints')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {/* 启用 */}
            <div className="flex items-center justify-between rounded-xl border border-border bg-muted/30 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-ink">{tt('adm.plat.enableRule')}</p>
                <p className="text-xs text-muted-foreground">{tt('adm.rule.offHint1')}「{tt('adm.plat.notConfigured')}」{tt('adm.rule.offHint2')}</p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>

            {/* 字段 */}
            <div>
              <p className="mb-2 text-sm font-semibold text-ink">{tt('adm.rule.fieldVisReq')}</p>
              <div className="space-y-2">
                {SITE_FIELDS.map((f) => {
                  const cfg = fieldCfg[f.key];
                  if (!cfg) return null;
                  return (
                    <div key={f.key} className="rounded-xl border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-ink">{f.label}</p>
                          <p className="text-xs text-muted-foreground">{f.hint}</p>
                        </div>
                        <div className="flex items-center gap-4">
                          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            {tt("common.show")}<Switch checked={cfg.visible} onCheckedChange={(v) => setFieldCfg({ ...fieldCfg, [f.key]: { ...cfg, visible: v } })} />
                          </label>
                          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            {tt("common.required")}<Switch checked={cfg.required} onCheckedChange={(v) => setFieldCfg({ ...fieldCfg, [f.key]: { ...cfg, required: v } })} />
                          </label>
                        </div>
                      </div>
                      <input
                        value={cfg.error_text}
                        onChange={(e) => setFieldCfg({ ...fieldCfg, [f.key]: { ...cfg, error_text: e.target.value } })}
                        placeholder={tt('adm.rules.errRequiredPh')}
                        className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary"
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 文件上传项 */}
            <div>
              <p className="mb-2 text-sm font-semibold text-ink">{tt('adm.rule.fileUploadFields')}</p>
              <div className="space-y-2">
                {SITE_UPLOADS.map((u) => {
                  const cfg = uploadCfg[u.key];
                  if (!cfg) return null;
                  return (
                    <div key={u.key} className="rounded-xl border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-ink">{u.label}</p>
                          <p className="text-xs text-muted-foreground">{u.hint}</p>
                        </div>
                        <div className="flex items-center gap-4">
                          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            {tt("common.on")}<Switch checked={cfg.enabled} onCheckedChange={(v) => setUploadCfg({ ...uploadCfg, [u.key]: { ...cfg, enabled: v } })} />
                          </label>
                          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            {tt("common.required")}<Switch checked={cfg.required} onCheckedChange={(v) => setUploadCfg({ ...uploadCfg, [u.key]: { ...cfg, required: v } })} />
                          </label>
                        </div>
                      </div>
                      <input
                        value={cfg.error_text}
                        onChange={(e) => setUploadCfg({ ...uploadCfg, [u.key]: { ...cfg, error_text: e.target.value } })}
                        placeholder={tt('adm.rules.errUploadPh')}
                        className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>{tt('common.cancel')}</Button>
            <Button size="sm" onClick={() => void saveRule()} disabled={saving}>
              {saving ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Plus size={14} className="mr-1.5" />}
              {tt("adm.rules.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
