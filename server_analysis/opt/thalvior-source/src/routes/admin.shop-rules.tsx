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

export const Route = createFileRoute("/admin/shop-rules")({
  component: ShopRules,
});

// 站点专属字段（key 与编辑页 SITE_FIELDS / shop_listing_rules.fields 一一对应）
const SITE_FIELDS: { key: string; label: string; hint: string }[] = [
  { key: "site_title", label: "当地语言标题", hint: "该店铺站点使用的当地语言商品标题" },
  { key: "site_bullets", label: "当地语言卖点", hint: "每行一条卖点" },
  { key: "site_description", label: "当地语言详情", hint: "该店铺站点的详细描述（当地语言）" },
  { key: "site_price", label: "站点售价", hint: "该店铺站点的实际售价（当地货币）" },
  { key: "site_stock", label: "站点库存", hint: "该店铺站点的可售库存数量" },
  { key: "fulfill_time", label: "备货时效", hint: "如：现货 24h / 7-15 天备货" },
  { key: "shipping_template", label: "运费模板", hint: "选择该店铺绑定的运费模板" },
  { key: "ean", label: "EAN-13 条码", hint: "SKU 表格中的 EAN-13 列（欧盟店必填）" },
  { key: "ptc", label: "PTC 商品税务编码", hint: "欧盟商品税务编码" },
  { key: "manufacturer", label: "制造商信息", hint: "制造商名称与地址" },
  { key: "eu_responsible", label: "欧盟责任人（欧代）", hint: "名称 / 地址 / 邮箱" },
  { key: "eu_doc", label: "欧代授权文件", hint: "欧盟代表授权书" },
  { key: "ce_declaration", label: "CE 符合性声明", hint: "CE 声明文件" },
  { key: "ce_report", label: "产品检测报告", hint: "检测报告（EN/IEC 等）" },
  { key: "label_image", label: "产品标签图", hint: "含制造商/进口商信息" },
  { key: "warning_lang", label: "对应语言警示语", hint: "当地语言的安全警示语" },
];

// 文件上传项（存 uploads 规则）
const SITE_UPLOADS: { key: string; label: string; hint: string }[] = [
  { key: "cert_file", label: "本地证书（TISI/SIRIM）", hint: "东南亚店铺本地认证证书" },
  { key: "eu_doc", label: "欧代授权文件", hint: "欧盟代表授权书" },
  { key: "ce_declaration", label: "CE 符合性声明", hint: "CE 声明文件" },
  { key: "ce_report", label: "产品检测报告", hint: "检测报告文件" },
  { key: "label_image", label: "产品标签图", hint: "标签图片" },
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
      toast.error("加载失败：" + (e instanceof Error ? e.message : "未知错误"));
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
        toast.success("规则已更新");
      } else {
        await insertRow("shop_listing_rules", payload);
        toast.success("规则已创建");
      }
      setDialogOpen(false);
      setEdit(null);
      await reload();
    } catch (e) {
      toast.error("保存失败：" + (e instanceof Error ? e.message : "未知错误"));
    } finally {
      setSaving(false);
    }
  };

  const removeRule = async (shop: ShopRow) => {
    const rule = ruleOf(shop.id);
    if (!rule?.id) return;
    try {
      await deleteRow("shop_listing_rules", rule.id);
      toast.success("规则已删除（店铺恢复默认显示）");
      await reload();
    } catch (e) {
      toast.error("删除失败：" + (e instanceof Error ? e.message : "未知错误"));
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
      <PageHeader title="店铺规则配置" description="为每家绑定店铺配置刊登字段显隐/必填与文件上传，统一刊登编辑页选中店铺后自动套用" />

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />加载中...</div>
      ) : shops.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-muted-foreground">
          <Store size={32} className="mb-2 text-muted-foreground/40" />
          <p>暂无绑定店铺，请先到「店铺管理」添加店铺</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/50">
              <tr>
                <th className="px-4 py-3 font-medium text-muted-foreground">店铺</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">站点国家</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">启用状态</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">必填项数</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shops.map((shop) => {
                const rule = ruleOf(shop.id);
                return (
                  <tr key={shop.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium text-ink">{shop.name}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="gap-1"><Globe size={11} />{shop.region || shop.platform || "—"}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {rule ? (
                        <Badge className={cn("gap-1", rule.enabled !== false ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground")}>
                          <Power size={11} />{rule.enabled !== false ? "已启用" : "已停用"}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-amber-600">未配置</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 font-data">{fieldCountOf(shop.id)} 项</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => openEdit(shop)}>
                          <Settings2 size={13} className="mr-1" />{rule ? "编辑规则" : "配置规则"}
                        </Button>
                        {rule?.id && (
                          <Button size="sm" variant="ghost" className="h-8 text-xs text-rose-500 hover:bg-rose-50" onClick={() => void removeRule(shop)}>
                            <Trash2 size={13} className="mr-1" />清除
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
            共 {shops.length} 家店铺 · 已启用规则 {enabledCount} 家 · 未配置规则的店铺在编辑页默认显示全部站点字段（不强制必填）
          </div>
        </div>
      )}

      {/* 编辑规则弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) setDialogOpen(false); }}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Store size={16} className="text-primary" />
              {edit?.shop.name} · 刊登规则配置
              {edit?.shop.region && <Badge variant="outline" className="gap-1"><Globe size={11} />{edit.shop.region}</Badge>}
            </DialogTitle>
            <DialogDescription>配置后统一刊登编辑页选中该店铺会自动套用显隐、必填与报错提示</DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {/* 启用 */}
            <div className="flex items-center justify-between rounded-xl border border-border bg-muted/30 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-ink">启用该店铺规则</p>
                <p className="text-xs text-muted-foreground">停用后编辑页将按「未配置」处理（字段默认全部显示）</p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>

            {/* 字段 */}
            <div>
              <p className="mb-2 text-sm font-semibold text-ink">字段显隐与必填</p>
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
                            显示<Switch checked={cfg.visible} onCheckedChange={(v) => setFieldCfg({ ...fieldCfg, [f.key]: { ...cfg, visible: v } })} />
                          </label>
                          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            必填<Switch checked={cfg.required} onCheckedChange={(v) => setFieldCfg({ ...fieldCfg, [f.key]: { ...cfg, required: v } })} />
                          </label>
                        </div>
                      </div>
                      <input
                        value={cfg.error_text}
                        onChange={(e) => setFieldCfg({ ...fieldCfg, [f.key]: { ...cfg, error_text: e.target.value } })}
                        placeholder="报错提示（默认：该字段为必填项）"
                        className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary"
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 文件上传项 */}
            <div>
              <p className="mb-2 text-sm font-semibold text-ink">文件上传项</p>
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
                            开启<Switch checked={cfg.enabled} onCheckedChange={(v) => setUploadCfg({ ...uploadCfg, [u.key]: { ...cfg, enabled: v } })} />
                          </label>
                          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            必填<Switch checked={cfg.required} onCheckedChange={(v) => setUploadCfg({ ...uploadCfg, [u.key]: { ...cfg, required: v } })} />
                          </label>
                        </div>
                      </div>
                      <input
                        value={cfg.error_text}
                        onChange={(e) => setUploadCfg({ ...uploadCfg, [u.key]: { ...cfg, error_text: e.target.value } })}
                        placeholder="报错提示（默认：请上传该文件）"
                        className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button size="sm" onClick={() => void saveRule()} disabled={saving}>
              {saving ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Plus size={14} className="mr-1.5" />}
              保存规则
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
