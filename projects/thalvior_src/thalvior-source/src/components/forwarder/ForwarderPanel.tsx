// Tab A「我的货代」：freight_forwarders CRUD + v_forwarder_readiness 就绪度
// 筛选四维全部下推为数据库查询条件：
//   · 平台 / 站点 / 服务（text[]）→ overlaps '{code}'；城市 → eq；软删标记 → eq is_deleted
//   · 租户隔离：v_forwarder_readiness 不是 security_barrier 视图，必须显式带 session user_id 过滤
//   · 排序 name 升序、分页 range + count exact 都由服务端完成，前端不再全量拉取后过滤/切片
import { useState } from "react";
import { Loader2, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { fetchTable, insertRow, queryTable, updateRow, type TableFilter } from "@/lib/data-access";
import {
  AUTH_STATE_META, AVAIL_STATE_META, Chip, ChipMulti, EmptyRow, EnumBadge, ErrorRow,
  FORWARDER_STATUSES, FORWARDER_STATUS_META, LoadingRow, PACKING_FLOW_META, Pager, Panel,
  PLATFORM_OPTIONS, PROTOCOL_META, Sel, SERVICE_OPTIONS, SITE_OPTIONS, SOURCE_META,
  Td, Th, currentUserId, mapForwarder, mapReadiness, optionLabel, pgArray, readinessItems, toOptions, useAsyncData,
  type Forwarder, type Readiness, type ReadinessMap,
} from "./common";

const STATUS_OPTIONS = toOptions(FORWARDER_STATUS_META);
const SOURCE_OPTIONS = toOptions(SOURCE_META);
const FLOW_OPTIONS = toOptions(PACKING_FLOW_META);
const PROTOCOL_OPTIONS = toOptions(PROTOCOL_META);

type Filters = { platform: string; site: string; city: string; service: string; deleted: string };
const emptyFilters: Filters = { platform: "", site: "", city: "", service: "", deleted: "" };

const PAGE_SIZE = 20;

type Data = { rows: Forwarder[]; rd: ReadinessMap; cities: string[]; total: number };
const emptyData: Data = { rows: [], rd: new Map(), cities: [], total: 0 };

type FormData = {
  name: string; code: string; contact: string; phone: string; wechat: string;
  province: string; city: string; status: string; packing_flow: string; sla_hours: string;
  platforms: string[]; sites: string[]; services: string[]; tags: string; intro: string; remark: string;
};
const blankForm: FormData = {
  name: "", code: "", contact: "", phone: "", wechat: "", province: "", city: "",
  status: "active", packing_flow: "simple", sla_hours: "",
  platforms: [], sites: [], services: [], tags: "", intro: "", remark: "",
};

// code 为外部契约码（租户内唯一、创建后不可变），故编辑态只读回显不提交
function toForm(f: Forwarder): FormData {
  return {
    name: f.name, code: f.code, contact: f.contact, phone: f.phone, wechat: f.wechat,
    province: f.province, city: f.city,
    status: FORWARDER_STATUSES.includes(f.status) ? f.status : "active",
    packing_flow: f.packing_flow === "task_based" ? "task_based" : "simple",
    sla_hours: f.sla_hours ? String(f.sla_hours) : "",
    platforms: f.platforms, sites: f.sites, services: f.services,
    tags: f.tags.join(", "), intro: f.intro, remark: f.remark,
  };
}

const authOf = (f: Forwarder, rd?: Readiness) => rd?.auth_state_real || f.auth_state;
const availOf = (f: Forwarder, rd?: Readiness) => rd?.available_state || f.available_state;

export function ForwarderPanel() {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Forwarder | null>(null);
  const [form, setForm] = useState<FormData>(blankForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Forwarder | null>(null);

  const setF = (patch: Partial<Filters>) => {
    setFilters((p) => ({ ...p, ...patch }));
    setPage(1);
  };

  const { data, loading, error, reload } = useAsyncData<Data>(
    async () => {
      const uid = await currentUserId();
      const fs: TableFilter[] = [
        { field: "is_deleted", value: filters.deleted === "1" ? "true" : "false" },
      ];
      if (filters.city) fs.push({ field: "city", value: filters.city });
      if (filters.platform) fs.push({ field: "platforms", value: pgArray([filters.platform]), op: "overlaps" });
      if (filters.site) fs.push({ field: "sites", value: pgArray([filters.site]), op: "overlaps" });
      if (filters.service) fs.push({ field: "services", value: pgArray([filters.service]), op: "overlaps" });
      const from = (page - 1) * PAGE_SIZE;
      const [res, view] = await Promise.all([
        queryTable("freight_forwarders", {
          filters: fs,
          order: { field: "name", ascending: true },
          range: { from, to: from + PAGE_SIZE - 1 },
          count: "exact",
        }),
        uid ? fetchTable("v_forwarder_readiness", { field: "user_id", value: uid }) : Promise.resolve([]),
      ]);
      const rd = new Map<string, Readiness>();
      const cities = new Set<string>();
      view.forEach((v) => {
        const r = mapReadiness(v);
        if (r.forwarder_id) rd.set(r.forwarder_id, r);
        if (r.city) cities.add(r.city);
      });
      return {
        rows: res.rows.map(mapForwarder),
        rd,
        cities: Array.from(cities).sort((a, b) => a.localeCompare(b)),
        total: res.count ?? res.rows.length,
      };
    },
    [filters, page],
    emptyData,
  );

  const pageCount = Math.max(1, Math.ceil(Math.max(data.total, data.rows.length) / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);

  const set = (patch: Partial<FormData>) => setForm((prev) => ({ ...prev, ...patch }));
  const openAdd = () => {
    setEditing(null);
    setForm({ ...blankForm, city: filters.city });
    setOpen(true);
  };
  const openEdit = (f: Forwarder) => {
    setEditing(f);
    setForm(toForm(f));
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error(tt("fw.msg.needName"));
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        contact: form.contact.trim(),
        phone: form.phone.trim(),
        wechat: form.wechat.trim(),
        province: form.province.trim(),
        city: form.city.trim(),
        status: form.status,
        packing_flow: form.packing_flow,
        platforms: form.platforms,
        sites: form.sites,
        services: form.services,
        tags: form.tags.split(",").map((x) => x.trim()).filter(Boolean),
        intro: form.intro.trim(),
        remark: form.remark.trim(),
        sla_hours: form.sla_hours.trim() ? Number(form.sla_hours) : null,
      };
      if (editing) {
        await updateRow("freight_forwarders", editing.id, payload);
        toast.success(tt("fw.msg.updated"));
      } else {
        if (form.code.trim()) payload.code = form.code.trim();
        payload.source = "manual";
        await insertRow("freight_forwarders", payload);
        toast.success(tt("fw.msg.created"));
      }
      setOpen(false);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tt("fw.msg.saveFail"));
    } finally {
      setSaving(false);
    }
  };

  const toggleArchived = async () => {
    if (!deleting) return;
    const target = deleting;
    const restore = target.is_deleted;
    setDeleting(null);
    try {
      await updateRow("freight_forwarders", target.id, { is_deleted: !restore });
      toast.success(restore ? tt("fw.msg.restored") : tt("fw.msg.archived"));
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tt("fw.msg.deleteFail"));
    }
  };

  const activeDims = [filters.platform, filters.site, filters.city, filters.service].filter(Boolean).length;
  const colCount = 10;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-border bg-card px-4 py-3">
        <Sel value={filters.platform} onChange={(v) => setF({ platform: v })}>
          <option value="">{tt("fw.filt.allPlatforms")}</option>
          {PLATFORM_OPTIONS.map((o) => (
            <option key={o.code} value={o.code}>{tt(o.key)}</option>
          ))}
        </Sel>
        <Sel value={filters.site} onChange={(v) => setF({ site: v })}>
          <option value="">{tt("fw.filt.allSites")}</option>
          {SITE_OPTIONS.map((o) => (
            <option key={o.code} value={o.code}>{tt(o.key)}</option>
          ))}
        </Sel>
        <Sel value={filters.city} onChange={(v) => setF({ city: v })}>
          <option value="">{tt("fw.filt.allCities")}</option>
          {data.cities.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Sel>
        <Sel value={filters.service} onChange={(v) => setF({ service: v })}>
          <option value="">{tt("fw.filt.allServices")}</option>
          {SERVICE_OPTIONS.map((o) => (
            <option key={o.code} value={o.code}>{tt(o.key)}</option>
          ))}
        </Sel>
        <Sel value={filters.deleted} onChange={(v) => setF({ deleted: v })}>
          <option value="">{tt("fw.filt.onlyActive")}</option>
          <option value="1">{tt("fw.filt.onlyArchived")}</option>
        </Sel>
        {activeDims > 0 || filters.deleted ? (
          <Button size="sm" variant="ghost" onClick={() => setF(emptyFilters)}>
            <RotateCcw size={14} className="mr-1" />
            {tt("fw.filt.reset")}
          </Button>
        ) : null}
        <span className="ml-auto text-xs text-muted-foreground">{tt("fw.ui.rowCount", { n: data.total })}</span>
      </div>

      <Panel
        title={tt("fw.panel.myList")}
        actions={
          <Button size="sm" onClick={openAdd}>
            <Plus size={15} className="mr-1.5" />
            {tt("fw.act.newForwarder")}
          </Button>
        }
      >
        <table className="w-full min-w-[920px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <Th className="w-[17%]">{tt("fw.col.name")}</Th>
              <Th>{tt("fw.col.contact")}</Th>
              <Th>{tt("fw.col.city")}</Th>
              <Th className="w-[18%]">{tt("fw.col.services")}</Th>
              <Th>{tt("fw.col.authState")}</Th>
              <Th>{tt("fw.col.availState")}</Th>
              <Th className="text-right">{tt("fw.col.warehouses")}</Th>
              <Th className="text-right">{tt("fw.col.channels")}</Th>
              <Th>{tt("fw.col.readiness")}</Th>
              <Th className="text-right">{tt("fw.col.actions")}</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <LoadingRow colSpan={colCount} />
            ) : error ? (
              <ErrorRow colSpan={colCount} message={error} onRetry={reload} />
            ) : data.rows.length === 0 ? (
              <EmptyRow
                colSpan={colCount}
                text={tt("fw.empty.forwarders")}
                hint={activeDims > 0 ? tt("fw.empty.filterHint") : tt("fw.empty.forwardersHint")}
                action={
                  activeDims > 0 ? (
                    <Button size="sm" variant="outline" onClick={() => setFilters(emptyFilters)}>
                      {tt("fw.filt.reset")}
                    </Button>
                  ) : (
                    <Button size="sm" onClick={openAdd}>
                      <Plus size={14} className="mr-1" />
                      {tt("fw.act.newForwarder")}
                    </Button>
                  )
                }
              />
            ) : (
              data.rows.map((f) => {
                const rd = data.rd.get(f.id);
                const items = readinessItems(f, rd);
                const score = items.filter((i) => i.ok).length;
                // 冗余列与权威值不一致时给出提示（授权列是 forwarder_auths 的镜像，可能滞后）
                const drift = !!rd?.auth_state_real && rd.auth_state_real !== rd.auth_state_mirror;
                return (
                  <tr key={f.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/60">
                    <Td className="align-top">
                      <div className="font-medium text-ink">{f.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                        {f.code ? <span className="font-data">{f.code}</span> : null}
                        <Chip>{optionLabel(SOURCE_OPTIONS, f.source)}</Chip>
                        {f.is_deleted ? <Chip tone="bad">{tt("fw.tag.archived")}</Chip> : null}
                      </div>
                    </Td>
                    <Td className="text-muted-foreground">
                      {f.contact || "—"}
                      {f.phone || f.wechat ? (
                        <div className="mt-0.5 text-[11px]">{[f.phone, f.wechat].filter(Boolean).join(" · ")}</div>
                      ) : null}
                    </Td>
                    <Td className="text-muted-foreground">{[f.province, f.city].filter(Boolean).join(" / ") || "—"}</Td>
                    <Td className="text-muted-foreground">
                      <div className="flex flex-wrap gap-1">
                        {f.services.length ? (
                          f.services.slice(0, 3).map((x) => (
                            <Chip key={x} tone="info">{optionLabel(SERVICE_OPTIONS, x)}</Chip>
                          ))
                        ) : (
                          <span>—</span>
                        )}
                        {f.services.length > 3 ? <Chip>+{f.services.length - 3}</Chip> : null}
                      </div>
                      {f.platforms.length || f.sites.length ? (
                        <div className="mt-1 flex flex-wrap gap-x-2 text-[10.5px]">
                          {f.platforms.slice(0, 4).map((x) => (
                            <span key={x}>{optionLabel(PLATFORM_OPTIONS, x)}</span>
                          ))}
                          {f.sites.slice(0, 3).map((x) => (
                            <span key={x}>{optionLabel(SITE_OPTIONS, x)}</span>
                          ))}
                        </div>
                      ) : null}
                    </Td>
                    <Td className="text-muted-foreground">
                      <EnumBadge value={authOf(f, rd)} meta={AUTH_STATE_META} />
                      {rd?.protocol ? (
                        <div className="mt-1 text-[10.5px]">{optionLabel(PROTOCOL_OPTIONS, rd.protocol)}</div>
                      ) : null}
                      {drift ? <div className="mt-1 text-[10.5px] text-warning">{tt("fw.hint.mirrorDrift")}</div> : null}
                    </Td>
                    <Td className="text-muted-foreground">
                      <EnumBadge value={availOf(f, rd)} meta={AVAIL_STATE_META} />
                      {rd?.unavailable_reason ? (
                        <div className="mt-1 max-w-[150px] text-[10.5px] text-destructive">{rd.unavailable_reason}</div>
                      ) : null}
                    </Td>
                    <Td className="text-right font-data tabular-nums">{rd ? rd.warehouse_count : "—"}</Td>
                    <Td className="text-right font-data tabular-nums">{rd ? rd.channel_count : "—"}</Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <span className="font-data text-xs tabular-nums text-ink">
                          {score}/{items.length}
                        </span>
                        <div className="flex gap-0.5">
                          {items.map((i) => (
                            <span
                              key={i.key}
                              title={tt(i.key)}
                              className={"h-2 w-2 rounded-full " + (i.ok ? "bg-success" : "bg-muted")}
                            />
                          ))}
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(f)}>
                          <Pencil size={15} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title={f.is_deleted ? tt("fw.act.restore") : tt("fw.act.archive")}
                          onClick={() => setDeleting(f)}
                        >
                          {f.is_deleted ? (
                            <RotateCcw size={15} />
                          ) : (
                            <Trash2 size={15} className="text-destructive" />
                          )}
                        </Button>
                      </div>
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        <Pager page={safePage} pageCount={pageCount} onPage={setPage} />
      </Panel>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? tt("fw.act.editForwarder") : tt("fw.act.newForwarder")}</DialogTitle>
            <DialogDescription>{tt("fw.dialog.forwarderDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>
                  {tt("fw.col.name")}
                  <span className="text-destructive">*</span>
                </Label>
                <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder={tt("fw.ph.name")} />
              </div>
              <div className="grid gap-1.5">
                <Label>{tt("fw.col.code")}</Label>
                <Input
                  value={form.code}
                  disabled={!!editing}
                  onChange={(e) => set({ code: e.target.value })}
                  placeholder={tt("fw.ph.code")}
                />
                <p className="text-[11px] text-muted-foreground">
                  {editing ? tt("fw.hint.codeImmutable") : tt("fw.hint.codeContract")}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-1.5">
                <Label>{tt("fw.col.contact")}</Label>
                <Input value={form.contact} onChange={(e) => set({ contact: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>{tt("fw.col.phone")}</Label>
                <Input value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>{tt("fw.col.wechat")}</Label>
                <Input value={form.wechat} onChange={(e) => set({ wechat: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-1.5">
                <Label>{tt("fw.col.province")}</Label>
                <Input value={form.province} onChange={(e) => set({ province: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>{tt("fw.col.city")}</Label>
                <Input value={form.city} onChange={(e) => set({ city: e.target.value })} placeholder={tt("fw.ph.city")} />
              </div>
              <div className="grid gap-1.5">
                <Label>{tt("fw.col.slaHours")}</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.sla_hours}
                  onChange={(e) => set({ sla_hours: e.target.value })}
                  placeholder={tt("fw.ph.optional")}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>{tt("fw.col.platforms")}</Label>
              <ChipMulti options={PLATFORM_OPTIONS} value={form.platforms} onChange={(v) => set({ platforms: v })} />
            </div>
            <div className="grid gap-1.5">
              <Label>{tt("fw.col.sites")}</Label>
              <ChipMulti options={SITE_OPTIONS} value={form.sites} onChange={(v) => set({ sites: v })} />
            </div>
            <div className="grid gap-1.5">
              <Label>{tt("fw.col.services")}</Label>
              <ChipMulti options={SERVICE_OPTIONS} value={form.services} onChange={(v) => set({ services: v })} />
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
              <div className="grid gap-1.5">
                <Label>{tt("fw.col.packingFlow")}</Label>
                <Sel value={form.packing_flow} onChange={(v) => set({ packing_flow: v })} className="w-full">
                  {FLOW_OPTIONS.map((o) => (
                    <option key={o.code} value={o.code}>{tt(o.key)}</option>
                  ))}
                </Sel>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>{tt("fw.col.tags")}</Label>
              <Input value={form.tags} onChange={(e) => set({ tags: e.target.value })} placeholder={tt("fw.ph.tags")} />
            </div>
            <div className="grid gap-1.5">
              <Label>{tt("fw.col.intro")}</Label>
              <Textarea rows={2} value={form.intro} onChange={(e) => set({ intro: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>{tt("fw.col.remark")}</Label>
              <Textarea rows={2} value={form.remark} onChange={(e) => set({ remark: e.target.value })} />
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
            <AlertDialogTitle>
              {deleting?.is_deleted ? tt("fw.confirm.restoreTitle") : tt("fw.confirm.archiveTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.is_deleted ? tt("fw.confirm.restoreDesc") : tt("fw.confirm.archiveDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tt("fw.act.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={toggleArchived}>
              {deleting?.is_deleted ? tt("fw.act.restore") : tt("fw.act.archive")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
