// Tab C「货代仓」：forwarder_warehouses CRUD
// code 是对外推单接口契约字段（必须与对方系统仓库代码字面一致），UI 显式标注并禁止静默改值。
import { useState } from "react";
import { Loader2, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { tt } from "@/i18n/tts";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { deleteRow, insertRow, queryTable, updateRow, type TableFilter } from "@/lib/data-access";
import {
  CAPABILITY_OPTIONS, Chip, ChipMulti, EmptyRow, EnumBadge, ErrorRow, LoadingRow, Panel, Sel, SITE_OPTIONS,
  WH_STATUS_META, Th, Td, fmtTs, mapWarehouse, optionLabel, toOptions, useAsyncData, useForwarderOptions,
  type Warehouse,
} from "./common";

const STATUS_OPTIONS = toOptions(WH_STATUS_META);

type Form = {
  forwarder_id: string; code: string; external_warehouse_id: string; name: string;
  country: string; province: string; city: string; address: string; contact: string; phone: string;
  capabilities: string[]; platform_sites: string[]; promise: string; distance_to_official: string;
  status: string; is_default: boolean;
};
const blank: Form = {
  forwarder_id: "", code: "", external_warehouse_id: "", name: "",
  country: "CN", province: "", city: "", address: "", contact: "", phone: "",
  capabilities: [], platform_sites: [], promise: "", distance_to_official: "",
  status: "active", is_default: false,
};

const toForm = (w: Warehouse): Form => ({
  forwarder_id: w.forwarder_id, code: w.code, external_warehouse_id: w.external_warehouse_id, name: w.name,
  country: w.country || "CN", province: w.province, city: w.city, address: w.address,
  contact: w.contact, phone: w.phone, capabilities: w.capabilities, platform_sites: w.platform_sites,
  promise: w.promise, distance_to_official: w.distance_to_official,
  status: STATUS_OPTIONS.some((o) => o.code === w.status) ? w.status : "active",
  is_default: w.is_default,
});

export function WarehousePanel() {
  const { forwarders } = useForwarderOptions();
  const [fForwarder, setFForwarder] = useState("");
  const [fStatus, setFStatus] = useState("");

  const nameMap = new Map(forwarders.map((f) => [f.id, f.name]));

  const { data, loading, error, reload } = useAsyncData<Warehouse[]>(
    async () => {
      // 下推：货代 + 仓库状态都是数据库查询参数（forwarder_warehouses.user_id 由 RLS 兜底）
      const fs: TableFilter[] = [];
      if (fForwarder) fs.push({ field: "forwarder_id", value: fForwarder });
      if (fStatus) fs.push({ field: "status", value: fStatus });
      const rows = await queryTable("forwarder_warehouses", {
        filters: fs.length ? fs : undefined,
        // 默认仓优先 + 仓库编码升序：TableQuery.order 支持多列后交给 DB，
        // 不再前端 .sort()（前端排序只会排当前页，跨页就错）
        order: [
          { field: "is_default", ascending: false },
          { field: "code", ascending: true },
        ],
      });
      return rows.rows.map(mapWarehouse);
    },
    [fForwarder, fStatus, forwarders.length],
    [],
  );

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Warehouse | null>(null);
  const set = (patch: Partial<Form>) => setForm((p) => ({ ...p, ...patch }));

  const openAdd = () => {
    setEditing(null);
    setForm({ ...blank, forwarder_id: fForwarder || forwarders[0]?.id || "" });
    setOpen(true);
  };
  const openEdit = (w: Warehouse) => {
    setEditing(w);
    setForm(toForm(w));
    setOpen(true);
  };

  const save = async () => {
    if (!form.forwarder_id) {
      toast.error(tt("fw.msg.needForwarder"));
      return;
    }
    if (!form.code.trim()) {
      toast.error(tt("fw.msg.needCode"));
      return;
    }
    if (!form.name.trim()) {
      toast.error(tt("fw.msg.needWhName"));
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        forwarder_id: form.forwarder_id,
        code: form.code.trim(),
        external_warehouse_id: form.external_warehouse_id.trim() || null,
        name: form.name.trim(),
        country: form.country.trim() || "CN",
        province: form.province.trim(),
        city: form.city.trim(),
        address: form.address.trim(),
        contact: form.contact.trim(),
        phone: form.phone.trim(),
        capabilities: form.capabilities,
        platform_sites: form.platform_sites,
        promise: form.promise.trim(),
        distance_to_official: form.distance_to_official.trim(),
        status: form.status,
        is_default: form.is_default,
      };
      if (editing) {
        await updateRow("forwarder_warehouses", editing.id, payload);
        toast.success(tt("fw.msg.updated"));
      } else {
        await insertRow("forwarder_warehouses", payload);
        toast.success(tt("fw.msg.created"));
      }
      // 设为默认时，同货代其余仓库取消默认（同货代内唯一默认仓）
      if (form.is_default) {
        const others = data.filter((w) => w.forwarder_id === form.forwarder_id && w.is_default && w.id !== editing?.id);
        for (const w of others) {
          try {
            await updateRow("forwarder_warehouses", w.id, { is_default: false });
          } catch (e) {
            toast.error(e instanceof Error ? e.message : tt("fw.msg.actionFail"));
          }
        }
      }
      setOpen(false);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tt("fw.msg.saveFail"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    try {
      await deleteRow("forwarder_warehouses", target.id);
      toast.success(tt("fw.msg.deleted"));
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tt("fw.msg.deleteFail"));
    }
  };

  const colCount = 9;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-border bg-card px-4 py-3">
        <Sel value={fForwarder} onChange={setFForwarder}>
          <option value="">{tt("fw.filt.allForwarders")}</option>
          {forwarders.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </Sel>
        <Sel value={fStatus} onChange={setFStatus}>
          <option value="">{tt("fw.filt.allWhStatus")}</option>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.code} value={o.code}>{tt(o.key)}</option>
          ))}
        </Sel>
        <span className="ml-auto text-xs text-muted-foreground">{tt("fw.ui.rowCount", { n: data.length })}</span>
        <Button size="sm" onClick={openAdd} disabled={forwarders.length === 0}>
          <Plus size={15} className="mr-1.5" />
          {tt("fw.act.newWarehouse")}
        </Button>
      </div>

      <Panel title={tt("fw.panel.whList")} meta={<span>{tt("fw.hint.codeContract")}</span>}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <Th className="w-[15%]">{tt("fw.col.code")}</Th>
              <Th>{tt("fw.col.forwarder")}</Th>
              <Th>{tt("fw.col.name")}</Th>
              <Th>{tt("fw.col.location")}</Th>
              <Th>{tt("fw.col.capabilities")}</Th>
              <Th>{tt("fw.col.status")}</Th>
              <Th>{tt("fw.col.distanceToOfficial")}</Th>
              <Th>{tt("fw.col.syncedAt")}</Th>
              <Th className="text-right">{tt("fw.col.actions")}</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <LoadingRow colSpan={colCount} />
            ) : error ? (
              <ErrorRow colSpan={colCount} message={error} onRetry={reload} />
            ) : data.length === 0 ? (
              <EmptyRow
                colSpan={colCount}
                text={tt("fw.empty.warehouses")}
                hint={forwarders.length === 0 ? tt("fw.empty.whNoFw") : tt("fw.empty.warehousesHint")}
                action={
                  forwarders.length === 0 ? undefined : (
                    <Button size="sm" onClick={openAdd}>
                      <Plus size={14} className="mr-1" />
                      {tt("fw.act.newWarehouse")}
                    </Button>
                  )
                }
              />
            ) : (
              data.map((w) => (
                <tr key={w.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/60">
                  <Td className="align-top">
                    <div className="flex items-center gap-1.5">
                      <span className="font-data text-[12.5px] font-medium text-ink">{w.code || "—"}</span>
                      {w.is_default ? <Star size={12} className="fill-current text-cargo-gold" /> : null}
                    </div>
                    {w.external_warehouse_id ? (
                      <div className="mt-0.5 text-[10.5px] text-muted-foreground">{w.external_warehouse_id}</div>
                    ) : null}
                  </Td>
                  <Td className="text-muted-foreground">{nameMap.get(w.forwarder_id) ?? tt("fw.tag.deletedForwarder")}</Td>
                  <Td className="text-muted-foreground">
                    {w.name}
                    {w.contact || w.phone ? (
                      <div className="mt-0.5 text-[10.5px]">{[w.contact, w.phone].filter(Boolean).join(" · ")}</div>
                    ) : null}
                  </Td>
                  <Td className="text-muted-foreground">
                    {[w.country, w.province, w.city].filter(Boolean).join(" / ") || "—"}
                    {w.address ? <div className="mt-0.5 text-[10.5px]">{w.address}</div> : null}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {w.capabilities.length ? (
                        w.capabilities.slice(0, 4).map((c) => (
                          <Chip key={c} tone="info">{optionLabel(CAPABILITY_OPTIONS, c)}</Chip>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                    {w.platform_sites.length ? (
                      <div className="mt-1 flex flex-wrap gap-x-2 text-[10.5px] text-muted-foreground">
                        {w.platform_sites.map((s) => (
                          <span key={s}>{optionLabel(SITE_OPTIONS, s)}</span>
                        ))}
                      </div>
                    ) : null}
                  </Td>
                  <Td>
                    <EnumBadge value={w.status} meta={WH_STATUS_META} />
                  </Td>
                  <Td className="text-muted-foreground">{w.distance_to_official || "—"}</Td>
                  <Td className="text-muted-foreground">{w.synced_at ? fmtTs(w.synced_at) : "—"}</Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(w)}>
                        <Pencil size={15} />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDeleting(w)}>
                        <Trash2 size={15} className="text-destructive" />
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Panel>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? tt("fw.act.editWarehouse") : tt("fw.act.newWarehouse")}</DialogTitle>
            <DialogDescription>{tt("fw.dialog.whDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>
                  {tt("fw.col.forwarder")}
                  <span className="text-destructive">*</span>
                </Label>
                <Sel value={form.forwarder_id} onChange={(v) => set({ forwarder_id: v })} className="w-full">
                  <option value="">{tt("fw.filt.pickForwarder")}</option>
                  {forwarders.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </Sel>
              </div>
              <div className="grid gap-1.5">
                <Label>{tt("fw.col.name")}</Label>
                <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder={tt("fw.ph.whName")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>
                  {tt("fw.col.code")}
                  <span className="text-destructive">*</span>
                </Label>
                <Input value={form.code} onChange={(e) => set({ code: e.target.value })} placeholder={tt("fw.ph.code")} />
                <p className="rounded-md bg-warning-bg/60 px-2 py-1.5 text-[11px] leading-4 text-warning">
                  {tt("fw.hint.codeContractFull")}
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label>{tt("fw.col.externalWarehouseId")}</Label>
                <Input
                  value={form.external_warehouse_id}
                  onChange={(e) => set({ external_warehouse_id: e.target.value })}
                  placeholder={tt("fw.ph.optional")}
                />
                <p className="text-[11px] text-muted-foreground">{tt("fw.hint.externalId")}</p>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-4">
              <div className="grid gap-1.5">
                <Label>{tt("fw.col.country")}</Label>
                <Input value={form.country} onChange={(e) => set({ country: e.target.value })} placeholder="CN" />
              </div>
              <div className="grid gap-1.5">
                <Label>{tt("fw.col.province")}</Label>
                <Input value={form.province} onChange={(e) => set({ province: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>{tt("fw.col.city")}</Label>
                <Input value={form.city} onChange={(e) => set({ city: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>{tt("fw.col.distanceToOfficial")}</Label>
                <Input
                  value={form.distance_to_official}
                  onChange={(e) => set({ distance_to_official: e.target.value })}
                  placeholder={tt("fw.ph.distance")}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>{tt("fw.col.address")}</Label>
              <Input value={form.address} onChange={(e) => set({ address: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>{tt("fw.col.contact")}</Label>
                <Input value={form.contact} onChange={(e) => set({ contact: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>{tt("fw.col.phone")}</Label>
                <Input value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>{tt("fw.col.capabilities")}</Label>
              <ChipMulti options={CAPABILITY_OPTIONS} value={form.capabilities} onChange={(v) => set({ capabilities: v })} />
            </div>
            <div className="grid gap-1.5">
              <Label>{tt("fw.col.platformSites")}</Label>
              <ChipMulti options={SITE_OPTIONS} value={form.platform_sites} onChange={(v) => set({ platform_sites: v })} />
            </div>
            <div className="grid gap-1.5">
              <Label>{tt("fw.col.promise")}</Label>
              <Textarea rows={2} value={form.promise} onChange={(e) => set({ promise: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>{tt("fw.col.status")}</Label>
                <Sel value={form.status} onChange={(v) => set({ status: v })} className="w-full">
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.code} value={o.code}>{tt(o.key)}</option>
                  ))}
                </Sel>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                <div>
                  <div className="text-sm font-medium text-ink">{tt("fw.col.defaultWarehouse")}</div>
                  <div className="text-[11px] text-muted-foreground">{tt("fw.hint.defaultWh")}</div>
                </div>
                <Switch checked={form.is_default} onCheckedChange={(v) => set({ is_default: !!v })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tt("fw.act.cancel")}
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
              {tt("fw.act.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tt("fw.confirm.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{tt("fw.confirm.deleteWhDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tt("fw.act.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-destructive hover:bg-destructive">
              {tt("fw.act.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
