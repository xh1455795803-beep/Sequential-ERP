import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Loader2, RefreshCw, PackageSearch, MapPin, Clock, Search, ScanSearch, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { fetchTable, insertRow, updateRow, deleteRow, type ShipmentRow, type TrackingEvent } from "@/lib/data-access";
import { queryTracking } from "@/services/tracking";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_layout/logistics/tracking")({
  component: Tracking,
});

const emptyForm = { tracking_no: "", carrier: "", destination: "", origin: "", status: "待揽收" };

function Tracking() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ShipmentRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<ShipmentRow | null>(null);
  const [queryingId, setQueryingId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [quickNo, setQuickNo] = useState("");
  const [quickCarrier, setQuickCarrier] = useState("");
  const [quickLoading, setQuickLoading] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);

  const load = () => {
    fetchTable("shipments")
      .then((data) => setRows(data as unknown as ShipmentRow[]))
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (row: ShipmentRow) => {
    setEditing(row);
    setForm({
      tracking_no: row.tracking_no,
      carrier: row.carrier ?? "",
      destination: row.destination ?? "",
      origin: row.origin ?? "",
      status: row.status ?? "待揽收",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.tracking_no.trim()) return;
    setSaving(true);
    try {
      const payload = {
        tracking_no: form.tracking_no.trim(),
        carrier: form.carrier.trim(),
        destination: form.destination.trim(),
        origin: form.origin.trim(),
        status: form.status,
      };
      if (editing) {
        await updateRow("shipments", editing.id, payload);
      } else {
        await insertRow("shipments", payload);
      }
      setDialogOpen(false);
      setForm(emptyForm);
      load();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : t("common.saveFail"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteRow("shipments", deleting.id);
      setDeleting(null);
      load();
    } catch (e) {
      console.error(e);
      setDeleting(null);
    }
  };

  // 查询轨迹：调用快递鸟代理，解析轨迹事件并写回 shipments.tracking_events
  const queryOne = async (no: string, carrier: string) => {
    const result = (await queryTracking(no)) as {
      data?: { accepted?: { number: string; track?: { e?: unknown[] } }[] };
    };
    const accepted = result?.data?.accepted ?? [];
    const track = accepted[0]?.track;
    const rawEvents = track?.e ?? [];

    // 解析 17TRACK 轨迹事件为统一结构
    const events: TrackingEvent[] = (rawEvents as Array<Record<string, unknown>>).map((ev) => ({
      time: String(ev.a ?? ev.z ?? ""),
      location: String(ev.c ?? ev.z ?? ""),
      description: String(ev.z ?? ev.c ?? ""),
      status: String(ev.z ?? ""),
    }));
    return { events, latestStatus: events.length > 0 ? events[0].description : "运输中" };
  };

  const handleQuery = async (row: ShipmentRow) => {
    setQueryingId(row.id);
    try {
      const { events, latestStatus } = await queryOne(row.tracking_no, row.carrier ?? "");
      await updateRow("shipments", row.id, {
        tracking_events: events,
        status: latestStatus,
      });
      console.log("[tracking] 轨迹查询成功", { no: row.tracking_no, events: events.length });
      toast.success(t("tracking.queryDone"));
      load();
    } catch (e) {
      console.error("[tracking] 轨迹查询失败", e);
      const msg = e instanceof Error ? e.message : t("tracking.queryFail");
      toast.error(msg.includes("环境变量") ? t("tracking.noKey") : msg);
    } finally {
      setQueryingId(null);
    }
  };

  // 快速查询：输入单号直接建运单并同步轨迹
  const handleQuickQuery = async () => {
    const no = quickNo.trim();
    if (!no) return;
    setQuickLoading(true);
    try {
      const exists = rows.find((r) => r.tracking_no === no);
      if (exists) {
        toast.info("该单号已存在，正在同步最新轨迹");
      } else {
        await insertRow("shipments", {
          tracking_no: no,
          carrier: quickCarrier.trim() || "待确认",
          destination: "",
          origin: "",
          status: "运输中",
        });
      }
      // insertRow 返回 void，重新拉取定位该单号行
      const list = (await fetchTable("shipments")) as ShipmentRow[];
      const fresh = list.find((r) => r.tracking_no === no);
      if (fresh) {
        const { events, latestStatus } = await queryOne(no, quickCarrier.trim());
        await updateRow("shipments", fresh.id, {
          tracking_events: events,
          status: latestStatus,
          carrier: quickCarrier.trim() || "待确认",
        });
        toast.success("轨迹同步完成，共 " + events.length + " 条记录");
      } else {
        toast.success("运单已创建");
      }
      setQuickNo("");
      setQuickCarrier("");
      load();
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : t("tracking.queryFail");
      toast.error(msg.includes("环境变量") ? t("tracking.noKey") : msg);
      load();
    } finally {
      setQuickLoading(false);
    }
  };

  // 批量同步全部未签收运单轨迹
  const handleSyncAll = async () => {
    const pending = rows.filter((r) => r.status !== "已签收");
    if (!pending.length) { toast.info("没有需要同步的运单"); return; }
    setSyncingAll(true);
    let ok = 0;
    try {
      for (const row of pending) {
        try {
          const { events, latestStatus } = await queryOne(row.tracking_no, row.carrier ?? "");
          await updateRow("shipments", row.id, { tracking_events: events, status: latestStatus });
          ok++;
        } catch (e) { console.error("[tracking] 同步失败", row.tracking_no, e); }
      }
      toast.success(`同步完成：${ok}/${pending.length} 条成功`);
      load();
    } finally {
      setSyncingAll(false);
    }
  };

  const detailRow = rows.find((r) => r.id === detailId);
  const events = detailRow?.tracking_events ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("tracking.title")}
        description={t("tracking.desc")}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleSyncAll} disabled={syncingAll || rows.length === 0}>
              {syncingAll ? <Loader2 size={15} className="mr-1 animate-spin" /> : <RefreshCw size={15} className="mr-1" />}
              同步全部轨迹
            </Button>
            <Button size="sm" onClick={openAdd}>
              <Plus size={15} /> {t("tracking.add")}
            </Button>
          </div>
        }
      />

      {/* 单号快速查询 */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">
          <ScanSearch size={15} className="text-primary" /> 单号快速查询
          <span className="text-xs font-normal text-muted-foreground">输入快递单号，自动建档并同步最新轨迹</span>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={quickNo}
              onChange={(e) => setQuickNo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleQuickQuery()}
              placeholder="输入物流单号，如：YT20260922001"
              className="pl-9"
            />
          </div>
          <div className="w-full sm:w-52">
            <Input value={quickCarrier} onChange={(e) => setQuickCarrier(e.target.value)} placeholder="承运商（选填）" />
          </div>
          <Button onClick={handleQuickQuery} disabled={quickLoading || !quickNo.trim()}>
            {quickLoading ? <Loader2 size={15} className="mr-1 animate-spin" /> : <Truck size={15} className="mr-1" />}
            查询并添加
          </Button>
        </div>
      </div>

      {/* 运单列表 */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">{t("tracking.trackingNo")}</th>
              <th className="px-4 py-3 font-medium">{t("tracking.carrier")}</th>
              <th className="px-4 py-3 font-medium">{t("tracking.destination")}</th>
              <th className="px-4 py-3 font-medium">{t("tracking.status")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                  <Loader2 size={18} className="mx-auto mb-2 animate-spin" /> {t("common.loading")}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">{t("common.empty")}</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono font-medium text-primary">{row.tracking_no}</td>
                  <td className="px-4 py-3 text-muted-foreground">{row.carrier || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{row.destination || "—"}</td>
                  <td className="px-4 py-3"><StatusBadge status={row.status ?? ""} /></td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1 text-xs"
                        onClick={() => handleQuery(row)}
                        disabled={queryingId === row.id}
                      >
                        {queryingId === row.id ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                        {t("tracking.query")}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={() => setDetailId(row.id)}>
                        <PackageSearch size={14} /> {t("tracking.events")}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(row)}>
                        <Pencil size={15} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-rose-600 hover:text-rose-600"
                        onClick={() => setDeleting(row)}
                      >
                        <Trash2 size={15} />
                      </Button>
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
            <DialogTitle>{editing ? t("common.edit") : t("tracking.add")}</DialogTitle>
            <DialogDescription>{editing ? t("common.editDesc") : t("common.addDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>{t("tracking.trackingNo")} <span className="text-rose-500">*</span></Label>
              <Input value={form.tracking_no} onChange={(e) => setForm({ ...form, tracking_no: e.target.value })} placeholder="如：YT20260922001" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>{t("tracking.carrier")}</Label>
                <Input value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })} placeholder="如：云途物流" />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("tracking.status")}</Label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {["待揽收", "运输中", "已签收"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>{t("tracking.origin")}</Label>
                <Input value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value })} placeholder="如：深圳" />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("tracking.destination")}</Label>
                <Input value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} placeholder="如：美国洛杉矶" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 size={14} className="mr-1 animate-spin" />}{t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 轨迹明细弹窗 */}
      <Dialog open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("tracking.events")}</DialogTitle>
            <DialogDescription>{detailRow?.tracking_no}</DialogDescription>
          </DialogHeader>
          {events.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("tracking.noEvents")}</p>
          ) : (
            <div className="max-h-96 space-y-0 overflow-y-auto py-2">
              {events.map((ev, i) => (
                <div key={i} className="relative flex gap-3 pb-5 last:pb-0">
                  {/* 时间线 */}
                  <div className="flex flex-col items-center">
                    <span className={`mt-1 h-2.5 w-2.5 rounded-full ${i === 0 ? "bg-primary" : "bg-muted-foreground/40"}`} />
                    {i < events.length - 1 && <span className="w-px flex-1 bg-border" />}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock size={12} /> {ev.time}
                    </div>
                    <div className="mt-0.5 text-sm font-medium">{ev.description}</div>
                    {ev.location && (
                      <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin size={12} /> {ev.location}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.confirmDelete")}</AlertDialogTitle>
            <AlertDialogDescription>{t("common.confirmDeleteDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-rose-600 hover:bg-rose-700">
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}