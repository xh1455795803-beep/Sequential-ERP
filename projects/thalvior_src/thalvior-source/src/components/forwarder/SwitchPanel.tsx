// Tab E「履约开关」：fulfillment_switches 表单（scope + scope_ref 作用域 + 7 个开关/阈值）
// 作用域优先级由业务侧读取时决定，这里只负责按 (scope, scope_ref) 维度真实读写本租户的行。
import { useState } from "react";
import { Loader2, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { tt } from "@/i18n/tts";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { fetchTable, insertRow, updateRow } from "@/lib/data-access";
import {
  Chip, EmptyRow, EnumBadge, ErrorRow, LoadingRow, Panel, Sel, SWITCH_SCOPE_META, Td, Th,
  fmtTs, mapSwitch, toOptions, useAsyncData, useForwarderOptions, type SwitchRow,
} from "./common";

const SCOPE_OPTIONS = toOptions(SWITCH_SCOPE_META);

type BoolCol = "auto_push_forwarder" | "auto_mark_ship" | "auto_deduct_inventory";
type NumCol = "retry_max" | "dedupe_window_hours" | "fee_auto_update_days" | "bill_import_max_days";

type Form = {
  scope: string; scope_ref: string;
  auto_push_forwarder: boolean; auto_mark_ship: boolean; auto_deduct_inventory: boolean;
  retry_max: string; dedupe_window_hours: string; fee_auto_update_days: string; bill_import_max_days: string;
};
const blank: Form = {
  scope: "global", scope_ref: "",
  auto_push_forwarder: false, auto_mark_ship: false, auto_deduct_inventory: true,
  retry_max: "5", dedupe_window_hours: "24", fee_auto_update_days: "7", bill_import_max_days: "120",
};
const toForm = (s: SwitchRow): Form => ({
  scope: SWITCH_SCOPE_META[s.scope] ? s.scope : "global",
  scope_ref: s.scope_ref,
  auto_push_forwarder: s.auto_push_forwarder,
  auto_mark_ship: s.auto_mark_ship,
  auto_deduct_inventory: s.auto_deduct_inventory,
  retry_max: String(s.retry_max),
  dedupe_window_hours: String(s.dedupe_window_hours),
  fee_auto_update_days: String(s.fee_auto_update_days),
  bill_import_max_days: String(s.bill_import_max_days),
});

// 布尔开关的标签 + 一句「打开后会发生什么」，避免只给一个看不懂的开关
const BOOL_FIELDS: { col: BoolCol; labelKey: string; descKey: string }[] = [
  { col: "auto_push_forwarder", labelKey: "fw.sw.autoPushForwarder", descKey: "fw.sw.autoPushForwarderDesc" },
  { col: "auto_mark_ship", labelKey: "fw.sw.autoMarkShip", descKey: "fw.sw.autoMarkShipDesc" },
  { col: "auto_deduct_inventory", labelKey: "fw.sw.autoDeductInventory", descKey: "fw.sw.autoDeductInventoryDesc" },
];
const NUM_FIELDS: { col: NumCol; labelKey: string; descKey: string; max: number }[] = [
  { col: "retry_max", labelKey: "fw.sw.retryMax", descKey: "fw.sw.retryMaxDesc", max: 20 },
  { col: "dedupe_window_hours", labelKey: "fw.sw.dedupeWindowHours", descKey: "fw.sw.dedupeWindowHoursDesc", max: 168 },
  { col: "fee_auto_update_days", labelKey: "fw.sw.feeAutoUpdateDays", descKey: "fw.sw.feeAutoUpdateDaysDesc", max: 90 },
  { col: "bill_import_max_days", labelKey: "fw.sw.billImportMaxDays", descKey: "fw.sw.billImportMaxDaysDesc", max: 365 },
];

export function SwitchPanel() {
  const { forwarders } = useForwarderOptions();
  const [fScope, setFScope] = useState("");

  const { data, loading, error, reload } = useAsyncData<SwitchRow[]>(
    async () => {
      // 下推：选定作用域时按 scope 查
      const rows = await fetchTable("fulfillment_switches", fScope ? { field: "scope", value: fScope } : undefined);
      return rows
        .map(mapSwitch)
        .sort((a, b) => (a.scope === "global" ? -1 : b.scope === "global" ? 1 : a.scope.localeCompare(b.scope)));
    },
    [fScope],
    [],
  );

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SwitchRow | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<Form>) => setForm((p) => ({ ...p, ...patch }));
  const setBool = (col: BoolCol, v: boolean) => setForm((p) => ({ ...p, [col]: v }));
  const setNum = (col: NumCol, v: string) => setForm((p) => ({ ...p, [col]: v }));

  const openAdd = () => {
    setEditing(null);
    setForm({ ...blank, scope: fScope || "global" });
    setOpen(true);
  };
  const openEdit = (s: SwitchRow) => {
    setEditing(s);
    setForm(toForm(s));
    setOpen(true);
  };

  const save = async () => {
    if (form.scope !== "global" && !form.scope_ref.trim()) {
      toast.error(tt("fw.msg.needScopeRef"));
      return;
    }
    const nums: Record<string, number> = {};
    for (const f of NUM_FIELDS) {
      const raw = form[f.col].trim();
      const v = raw === "" ? 0 : Number(raw);
      if (!Number.isInteger(v) || v < 0 || v > f.max) {
        toast.error(tt("fw.msg.badNumber", { v1: tt(f.labelKey) }));
        return;
      }
      nums[f.col] = v;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        scope: form.scope,
        scope_ref: form.scope === "global" ? null : form.scope_ref.trim(),
        auto_push_forwarder: form.auto_push_forwarder,
        auto_mark_ship: form.auto_mark_ship,
        auto_deduct_inventory: form.auto_deduct_inventory,
        retry_max: nums.retry_max,
        dedupe_window_hours: nums.dedupe_window_hours,
        fee_auto_update_days: nums.fee_auto_update_days,
        bill_import_max_days: nums.bill_import_max_days,
      };
      if (editing) {
        await updateRow("fulfillment_switches", editing.id, payload);
        toast.success(tt("fw.msg.updated"));
      } else {
        await insertRow("fulfillment_switches", payload);
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

  // scope_ref 的录入控件按作用域换语义：货代/仓库/渠道用 id，平台/店铺用文本
  const refIsId = form.scope === "forwarder";
  const colCount = 7;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-border bg-card px-4 py-3">
        <Sel value={fScope} onChange={setFScope}>
          <option value="">{tt("fw.filt.allScopes")}</option>
          {SCOPE_OPTIONS.map((o) => (
            <option key={o.code} value={o.code}>{tt(o.key)}</option>
          ))}
        </Sel>
        <span className="ml-auto text-xs text-muted-foreground">{tt("fw.ui.rowCount", { n: data.length })}</span>
        <Button size="sm" onClick={openAdd}>
          <Plus size={15} className="mr-1.5" />
          {tt("fw.act.newSwitch")}
        </Button>
      </div>

      <Panel title={tt("fw.panel.switchList")} meta={<span>{tt("fw.hint.scopePriority")}</span>}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <Th className="w-[12%]">{tt("fw.col.scope")}</Th>
              <Th className="w-[20%]">{tt("fw.col.scopeRef")}</Th>
              <Th>{tt("fw.sw.autoPushForwarder")}</Th>
              <Th>{tt("fw.sw.autoMarkShip")}</Th>
              <Th>{tt("fw.sw.autoDeductInventory")}</Th>
              <Th>{tt("fw.col.thresholds")}</Th>
              <Th className="text-right">{tt("fw.col.updatedAt")}</Th>
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
                text={tt("fw.empty.switches")}
                hint={tt("fw.empty.switchesHint")}
                action={
                  <Button size="sm" onClick={openAdd}>
                    <Plus size={14} className="mr-1" />
                    {tt("fw.act.newSwitch")}
                  </Button>
                }
              />
            ) : (
              data.map((s) => (
                <tr key={s.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/60">
                  <Td className="align-top">
                    <EnumBadge value={s.scope} meta={SWITCH_SCOPE_META} />
                  </Td>
                  <Td className="align-top text-muted-foreground">
                    {s.scope === "global" ? (
                      <Chip>{tt("fw.scope.globalAll")}</Chip>
                    ) : (
                      <span className="font-data text-[11.5px]">{scopeRefLabel(s, forwarders) || "—"}</span>
                    )}
                  </Td>
                  <Td className="align-top">
                    <Dot on={s.auto_push_forwarder} label={s.auto_push_forwarder ? tt("fw.sw.on") : tt("fw.sw.off")} />
                  </Td>
                  <Td className="align-top">
                    <Dot on={s.auto_mark_ship} label={s.auto_mark_ship ? tt("fw.sw.on") : tt("fw.sw.off")} />
                  </Td>
                  <Td className="align-top">
                    <Dot on={s.auto_deduct_inventory} label={s.auto_deduct_inventory ? tt("fw.sw.on") : tt("fw.sw.off")} />
                  </Td>
                  <Td className="align-top text-[11px] text-muted-foreground">
                    <div>{tt("fw.sw.retryMax")} {s.retry_max}</div>
                    <div>{tt("fw.sw.dedupeWindowHours")} {s.dedupe_window_hours}</div>
                    <div>{tt("fw.sw.feeAutoUpdateDays")} {s.fee_auto_update_days}</div>
                    <div>{tt("fw.sw.billImportMaxDays")} {s.bill_import_max_days}</div>
                  </Td>
                  <Td className="align-top text-right">
                    <div className="text-[11px] text-muted-foreground">{fmtTs(s.updated_at)}</div>
                    <Button size="sm" variant="outline" className="mt-1 h-7 px-2 text-[11px]" onClick={() => openEdit(s)}>
                      <Pencil size={11} className="mr-1" />
                      {tt("fw.act.edit")}
                    </Button>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Panel>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? tt("fw.act.editSwitch") : tt("fw.act.newSwitch")}</DialogTitle>
            <DialogDescription>{tt("fw.dialog.switchDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>
                  {tt("fw.col.scope")}
                  <span className="text-destructive">*</span>
                </Label>
                <Sel value={form.scope} onChange={(v) => set({ scope: v })} className="w-full" disabled={!!editing}>
                  {SCOPE_OPTIONS.map((o) => (
                    <option key={o.code} value={o.code}>{tt(o.key)}</option>
                  ))}
                </Sel>
              </div>
              <div className="grid gap-1.5">
                <Label>{tt("fw.col.scopeRef")}</Label>
                {refIsId ? (
                  <Sel value={form.scope_ref} onChange={(v) => set({ scope_ref: v })} className="w-full">
                    <option value="">{tt("fw.filt.pickForwarder")}</option>
                    {forwarders.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </Sel>
                ) : (
                  <Input
                    value={form.scope_ref}
                    onChange={(e) => set({ scope_ref: e.target.value })}
                    placeholder={form.scope === "global" ? tt("fw.ph.scopeRefGlobal") : tt("fw.ph.scopeRef")}
                    disabled={form.scope === "global"}
                  />
                )}
                <p className="text-[11px] text-muted-foreground">{tt("fw.hint.scopeRef")}</p>
              </div>
            </div>

            <div className="grid gap-2">
              {BOOL_FIELDS.map((f) => (
                <div key={f.col} className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                  <div>
                    <div className="text-sm font-medium text-ink">{tt(f.labelKey)}</div>
                    <div className="text-[11px] text-muted-foreground">{tt(f.descKey)}</div>
                  </div>
                  <Switch checked={form[f.col]} onCheckedChange={(v) => setBool(f.col, !!v)} />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {NUM_FIELDS.map((f) => (
                <div key={f.col} className="grid gap-1.5">
                  <Label>{tt(f.labelKey)}</Label>
                  <Input type="number" min={0} max={f.max} value={form[f.col]} onChange={(e) => setNum(f.col, e.target.value)} />
                  <p className="text-[11px] text-muted-foreground">{tt(f.descKey)}</p>
                </div>
              ))}
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
    </div>
  );
}

function Dot({ on, label }: { on: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={"h-2 w-2 rounded-full " + (on ? "bg-success" : "bg-muted")} />
      <span className={on ? "text-success" : "text-muted-foreground"}>{label}</span>
    </span>
  );
}

// scope_ref 命中货代 id 时显示货代名，否则原样（平台/店铺等由业务侧传标识）
function scopeRefLabel(s: SwitchRow, forwarders: { id: string; name: string }[]): string {
  if (s.scope !== "forwarder") return "";
  return forwarders.find((f) => f.id === s.scope_ref)?.name ?? s.scope_ref;
}
