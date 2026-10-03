import { useEffect, useState } from "react";
import {
  Plus,
  Trash2,
  Loader2,
  Store,
  Link2,
  ShieldCheck,
  CheckCircle2,
  X,
  KeyRound,
  Globe2,
  Factory,
  ShoppingBag,
  Layers,
  Zap,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatCard } from "@/components/page-header";
import { fetchTable, deleteRow, type ExtRow } from "@/lib/data-access";
import { StatusBadge } from "@/components/status-badge";
import { supabase, supabaseUrl } from "@/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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

// ===== 货源平台池（按类别分组；auth_type: oauth=一键授权 / manual=手动填凭据） =====
type SourceGroup = {
  group: string;
  icon: typeof ShoppingBag;
  color: string;
  desc: string;
  platforms: { name: string; auth_type: "oauth" | "manual" }[];
};

const SOURCE_GROUPS: SourceGroup[] = [
  {
    group: "国内批发",
    icon: ShoppingBag,
    color: "from-orange-500 to-amber-400",
    desc: "国内一手货源与批发市场，支持一件代发",
    platforms: [
      { name: "1688", auth_type: "oauth" },
      { name: "淘宝天猫", auth_type: "oauth" },
      { name: "拼多多", auth_type: "oauth" },
      { name: "义乌购", auth_type: "manual" },
      { name: "广州十三行", auth_type: "manual" },
      { name: "杭州四季青", auth_type: "manual" },
    ],
  },
  {
    group: "跨境B2B",
    icon: Globe2,
    color: "from-blue-500 to-indigo-400",
    desc: "跨境大宗批发与工厂直供，支持验厂与定制",
    platforms: [
      { name: "阿里巴巴国际站", auth_type: "oauth" },
      { name: "环球资源", auth_type: "manual" },
      { name: "中国制造网", auth_type: "manual" },
      { name: "敦煌网", auth_type: "manual" },
      { name: "义乌国际商贸城", auth_type: "manual" },
    ],
  },
  {
    group: "跨境电商平台",
    icon: Layers,
    color: "from-violet-500 to-purple-400",
    desc: "平台化选品与跟卖货源，需账号授权",
    platforms: [
      { name: "Amazon 供应商", auth_type: "manual" },
      { name: "eBay 分销", auth_type: "manual" },
      { name: "Temu 全托管", auth_type: "manual" },
      { name: "SHEIN 供应链", auth_type: "manual" },
      { name: "Coupang", auth_type: "manual" },
      { name: "Shopee", auth_type: "manual" },
      { name: "Lazada", auth_type: "manual" },
      { name: "Mercado Libre", auth_type: "manual" },
    ],
  },
  {
    group: "工厂直供",
    icon: Factory,
    color: "from-emerald-500 to-teal-400",
    desc: "工厂一手报价，支持小单快返与OEM/ODM",
    platforms: [
      { name: "珠三角工厂集群", auth_type: "manual" },
      { name: "长三角工厂集群", auth_type: "manual" },
      { name: "产业带直供", auth_type: "manual" },
    ],
  },
];

const ALL_SOURCE_PLATFORMS = SOURCE_GROUPS.flatMap((g) => g.platforms);
const oauthSourcePlatforms = ALL_SOURCE_PLATFORMS.filter((p) => p.auth_type === "oauth").map((p) => p.name);

// ===== 手动授权凭据字段（按平台差异） =====
// 可真实校验平台（Amazon 供应商 / eBay 分销 / Shopify 独立站）：校验通过 → 已授权；失败 → 拒绝保存
// 其余平台：保存为「待验证」，绝不直接标记已授权
type SourceCredField = { key: string; label: string; placeholder: string; required?: boolean };

