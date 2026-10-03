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
  { name: "美国专线小包", carrier: "云途物流", days: "7-12 天", region: "美国", price: "¥18/kg 起", forwarder_name: "云途物流" },
  { name: "欧洲空运专线", carrier: "燕文物流", days: "8-15 天", region: "欧洲", price: "¥32/kg 起", forwarder_name: "燕文物流" },
  { name: "FBA 头程海运", carrier: "递四方 4PX", days: "25-40 天", region: "美国 · 欧洲", price: "¥9/kg 起", forwarder_name: "递四方 4PX" },
  { name: "英国空运专线", carrier: "飞盒跨境", days: "5-9 天", region: "英国", price: "¥28/kg 起", forwarder_name: "飞盒跨境" },
  { name: "巴西专线", carrier: "安骏物流", days: "8-16 天", region: "巴西", price: "¥38/kg 起", forwarder_name: "安骏物流" },
  { name: "日本专线小包", carrier: "万邑通 WINIT", days: "5-9 天", region: "日本", price: "¥22/kg 起", forwarder_name: "万邑通 WINIT" },
  { name: "DHL 国际快递", carrier: "DHL", days: "3-7 天", region: "全球", price: "¥120/kg 起", forwarder_name: "DHL eCommerce" },
  { name: "USPS 美国小包", carrier: "USPS", days: "7-14 天", region: "美国", price: "¥16/kg 起", forwarder_name: "USPS Priority" },
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
        const sorted = [...(data ?? [])].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
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
      priority: row.priority ?? 0, status: row.status ?? "启用",
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
      if (editing) { await updateRow("logistics_channels", editing.id, payload); toast.success("渠道已更新"); }
      else { await insertRow("logistics_channels", payload); toast.success("渠道已添加"); }
      setDialogOpen(false); setForm(emptyForm); load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "保存失败"); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteRow("logistics_channels", deleting.id);
      setDeleting(null); toast.success("已删除"); load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "删除失败"); setDeleting(null); }
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
    } catch (e) { toast.error(e instanceof Error ? e.message : "排序失败"); }
  };

  const addPreset = async (p: (typeof PRESET_CHANNELS)[number]) => {
    try {
      await insertRow("logistics_channels", { ...p, priority: rows.length, status: "启用" });
      toast.success(`已添加渠道「${p.name}」`);
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "添加失败"); }
  };

  const addAllPreset = async () => {
    const toAdd = PRESET_CHANNELS.filter((p) => !names.has(p.name));
    if (!toAdd.length) { toast.info("预置渠道均已添加"); return; }
    try {
      for (let i = 0; i < toAdd.length; i++) {
        await insertRow("logistics_channels", { ...toAdd[i], priority: rows.length + i, status: "启用" });
      }
      toast.success(`已批量添加 ${toAdd.length} 条预置渠道`);
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "批量添加失败"); }
  };

  const stats = [
    { label: "启用渠道", value: String(rows.filter((r) => r.status === "启用").length), icon: <Zap size={17} />, tone: "success" as const },
    { label: "停用渠道", value: String(rows.filter((r) => r.status === "停用").length), icon: <Layers size={17} />, tone: "warning" as const },
    { label: "预置渠道", value: String(PRESET_CHANNELS.length), icon: <CheckCircle2 size={17} />, tone: "primary" as const },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="渠道配置"
        description="绑定货代渠道，设置优先级与时效价格"
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={addAllPreset} disabled={names.size >= PRESET_CHANNELS.length}>
              <Zap size={15} className="mr-1.5" /> 批量添加预置
            </Button>
            <Button size="sm" onClick={openAdd}><Plus size={15} className="mr-1.5" /> 新增渠道</Button>
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
          <Zap size={15} className="text-cargo-gold" /> 常用渠道快捷添加
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
                    ? "cursor-default border-emerald-500/30 bg-emerald-500/5 text-muted-foreground"
                    : "border-border bg-background hover:border-primary/40 hover:shadow-sm")
                }
              >
                <div className="font-medium text-ink">{p.name}</div>
                <div className="mt-0.5 text-muted-foreground">{p.carrier} · {p.days} · {p.price}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 渠道列表 */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-3.5">
          <h3 className="font-display text-sm font-semibold text-ink">渠道列表（{rows.length} 条）</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-3 py-3 text-center font-medium">优先级</th>
              <th className="px-3 py-3 font-medium">渠道名称</th>
              <th className="px-3 py-3 font-medium">承运商</th>
              <th className="px-3 py-3 font-medium">绑定货代</th>
              <th className="px-3 py-3 font-medium">覆盖区域</th>
              <th className="px-3 py-3 font-medium">时效</th>
              <th className="px-3 py-3 font-medium">参考价格</th>
              <th className="px-3 py-3 font-medium">状态</th>
              <th className="px-3 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground"><Loader2 size={18} className="mx-auto mb-2 animate-spin" />加载中...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">暂无渠道，可从上方向导添加预置渠道</td></tr>
            ) : (
              rows.map((row, idx) => (
                <tr key={row.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-center gap-0.5">
                      <button onClick={() => move(idx, -1)} disabled={idx === 0} className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-25"><ArrowUp size={13} /></button>
                      <span className="w-5 text-center text-xs font-semibold text-primary">{(row.priority ?? 0) + 1}</span>
                      <button onClick={() => move(idx, 1)} disabled={idx === rows.length - 1} className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-25"><ArrowDown size={13} /></button>
                    </div>
                  </td>
                  <td className="px-3 py-3 font-medium text-ink">{row.name}</td>
                  <td className="px-3 py-3 text-muted-foreground">{row.carrier || "—"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{row.forwarder_name || "—"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{row.region || "—"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{row.days || "—"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{row.price || "—"}</td>
                  <td className="px-3 py-3"><StatusBadge status={row.status ?? ""} /></td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(row)}><Pencil size={15} /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-600 hover:text-rose-600" onClick={() => setDeleting(row)}><Trash2 size={15} /></Button>
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
            <DialogTitle>{editing ? "编辑渠道" : "新增渠道"}</DialogTitle>
            <DialogDescription>{editing ? "更新渠道配置" : "添加一条物流渠道"}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>渠道名称 <span className="text-rose-500">*</span></Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：美国专线小包" />
              </div>
              <div className="grid gap-1.5">
                <Label>承运商</Label>
                <Input value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })} placeholder="如：云途物流" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>绑定货代</Label>
                <select value={form.forwarder_name} onChange={(e) => setForm({ ...form, forwarder_name: e.target.value })}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring">
                  <option value="">未绑定</option>
                  {forwarders.map((f) => <option key={f.id} value={f.name}>{f.name}</option>)}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label>优先级</Label>
                <Input type="number" min={0} value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>覆盖区域</Label>
                <Input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder="如：美国" />
              </div>
              <div className="grid gap-1.5">
                <Label>时效</Label>
                <Input value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} placeholder="如：7-12 天" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>参考价格</Label>
                <Input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="如：¥18/kg 起" />
              </div>
              <div className="grid gap-1.5">
                <Label>状态</Label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring">
                  {["启用", "停用"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSave} disabled={saving}>{saving && <Loader2 size={14} className="mr-1 animate-spin" />}保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除？</AlertDialogTitle>
            <AlertDialogDescription>删除后该渠道将从列表移除，历史运单不受影响。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-rose-600 hover:bg-rose-700">删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
