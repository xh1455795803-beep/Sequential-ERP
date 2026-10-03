import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Plus, Pencil, Trash2, Loader2, Truck, Globe2, Clock, Star,
  CheckCircle2, Phone, Building2, ArrowRight, Package,
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

export const Route = createFileRoute("/_layout/logistics/")({
  component: Logistics,
});

/* 预置主流跨境货代资源库（前端内置，点击一键加入合作） */
const FREIGHT_LIBRARY = [
  { name: "云途物流", channel: "专线小包 / 空运专线", region: "欧美 · 东南亚", quoteDays: "5-10 天", tags: ["时效稳", "可追踪"], desc: "欧美专线头部服务商，日均百万级包裹处理能力" },
  { name: "燕文物流", channel: "经济小包 / 专线", region: "全球", quoteDays: "7-15 天", tags: ["性价比", "覆盖广"], desc: "跨境出口物流老牌服务商，覆盖 200+ 国家" },
  { name: "递四方 4PX", channel: "直发专线 / FBA 头程", region: "欧美 · 中东", quoteDays: "6-12 天", tags: ["FBA头程", "海外仓"], desc: "AEO 高级认证物流，FBA 头程与海外仓一体化" },
  { name: "万邑通 WINIT", channel: "专线 / 海外仓", region: "美国 · 欧洲", quoteDays: "7-14 天", tags: ["海外仓", "时效稳"], desc: "自营海外仓覆盖欧美，支持一件代发" },
  { name: "飞盒跨境", channel: "空运专线 / 小包", region: "美国 · 英国", quoteDays: "5-9 天", tags: ["空运", "限时达"], desc: "美国空运专线优势渠道，末端 UPS 派送" },
  { name: "纵腾集团", channel: "谷仓海外仓 / 专线", region: "全球", quoteDays: "6-14 天", tags: ["大件", "海外仓"], desc: "谷仓海外仓体系，覆盖美欧日澳" },
  { name: "安骏物流", channel: "巴西专线 / 拉美", region: "巴西 · 拉美", quoteDays: "8-16 天", tags: ["巴西专线", "清关强"], desc: "拉美市场专线优势，巴西清关资源深厚" },
  { name: "中外运", channel: "海运 / 空运 / 快递", region: "全球", quoteDays: "10-30 天", tags: ["国企", "海运"], desc: "大型综合物流央企，海运整柜拼柜资源丰富" },
  { name: "DHL eCommerce", channel: "国际快递 / 专线", region: "全球", quoteDays: "3-7 天", tags: ["最快", "高端"], desc: "DHL 全球网络，适合高价值与时效敏感件" },
  { name: "FedEx IP", channel: "国际快递", region: "全球", quoteDays: "2-5 天", tags: ["最快", "高端"], desc: "FedEx 国际优先，门到门限时达" },
  { name: "UPS Worldwide", channel: "国际快递", region: "全球", quoteDays: "2-6 天", tags: ["最快", "高端"], desc: "UPS 全球速递，商务件首选" },
  { name: "USPS Priority", channel: "国际小包", region: "美国", quoteDays: "7-14 天", tags: ["美国", "经济"], desc: "美国邮政优先件，末端派送覆盖全美" },
];

const emptyForm = { name: "", channel: "", region: "", status: "合作中", contact: "", phone: "" };

