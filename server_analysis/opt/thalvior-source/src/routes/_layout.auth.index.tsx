import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  Loader2,
  ShieldCheck,
  Store,
  Link2,
  CheckCircle2,
  Zap,
  KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, StatCard } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { fetchTable, deleteRow, type ExtRow } from "@/lib/data-access";
import { supabase, supabaseUrl } from "@/supabase/client";
import { getOAuthUrl } from "@/services/shopOAuth";
import { AuthSourcePage } from "@/components/auth-source-page";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/LanguageContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

export const Route = createFileRoute("/_layout/auth/")({
  component: AuthCenter,
});

// ===== 平台配置 =====
// 授权类型标记统一从开发者后台 platform_configs 表读取（auth_type: oauth / manual），
// 并叠加 platform_auth_config.oauth_ready 就绪标记：声明为 oauth 但后端未就绪（缺密钥/未接入）的平台
// 一律降级为 manual 手动凭据（保存为「待验证」），绝不让用户点进报错的 OAuth 流程。
// 前端不写死板块归属；后台表为空或读取失败时使用下面的内置兜底配置，保证页面可用。
export type PlatformCfg = {
  name: string;
  region: string;
  auth_type: "oauth" | "manual";
  status?: string;
  oauth_ready?: boolean;
};

const fallbackPlatforms: PlatformCfg[] = [
  // 支持 OAuth 的平台归入「一键 OAuth 授权」区；oauth_ready=false 表示后端密钥/接入待配置，按钮点击转手动授权
  { name: "Shopify", region: "独立站", auth_type: "oauth", oauth_ready: false },
  { name: "TikTok Shop", region: "短视频电商", auth_type: "oauth", oauth_ready: false },
  { name: "Lazada", region: "东南亚", auth_type: "oauth", oauth_ready: false },
  { name: "Shopee", region: "东南亚", auth_type: "oauth", oauth_ready: false },
  { name: "Amazon US", region: "美国站", auth_type: "manual" },
  { name: "Amazon JP", region: "日本站", auth_type: "manual" },
  { name: "Amazon EU", region: "欧洲站", auth_type: "manual" },
  { name: "eBay", region: "全球拍卖", auth_type: "manual" },
  { name: "Walmart", region: "美国商超", auth_type: "manual" },
  { name: "Etsy", region: "手工艺品", auth_type: "manual" },
  { name: "Temu", region: "全托管", auth_type: "manual" },
  { name: "SHEIN", region: "快时尚", auth_type: "manual" },
  { name: "AliExpress", region: "速卖通", auth_type: "manual" },
  { name: "Amazon CA", region: "加拿大站", auth_type: "manual" },
  { name: "Amazon AU", region: "澳洲站", auth_type: "manual" },
  { name: "Mercado Libre", region: "拉美", auth_type: "manual" },
  { name: "Coupang", region: "韩国", auth_type: "manual" },
  { name: "Noon", region: "中东", auth_type: "manual" },
  { name: "Ozon", region: "俄罗斯", auth_type: "manual" },
  { name: "Wildberries", region: "俄罗斯", auth_type: "manual" },
  { name: "WooCommerce", region: "独立站", auth_type: "manual" },
];

