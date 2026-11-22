import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Package, PackagePlus, Trash2, ExternalLink, Loader2, CheckCheck, PackageCheck,
  Puzzle, Copy, X, Store, Settings2, AlertCircle, RotateCcw, Search, Tag, Download,
  BadgeCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, StatCard } from "@/components/page-header";
import { DockPanel } from "@/components/dock-panel";
import { toast } from "sonner";
import { supabase, supabaseUrl, supabaseAnonKey } from "@/supabase/client";
import {
  loadCollectSettings, saveCollectSettings, applyPriceFormula, filterBannedWords,
  DEFAULT_SETTINGS, type CollectSettings,
} from "@/lib/collect-settings";
import { useLanguage } from "@/i18n/LanguageContext";
// 授权状态白名单：店铺状态机上线后「即将到期」的店仍然可用，
// 若此处写死 status = "已授权"，这批店会从采集目标店铺里凭空消失（功能性回归）。
import { ACTIVE_AUTH_STATUSES } from "@/lib/shop-status";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/products/collect")({
  component: Collect,
});

// 1688/淘宝/天猫风控极严：对数据中心 IP 返回 punish 拦截页（action=deny，无滑块机会），
// 服务器代理路径必然失败 —— 这些平台的条目一律引导用户用浏览器插件（本地登录态）采集。
const STRONG_ANTI_CRAWL = /1688\.com|taobao\.com|tmall\.com/i;
const isStrongAntiCrawl = (u: string | null | undefined) => !!u && STRONG_ANTI_CRAWL.test(u);

// 从货源链接提取短标识（1688 offer ID / 淘宝 item ID / 路径尾段），用于"待插件采集"占位名
function shortSourceId(u: string): string {
  try {
    const url = new URL(u);
    const offer = url.pathname.match(/offer\/(\d+)/);
    if (offer) return `offer/${offer[1]}`;
    const itemId = url.searchParams.get("id");
    if (itemId) return `id=${itemId}`;
    const seg = url.pathname.split("/").filter(Boolean).pop();
    return seg ? seg.slice(0, 40) : url.hostname;
  } catch {
    return u.slice(0, 40);
  }
}

type BoxTab = "public" | "platform" | "failed" | "settings";

interface CollectVariant {
  name: string;
  sku: string;
  price: number;
  image: string;
  stock: number;
}

interface CollectRow {
  id: string;
  name: string;
  source: string | null;
  category: string | null;
  description: string | null;
  price: number | null;
  original_price: number | null;
  currency: string | null;
  image: string | null;
  images: unknown;
  detail_images: unknown;
  sku: string | null;
  brand: string | null;
  platform: string | null;
  seller: string | null;
  rating: number | null;
  reviews: number | null;
  sales: number | null;
  stock: number | null;
  variants: unknown;
  status: string | null;
  error_message: string | null;
  claimed_shop: string | null;
  claimed_shop_id: string | null;
  claimed_at: string | null;
  created_at: string | null;
}

interface ShopRow {
  id: string;
  shop_name: string;
  platform: string | null;
  region: string | null;
}

