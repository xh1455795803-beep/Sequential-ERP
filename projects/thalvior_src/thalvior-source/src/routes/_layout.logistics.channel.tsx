import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Plus, Pencil, Trash2, Loader2, ArrowUp, ArrowDown, Layers, CheckCircle2, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, StatCard } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { fetchTable, insertRow, updateRow, deleteRow } from "@/lib/data-access";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { tt, tk } from "@/i18n/tts";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_layout/logistics/channel")({
  component: Channel,
});

/* 预置常用跨境物流渠道 */
const PRESET_CHANNELS = [
  { name: "log.chUSSmallPacket", carrier: "log.carrierYuntu", days: "log.days7_12", region: "log.regionUS", price: "log.price18", forwarder_name: "log.carrierYuntu" },
  { name: "log.chEUAir", carrier: "log.carrierYanwen", days: "log.days8_15", region: "region.eu", price: "log.price32", forwarder_name: "log.carrierYanwen" },
  { name: "log.chFBASea", carrier: "log.carrier4PX", days: "log.days25_40", region: "log.regionUSEU", price: "log.price9", forwarder_name: "log.carrier4PX" },
  { name: "log.chUKAir", carrier: "log.carrierFeihe", days: "log.days5_9", region: "log.regionUK", price: "log.price28", forwarder_name: "log.carrierFeihe" },
  { name: "log.chBrazilLine", carrier: "log.carrierAnjun", days: "log.days8_16", region: "log.regionBrazil", price: "log.price38", forwarder_name: "log.carrierAnjun" },
  { name: "log.chJapanSmallPacket", carrier: "log.carrierWinit", days: "log.days5_9", region: "log.regionJapan", price: "log.price22", forwarder_name: "log.carrierWinit" },
  { name: "log.chDHL", carrier: "DHL", days: "log.days3_7", region: "log.regionGlobal", price: "log.price120", forwarder_name: "DHL eCommerce" },
  { name: "log.chUSPS", carrier: "USPS", days: "log.days7_14", region: "log.regionUS", price: "log.price16", forwarder_name: "USPS Priority" },
];

const emptyForm = { name: "", carrier: "", forwarder_name: "", days: "", region: "", price: "", priority: 0, status: "启用" };