// 平台卡片视觉样式（徽标字母 + 渐变配色）
const platformStyle: Record<string, { letter: string; color: string }> = {
  Shopify: { letter: "S", color: "from-emerald-500 to-teal-400" },
  "TikTok Shop": { letter: "T", color: "from-slate-700 to-slate-900" },
  Lazada: { letter: "L", color: "from-indigo-500 to-violet-500" },
  Shopee: { letter: "S", color: "from-orange-500 to-amber-400" },
  "Amazon US": { letter: "A", color: "from-amber-500 to-orange-400" },
  "Amazon JP": { letter: "A", color: "from-amber-500 to-orange-400" },
  "Amazon EU": { letter: "A", color: "from-amber-500 to-orange-400" },
  eBay: { letter: "e", color: "from-blue-500 to-indigo-400" },
  Walmart: { letter: "W", color: "from-sky-500 to-blue-500" },
  Etsy: { letter: "E", color: "from-orange-500 to-rose-400" },
  Temu: { letter: "T", color: "from-rose-500 to-pink-500" },
  SHEIN: { letter: "S", color: "from-slate-800 to-slate-950" },
  AliExpress: { letter: "A", color: "from-red-500 to-orange-500" },
  "Amazon CA": { letter: "A", color: "from-amber-500 to-orange-400" },
  "Amazon AU": { letter: "A", color: "from-amber-500 to-orange-400" },
  "Mercado Libre": { letter: "M", color: "from-yellow-500 to-amber-600" },
  Coupang: { letter: "C", color: "from-rose-500 to-red-500" },
  Noon: { letter: "N", color: "from-emerald-600 to-teal-500" },
  Ozon: { letter: "O", color: "from-blue-500 to-indigo-500" },
  Wildberries: { letter: "W", color: "from-violet-500 to-purple-500" },
  WooCommerce: { letter: "W", color: "from-slate-600 to-slate-800" },
};

const DEFAULT_STYLE = { letter: "P", color: "from-slate-500 to-slate-700" };

const styleOf = (name: string) => platformStyle[name] ?? DEFAULT_STYLE;

const emptyForm = {
  shop_name: "",
  platform: "Amazon US",
  region: "",
  status: "已授权",
  creds: {} as Record<string, string>,
};

// ===== 手动授权凭据字段（按平台差异） =====
// 保存前必须填写带 * 的字段；Amazon/Walmart/Etsy 会调平台官方端点真实校验，
// 校验通过才标记「已授权」；eBay/Temu/SHEIN/AliExpress 暂不支持自动校验，保存为「待验证」。
export type CredField = { key: string; labelKey: string; placeholderKey: string; required?: boolean };