const SOURCE_CRED_FIELDS: Record<string, SourceCredField[]> = {
  "1688": [
    { key: "app_key", label: "AppKey", placeholder: "1688 开放平台应用 AppKey", required: true },
    { key: "app_secret", label: "AppSecret", placeholder: "1688 开放平台应用 AppSecret", required: true },
    { key: "seller_account", label: "账号", placeholder: "1688 账号", required: true },
  ],
  "淘宝天猫": [
    { key: "app_key", label: "AppKey", placeholder: "淘宝开放平台应用 AppKey", required: true },
    { key: "app_secret", label: "AppSecret", placeholder: "淘宝开放平台应用 AppSecret", required: true },
    { key: "seller_account", label: "账号", placeholder: "淘宝/天猫账号", required: true },
  ],
  "拼多多": [
    { key: "app_key", label: "Client ID", placeholder: "拼多多开放平台 Client ID", required: true },
    { key: "app_secret", label: "Client Secret", placeholder: "拼多多开放平台 Client Secret", required: true },
    { key: "seller_account", label: "账号", placeholder: "拼多多商家账号", required: true },
  ],
  "阿里巴巴国际站": [
    { key: "app_key", label: "AppKey", placeholder: "国际站开放平台 AppKey", required: true },
    { key: "app_secret", label: "AppSecret", placeholder: "国际站开放平台 AppSecret", required: true },
    { key: "seller_account", label: "账号", placeholder: "国际站账号", required: true },
  ],
  "Amazon 供应商": [
    { key: "client_id", label: "Client ID", placeholder: "Amazon SP-API Client ID", required: true },
    { key: "client_secret", label: "Client Secret", placeholder: "Amazon SP-API Client Secret", required: true },
    { key: "refresh_token", label: "Refresh Token", placeholder: "SP-API Refresh Token", required: true },
  ],
  "eBay 分销": [
    { key: "dev_id", label: "Dev ID", placeholder: "eBay 开发者 Dev ID", required: true },
    { key: "app_id", label: "App ID", placeholder: "eBay 应用 App ID", required: true },
    { key: "cert_id", label: "Cert ID", placeholder: "eBay 应用 Cert ID", required: true },
    { key: "auth_token", label: "授权令牌", placeholder: "eBay 卖家授权令牌（Auth Token）", required: true },
  ],
  "Temu 全托管": [
    { key: "app_key", label: "AppKey", placeholder: "Temu 开放平台 AppKey", required: true },
    { key: "app_secret", label: "AppSecret", placeholder: "Temu 开放平台 AppSecret", required: true },
    { key: "seller_account", label: "账号", placeholder: "Temu 商家账号", required: true },
  ],
  "SHEIN 供应链": [
    { key: "app_key", label: "AppKey", placeholder: "SHEIN 供应链平台 AppKey", required: true },
    { key: "app_secret", label: "AppSecret", placeholder: "SHEIN 供应链平台 AppSecret", required: true },
    { key: "seller_account", label: "账号", placeholder: "SHEIN 商家账号", required: true },
  ],
  Coupang: [
    { key: "access_key", label: "Access Key", placeholder: "Coupang 开发者 Access Key", required: true },
    { key: "secret_key", label: "Secret Key", placeholder: "Coupang 开发者 Secret Key", required: true },
    { key: "seller_account", label: "账号", placeholder: "Coupang 卖家账号", required: true },
  ],
  Shopee: [
    { key: "app_key", label: "Partner ID", placeholder: "Shopee 开放平台 Partner ID", required: true },
    { key: "app_secret", label: "Partner Key", placeholder: "Shopee 开放平台 Partner Key", required: true },
    { key: "seller_account", label: "账号", placeholder: "Shopee 卖家账号", required: true },
  ],
  Lazada: [
    { key: "app_key", label: "AppKey", placeholder: "Lazada 开放平台 AppKey", required: true },
    { key: "app_secret", label: "AppSecret", placeholder: "Lazada 开放平台 AppSecret", required: true },
    { key: "seller_account", label: "账号", placeholder: "Lazada 卖家账号", required: true },
  ],
  "Mercado Libre": [
    { key: "app_id", label: "App ID", placeholder: "Mercado Libre App ID", required: true },
    { key: "client_secret", label: "Client Secret", placeholder: "Mercado Libre Client Secret", required: true },
    { key: "seller_account", label: "账号", placeholder: "Mercado Libre 卖家账号", required: true },
  ],
  "义乌购": [
    { key: "seller_account", label: "账号", placeholder: "义乌购账号", required: true },
  ],
  "广州十三行": [
    { key: "seller_account", label: "账号/联系方式", placeholder: "档口账号或联系方式", required: true },
  ],
  "杭州四季青": [
    { key: "seller_account", label: "账号/联系方式", placeholder: "档口账号或联系方式", required: true },
  ],
  "环球资源": [
    { key: "seller_account", label: "账号", placeholder: "环球资源账号", required: true },
  ],
  "中国制造网": [
    { key: "seller_account", label: "账号", placeholder: "中国制造网账号", required: true },
  ],
  "敦煌网": [
    { key: "seller_account", label: "账号", placeholder: "敦煌网账号", required: true },
  ],
  "义乌国际商贸城": [
    { key: "seller_account", label: "账号/联系方式", placeholder: "商铺账号或联系方式", required: true },
  ],
  "珠三角工厂集群": [
    { key: "factory_name", label: "工厂名称", placeholder: "如：东莞某电子厂", required: true },
    { key: "contact", label: "联系人/电话", placeholder: "业务联系人及电话", required: true },
  ],
  "长三角工厂集群": [
    { key: "factory_name", label: "工厂名称", placeholder: "如：苏州某纺织厂", required: true },
    { key: "contact", label: "联系人/电话", placeholder: "业务联系人及电话", required: true },
  ],
  "产业带直供": [
    { key: "factory_name", label: "产业带/工厂名称", placeholder: "如：中山灯饰产业带", required: true },
    { key: "contact", label: "联系人/电话", placeholder: "业务联系人及电话", required: true },
  ],
};

