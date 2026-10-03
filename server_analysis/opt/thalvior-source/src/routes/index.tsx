import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ShieldCheck,
  Package,
  ShoppingCart,
  Warehouse,
  Truck,
  BarChart3,
  ArrowRight,
  Sparkles,
  Globe,
  Zap,
  CheckCircle2,
  ArrowUpRight,
  Bot,
  Image,
  Languages,
  Play,
  Star,
  ChevronRight,
  MousePointerClick,
} from "lucide-react";
import { useLanguage } from "@/i18n/LanguageContext";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/auth-shell";

export const Route = createFileRoute("/")({
  component: Landing,
});

/* ───────── 功能亮点 ───────── */
const features = [
  { icon: MousePointerClick, titleKey: "land.feat1.title", descKey: "land.feat1.desc", color: "bg-blue-50 text-blue-600", accent: "group-hover:border-blue-200" },
  { icon: Package, titleKey: "land.feat2.title", descKey: "land.feat2.desc", color: "bg-violet-50 text-violet-600", accent: "group-hover:border-violet-200" },
  { icon: ShoppingCart, titleKey: "land.feat3.title", descKey: "land.feat3.desc", color: "bg-teal-50 text-teal-600", accent: "group-hover:border-teal-200" },
  { icon: Warehouse, titleKey: "land.feat4.title", descKey: "land.feat4.desc", color: "bg-amber-50 text-amber-600", accent: "group-hover:border-amber-200" },
  { icon: Truck, titleKey: "land.feat5.title", descKey: "land.feat5.desc", color: "bg-rose-50 text-rose-600", accent: "group-hover:border-rose-200" },
  { icon: BarChart3, titleKey: "land.feat6.title", descKey: "land.feat6.desc", color: "bg-emerald-50 text-emerald-600", accent: "group-hover:border-emerald-200" },
];

/* ───────── AI 能力展示 ───────── */
const aiFeatures = [
  { icon: Languages, title: "图片翻译", desc: "自动识别商品图片中的文字并翻译为目标语言" },
  { icon: Image, title: "图片处理", desc: "AI 生成专业电商主图，白底、场景化一键切换" },
  { icon: Sparkles, title: "文案优化", desc: "智能润色标题与描述，提升转化率和搜索排名" },
  { icon: Play, title: "视频生成", desc: "商品图片一键生成短视频，适配各平台投放" },
];

/* ───────── 数据统计 ───────── */
const stats = [
  { value: "10,000+", labelKey: "land.stat1" },
  { value: "50+", labelKey: "land.stat2" },
  { value: "99.9%", labelKey: "land.stat3" },
  { value: "3×", labelKey: "land.stat4" },
];

/* ───────── 支持平台 ───────── */
const platforms = ["Amazon", "Shopify", "eBay", "TikTok Shop", "Walmart", "Temu"];

/* ───────── 工作流程 ───────── */
const steps = [
  { num: "01", title: "一键采集", desc: "通过浏览器插件，从任意电商平台快速采集商品信息到采集箱" },
  { num: "02", title: "AI 增强", desc: "利用 AI 自动翻译图片、优化文案、生成主图和视频" },
  { num: "03", title: "批量刊登", desc: "编辑完成后一键上架到多个电商平台，批量管理" },
  { num: "04", title: "数据追踪", desc: "实时追踪销售数据、库存和物流状态，掌控全局" },
];

/* ═══════════════════════════════════════════════════════════
   动态货单看板
   ═══════════════════════════════════════════════════════════ */