function Collect() {
  const { t } = useLanguage();
  const [tab, setTab] = useState<BoxTab>("public");
  const [rows, setRows] = useState<CollectRow[]>([]);
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [claimShop, setClaimShop] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [pluginOpen, setPluginOpen] = useState(false);
  const [dockOpen, setDockOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [urls, setUrls] = useState("");
  const [collecting, setCollecting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, fail: 0 });
  const [platformFilter, setPlatformFilter] = useState("");

  // ===== 采集设置 =====
  const [settings, setSettings] = useState<CollectSettings>(DEFAULT_SETTINGS);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const load = () => {
    supabase
      .from("collect_items")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data }) => {
        setRows((data ?? []) as unknown as CollectRow[]);
        setLoading(false);
      });
    supabase
      .from("shop_auths")
      .select("id, shop_name, platform, region")
      .in("status", [...ACTIVE_AUTH_STATUSES])
      .then(({ data }) => setShops((data ?? []) as ShopRow[]));
  };

  useEffect(() => {
    load();
    loadCollectSettings().then(setSettings).catch(() => undefined);
  }, []);

  // ===== 数据分桶：公用箱 / 平台箱 / 失败 =====
  const publicRows = useMemo(
    () => rows.filter((r) => (r.status || "待处理") === "待处理"),
    [rows],
  );
  const platformRows = useMemo(
    () => rows.filter((r) => r.status === "已认领" || r.status === "已上架"),
    [rows],
  );
  const failedRows = useMemo(
    () => rows.filter((r) => r.status === "采集失败"),
    [rows],
  );
  const shown = tab === "public" ? publicRows : tab === "platform" ? platformRows : failedRows;
  const filtered = platformFilter
    ? platformRows.filter((r) => r.claimed_shop === platformFilter)
    : shown;
  const platformShops = useMemo(
    () => Array.from(new Set(platformRows.map((r) => r.claimed_shop).filter(Boolean))) as string[],
    [platformRows],
  );

  // ===== 批量认领：应用采集设置（价格公式/库存/违禁词）=====
  const claim = async () => {
    if (!claimShop) {
      toast.error(t("collect.claimPickShop"));
      return;
    }
    const ids = Array.from(selected);
    if (ids.length === 0) {
      toast.error(t("collect.claimPickItems"));
      return;
    }
    setClaiming(true);
    let ok = 0;
    for (const id of ids) {
      const row = rows.find((r) => r.id === id);
      if (!row) continue;
      // 应用采集设置
      const newPrice = applyPriceFormula(Number(row.price) || 0, settings);
      const newName = filterBannedWords(row.name, settings);
      const newDesc = filterBannedWords(row.description || "", settings);
      const { error } = await supabase
        .from("collect_items")
        .update({
          status: "已认领",
          claimed_shop: shops.find((s) => s.id === claimShop)?.shop_name || claimShop,
          claimed_shop_id: claimShop,
          claimed_at: new Date().toISOString(),
          // 保存定价后的售价到 original_price 字段行（采购价保留在 price）
          original_price: newPrice > 0 ? newPrice : row.original_price,
          stock: settings.default_stock,
          name: newName || row.name,
          description: newDesc || row.description,
        })
        .eq("id", id);
      if (!error) ok++;
    }
    setClaiming(false);
    setSelected(new Set());
    toast.success(t("collect.claimDone", { count: ok, shop: shops.find((sp) => sp.id === claimShop)?.shop_name || claimShop }));
    load();
  };

  // ===== 认领后上架：写入 products 表 =====
  const publishOne = async (row: CollectRow) => {
    setImportingId(row.id);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData.session?.user?.id;
      // 售价优先用认领时定价（original_price），否则用价格公式现算
      const sellPrice = Number(row.original_price) > 0
        ? Number(row.original_price)
        : applyPriceFormula(Number(row.price) || 0, settings);
      const mainImgs = Array.isArray(row.images) ? (row.images as string[]) : [];
      const detailImgs = Array.isArray(row.detail_images) ? (row.detail_images as string[]) : [];
      const allImages = Array.from(new Set([...(row.image ? [row.image] : []), ...mainImgs, ...detailImgs])).filter(Boolean).slice(0, 40);
      const { error } = await supabase.from("products").insert({
        id: crypto.randomUUID(),
        name: row.name,
        sku: row.sku || `COLLECT-${Date.now().toString(36).toUpperCase()}`,
        category: row.category || row.claimed_shop || tt('ai.tabCollect'),
        price: sellPrice,
        stock: Number(row.stock) || settings.default_stock,
        status: "在售",
        image: row.image || "",
        images: allImages,
        primary_image: row.image || allImages[0] || "",
        description: row.description || "",
        variants: (row.variants as any) ?? null,
        source_platform: row.platform || "",
        source_url: row.source || "",
        shop_id: row.claimed_shop_id || null,
        user_id: uid,
      });
      if (error) throw new Error(error.message);
      await supabase.from("collect_items").update({ status: "已上架" }).eq("id", row.id);
      toast.success(t("collect.importedOne", { name: row.name.slice(0, 20) }));
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("collect.importFail"));
    } finally {
      setImportingId(null);
    }
  };

  const retryOne = async (row: CollectRow) => {
    if (!row.source || importingId !== null) return;
    setImportingId(row.id);
    // 1688/淘宝系：服务器代理必被风控拦截（数据中心 IP 被拒），直接引导插件，不再空转
    if (isStrongAntiCrawl(row.source)) {
      const msg = t("collect.pluginOnlyError");
      await supabase.from("collect_items").update({ error_message: msg.slice(0, 300) }).eq("id", row.id);
      toast.error(msg, { duration: 8000 });
      load();
      return;
    }
    const session = (await supabase.auth.getSession()).data.session;
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/collect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ url: row.source }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || tt('collect.fail'));
      const d = result.data;
      const { error } = await supabase
        .from("collect_items")
        .update({
          name: d.name, price: d.price, original_price: d.originalPrice ?? null, image: d.image, images: d.images,
          description: d.description, sku: d.sku, brand: d.brand, seller: d.seller,
          rating: d.rating, reviews: d.reviews, sales: d.sales, variants: d.variants,
          platform: d.platform, currency: d.currency,
          status: "待处理", error_message: null,
        })
        .eq("id", row.id);
      if (error) throw new Error(error.message);
      toast.success(t("collect.retryOk"));
      load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : tt('collect.fail');
      await supabase.from("collect_items").update({ error_message: msg }).eq("id", row.id);
      toast.error(msg);
      load();
    } finally {
      setImportingId(null);
    }
  };

  const deleteOne = async (id: string) => {
    const { error } = await supabase.from("collect_items").delete().eq("id", id).select();
    if (error) {
      toast.error(`${t("collect.deleteFail")}: ${error.message}`);
      return;
    }
    load();
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => {
      if (prev.size === filtered.length && filtered.length > 0) return new Set();
      return new Set(filtered.map((r) => r.id));
    });
  };

  // ===== 链接批量采集：逐条调 collect EF 解析后入库 =====
  const submitUrls = async () => {
    const list = urls
      .split(/[\n,，]+/)
      .map((s) => s.trim())
      .filter((s) => /^https?:\/\//i.test(s))
      .slice(0, 30);
    if (list.length === 0) {
      toast.error(t("collect.urlFirst"));
      return;
    }
    setCollecting(true);
    setProgress({ done: 0, total: list.length, fail: 0 });
    const session = (await supabase.auth.getSession()).data.session;
    const uid = session?.user?.id;
    let fail = 0;
    let pluginOnly = 0;
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      setProgress({ done: i, total: list.length, fail });
      // 1688/淘宝系：服务器代理必被风控拦截，直接入箱标记"待插件采集"，不空转服务器采集
      if (isStrongAntiCrawl(u)) {
        pluginOnly++;
        const plat = /1688\.com/i.test(u) ? "1688" : /taobao\.com/i.test(u) ? tt('platform.name.taobao') : tt('platform.name.tmall');
        await supabase.from("collect_items").insert({
          name: t("collect.pluginOnlyName", { platform: plat, id: shortSourceId(u) }),
          source: u,
          category: tt('collect.linkTitle'),
          platform: plat,
          status: "待处理",
          error_message: null,
          user_id: uid,
        });
        continue;
      }
      let rowId: string | null = null;
      try {
        const { data: inserted } = await supabase
          .from("collect_items")
          .insert({ name: tt('collect.workingName'), source: u, status: "采集中", category: tt('collect.linkTitle'), user_id: uid })
          .select("id");
        rowId = Array.isArray(inserted) && inserted[0] ? (inserted[0] as { id: string }).id : null;
        const resp = await fetch(`${supabaseUrl}/functions/v1/collect`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({ url: u }),
        });
        const result = await resp.json();
        if (!resp.ok) throw new Error(result.error || tt('collect.fail'));
        const d = result.data;
        const autoShop = settings.auto_claim_shop ? shops.find((s) => s.shop_name === settings.auto_claim_shop) : null;
        const newPrice = autoShop ? applyPriceFormula(Number(d.price) || 0, settings) : 0;
        await supabase
          .from("collect_items")
          .update({
            name: d.name || u.slice(0, 80),
            price: d.price ?? null,
            original_price: newPrice > 0 ? newPrice : d.originalPrice ?? null,
            image: d.image || "",
            images: d.images || [],
            detail_images: d.detailImages || [],
            description: d.description || "",
            sku: d.sku || "",
            brand: d.brand || "",
            seller: d.seller || "",
            rating: d.rating ?? null,
            reviews: d.reviews ?? null,
            sales: d.sales ?? null,
            stock: d.stock ?? null,
            variants: d.variants || [],
            platform: d.platform || "",
            currency: d.currency || "",
            status: autoShop ? tt('collect.statClaimed') : "待处理",
            claimed_shop: autoShop ? autoShop.shop_name : null,
            claimed_shop_id: autoShop ? autoShop.id : null,
            claimed_at: autoShop ? new Date().toISOString() : null,
            error_message: null,
          })
          .eq("id", rowId!);
      } catch (e) {
        fail++;
        const msg = e instanceof Error ? e.message : tt('collect.fail');
        if (rowId) {
          await supabase
            .from("collect_items")
            .update({ status: "采集失败", error_message: msg.slice(0, 300) })
            .eq("id", rowId!);
        } else {
          // 反馈闭环兜底：入库行不存在（insert 即失败）时补插失败记录，失败原因真实可见可重试
          await supabase.from("collect_items").insert({
            name: u.slice(0, 80),
            source: u,
            category: tt('collect.linkTitle'),
            status: "采集失败",
            error_message: msg.slice(0, 300),
            user_id: uid,
          });
        }
      }
    }
    setProgress({ done: list.length, total: list.length, fail });
    setCollecting(false);
    setUrls("");
    const serverCount = list.length - pluginOnly - fail;
    if (pluginOnly > 0) {
      toast.info(t("collect.pluginOnlyToast", { count: pluginOnly }), { duration: 9000 });
    }
    if (fail === 0 && serverCount > 0) toast.success(t("collect.serverOkDone", { count: serverCount }));
    else if (fail > 0) toast.warning(t("collect.serverMixedDone", { ok: serverCount, fail }));
    load();
  };

  // ===== 采集设置保存 =====
  const saveSettings = async () => {
    setSettingsSaving(true);
    try {
      await saveCollectSettings(settings);
      toast.success(t("collect.settingsSaved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tt('common.saveFail'));
    } finally {
      setSettingsSaving(false);
    }
  };

  // 设置预览：示例 10 元采购价 → 售价
  const previewPrice = applyPriceFormula(10, settings);

  const tabs: { key: BoxTab; label: string; count: number; icon: typeof Package }[] = [
    { key: "public", label: t("collect.tabPublic"), count: publicRows.length, icon: Package },
    { key: "platform", label: t("collect.tabPlatform"), count: platformRows.length, icon: Store },
    { key: "failed", label: t("collect.tabFailed"), count: failedRows.length, icon: AlertCircle },
    { key: "settings", label: t("collect.tabSettings"), count: 0, icon: Settings2 },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        code="01 / COLLECT"
        title={t("collect.pageTitle")}
        description={t("collect.pageDesc")}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setPluginOpen(true)}>
              <Puzzle size={15} /> {t("collect.pluginBtn")}
            </Button>
          </div>
        }
      />

      {/* 统计卡 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t("collect.statTotal")} value={String(rows.length)} icon={<Package size={17} />} tone="primary" />
        <StatCard label={t("collect.statPending")} value={String(publicRows.length)} icon={<PackagePlus size={17} />} tone="warning" />
        <StatCard label={t("collect.statClaimed")} value={String(platformRows.filter((r) => r.status === "已认领").length)} icon={<Store size={17} />} tone="success" />
        <StatCard label={t("collect.statFailed")} value={String(failedRows.length)} icon={<AlertCircle size={17} />} tone="violet" />
      </div>

      {/* 标签页 */}
      <div className="flex items-center gap-1 rounded-xl bg-surface-sunken p-1">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            onClick={() => { setTab(tb.key); setSelected(new Set()); setPlatformFilter(""); }}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition-colors ${
              tab === tb.key ? "bg-card text-fg shadow-soft" : "text-fg-muted hover:text-fg"
            }`}
          >
            <tb.icon size={15} />
            {tb.label}
            {tb.count > 0 && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tab === tb.key ? "bg-primary/10 text-primary" : "bg-muted-foreground/15 text-fg-muted"}`}>
                {tb.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ===== 采集设置标签 ===== */}
      {tab === "settings" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-6 shadow-soft">
            <h3 className="font-display font-semibold">{t("collect.settingsPrice")}</h3>
            <p className="mt-1 text-xs text-fg-muted">{t("collect.settingsPriceDesc")}</p>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="text-xs font-semibold text-fg-muted">{t("collect.settingsMarkup")}</label>
                <div className="relative mt-1.5">
                  <Input
                    type="number"
                    value={settings.price_markup}
                    onChange={(e) => setSettings({ ...settings, price_markup: Number(e.target.value) || 0 })}
                    className="pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-fg-muted">%</span>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-fg-muted">{t("collect.settingsFee")}</label>
                <Input
                  type="number"
                  className="mt-1.5"
                  value={settings.price_fixed_fee}
                  onChange={(e) => setSettings({ ...settings, price_fixed_fee: Number(e.target.value) || 0 })}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-fg-muted">{t("collect.settingsEnding")}</label>
                <Input
                  className="font-data mt-1.5"
                  placeholder={t("pd.priceEndingPh")}
                  value={settings.price_ending}
                  onChange={(e) => setSettings({ ...settings, price_ending: e.target.value })}
                />
              </div>
            </div>
            <p className="font-data mt-3 rounded-md bg-surface-sunken/60 px-3 py-2 text-xs text-fg-muted">
              {t("collect.settingsPreview", { cost: 10, price: previewPrice.toFixed(2) })}
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card p-6 shadow-soft">
            <h3 className="font-display font-semibold">{t("collect.settingsRules")}</h3>
            <div className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-semibold text-fg-muted">{t("collect.settingsStock")}</label>
                <Input
                  type="number"
                  className="mt-1.5 max-w-[200px]"
                  value={settings.default_stock}
                  onChange={(e) => setSettings({ ...settings, default_stock: Number(e.target.value) || 0 })}
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
                  <Tag size={12} /> {t("collect.settingsBanned")}
                </label>
                <Input
                  className="mt-1.5"
                  placeholder={t("collect.settingsBannedHint")}
                  value={settings.banned_words}
                  onChange={(e) => setSettings({ ...settings, banned_words: e.target.value })}
                />
                <p className="mt-1.5 text-xs text-fg-muted">{t("collect.settingsBannedDesc")}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-fg-muted">{t("collect.settingsAutoClaim")}</label>
                <select
                  className="mt-1.5 h-8 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  value={settings.auto_claim_shop}
                  onChange={(e) => setSettings({ ...settings, auto_claim_shop: e.target.value })}
                >
                  <option value="">{t("collect.settingsAutoClaimOff")}</option>
                  {shops.map((s) => (
                    <option key={s.id} value={s.shop_name}>{s.shop_name}{s.platform ? `（${s.platform}${s.region ? " · " + s.region : ""}）` : ""}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <Button onClick={saveSettings} disabled={settingsSaving}>
            {settingsSaving ? <Loader2 size={15} className="animate-spin" /> : <CheckCheck size={15} />}
            {t("collect.settingsSave")}
          </Button>
        </div>
      )}

      {/* ===== 链接采集（批量粘贴商品链接）===== */}
      {tab === "public" && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">{t("collect.linkTitle")}</h3>
              <p className="mt-0.5 text-xs text-fg-muted">
                {t("collect.linkDesc")}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {["1688", "taobao", "Amazon", "AliExpress", "Temu", "eBay", "TikTok", "WooCommerce", "generic"].map((p) => (
                <span key={p} className="rounded-full bg-cargo-teal/10 px-2 py-0.5 text-[11px] font-medium text-cargo-teal">{p === "taobao" ? t("collect.platTaobao") : p === "generic" ? t("collect.platGeneric") : p}</span>
              ))}
            </div>
          </div>
          <textarea
            className="font-data mt-3 min-h-[88px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
            placeholder={"https://detail.1688.com/offer/xxxxx.html\nhttps://item.taobao.com/item.htm?id=xxxxx\nhttps://www.amazon.com/dp/XXXXXXXXXX"}
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            disabled={collecting}
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={submitUrls} disabled={collecting || !urls.trim()}>
              {collecting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {collecting
                ? (progress.fail > 0
                    ? t("collect.progressBtnFail", { done: progress.done, total: progress.total, fail: progress.fail })
                    : t("collect.progressBtn", { done: progress.done, total: progress.total }))
                : (urls.trim()
                    ? t("collect.startBtn", { count: urls.trim().split(/[\n,，]+/).map((x) => x.trim()).filter((s) => /^https?:\/\//i.test(s)).length })
                    : t("collect.startBtnEmpty"))}
            </Button>
            <span className="text-xs text-fg-muted">{t("collect.urlParseHint")}</span>
          </div>
          <div className="mt-2 flex items-start gap-1.5 rounded-md bg-warning-bg px-3 py-2 text-xs text-warning">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span>{t("collect.serverModeHint")}</span>
          </div>
        </div>
      )}

      {/* ===== 关键词采集入口（公用箱标签下）===== */}
      {tab === "public" && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-sunken/40 px-4 py-3">
          <Search size={15} className="text-fg-muted" />
          <Input
            className="max-w-xs"
            placeholder={t("collect.keywordPlaceholder")}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && keyword.trim()) {
                window.open(`https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(keyword.trim())}`, "_blank");
              }
            }}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!keyword.trim()}
            onClick={() => window.open(`https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(keyword.trim())}`, "_blank")}
          >
            {t("collect.keywordGo")}
          </Button>
          <span className="text-xs text-fg-muted">{t("collect.keywordHint")}</span>
        </div>
      )}

      {/* ===== 列表标签（公用/平台/失败共用表格）===== */}
      {tab !== "settings" && (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
          {/* 工具条 */}
          <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface-sunken px-4 py-3">
            {tab === "public" && (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[oklch(0.58_0.165_42)]"
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    onChange={toggleAll}
                  />
                  {t("collect.selectAll")}
                </label>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:border-primary"
                  value={claimShop}
                  onChange={(e) => setClaimShop(e.target.value)}
                >
                  <option value="">{t("collect.claimSelectShop")}</option>
                  {shops.map((s) => (
                    <option key={s.id} value={s.id}>{s.shop_name}{s.platform ? `（${s.platform}${s.region ? " · " + s.region : ""}）` : ""}</option>
                  ))}
                </select>
                <Button size="sm" onClick={claim} disabled={claiming || selected.size === 0 || !claimShop}>
                  {claiming ? <Loader2 size={13} className="animate-spin" /> : <Store size={13} />}
                  {t("collect.claimBtn", { count: selected.size })}
                </Button>
              </>
            )}
            {tab === "platform" && platformShops.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-fg-muted">{t("collect.filterShop")}</span>
                {platformShops.map((s) => (
                  <button
                    key={s}
                    onClick={() => setPlatformFilter(platformFilter === s ? "" : s)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      platformFilter === s ? "bg-primary text-primary-foreground" : "bg-surface-sunken text-fg-muted hover:text-fg"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            <span className="ml-auto text-xs text-fg-muted">{t("collect.rowCount", { count: filtered.length })}</span>
          </div>

          {/* 表头 */}
          <div className={`grid items-center gap-3 border-b border-border bg-muted/50 px-4 py-2.5 text-[11px] font-medium text-muted-foreground ${
            tab === "public" ? "grid-cols-[28px_64px_1.6fr_0.7fr_0.9fr_0.6fr_110px]" : "grid-cols-[64px_1.7fr_0.8fr_0.9fr_0.9fr_0.7fr_110px]"
          }`}>
            {tab === "public" && <span />}
            <span>{t("collect.imgCol")}</span>
            <span>{t("collect.name")}</span>
            <span>{tab === "failed" ? t("collect.errorCol") : t("collect.platformCol")}</span>
            <span>{tab === "platform" ? t("collect.sellPrice") : t("collect.price")}</span>
            <span>{tab === "platform" ? t("collect.claimedShop") : "SKU"}</span>
            <span>{t("collect.statusCol")}</span>
            <span className="text-right">{t("collect.actionCol")}</span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16 text-fg-muted">
              <Loader2 size={22} className="animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-fg-muted">
              <PackagePlus size={32} className="opacity-40" />
              <p className="text-sm">{t("collect.empty")}</p>
              <p className="text-xs">{t("collect.emptyHint")}</p>
            </div>
          ) : (
            filtered.map((row) => (
              <div
                key={row.id}
                className={`grid items-center gap-3 border-b border-border/60 px-4 py-3 transition-colors last:border-0 hover:bg-muted/60 ${
                  tab === "public" ? "grid-cols-[28px_64px_1.6fr_0.7fr_0.9fr_0.6fr_110px]" : "grid-cols-[64px_1.7fr_0.8fr_0.9fr_0.9fr_0.7fr_110px]"
                }`}
              >
                {tab === "public" && (
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[oklch(0.58_0.165_42)]"
                    checked={selected.has(row.id)}
                    onChange={() => toggleOne(row.id)}
                  />
                )}
                {row.image ? (
                  <img
                    src={row.image}
                    alt={row.name}
                    className="h-12 w-12 rounded-md border border-border object-cover"
                    onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-md border border-border bg-surface-sunken/40 text-fg-muted">
                    <Package size={16} />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{row.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-fg-muted">
                    {row.brand && <span>{row.brand}</span>}
                    {row.rating && Number(row.rating) > 0 && (
                      <span className="flex items-center gap-0.5">
                        <span className="text-cargo-gold">★</span>
                        <span className="font-data">{Number(row.rating).toFixed(1)}</span>
                      </span>
                    )}
                    {Array.isArray(row.variants) && (row.variants as CollectVariant[]).length > 0 && (
                      <span className="chip-violet rounded px-1.5 py-0.5 font-medium">
                        {(row.variants as CollectVariant[]).length} {t("collect.variantChip")}
                      </span>
                    )}
                    {row.source && (
                      <a href={row.source} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-primary">
                        <ExternalLink size={10} />
                        <span className="max-w-[160px] truncate">{row.source}</span>
                      </a>
                    )}
                  </div>
                </div>
                {tab === "failed" ? (
                  <span className="line-clamp-2 text-xs text-destructive">{row.error_message || tt('common.unknownError')}</span>
                ) : (
                  <span className="w-fit rounded-full bg-cargo-teal/12 px-2 py-0.5 text-[11px] font-medium text-cargo-teal">
                    {row.platform || "Web"}
                  </span>
                )}
                <span className="font-data text-sm font-medium">
                  {tab === "platform" ? (
                    <>
                      {row.original_price && Number(row.original_price) > 0 ? (
                        <span className="text-primary">{Number(row.original_price).toFixed(2)}</span>
                      ) : (
                        <span>{row.price ? Number(row.price).toFixed(2) : "—"}</span>
                      )}
                      {row.price ? (
                        <span className="ml-1 text-[11px] text-fg-muted">←{Number(row.price).toFixed(2)}</span>
                      ) : null}
                    </>
                  ) : (
                    <>
                      {row.price
                        ? `${row.currency === "CNY" ? "¥" : row.currency === "USD" ? "$" : ""}${Number(row.price).toFixed(2)}`
                        : "—"}
                      {row.original_price && Number(row.original_price) > Number(row.price ?? 0) && (
                        <span className="ml-1 text-[11px] text-fg-muted line-through">
                          {Number(row.original_price).toFixed(2)}
                        </span>
                      )}
                    </>
                  )}
                </span>
                {tab === "platform" ? (
                  <span className="truncate text-xs font-medium">
                    {row.claimed_shop ? (
                      <span className="inline-flex items-center gap-1" title={t("pd.claimedShopV")}>
                        <BadgeCheck size={13} className="shrink-0 text-harbor" />
                        <span className="truncate">{row.claimed_shop}</span>
                      </span>
                    ) : "—"}
                  </span>
                ) : (
                  <span className="font-data truncate text-xs text-fg-muted">{row.sku || "—"}</span>
                )}
                <span className={`w-fit rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  row.status === "已上架" ? "chip-teal" : row.status === "已认领" ? "chip-blue" : row.status === "采集失败" ? "bg-destructive/10 text-destructive" : "chip-gold"
                }`}>
                  {row.status ? t(`status.${row.status}`) : t("st.pending")}
                </span>
                <div className="flex items-center justify-end gap-1">
                  {tab === "public" && row.source && (
                    <Button size="sm" variant="outline" onClick={() => retryOne(row)} disabled={importingId !== null}>
                      <RotateCcw size={13} /> {t("collect.parseBtn")}
                    </Button>
                  )}
                  {tab === "failed" ? (
                    <Button size="sm" variant="outline" onClick={() => retryOne(row)} disabled={importingId !== null}>
                      {importingId === row.id ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} {t("collect.retryBtn")}
                    </Button>
                  ) : tab === "platform" && row.status === "已认领" ? (
                    <Button size="sm" variant="outline" onClick={() => publishOne(row)} disabled={importingId !== null}>
                      {importingId === row.id ? <Loader2 size={13} className="animate-spin" /> : <PackageCheck size={13} />}
                      {t("collect.publishBtn")}
                    </Button>
                  ) : tab === "platform" ? (
                    <span className="text-right text-xs text-fg-muted">{t("collect.imported")}</span>
                  ) : null}
                  <button
                    onClick={() => deleteOne(row.id)}
                    className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-danger-bg hover:text-destructive"
                    title={t("common.delete")}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* 浏览器插件对话框 */}
      {pluginOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm" onClick={() => setPluginOpen(false)}>
          <div
            className="glass relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={() => setPluginOpen(false)} className="absolute right-4 top-4 rounded-md p-1 text-fg-muted hover:bg-surface-hover hover:text-fg">
              <X size={16} />
            </button>
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink text-white">
                <Puzzle size={18} />
              </div>
              <div>
                <h3 className="font-display font-semibold">{t("collect.pluginTitle")}</h3>
                <p className="text-xs text-fg-muted">{t("collect.pluginDesc")}</p>
              </div>
            </div>

            <ol className="mt-5 space-y-3 text-sm">
              <li className="flex gap-3">
                <span className="font-data flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">1</span>
                <div>
                  <p className="font-medium">{t("collect.pluginStep1")}</p>
                  <p className="mt-0.5 text-xs text-fg-muted">{t("collect.pluginStep1Desc")}</p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="font-data flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">2</span>
                <div>
                  <p className="font-medium">{t("collect.pluginStep2")}</p>
                  <p className="mt-0.5 text-xs text-fg-muted">{t("collect.pluginStep2Desc")}</p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="font-data flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">3</span>
                <div>
                  <p className="font-medium">{t("collect.pluginStep3")}</p>
                  <p className="mt-0.5 text-xs text-fg-muted">{t("collect.pluginStep3Desc")}</p>
                </div>
              </li>
            </ol>

            {/* 直接用 ERP 账号密码登录即可，无需任何额外配置 */}
            <div className="mt-5 rounded-xl border border-border bg-surface-sunken p-4">
              <p className="text-sm font-medium">{t("collect.pluginStep3")}</p>
              <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                {t("collect.pluginStep3Desc")}
              </p>
              <Button
                className="mt-3 w-full"
                size="sm"
                onClick={() => {
                  setPluginOpen(false);
                  setDockOpen(true);
                }}
              >
                <Download size={14} className="mr-1.5" />
                {t("collect.gotoDock")}
              </Button>
              <p className="mt-2 text-center text-[11px] text-fg-muted">{t("collect.gotoDockHint")}</p>
            </div>
          </div>
        </div>
      )}

      {/* 扩展坞面板（含插件安装包下载，与顶栏 Dock 图标同一套） */}
      <DockPanel open={dockOpen} onClose={() => setDockOpen(false)} />
    </div>
  );
}