const manualCredFields: Record<string, CredField[]> = {
  Shopify: [
    { key: "shop_domain", labelKey: "auth.cred.shopDomain", placeholderKey: "auth.cred.shopDomainPh", required: true },
    { key: "access_token", labelKey: "auth.cred.accessToken", placeholderKey: "auth.cred.accessTokenPh", required: true },
  ],
  "TikTok Shop": [
    { key: "app_key", labelKey: "auth.cred.appKey", placeholderKey: "auth.cred.appKeyPh", required: true },
    { key: "app_secret", labelKey: "auth.cred.appSecret", placeholderKey: "auth.cred.appSecretPh", required: true },
    { key: "seller_account", labelKey: "auth.cred.sellerAccount", placeholderKey: "auth.cred.sellerAccountPh", required: true },
  ],
  Lazada: [
    { key: "app_key", labelKey: "auth.cred.appKey", placeholderKey: "auth.cred.appKeyPh", required: true },
    { key: "app_secret", labelKey: "auth.cred.appSecret", placeholderKey: "auth.cred.appSecretPh", required: true },
    { key: "seller_account", labelKey: "auth.cred.sellerAccount", placeholderKey: "auth.cred.sellerAccountPh", required: true },
  ],
  Shopee: [
    { key: "app_key", labelKey: "auth.cred.appKey", placeholderKey: "auth.cred.appKeyPh", required: true },
    { key: "app_secret", labelKey: "auth.cred.appSecret", placeholderKey: "auth.cred.appSecretPh", required: true },
    { key: "seller_account", labelKey: "auth.cred.sellerAccount", placeholderKey: "auth.cred.sellerAccountPh", required: true },
  ],
  "Amazon US": [
    { key: "client_id", labelKey: "auth.cred.clientId", placeholderKey: "auth.cred.clientIdPh", required: true },
    { key: "client_secret", labelKey: "auth.cred.clientSecret", placeholderKey: "auth.cred.clientSecretPh", required: true },
    { key: "refresh_token", labelKey: "auth.cred.refreshToken", placeholderKey: "auth.cred.refreshTokenPh", required: true },
  ],
  "Amazon JP": [
    { key: "client_id", labelKey: "auth.cred.clientId", placeholderKey: "auth.cred.clientIdPh", required: true },
    { key: "client_secret", labelKey: "auth.cred.clientSecret", placeholderKey: "auth.cred.clientSecretPh", required: true },
    { key: "refresh_token", labelKey: "auth.cred.refreshToken", placeholderKey: "auth.cred.refreshTokenPh", required: true },
  ],
  "Amazon EU": [
    { key: "client_id", labelKey: "auth.cred.clientId", placeholderKey: "auth.cred.clientIdPh", required: true },
    { key: "client_secret", labelKey: "auth.cred.clientSecret", placeholderKey: "auth.cred.clientSecretPh", required: true },
    { key: "refresh_token", labelKey: "auth.cred.refreshToken", placeholderKey: "auth.cred.refreshTokenPh", required: true },
  ],
  Walmart: [
    { key: "client_id", labelKey: "auth.cred.clientId", placeholderKey: "auth.cred.walmartClientIdPh", required: true },
    { key: "client_secret", labelKey: "auth.cred.clientSecret", placeholderKey: "auth.cred.walmartClientSecretPh", required: true },
  ],
  Etsy: [
    { key: "api_key", labelKey: "auth.cred.apiKey", placeholderKey: "auth.cred.etsyApiKeyPh", required: true },
  ],
  eBay: [
    { key: "app_id", labelKey: "auth.cred.appId", placeholderKey: "auth.cred.appIdPh", required: true },
    { key: "cert_id", labelKey: "auth.cred.certId", placeholderKey: "auth.cred.certIdPh", required: true },
    { key: "dev_id", labelKey: "auth.cred.devId", placeholderKey: "auth.cred.devIdPh", required: true },
    { key: "auth_token", labelKey: "auth.cred.authToken", placeholderKey: "auth.cred.authTokenPh", required: true },
  ],
  Temu: [
    { key: "app_key", labelKey: "auth.cred.appKey", placeholderKey: "auth.cred.appKeyPh", required: true },
    { key: "app_secret", labelKey: "auth.cred.appSecret", placeholderKey: "auth.cred.appSecretPh", required: true },
    { key: "seller_account", labelKey: "auth.cred.sellerAccount", placeholderKey: "auth.cred.sellerAccountPh", required: true },
  ],
  SHEIN: [
    { key: "app_key", labelKey: "auth.cred.appKey", placeholderKey: "auth.cred.appKeyPh", required: true },
    { key: "app_secret", labelKey: "auth.cred.appSecret", placeholderKey: "auth.cred.appSecretPh", required: true },
    { key: "seller_account", labelKey: "auth.cred.sellerAccount", placeholderKey: "auth.cred.sellerAccountPh", required: true },
  ],
  AliExpress: [
    { key: "app_key", labelKey: "auth.cred.appKey", placeholderKey: "auth.cred.appKeyPh", required: true },
    { key: "app_secret", labelKey: "auth.cred.appSecret", placeholderKey: "auth.cred.appSecretPh", required: true },
    { key: "seller_account", labelKey: "auth.cred.sellerAccount", placeholderKey: "auth.cred.sellerAccountPh", required: true },
  ],
  "Amazon CA": [
    { key: "client_id", labelKey: "auth.cred.clientId", placeholderKey: "auth.cred.clientIdPh", required: true },
    { key: "client_secret", labelKey: "auth.cred.clientSecret", placeholderKey: "auth.cred.clientSecretPh", required: true },
    { key: "refresh_token", labelKey: "auth.cred.refreshToken", placeholderKey: "auth.cred.refreshTokenPh", required: true },
  ],
  "Amazon AU": [
    { key: "client_id", labelKey: "auth.cred.clientId", placeholderKey: "auth.cred.clientIdPh", required: true },
    { key: "client_secret", labelKey: "auth.cred.clientSecret", placeholderKey: "auth.cred.clientSecretPh", required: true },
    { key: "refresh_token", labelKey: "auth.cred.refreshToken", placeholderKey: "auth.cred.refreshTokenPh", required: true },
  ],
  "Mercado Libre": [
    { key: "app_id", labelKey: "auth.cred.appId", placeholderKey: "auth.cred.appIdPh", required: true },
    { key: "client_secret", labelKey: "auth.cred.clientSecret", placeholderKey: "auth.cred.clientSecretPh", required: true },
    { key: "seller_account", labelKey: "auth.cred.sellerAccount", placeholderKey: "auth.cred.sellerAccountPh", required: true },
  ],
  Coupang: [
    { key: "access_key", labelKey: "auth.cred.accessKey", placeholderKey: "auth.cred.accessKeyPh", required: true },
    { key: "secret_key", labelKey: "auth.cred.secretKey", placeholderKey: "auth.cred.secretKeyPh", required: true },
    { key: "seller_account", labelKey: "auth.cred.sellerAccount", placeholderKey: "auth.cred.sellerAccountPh", required: true },
  ],
  Noon: [
    { key: "app_key", labelKey: "auth.cred.appKey", placeholderKey: "auth.cred.appKeyPh", required: true },
    { key: "app_secret", labelKey: "auth.cred.appSecret", placeholderKey: "auth.cred.appSecretPh", required: true },
    { key: "seller_account", labelKey: "auth.cred.sellerAccount", placeholderKey: "auth.cred.sellerAccountPh", required: true },
  ],
  Ozon: [
    { key: "client_id", labelKey: "auth.cred.clientId", placeholderKey: "auth.cred.clientIdPh", required: true },
    { key: "api_key", labelKey: "auth.cred.apiKey", placeholderKey: "auth.cred.apiKeyPh", required: true },
  ],
  Wildberries: [
    { key: "api_key", labelKey: "auth.cred.apiKey", placeholderKey: "auth.cred.apiKeyPh", required: true },
  ],
  WooCommerce: [
    { key: "shop_domain", labelKey: "auth.cred.shopDomain", placeholderKey: "auth.cred.shopDomainPh", required: true },
    { key: "consumer_key", labelKey: "auth.cred.consumerKey", placeholderKey: "auth.cred.consumerKeyPh", required: true },
    { key: "consumer_secret", labelKey: "auth.cred.consumerSecret", placeholderKey: "auth.cred.consumerSecretPh", required: true },
  ],
};