function Logistics() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [addingName, setAddingName] = useState<string | null>(null);

  const load = () => {
    fetchTable("freight_forwarders")
      .then((data) => setRows(data))
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const names = useMemo(() => new Set(rows.map((r) => r.name)), [rows]);

  const openAdd = () => { setEditing(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (row: any) => {
    setEditing(row);
    setForm({
      name: row.name ?? "", channel: row.channel ?? "", region: row.region ?? "",
      status: row.status ?? "合作中", contact: row.contact ?? "", phone: row.phone ?? "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(), channel: form.channel.trim(), region: form.region.trim(),
        status: form.status, contact: form.contact.trim(), phone: form.phone.trim(),
      };
      if (editing) { await updateRow("freight_forwarders", editing.id, payload); toast.success("货代已更新"); }
      else { await insertRow("freight_forwarders", payload); toast.success("货代已添加"); }
      setDialogOpen(false); setForm(emptyForm); load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "保存失败"); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteRow("freight_forwarders", deleting.id);
      setDeleting(null); toast.success("已删除"); load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "删除失败"); setDeleting(null); }
  };

  // 一键添加预置货代为合作货代
  const addFromLibrary = async (lib: (typeof FREIGHT_LIBRARY)[number]) => {
    setAddingName(lib.name);
    try {
      await insertRow("freight_forwarders", {
        name: lib.name, channel: lib.channel, region: lib.region,
        status: "合作中", contact: "", phone: "",
      });
      toast.success(`已添加 ${lib.name} 为合作货代`);
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "添加失败"); }
    finally { setAddingName(null); }
  };

  const addAllLibrary = async () => {
    const toAdd = FREIGHT_LIBRARY.filter((l) => !names.has(l.name));
    if (!toAdd.length) { toast.info("资源库货代均已添加"); return; }
    try {
      for (const lib of toAdd) {
        await insertRow("freight_forwarders", {
          name: lib.name, channel: lib.channel, region: lib.region, status: "合作中",
        });
      }
      toast.success(`已批量添加 ${toAdd.length} 家推荐货代`);
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "批量添加失败"); }
  };

  const stats = [
    { label: "合作货代", value: String(rows.filter((r) => r.status === "合作中").length), icon: <CheckCircle2 size={17} />, tone: "success" as const },
    { label: "待评估", value: String(rows.filter((r) => r.status === "待评估").length), icon: <Clock size={17} />, tone: "warning" as const },
    { label: "资源库", value: String(FREIGHT_LIBRARY.length), icon: <Globe2 size={17} />, tone: "primary" as const },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="货代列表"
        description="预置主流跨境货代资源库，灵活配置物流渠道，实时追踪包裹状态"
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={addAllLibrary} disabled={names.size >= FREIGHT_LIBRARY.length}>
              <Package size={15} className="mr-1.5" /> 批量添加推荐
            </Button>
            <Button size="sm" onClick={openAdd}>
              <Plus size={15} className="mr-1.5" /> 新增货代
            </Button>
          </div>
        }
      />

      {/* 统计卡 */}
      <div className="grid grid-cols-3 gap-4">
        {stats.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} icon={s.icon} tone={s.tone} />
        ))}
      </div>

      {/* ── 推荐货代资源库 ── */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="flex items-center gap-2 font-display text-base font-semibold text-ink">
              <Star size={16} className="text-cargo-gold" /> 主流跨境货代资源库
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">覆盖专线、小包、海外仓、FBA 头程与快递渠道，一键加入合作</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {FREIGHT_LIBRARY.map((lib) => {
            const added = names.has(lib.name);
            return (
              <div key={lib.name} className={cnCard(added)}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cargo-teal/10">
                      <Truck size={16} className="text-cargo-teal" />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">{lib.name}</div>
                      <div className="text-[11px] text-muted-foreground">{lib.channel}</div>
                    </div>
                  </div>
                  {added ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
                      <CheckCircle2 size={11} /> 已合作
                    </span>
                  ) : (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => addFromLibrary(lib)} disabled={addingName === lib.name}>
                      {addingName === lib.name ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Plus size={12} className="mr-1" />}
                      添加合作
                    </Button>
                  )}
                </div>
                <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{lib.desc}</p>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1"><Globe2 size={11} /> {lib.region}</span>
                  <span className="flex items-center gap-1"><Clock size={11} /> {lib.quoteDays}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {lib.tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{tag}</span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 合作货代列表 ── */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
            <Building2 size={15} className="text-cargo-teal" /> 合作货代列表
            <span className="text-xs font-normal text-muted-foreground">（{rows.length} 家）</span>
          </h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-5 py-3 font-medium">货代名称</th>
              <th className="px-4 py-3 font-medium">物流渠道</th>
              <th className="px-4 py-3 font-medium">覆盖区域</th>
              <th className="px-4 py-3 font-medium">联系人</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground"><Loader2 size={18} className="mx-auto mb-2 animate-spin" />加载中...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">暂无合作货代，可从上方向导添加推荐货代</td></tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
                  <td className="px-5 py-3 font-medium text-ink">{row.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{row.channel || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{row.region || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {row.contact || "—"}
                    {row.phone && <span className="ml-1.5 inline-flex items-center gap-1 text-[11px]"><Phone size={10} />{row.phone}</span>}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={row.status ?? ""} /></td>
                  <td className="px-4 py-3">
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
            <DialogTitle>{editing ? "编辑货代" : "新增货代"}</DialogTitle>
            <DialogDescription>{editing ? "更新货代合作信息" : "手动添加一家合作货代"}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>货代名称 <span className="text-rose-500">*</span></Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：云途物流" />
              </div>
              <div className="grid gap-1.5">
                <Label>物流渠道</Label>
                <Input value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} placeholder="如：专线小包" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>覆盖区域</Label>
                <Input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder="如：欧美" />
              </div>
              <div className="grid gap-1.5">
                <Label>状态</Label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring">
                  {["合作中", "待评估", "已终止"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>联系人</Label>
                <Input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="选填" />
              </div>
              <div className="grid gap-1.5">
                <Label>联系电话</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="选填" />
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
            <AlertDialogDescription>删除后该货代将从合作列表移除，历史运单不受影响。</AlertDialogDescription>
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

function cnCard(added: boolean) {
  return "relative flex flex-col rounded-xl border p-3.5 transition-all " +
    (added
      ? "border-emerald-500/30 bg-emerald-500/[0.03]"
      : "border-border bg-background hover:border-primary/40 hover:shadow-sm");
}
