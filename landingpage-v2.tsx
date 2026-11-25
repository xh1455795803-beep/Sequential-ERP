import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AuthModal } from "@/components/auth-modal";
import {
  Globe, Package, Truck, Wallet, BarChart3, ShoppingCart,
  ArrowRight, CheckCircle2, Sparkles, Zap, Shield, Layers,
  ArrowUpRight
} from "lucide-react";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

/** 6 大核心能力 — 每项配品牌渐变条 + 序号徽章 */
const CAPABILITIES = [
  { no: "01", icon: Globe,      title: "50+ 平台订单同步",    tags: ["TikTok", "Shopee", "Lazada", "Ozon", "Mercado"],   grad: "from-sky-500 to-cyan-500",   desc: "主流跨境平台官方 API 直连 · 订单自动拉取 · 状态实时回传" },
  { no: "02", icon: Package,    title: "智能仓储管理",        tags: ["入库上架", "自动拣货", "波次管理"],                grad: "from-emerald-500 to-teal-500", desc: "PDA 扫码作业 · 多仓库协同 · 实时盘点预警" },
  { no: "03", icon: Truck,      title: "物流面单自动生成",    tags: ["云途", "燕文", "4PX", "中环"],                     grad: "from-violet-500 to-indigo-500", desc: "主流物流渠道官方 API · 条码面单一键打印 · 轨迹自动回传" },
  { no: "04", icon: Wallet,     title: "钱包与资金实时结算",  tags: ["充值扣费", "月结账单", "COD 结算"],                grad: "from-amber-500 to-orange-500",  desc: "多币种钱包 · 自动对账 · 财务流水可追溯" },
  { no: "05", icon: BarChart3,  title: "经营分析驾驶舱",      tags: ["销售趋势", "利润核算", "库存周转"],                grad: "from-rose-500 to-pink-500",     desc: "BI 看板 · 多维度下钻 · AI 异常预警" },
  { no: "06", icon: Zap,        title: "自动化运营引擎",      tags: ["自动代打包", "上架模板", "智能定价"],              grad: "from-blue-500 to-indigo-600",   desc: "规则引擎 · SOP 流程编排 · 异常自动拦截" },
];

/** 底部信任指标 — 替代老的 carousel，纯 CSS 实现 */
const TRUST = [
  { num: "50+", label: "跨境平台对接" },
  { num: "120K+", label: "日均订单处理" },
  { num: "99.9%", label: "API 可用性" },
  { num: "<200ms", label: "平均响应延迟" },
];

function LandingPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<"login" | "register">("login");
  const openLogin  = () => { setModalTab("login");    setModalOpen(true); };
  const openSignup = () => { setModalTab("register"); setModalOpen(true); };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <AuthModal open={modalOpen} defaultTab={modalTab} onOpenChange={setModalOpen} />

      {/* ======== 背景层：品牌渐变 + 网格暗纹 ======== */}
      <div aria-hidden className="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
        {/* 品牌主光斑 */}
        <div className="absolute -top-32 -left-24 w-[480px] h-[480px] rounded-full bg-gradient-to-br from-sky-200/50 via-cyan-100/30 to-transparent blur-3xl" />
        <div className="absolute top-1/3 -right-32 w-[560px] h-[560px] rounded-full bg-gradient-to-bl from-emerald-200/40 via-teal-100/20 to-transparent blur-3xl" />
        <div className="absolute bottom-0 left-1/4 w-[420px] h-[420px] rounded-full bg-gradient-to-tr from-indigo-200/30 to-transparent blur-3xl" />
        {/* 全球网格点（暗示跨境） */}
        <svg className="absolute inset-0 w-full h-full opacity-[0.035]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" fill="currentColor" className="text-foreground" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>

      {/* ======== 导航栏 ======== */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/70 border-b border-border/50">
        <div className="max-w-7xl mx-auto px-5 md:px-8 h-14 md:h-16 flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 md:w-9 md:h-9 rounded-xl bg-gradient-to-br from-sky-400 via-cyan-400 to-emerald-400 flex items-center justify-center text-white font-bold shadow-md shadow-sky-200/60 group-hover:scale-105 transition-transform">
              T
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-semibold text-base md:text-lg tracking-tight">Thalvior</span>
              <span className="text-[11px] md:text-xs text-muted-foreground font-medium hidden sm:block">跨境电商 ERP</span>
            </div>
          </Link>

          {/* Nav links — 桌面显示，手机只显示登录按钮 */}
          <nav className="hidden md:flex items-center gap-1 mr-4">
            <a className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded-md transition-colors" href="#capabilities">核心能力</a>
            <a className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded-md transition-colors" href="#trust">数据实力</a>
            <a className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded-md transition-colors" href="#cta">立即体验</a>
          </nav>

          {/* Auth buttons */}
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" onClick={openLogin}>
              登录
            </Button>
            <Button size="sm" className="bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-600 hover:to-cyan-600 text-white shadow-md shadow-sky-200/60 hover:shadow-lg hover:shadow-sky-300/60 transition-shadow" onClick={openSignup}>
              免费注册
            </Button>
          </div>
        </div>
      </header>

      {/* ======== Hero ======== */}
      <section className="max-w-7xl mx-auto w-full px-5 md:px-8 pt-12 md:pt-24 pb-10 md:pb-16">
        <div className="max-w-3xl">
          {/* 品牌徽章 */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gradient-to-r from-sky-500/10 to-emerald-500/10 border border-sky-500/20 text-xs font-medium text-sky-700 mb-6">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Thalvior · 一站式跨境电商 ERP 平台</span>
          </div>

          {/* 主标题 */}
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-[1.15]">
            <span className="block text-foreground">把中国货卖向全球，</span>
            <span className="block bg-gradient-to-r from-sky-600 via-cyan-600 to-emerald-600 bg-clip-text text-transparent mt-1">
              一个系统搞定全链路
            </span>
          </h1>

          {/* 副标题 */}
          <p className="mt-5 text-base md:text-lg text-muted-foreground leading-relaxed max-w-2xl">
            订单自动同步 · 仓储智能调度 · 物流面单自动生成 · 钱包资金实时结算
            <span className="text-foreground/80 font-medium"> — 从出单到回款，全流程闭环。</span>
          </p>

          {/* CTA */}
          <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <Button size="lg" onClick={openSignup}
              className="bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-600 hover:to-cyan-600 text-white shadow-lg shadow-sky-200/70 hover:shadow-xl hover:shadow-sky-300/70 transition-all gap-2">
              立即免费使用
              <ArrowRight className="w-4 h-4" />
            </Button>
            <Button size="lg" variant="outline" onClick={openLogin}
              className="border-border hover:bg-accent/50">
              已有账号，登录
            </Button>
          </div>

          {/* 3 条核心承诺 */}
          <ul className="mt-10 grid gap-2 sm:grid-cols-3 text-sm text-muted-foreground">
            {["无需信用卡 · 免费试用", "7×24 专属客户经理", "API 全开放 · 可定制"].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ======== 信任指标（平台墙 + 数据） ======== */}
      <section id="trust" className="max-w-7xl mx-auto w-full px-5 md:px-8 py-8 md:py-10 border-y border-border/40">
        {/* 平台 logo 墙 — 纯 CSS 实现，零外链 */}
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 mb-8 opacity-70">
          {["TikTok", "Shopee", "Lazada", "Ozon", "Mercado", "Amazon", "Temu", "Shopify"].map((p) => (
            <span key={p} className="text-sm md:text-base font-medium tracking-wide text-muted-foreground hover:text-foreground transition-colors cursor-default">
              {p}
            </span>
          ))}
        </div>
        {/* 数据指标 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-4">
          {TRUST.map((t) => (
            <div key={t.label} className="text-center md:text-left">
              <div className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-sky-600 to-emerald-600 bg-clip-text text-transparent">
                {t.num}
              </div>
              <div className="text-xs md:text-sm text-muted-foreground mt-1">{t.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ======== 6 大核心能力 ======== */}
      <section id="capabilities" className="max-w-7xl mx-auto w-full px-5 md:px-8 py-14 md:py-20 flex-1">
        <div className="text-center max-w-2xl mx-auto mb-10 md:mb-14">
          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-600 bg-sky-500/10 px-2.5 py-1 rounded-full mb-3">
            <Layers className="w-3.5 h-3.5" />
            核心能力
          </div>
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight">一套系统，覆盖跨境电商全流程</h2>
          <p className="text-sm md:text-base text-muted-foreground mt-3">
            从商品上架、订单同步、仓储作业、物流发货到财务结算，Thalvior 提供完整的 SaaS 工具链。
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
          {CAPABILITIES.map((c) => {
            const Icon = c.icon;
            return (
              <div key={c.no}
                className="group relative rounded-xl border border-border/60 bg-card/80 backdrop-blur-sm p-5 md:p-6 hover:shadow-lg hover:shadow-sky-200/40 hover:border-sky-500/30 transition-all">
                {/* 顶部品牌色条带 */}
                <div className={`absolute top-0 left-0 right-0 h-[3px] rounded-t-xl bg-gradient-to-r ${c.grad}`} />

                {/* 序号 + 图标 */}
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-11 h-11 rounded-lg bg-gradient-to-br ${c.grad} flex items-center justify-center shadow-sm`}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <span className="text-xs font-mono text-muted-foreground/60 tracking-wider">{c.no}</span>
                </div>

                {/* 标题 + 描述 */}
                <h3 className="font-semibold text-base md:text-lg mb-2 leading-tight">{c.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">{c.desc}</p>

                {/* 标签行 */}
                <div className="flex flex-wrap gap-1.5">
                  {c.tags.map((tag) => (
                    <span key={tag} className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-muted text-muted-foreground border border-border/50">
                      {tag}
                    </span>
                  ))}
                </div>

                {/* 悬停链接暗示 */}
                <div className="mt-4 flex items-center gap-1 text-xs text-sky-600 opacity-0 group-hover:opacity-100 transition-opacity">
                  了解详情
                  <ArrowUpRight className="w-3 h-3" />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ======== 底部 CTA ======== */}
      <section id="cta" className="max-w-7xl mx-auto w-full px-5 md:px-8 py-12 md:py-16">
        <div className="relative rounded-2xl overflow-hidden border border-sky-500/30 bg-gradient-to-br from-sky-500/10 via-cyan-500/5 to-emerald-500/10 p-8 md:p-12 text-center">
          {/* 装饰光斑 */}
          <div aria-hidden className="absolute -top-20 -right-20 w-60 h-60 rounded-full bg-sky-400/20 blur-3xl" />
          <div aria-hidden className="absolute -bottom-20 -left-20 w-60 h-60 rounded-full bg-emerald-400/20 blur-3xl" />

          <div className="relative">
            <div className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 bg-emerald-500/10 px-2.5 py-1 rounded-full mb-4">
              <Shield className="w-3.5 h-3.5" />
              安全可靠 · 数据加密 · 自主可控
            </div>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-3">
              准备好把生意做向全球了吗？
            </h2>
            <p className="text-sm md:text-base text-muted-foreground mb-6 max-w-xl mx-auto">
              免费开通 · 3 分钟上手 · 核心功能不限量。
            </p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
              <Button size="lg" onClick={openSignup}
                className="bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-600 hover:to-cyan-600 text-white shadow-lg shadow-sky-200/70 gap-2">
                立即免费开通
                <ArrowRight className="w-4 h-4" />
              </Button>
              <Button size="lg" variant="outline" onClick={openLogin}>
                已有账号，直接登录
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer 由 __root.tsx 全局注入 LegalFooter */}
    </div>
  );
}