// ===== 平台徽标样式 =====
const styleOf = (name: string) => {
  const idx = ALL_SOURCE_PLATFORMS.findIndex((p) => p.name === name);
  const palettes = [
    "from-orange-500 to-amber-400",
    "from-blue-500 to-indigo-400",
    "from-violet-500 to-purple-400",
    "from-emerald-500 to-teal-400",
    "from-rose-500 to-pink-400",
    "from-slate-700 to-slate-900",
  ];
  return palettes[idx >= 0 ? idx % palettes.length : 0];
};

const emptyForm = {
  source_name: "",
  platform: "1688",
  creds: {} as Record<string, string>,
};

export function AuthSourcePage() {
  const [rows, setRows] = useState<ExtRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<ExtRow | null>(null);

  const load = () => {
    setLoading(true);
    fetchTable("source_auths")
      .then((r) => setRows(r ?? []))
      .catch((e) => console.error("[auth.source] 加载货源授权失败", e))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const authorizedCount = rows.filter((r) => r.status === "已授权").length;
  const pendingCount = rows.filter((r) => r.status === "待验证").length;
  const isAuthorized = (platform: string) =>
    rows.some((r) => r.platform === platform && r.status === "已授权");
  const isPending = (platform: string) =>
    rows.some((r) => r.platform === platform && r.status === "待验证");

  const openAdd = (p?: { name: string; auth_type: "oauth" | "manual" }) => {
    const target = p ?? ALL_SOURCE_PLATFORMS[0];
    setForm({ ...emptyForm, platform: target.name, creds: {} });
    setFormOpen(true);
  };

  // 一键授权：平台开放平台 OAuth。需先在后台配置开发者应用密钥；未配置时明确提示并转手动
  const handleOAuth = (platform: string) => {
    toast.info(`「${platform}」一键授权需先在后台配置开发者应用密钥（AppKey/Secret），已为你打开手动授权表单`, {
      duration: 5000,
    });
    setForm({ ...emptyForm, platform, creds: {} });
    setFormOpen(true);
  };

  // 手动授权保存：调服务端真实校验（可校验平台通过才标记已授权，其余保存为待验证）
  const handleSave = async () => {
    if (!form.source_name.trim()) {
      toast.error("请填写货源名称");
      return;
    }
    const fields = SOURCE_CRED_FIELDS[form.platform] ?? [];
    for (const f of fields) {
      if (f.required !== false && !String(form.creds?.[f.key] ?? "").trim()) {
        toast.error(`请填写 ${f.label}`);
        return;
      }
    }
    setSaving(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(`${supabaseUrl}/functions/v1/verify-source-auth`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          source_name: form.source_name.trim(),
          platform: form.platform,
          credentials: form.creds,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data) {
        toast.error(data?.message ?? data?.error ?? "校验失败");
        setSaving(false);
        return;
      }
      if (data.verifyable && !data.valid) {
        toast.error(data.message ?? "凭据校验失败，请核对后重试");
        setSaving(false);
        return;
      }
      if (data.status === "已授权") {
        toast.success("凭据校验通过，货源已授权");
      } else {
        toast.info(data.message ?? "凭据已保存，状态为待验证");
      }
      setFormOpen(false);
      setForm(emptyForm);
      load();
    } catch (e) {
      console.error("[auth.source] 保存失败", e);
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteRow("source_auths", deleting.id);
      toast.success("已删除该货源授权");
      setDeleting(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
      setDeleting(null);
    }
  };

  const platformCount = ALL_SOURCE_PLATFORMS.length;

  return (
    <div className="space-y-5">
      {/* 统计 + 新增入口 */}
      <div className="flex items-start justify-between gap-4">
        <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="已授权货源" value={String(authorizedCount)} icon={<Store size={18} />} tone="success" />
          <StatCard label="待验证" value={String(pendingCount)} icon={<AlertTriangle size={18} />} tone="warning" />
          <StatCard label="货源平台池" value={String(platformCount)} icon={<Link2 size={18} />} tone="violet" />
        </div>
        <Button size="sm" className="shrink-0" onClick={() => openAdd()}>
          <Plus size={15} /> 新增货源
        </Button>
      </div>

      {/* 授权方式说明：一键 OAuth / 手动凭据 */}
      <div className="flex flex-wrap gap-3 rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Zap size={13} className="text-emerald-500" /> 一键授权（OAuth）：平台开放平台直接授权，需后台配置开发者密钥
        </span>
        <span className="inline-flex items-center gap-1.5">
          <KeyRound size={13} className="text-amber-500" /> 手动授权：填写平台 AppKey / Secret / 账号等凭据，可校验平台自动验证
        </span>
      </div>

      {/* 货源平台池 */}
      <div className="space-y-4">
        {SOURCE_GROUPS.map((g) => {
          const Icon = g.icon;
          return (
            <div key={g.group} className="rounded-xl border border-border bg-card p-4 shadow-soft">
              <div className="mb-1 flex items-center gap-2">
                <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br text-white", g.color)}>
                  <Icon size={15} />
                </span>
                <div>
                  <div className="text-sm font-semibold">{g.group}</div>
                  <div className="text-xs text-muted-foreground">{g.desc}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {g.platforms.map((p) => {
                  const authed = isAuthorized(p.name);
                  const pending = isPending(p.name);
                  return (
                    <div
                      key={p.name}
                      className={cn(
                        "group relative inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-all",
                        authed
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : pending
                            ? "border-orange-200 bg-orange-50 text-orange-700"
                            : "border-border bg-background hover:border-primary/40"
                      )}
                    >
                      <span className={cn("flex h-5 w-5 items-center justify-center rounded bg-gradient-to-br text-[10px] font-bold text-white", styleOf(p.name))}>
                        {p.name.charAt(0)}
                      </span>
                      {p.name}
                      {p.auth_type === "oauth" && <Zap size={11} className="text-emerald-500" />}
                      {authed && <CheckCircle2 size={13} className="text-emerald-500" />}
                      {pending && <AlertTriangle size={13} className="text-orange-500" />}
                      {!authed && !pending && (
                        <button
                          className="invisible ml-0.5 inline-flex items-center gap-0.5 text-xs font-medium text-primary group-hover:visible"
                          onClick={() => (p.auth_type === "oauth" ? handleOAuth(p.name) : openAdd(p))}
                        >
                          <Plus size={11} /> {p.auth_type === "oauth" ? "一键授权" : "手动授权"}
                        </button>
                      )}
                      {pending && (
                        <button
                          className="invisible ml-0.5 inline-flex items-center gap-0.5 text-xs font-medium text-orange-600 group-hover:visible"
                          onClick={() => openAdd(p)}
                        >
                          <KeyRound size={11} /> 更新凭据
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* 已授权列表 */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-semibold">已绑定货源</h2>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600">
            <ShieldCheck size={11} /> {authorizedCount} 个有效授权
          </span>
          {pendingCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-600">
              <AlertTriangle size={11} /> {pendingCount} 个待验证
            </span>
          )}
        </div>
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">货源名称</th>
                <th className="px-4 py-3 font-medium">货源平台</th>
                <th className="px-4 py-3 font-medium">授权方式</th>
                <th className="px-4 py-3 font-medium">授权时间</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    <Loader2 size={18} className="mx-auto mb-2 animate-spin" />
                    加载中…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    暂无货源绑定，点击上方「新增货源」或平台卡片上的「手动授权 / 一键授权」开始绑定
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{r.source_name}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-xs">
                        <KeyRound size={11} className="text-muted-foreground" /> {r.platform}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {r.auth_type === "oauth" ? "一键授权" : "手动授权"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r.authorized_at ?? "—"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={String(r.status ?? "待验证")} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setDeleting(r)}>
                        <Trash2 size={14} />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 新增/更新弹窗 */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新增货源授权</DialogTitle>
            <DialogDescription>可校验平台（Amazon 供应商 / eBay 分销）校验通过后标记「已授权」，其余平台保存为「待验证」</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>货源平台 *</Label>
              <select
                value={form.platform}
                onChange={(e) => setForm({ ...form, platform: e.target.value, creds: {} })}
                className="flex h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {SOURCE_GROUPS.map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.platforms.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name}{p.auth_type === "oauth" ? "（支持一键授权）" : ""}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>货源名称 *</Label>
              <Input
                value={form.source_name}
                onChange={(e) => setForm({ ...form, source_name: e.target.value })}
                placeholder="如：1688 精选童装供应链"
              />
            </div>
            {(SOURCE_CRED_FIELDS[form.platform] ?? []).map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label>
                  {f.label} {f.required !== false && <span className="text-rose-500">*</span>}
                </Label>
                <Input
                  type={/secret|token|key/i.test(f.key) && f.key !== "access_key" && f.key !== "api_key" ? "password" : "text"}
                  value={form.creds?.[f.key] ?? ""}
                  onChange={(e) => setForm({ ...form, creds: { ...form.creds, [f.key]: e.target.value } })}
                  placeholder={f.placeholder}
                />
              </div>
            ))}
            {form.platform && oauthSourcePlatforms.includes(form.platform) && (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                该平台支持一键授权（OAuth），配置后台开发者密钥后可在平台卡片上直接一键授权；当前填写的凭据按手动授权保存。
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              <X size={14} /> 取消
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} 保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除货源授权</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除「{deleting?.source_name}」的授权吗？删除后该货源的绑定关系将解除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