// 支持平台官方端点真实校验的平台：校验通过才会标记「已授权」
const VERIFIABLE_PLATFORMS = new Set(["Amazon US", "Amazon JP", "Amazon EU", "Walmart", "Etsy"]);

function AuthShopTab() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<ExtRow[]>([]);
  const [platforms, setPlatforms] = useState<PlatformCfg[]>(fallbackPlatforms);
  const [loading, setLoading] = useState(true);
  const [cfgLoading, setCfgLoading] = useState(true);
  const [pickOpen, setPickOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<ExtRow | null>(null);

  const load = () => {
    fetchTable("shop_auths")
      .then(setRows)
      .catch((e) => console.error("[auth] 加载店铺授权失败", e))
      .finally(() => setLoading(false));
  };

  // 从开发者后台 platform_configs 读取平台配置（含授权类型标记），失败/为空时回退内置配置
  // 同时读取 platform_auth_config.oauth_ready：声明 oauth 但未就绪的平台降级为 manual，避免点进必失败的 OAuth 流程
  const loadPlatforms = () => {
    fetchTable("platform_configs")
      .then(async (cfgs) => {
        let readyMap: Record<string, boolean> = {};
        try {
          const readyRows = await fetchTable("platform_auth_config");
          readyMap = (readyRows ?? []).reduce<Record<string, boolean>>((m, r) => {
            m[String(r.platform_key ?? "")] = String(r.oauth_ready) === "true" || r.oauth_ready === true;
            return m;
          }, {});
        } catch {
          // 就绪表读取失败时保守处理：oauth 平台一律按未就绪降级
        }
        const list: PlatformCfg[] = (cfgs ?? [])
          .filter((r) => String(r.status ?? "启用") !== "停用")
          .map((r) => {
            const isOAuth = r.auth_type === "oauth";
            const name = String(r.name ?? "");
            const ready = readyMap[name] ?? false;
            return {
              name,
              region: String(r.region ?? ""),
              // OAuth 平台按其授权能力归入「一键 OAuth 授权」区；
              // oauth_ready=false 仅表示后端应用密钥/接入待配置，按钮点击时提示并允许转手动授权，不再降级隐藏
              auth_type: isOAuth ? ("oauth" as const) : ("manual" as const),
              status: String(r.status ?? "启用"),
              oauth_ready: ready,
            };
          })
          .filter((p) => p.name);
        setPlatforms(list.length > 0 ? list : fallbackPlatforms);
      })
      .catch((e) => {
        console.error("[auth] 加载平台配置失败，使用内置兜底", e);
        setPlatforms(fallbackPlatforms);
      })
      .finally(() => setCfgLoading(false));
  };

  useEffect(() => {
    load();
    loadPlatforms();
  }, []);

  const authorizedCount = rows.filter((r) => r.status === "已授权").length;
  const expiringCount = rows.filter((r) => r.status === "即将到期").length;

  // 按授权类型拆板块（一个平台只出现在一个板块，归属由后台配置决定）
  const oauthPlatforms = platforms.filter((p) => p.auth_type === "oauth");
  const manualPlatforms = platforms.filter((p) => p.auth_type === "manual");

  // 按区域分组（右上角「+新增授权」全量弹窗用）
  const regionGroups = useMemo(() => {
    const map = new Map<string, PlatformCfg[]>();
    platforms.forEach((p) => {
      const region = p.region || "其他";
      if (!map.has(region)) map.set(region, []);
      map.get(region)!.push(p);
    });
    return [...map.entries()];
  }, [platforms]);

  const isAuthorized = (platformKey: string) => rows.some((r) => r.platform === platformKey && r.status === "已授权");

  // 选择平台弹窗：点击卡片后按类型分流；oauth 未就绪的平台转手动授权表单
  const handlePick = (p: PlatformCfg) => {
    setPickOpen(false);
    if (p.auth_type === "oauth" && !p.oauth_ready) {
      toast.info(t("auth.oauthNotReady", { platform: p.name }));
      openForm(p.name);
    } else if (p.auth_type === "oauth") {
      handleOAuth(p.name);
    } else {
      openForm(p.name);
    }
  };

  // 手动授权：打开填写表单（重置凭据，避免不同平台字段串用）
  const openForm = (platformKey?: string) => {
    setForm({ ...emptyForm, platform: platformKey ?? "Amazon US", creds: {} });
    setFormOpen(true);
  };

  // 一键 OAuth 授权：输入店铺标识后跳转平台官方授权页
  // 平台未就绪（缺应用密钥/后端未接入）时提示并转手动授权表单，避免点进必失败的流程
  const handleOAuth = async (platformKey: string) => {
    const cfg = platforms.find((p) => p.name === platformKey);
    if (cfg?.auth_type === "oauth" && !cfg.oauth_ready) {
      toast.info(t("auth.oauthNotReady", { platform: platformKey }));
      openForm(platformKey);
      return;
    }
    try {
      const shop = window.prompt(t("auth.oauthPrompt", { platform: platformKey }));
      if (!shop) return;
      const url = await getOAuthUrl(platformKey, shop.trim());
      window.location.href = url;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (/缺少环境变量|SHOPIFY_CLIENT|TIKTOK_APP|LAZADA|SHOPEE/i.test(msg)) {
        toast.error(t("auth.oauthNotConfigured", { platform: platformKey }));
        openForm(platformKey);
      } else {
        toast.error(e instanceof Error ? e.message : t("auth.getUrlFail"));
      }
    }
  };

  // 手动授权保存：先做必填校验，再调服务端真实校验凭据，通过后才入库
  // 可校验平台（Amazon/Walmart/Etsy）：校验通过 -> 已授权；失败 -> 拒绝保存并提示
  // 暂不可校验平台（eBay/Temu/SHEIN/AliExpress）：保存为「待验证」，绝不直接标记已授权
  const handleSave = async () => {
    if (!form.shop_name.trim()) {
      toast.error(t("auth.shopNameRequired"));
      return;
    }
    const fields = manualCredFields[form.platform] ?? [];
    for (const f of fields) {
      if (f.required !== false && !String(form.creds?.[f.key] ?? "").trim()) {
        toast.error(t("auth.credsRequired", { field: t(f.labelKey) }));
        return;
      }
    }
    setSaving(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(`${supabaseUrl}/functions/v1/verify-shop-auth`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          action: "save",
          shop_name: form.shop_name.trim(),
          platform: form.platform,
          region: form.region.trim(),
          credentials: form.creds,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data) {
        toast.error(data?.message ?? data?.error ?? t("auth.verifyCredFail"));
        setSaving(false);
        return;
      }
      if (data.verifyable && !data.valid) {
        toast.error(data.message ?? t("auth.verifyCredFail"));
        setSaving(false);
        return;
      }
      if (data.status === "已授权") {
        toast.success(t("auth.verifyPass"));
      } else {
        toast.info(data.message ?? t("auth.verifyPending"));
      }
      setFormOpen(false);
      setForm(emptyForm);
      load();
    } catch (e) {
      console.error("[auth] 新增授权失败", e);
      toast.error(e instanceof Error ? e.message : t("auth.verifyCredFail"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteRow("shop_auths", deleting.id);
      console.log("[auth] 删除授权成功", { id: deleting.id });
      setDeleting(null);
      toast.success(t("common.deleted"));
      load();
    } catch (e) {
      console.error("[auth] 删除授权失败", e);
      setDeleting(null);
      toast.error(t("common.failed", { reason: e instanceof Error ? e.message : "" }));
    }
  };

  const renderPlatformCard = (p: PlatformCfg) => {
    const authed = isAuthorized(p.name);
    const oauth = p.auth_type === "oauth";
    const st = styleOf(p.name);
    return (
      <div
        key={p.name}
        className={cn(
          "group relative overflow-hidden rounded-xl border bg-card p-4 shadow-soft transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lift",
          authed ? "border-emerald-200" : "border-border hover:border-primary/30"
        )}
      >
        {/* 悬浮提示 */}
        <div className="pointer-events-none absolute left-1/2 top-2 z-20 w-max max-w-[220px] -translate-x-1/2 translate-y-0 rounded-lg bg-slate-900 px-3 py-1.5 text-center text-xs text-white opacity-0 shadow-lg transition-opacity duration-200 group-hover:opacity-100">
          {oauth ? t("auth.oauthHover") : t("auth.manualHover")}
          <span className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-slate-900" />
        </div>
        <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-primary/5 opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100" />
        <div className="relative flex items-start justify-between">
          <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br text-lg font-bold text-white shadow-sm", st.color)}>
            {st.letter}
          </div>
          {authed && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600">
              <CheckCircle2 size={12} /> {t("已授权")}
            </span>
          )}
        </div>
        <div className="relative mt-3">
          <div className="font-semibold">{p.name}</div>
          <div className="text-xs text-muted-foreground">{t(p.region)}</div>
          {/* 卡片内小字备注：标注该平台授权方式；oauth 未就绪时提示待配置 */}
          <div className={cn("mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium", oauth ? (p.oauth_ready ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600") : "bg-amber-50 text-amber-600")}>
            {oauth ? <Zap size={11} /> : <KeyRound size={11} />}
            {oauth ? (p.oauth_ready ? t("auth.oauthTag") : t("auth.oauthPending")) : t("auth.manualTag")}
          </div>
        </div>
        <Button
          size="sm"
          variant={authed ? "outline" : "default"}
          className="relative mt-3 w-full"
          onClick={() => {
            if (oauth && !p.oauth_ready) {
              toast.info(t("auth.oauthNotReady", { platform: p.name }));
              openForm(p.name);
            } else if (oauth) {
              handleOAuth(p.name);
            } else {
              openForm(p.name);
            }
          }}
        >
          {authed ? t("auth.reauth") : oauth ? (p.oauth_ready ? t("auth.oneClick") : t("auth.manualAuth")) : t("auth.manualAuth")}
        </Button>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* 统计 + 新增入口 */}
      <div className="flex items-start justify-between gap-4">
        <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label={t("auth.authorizedShops")} value={String(authorizedCount)} icon={<Store size={18} />} tone="success" />
          <StatCard label={t("auth.expiring")} value={String(expiringCount)} delta={t("auth.needRenew")} trend="down" icon={<ShieldCheck size={18} />} tone="warning" />
          <StatCard label={t("auth.platforms")} value={String(platforms.length)} icon={<Link2 size={18} />} tone="violet" />
        </div>
        <Button size="sm" className="shrink-0" onClick={() => setPickOpen(true)}>
          <Plus size={15} /> {t("auth.add")}
        </Button>
      </div>

      {/* 一键 OAuth 授权区 */}
      <div>
        <div className="mb-1 flex items-start gap-2">
          <h2 className="text-sm font-semibold text-foreground">{t("auth.oauthGroup")} · {oauthPlatforms.length}</h2>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600">
            <Zap size={11} /> {t("auth.oauthGroupTag")}
          </span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{t("auth.oauthGroupDesc")}</p>
        {cfgLoading ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-10 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" /> {t("common.loading")}
          </div>
        ) : oauthPlatforms.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card py-8 text-center text-sm text-muted-foreground">
            {t("auth.oauthEmpty")}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {oauthPlatforms.map(renderPlatformCard)}
          </div>
        )}
      </div>

      {/* 手动授权区 */}
      <div>
        <div className="mb-1 flex items-start gap-2">
          <h2 className="text-sm font-semibold text-foreground">{t("auth.manualGroup")} · {manualPlatforms.length}</h2>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            <KeyRound size={11} /> {t("auth.manualGroupTag")}
          </span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{t("auth.manualGroupDesc")}</p>
        {cfgLoading ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-10 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" /> {t("common.loading")}
          </div>
        ) : manualPlatforms.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card py-8 text-center text-sm text-muted-foreground">
            {t("auth.manualEmpty")}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {manualPlatforms.map(renderPlatformCard)}
          </div>
        )}
      </div>

      {/* 已授权店铺列表 */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground">{t("auth.authorizedList")}</h2>
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">{t("auth.shopName")}</th>
                <th className="px-4 py-3 font-medium">{t("auth.channel")}</th>
                <th className="px-4 py-3 font-medium">{t("auth.region")}</th>
                <th className="px-4 py-3 font-medium">{t("auth.authTime")}</th>
                <th className="px-4 py-3 font-medium">{t("状态")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    <Loader2 size={18} className="mx-auto mb-2 animate-spin" />
                    {t("common.loading")}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    {t("auth.empty")}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{String(row.shop_name ?? "")}</td>
                    <td className="px-4 py-3 text-muted-foreground">{String(row.platform ?? "")}</td>
                    <td className="px-4 py-3 text-muted-foreground">{String(row.region ?? "")}</td>
                    <td className="px-4 py-3 text-muted-foreground">{String(row.authorized_at ?? "")}</td>
                    <td className="px-4 py-3"><StatusBadge status={String(row.status ?? "")} /></td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-600 hover:text-rose-600" onClick={() => setDeleting(row)}>
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
      </div>

      {/* 右上角「+新增授权」：按区域分组展示全部平台的全量入口 */}
      <Dialog open={pickOpen} onOpenChange={setPickOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("auth.pickTitle")}</DialogTitle>
            <DialogDescription>{t("auth.pickDesc")}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-5 overflow-y-auto py-2 pr-1">
            {regionGroups.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">{t("auth.pickEmpty")}</div>
            ) : (
              regionGroups.map(([region, list]) => (
                <div key={region}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(region)}</span>
                    <span className="h-px flex-1 bg-border" />
                    <span className="text-xs text-muted-foreground">{list.length}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                    {list.map((p) => {
                      const st = styleOf(p.name);
                      const oauth = p.auth_type === "oauth";
                      const authed = isAuthorized(p.name);
                      return (
                        <button
                          key={p.name}
                          type="button"
                          onClick={() => handlePick(p)}
                          className={cn(
                            "group flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lift",
                            authed ? "border-emerald-200 bg-emerald-50/40" : "border-border bg-card"
                          )}
                        >
                          <div className="flex w-full items-center justify-between">
                            <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br text-sm font-bold text-white shadow-sm", st.color)}>
                              {st.letter}
                            </div>
                            {authed && <CheckCircle2 size={14} className="text-emerald-500" />}
                          </div>
                          <div className="font-medium leading-tight">{p.name}</div>
                          <div className={cn("inline-flex items-center gap-1 text-[11px] font-medium", oauth ? "text-emerald-600" : "text-amber-600")}>
                            {oauth ? <Zap size={10} /> : <KeyRound size={10} />}
                            {oauth ? t("auth.oauthTag") : t("auth.manualTag")}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickOpen(false)}>{t("common.cancel")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 手动授权表单弹窗 */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("auth.addTitle")}</DialogTitle>
            <DialogDescription>{t("auth.addDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>{t("auth.shopName")} <span className="text-rose-500">*</span></Label>
              <Input value={form.shop_name} onChange={(e) => setForm({ ...form, shop_name: e.target.value })} placeholder={t("auth.shopNamePlaceholder")} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("auth.channel")} <span className="text-rose-500">*</span></Label>
              <select
                value={form.platform}
                onChange={(e) => setForm({ ...form, platform: e.target.value, creds: {} })}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {manualPlatforms.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("auth.region")}</Label>
              <Input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder={t("auth.regionPlaceholder")} />
            </div>
            {/* 平台凭据字段（按平台动态渲染） */}
            {(manualCredFields[form.platform] ?? []).map((f) => (
              <div className="grid gap-1.5" key={f.key}>
                <Label>
                  {t(f.labelKey)} {f.required !== false && <span className="text-rose-500">*</span>}
                </Label>
                <Input
                  value={form.creds?.[f.key] ?? ""}
                  onChange={(e) => setForm({ ...form, creds: { ...(form.creds ?? {}), [f.key]: e.target.value } })}
                  placeholder={t(f.placeholderKey)}
                  type={/secret|token/i.test(f.key) ? "password" : "text"}
                  autoComplete="off"
                />
              </div>
            ))}
            {/* 校验说明 */}
            <div className="rounded-lg bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              {VERIFIABLE_PLATFORMS.has(form.platform)
                ? t("auth.verifyHint.verifyable")
                : t("auth.verifyHint.pending")}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 size={14} className="mr-1 animate-spin" />}
              {saving ? t("auth.verifying") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.confirmDelete")}</AlertDialogTitle>
            <AlertDialogDescription>{t("auth.deleteDesc", { name: String(deleting?.shop_name ?? "") })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-rose-600 hover:bg-rose-700">{t("common.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AuthCenter() {
  const { t } = useLanguage();
  return (
    <div className="space-y-5">
      <PageHeader title={t("auth.centerTitle")} description={t("auth.centerDesc")} />
      <Tabs defaultValue="shop">
        <TabsList>
          <TabsTrigger value="shop">{t("auth.tabShop")}</TabsTrigger>
          <TabsTrigger value="source">{t("auth.tabSource")}</TabsTrigger>
        </TabsList>
        <TabsContent value="shop" className="space-y-5">
          <AuthShopTab />
        </TabsContent>
        <TabsContent value="source" className="space-y-5">
          <AuthSourcePage />
        </TabsContent>
      </Tabs>
    </div>
  );
}