function ManifestBoard() {
  const rows = [
    { route: "CNSHA → USLAX", tracking: "THV-88213-SC", status: "在途", eta: "SEP 29", tone: "bg-blue-100 text-blue-700" },
    { route: "CNNGB → NLRTM", tracking: "THV-88190-SC", status: "到港", eta: "SEP 26", tone: "bg-emerald-100 text-emerald-700" },
    { route: "CNSZX → DEHAM", tracking: "THV-88172-SC", status: "清关中", eta: "SEP 28", tone: "bg-amber-100 text-amber-700" },
    { route: "CNSTO → BRSSZ", tracking: "THV-88103-SC", status: "派送", eta: "SEP 25", tone: "bg-violet-100 text-violet-700" },
  ];

  return (
    <div className="relative">
      {/* 背景光晕 */}
      <div className="pointer-events-none absolute -right-16 -top-16 h-72 w-72 rounded-full bg-primary/10 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-12 -left-12 h-48 w-48 rounded-full bg-blue-500/10 blur-3xl" aria-hidden />
      
      <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-card shadow-2xl">
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-border bg-gradient-to-r from-ink to-ink/90 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <span className="font-data text-xs font-medium tracking-[0.14em] text-white/90">LIVE MANIFEST</span>
          </div>
          <span className="font-data text-[11px] text-white/40">SYNC 09-24 08:00 UTC+8</span>
        </div>

        {/* 表头 */}
        <div className="grid grid-cols-[1.4fr_1.2fr_0.8fr_0.6fr] gap-3 border-b border-border bg-muted/30 px-5 py-2.5">
          {["航线", "运单号", "状态", "ETA"].map((h) => (
            <span key={h} className="text-[11px] font-medium text-muted-foreground">{h}</span>
          ))}
        </div>

        {/* 数据行 */}
        {rows.map((r) => (
          <div
            key={r.tracking}
            className="grid grid-cols-[1.4fr_1.2fr_0.8fr_0.6fr] items-center gap-3 border-b border-border/50 px-5 py-3 transition-colors last:border-0 hover:bg-muted/20"
          >
            <span className="flex items-center gap-2 text-[13px] font-medium text-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-harbor/70" />
              {r.route}
            </span>
            <span className="font-data text-xs text-muted-foreground">{r.tracking}</span>
            <span className={cn("w-fit rounded-full px-2 py-0.5 text-[11px] font-medium", r.tone)}>
              {r.status}
            </span>
            <span className="font-data text-xs text-foreground/80">{r.eta}</span>
          </div>
        ))}

        {/* 底栏 */}
        <div className="flex items-center justify-between border-t border-border bg-muted/20 px-5 py-3">
          <span className="font-data text-[11px] tracking-[0.1em] text-muted-foreground">TODAY IN TRANSIT</span>
          <span className="font-data text-sm font-semibold text-primary">1,284 TEU</span>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   主页面
   ═══════════════════════════════════════════════════════════ */
function Landing() {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen bg-background">
      {/* ── 导航 ── */}
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <BrandMark size={32} />
            <span className="font-display text-base font-semibold tracking-tight">Thalvior</span>
          </Link>
          <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
            <a href="#features" className="transition-colors hover:text-foreground">功能</a>
            <a href="#ai" className="transition-colors hover:text-foreground">AI 能力</a>
            <a href="#workflow" className="transition-colors hover:text-foreground">流程</a>
            <a href="#stats" className="transition-colors hover:text-foreground">数据</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link to="/login" className="text-sm font-medium text-foreground transition-colors hover:text-primary">
              {t("land.login")}
            </Link>
            <Link
              to="/register"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:brightness-110"
            >
              {t("land.register")}
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden border-b border-border">
        {/* 背景网格 */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.3]"
          style={{
            backgroundImage: "linear-gradient(to right, oklch(0.25 0.045 258 / 0.05) 1px, transparent 1px)",
            backgroundSize: "56px 100%",
          }}
          aria-hidden
        />
        {/* 光晕 */}
        <div className="pointer-events-none absolute -left-40 top-10 h-[500px] w-[500px] rounded-full bg-primary/8 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -right-32 bottom-0 h-[400px] w-[400px] rounded-full bg-harbor/8 blur-3xl" aria-hidden />

        <div className="relative mx-auto grid max-w-6xl items-center gap-16 px-6 py-24 sm:py-28 lg:grid-cols-2">
          {/* 左侧文案 */}
          <div>
            <div className="reveal inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              {t("land.badge")}
            </div>
            
            <h1 className="reveal mt-6 font-display text-4xl font-bold leading-[1.15] tracking-tight text-ink sm:text-[52px] lg:text-[56px]" data-reveal-delay="80">
              {t("land.heroTitle1")}
              <span className="relative">
                <span className="bg-gradient-to-r from-primary to-harbor bg-clip-text text-transparent">{t("land.heroTitle2")}</span>
              </span>
            </h1>
            
            <p className="reveal mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground" data-reveal-delay="160">
              {t("land.heroDesc")}
            </p>
            
            <div className="reveal mt-10 flex flex-col gap-4 sm:flex-row" data-reveal-delay="240">
              <Link
                to="/register"
                className="group inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-8 py-3.5 text-base font-medium text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:shadow-xl hover:shadow-primary/25 hover:brightness-110"
              >
                {t("land.ctaStart")}
                <ArrowRight size={18} className="transition-transform duration-300 group-hover:translate-x-1" />
              </Link>
              <a
                href="#features"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-8 py-3.5 text-base font-medium text-foreground shadow-sm transition-all hover:border-primary/30 hover:text-primary"
              >
                {t("land.ctaLearn")}
              </a>
            </div>

            {/* 平台 */}
            <div className="reveal mt-14" data-reveal-delay="320">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">{t("land.platforms")}</p>
              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
                {platforms.map((p) => (
                  <span key={p} className="font-display text-sm font-semibold text-muted-foreground/60 transition-colors hover:text-foreground">
                    {p}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* 右侧看板 */}
          <div className="reveal" data-reveal-delay="160">
            <ManifestBoard />
          </div>
        </div>
      </section>

      {/* ── 功能亮点 ── */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-24">
        <div className="reveal mb-14 text-center">
          <span className="inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">CORE FEATURES</span>
          <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">{t("land.featuresTitle")}</h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">{t("land.featuresDesc")}</p>
        </div>
        
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => (
            <div
              key={f.titleKey}
              className={cn(
                "group reveal relative overflow-hidden rounded-2xl border border-border bg-card p-6 transition-all duration-300 hover:shadow-lg",
                f.accent,
              )}
              data-reveal-delay={String(i * 60)}
            >
              <div className={cn("flex h-12 w-12 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110", f.color)}>
                <f.icon size={22} strokeWidth={1.8} />
              </div>
              <h3 className="mt-5 text-base font-semibold text-foreground">{t(f.titleKey)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(f.descKey)}</p>
              <ArrowUpRight size={16} className="absolute right-5 top-5 text-muted-foreground/30 transition-all duration-300 group-hover:text-primary/60 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </div>
          ))}
        </div>
      </section>

      {/* ── AI 能力展示 ── */}
      <section id="ai" className="relative overflow-hidden border-y border-border bg-gradient-to-b from-muted/40 to-background">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="reveal mb-14 text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-3 py-1 text-xs font-medium text-violet-700">
              <Bot size={12} /> AI POWERED
            </span>
            <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">AI 驱动的智能工具</h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              内置多种 AI 工具，从图片处理到文案生成，全方位提升跨境电商运营效率
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {aiFeatures.map((f, i) => (
              <div
                key={f.title}
                className="reveal group relative overflow-hidden rounded-2xl border border-border bg-card p-6 transition-all duration-300 hover:border-violet-200 hover:shadow-lg hover:shadow-violet-100/50"
                data-reveal-delay={String(i * 80)}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-100 to-primary/10 text-violet-600 transition-transform duration-300 group-hover:scale-110">
                  <f.icon size={22} />
                </div>
                <h3 className="mt-4 text-base font-semibold text-foreground">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 工作流程 ── */}
      <section id="workflow" className="mx-auto max-w-6xl px-6 py-24">
        <div className="reveal mb-14 text-center">
          <span className="inline-block rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">HOW IT WORKS</span>
          <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">四步开启高效运营</h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">从采集到刊登，全程自动化，让跨境电商变得简单</p>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <div key={s.num} className="reveal relative" data-reveal-delay={String(i * 100)}>
              {/* 连接线 */}
              {i < steps.length - 1 && (
                <div className="absolute right-0 top-10 hidden h-px w-6 bg-gradient-to-r from-border to-transparent lg:block" style={{ transform: "translateX(100%)" }} />
              )}
              <div className="rounded-2xl border border-border bg-card p-6 transition-all hover:border-primary/30 hover:shadow-md">
                <span className="font-data text-3xl font-bold text-primary/20">{s.num}</span>
                <h3 className="mt-3 text-base font-semibold text-foreground">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── 数据背书 ── */}
      <section id="stats" className="relative overflow-hidden bg-ink">
        <div className="pointer-events-none absolute inset-0 grid-texture" aria-hidden />
        <div className="pointer-events-none absolute -top-32 left-1/4 h-64 w-64 rounded-full bg-primary/15 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-32 right-1/4 h-64 w-64 rounded-full bg-harbor/15 blur-3xl" aria-hidden />
        
        <div className="relative mx-auto grid max-w-6xl grid-cols-2 gap-x-8 gap-y-10 px-6 py-20 text-center lg:grid-cols-4">
          {stats.map((s, i) => (
            <div key={s.labelKey} className="reveal" data-reveal-delay={String(i * 80)}>
              <div className="bg-gradient-to-b from-white to-white/50 bg-clip-text font-data text-4xl font-bold tracking-tight text-transparent sm:text-5xl">{s.value}</div>
              <div className="mt-3 flex items-center justify-center gap-2 text-sm text-white/50">
                <span className="h-px w-4 bg-white/20" aria-hidden />
                {t(s.labelKey)}
                <span className="h-px w-4 bg-white/20" aria-hidden />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── 价值主张 ── */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <div className="grid grid-cols-1 items-center gap-14 lg:grid-cols-2">
          <div className="reveal">
            <span className="inline-block rounded-full bg-harbor/10 px-3 py-1 text-xs font-medium text-harbor">WHY THALVIOR</span>
            <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">{t("land.whyTitle")}</h2>
            <div className="mt-8 space-y-6">
              {[
                { icon: Globe, titleKey: "land.why1.title", descKey: "land.why1.desc" },
                { icon: Zap, titleKey: "land.why2.title", descKey: "land.why2.desc" },
                { icon: ShieldCheck, titleKey: "land.why3.title", descKey: "land.why3.desc" },
              ].map((item) => (
                <div key={item.titleKey} className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-harbor/20 bg-harbor/8 text-harbor">
                    <item.icon size={20} strokeWidth={1.8} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">{t(item.titleKey)}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t(item.descKey)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 能力清单 */}
          <div className="reveal rounded-2xl border border-border bg-card p-8 shadow-lg" data-reveal-delay="120">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold">{t("land.capTitle")}</h3>
              <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">CHECKLIST</span>
            </div>
            <div className="mt-6 space-y-4">
              {["land.cap1", "land.cap2", "land.cap3", "land.cap4", "land.cap5", "land.cap6"].map((key) => (
                <div key={key} className="flex items-center gap-3 border-b border-border/50 pb-4 text-sm last:border-0 last:pb-0">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                    <CheckCircle2 size={14} className="text-emerald-600" />
                  </div>
                  <span className="text-foreground">{t(key)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="reveal relative overflow-hidden rounded-3xl bg-gradient-to-br from-ink via-ink to-primary/20 p-14 text-center shadow-2xl">
          <div className="pointer-events-none absolute inset-0 grid-texture opacity-30" aria-hidden />
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-primary/20 blur-3xl" aria-hidden />
          <div className="pointer-events-none absolute -bottom-20 left-20 h-48 w-48 rounded-full bg-harbor/15 blur-3xl" aria-hidden />
          
          <div className="relative">
            <h2 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">{t("land.ctaTitle")}</h2>
            <p className="mx-auto mt-4 max-w-lg text-white/60">
              {t("land.ctaDesc")}
            </p>
            <Link
              to="/register"
              className="group mt-8 inline-flex items-center gap-2 rounded-lg bg-primary px-8 py-4 text-base font-medium text-primary-foreground shadow-lg shadow-primary/30 transition-all hover:shadow-xl hover:brightness-110"
            >
              {t("land.register")}
              <ArrowRight size={18} className="transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
            <p className="mt-4 text-xs text-white/40">免费试用 · 无需信用卡</p>
          </div>
        </div>
      </section>

      {/* ── 页脚 ── */}
      <footer className="border-t border-border py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 text-sm text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2">
            <BrandMark size={22} />
            <span className="font-medium text-foreground">{t("land.footerBrand")}</span>
          </div>
          <span>{t("land.footerCopy")}</span>
        </div>
      </footer>
    </div>
  );
}