function Channel() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<any[]>([]);
  const [forwarders, setForwarders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<any | null>(null);

  const load = () => {
    fetchTable("logistics_channels")
      .then((data) => {
        const sorted = [...(data ?? [])].sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0));
        setRows(sorted);
      })
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);
  useEffect(() => {
    fetchTable("freight_forwarders").then((d) => setForwarders(d ?? [])).catch(() => {});
  }, []);

  const names = useMemo(() => new Set(rows.map((r) => r.name)), [rows]);

  const openAdd = () => { setEditing(null); setForm({ ...emptyForm, priority: rows.length }); setDialogOpen(true); };
  const openEdit = (row: any) => {
    setEditing(row);
    setForm({
      name: row.name ?? "", carrier: row.carrier ?? "", forwarder_name: row.forwarder_name ?? "",
      days: row.days ?? "", region: row.region ?? "", price: row.price ?? "",
      priority: row.priority ?? 0, status: row.status ?? tt('st.enabled'),
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(), carrier: form.carrier.trim(), forwarder_name: form.forwarder_name.trim(),
        days: form.days.trim(), region: form.region.trim(), price: form.price.trim(),
        priority: Number(form.priority) || 0, status: form.status,
      };
      if (editing) { await updateRow("logistics_channels", editing.id, payload); toast.success(tt('log.chUpdated')); }
      else { await insertRow("logistics_channels", payload); toast.success(tt('log.chAdded')); }
      setDialogOpen(false); setForm(emptyForm); load();
    } catch (e) { toast.error(e instanceof Error ? e.message : tt('common.saveFail')); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteRow("logistics_channels", deleting.id);
      setDeleting(null); toast.success(tt('notif.deleted')); load();
    } catch (e) { toast.error(e instanceof Error ? e.message : tt('notif.deleteFail')); setDeleting(null); }
  };

  // 优先级调整
  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    const a = rows[index]; const b = rows[target];
    const pa = a.priority ?? 0; const pb = b.priority ?? 0;
    try {
      await updateRow("logistics_channels", a.id, { priority: pb });
      await updateRow("logistics_channels", b.id, { priority: pa });
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : tt('log.sortFail')); }
  };

  const addPreset = async (p: (typeof PRESET_CHANNELS)[number]) => {
    try {
      await insertRow("logistics_channels", { ...p, priority: rows.length, status: "启用" });
      toast.success(tt('log.chAddedName', { v1: tk(p.name) }));
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : tt('log.addFail')); }
  };

  const addAllPreset = async () => {
    const toAdd = PRESET_CHANNELS.filter((p) => !names.has(p.name));
    if (!toAdd.length) { toast.info(tt('log.presetsAllAdded')); return; }
    try {
      for (let i = 0; i < toAdd.length; i++) {
        await insertRow("logistics_channels", { ...toAdd[i], priority: rows.length + i, status: "启用" });
      }
      toast.success(tt('log.presetsAddedCount', { v1: toAdd.length }));
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : tt('log.addFail')); }
  };

  const stats = [
    { label: tt('log.chEnable'), value: String(rows.filter((r) => r.status === "启用").length), icon: <Zap size={17} />, tone: "success" as const },
    { label: tt('log.chDisable'), value: String(rows.filter((r) => r.status === "停用").length), icon: <Layers size={17} />, tone: "warning" as const },
    { label: tt('log.presetChannels'), value: String(PRESET_CHANNELS.length), icon: <CheckCircle2 size={17} />, tone: "primary" as const },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={tt('nav.logistics.channel')}
        description={tt('log.channelDesc')}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={addAllPreset} disabled={names.size >= PRESET_CHANNELS.length}>
              <Zap size={15} className="mr-1.5" />{tt('log.addPresetsBatch')}
            </Button>
            <Button size="sm" onClick={openAdd}><Plus size={15} className="mr-1.5" />{tt('log.newChannel')}</Button>
          </div>
        }
      />

      {/* 统计卡 */}
      <div className="grid grid-cols-3 gap-4">
        {stats.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} icon={s.icon} tone={s.tone} />
        ))}
      </div>

      {/* 预置渠道池 */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <h3 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold text-ink">
          <Zap size={15} className="text-cargo-gold" />{tt('log.quickAddTitle')}
        </h3>
        <div className="flex flex-wrap gap-2">
          {PRESET_CHANNELS.map((p) => {
            const added = names.has(p.name);
            return (
              <button
                key={p.name}
                disabled={added}
                onClick={() => addPreset(p)}
                className={
                  "rounded-lg border px-3 py-2 text-left text-xs transition-all " +
                  (added
                    ? "cursor-default border-success/60/30 bg-success/5 text-muted-foreground"
                    : "border-border bg-background hover:border-primary/40 hover:shadow-float")
                }
              >
                <div className="font-medium text-ink">{tk(p.name)}</div>
                <div className="mt-0.5 text-muted-foreground">{tk(p.carrier)} · {tk(p.days)} · {tk(p.price)}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 渠道列表 */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-3.5">
          <h3 className="font-display text-sm font-semibold text-ink">{tt('log.chListPrefix')}{tt('log.chCount', { n: rows.length })}</h3>
        </div>
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-3 py-3 text-center font-medium">{tt('ful.rule.priority')}</th>
              <th className="px-3 py-3 font-medium">{tt('log.chNameLabel')}</th>
              <th className="px-3 py-3 font-medium">{tt('common.carrier')}</th>
              <th className="px-3 py-3 font-medium">{tt('log.bindForwarder')}</th>
              <th className="px-3 py-3 font-medium">{tt('log.colRegion')}</th>
              <th className="px-3 py-3 font-medium">{tt('log.colDays')}</th>
              <th className="px-3 py-3 font-medium">{tt('log.colPrice')}</th>
              <th className="px-3 py-3 font-medium">{tt('common.statusLabel')}</th>
              <th className="px-3 py-3 text-right font-medium">{tt('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground"><Loader2 size={18} className="mx-auto mb-2 animate-spin" />{tt('common.loading')}</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">{tt('log.noChannels')}，{tt('log.noChannelsHint')}</td></tr>
            ) : (
              rows.map((row, idx) => (
                <tr key={row.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/60">
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-center gap-0.5">
                      <button onClick={() => move(idx, -1)} disabled={idx === 0} className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-25"><ArrowUp size={13} /></button>
                      <span className="w-5 text-center text-xs font-semibold text-primary">{(row.priority ?? 0) + 1}</span>
                      <button onClick={() => move(idx, 1)} disabled={idx === rows.length - 1} className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-25"><ArrowDown size={13} /></button>
                    </div>
                  </td>
                  <td className="px-3 py-3 font-medium text-ink">{tk(row.name)}</td>
                  <td className="px-3 py-3 text-muted-foreground">{tk(row.carrier) || "—"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{tk(row.forwarder_name) || "—"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{tk(row.region) || "—"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{tk(row.days) || "—"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{tk(row.price) || "—"}</td>
                  <td className="px-3 py-3"><StatusBadge status={row.status ?? ""} /></td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(row)}><Pencil size={15} /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleting(row)}><Trash2 size={15} /></Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 新增/编辑弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? tt('log.chEdit') : tt('log.newChannel')}</DialogTitle>
            <DialogDescription>{editing ? tt('log.chUpdateCfg') : tt('log.chAddOne')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>{tt('log.chNameLabel')}<span className="text-destructive">*</span></Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={tt('log.chNamePh')} />
              </div>
              <div className="grid gap-1.5">
                <Label>{tt('common.carrier')}</Label>
                <Input value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })} placeholder={tt('log.carrierPh')} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>{tt('log.bindForwarder')}</Label>
                <select value={form.forwarder_name} onChange={(e) => setForm({ ...form, forwarder_name: e.target.value })}
                  className="h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring">
                  <option value="">{tt('log.notBound')}</option>
                  {forwarders.map((f) => <option key={f.id} value={f.name}>{f.name}</option>)}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label>{tt('ful.rule.priority')}</Label>
                <Input type="number" min={0} value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>{tt('log.colRegion')}</Label>
                <Input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder={tt('log.regionPh')} />
              </div>
              <div className="grid gap-1.5">
                <Label>{tt('log.colDays')}</Label>
                <Input value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} placeholder={tt('log.daysPh')} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>{tt('log.colPrice')}</Label>
                <Input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder={tt('log.pricePh')} />
              </div>
              <div className="grid gap-1.5">
                <Label>{tt('common.statusLabel')}</Label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring">
                  {[tt('st.enabled'), tt('st.disabled')].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{tt('common.cancel')}</Button>
            <Button onClick={handleSave} disabled={saving}>{saving && <Loader2 size={14} className="mr-1 animate-spin" />}{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tt('common.confirmDelete')}？</AlertDialogTitle>
            <AlertDialogDescription>{tt('log.delChConfirm')}，{tt('log.delKeepWaybills')}。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tt('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive">{tt('common.delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
