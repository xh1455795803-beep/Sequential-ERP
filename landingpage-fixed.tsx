import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ShoppingCart, Package, Globe, Wallet, Truck, BarChart3 } from "lucide-react";
import { AuthModal } from "@/components/auth-modal";
import { LegalFooter } from "@/components/legal-footer";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<"login" | "register">("login");

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <AuthModal
        open={modalOpen}
        defaultTab={modalTab}
        onOpenChange={setModalOpen}
      />

      {/* 背景装饰：柔和径向渐变 */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-0 -left-20 md:-left-40 w-64 h-64 md:w-[500px] md:h-[500px] rounded-full bg-sky-200/40 blur-3xl" />
        <div className="absolute top-20 md:top-40 -right-10 md:-right-20 w-72 h-72 md:w-[600px] md:h-[600px] rounded-full bg-violet-200/30 blur-3xl" />
        <div className="absolute bottom-0 left-1/4 md:left-1/3 w-64 h-64 md:w-[500px] md:h-[500px] rounded-full bg-emerald-200/40 blur-3xl" />
      </div>

      {/* 顶部导航 */}
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-background/60 border-b border-border/40">
        <div className="max-w-6xl mx-auto px-4 md:px-6 h-14 md:h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 md:w-9 md:h-9 rounded-xl bg-gradient-to-br from-sky-400 via-cyan-400 to-emerald-400 flex items-center justify-center text-white font-bold shadow-lg shadow-sky-200/60">
              T
            </div>
            <span className="font-semibold text-base md:text-lg">Thalvior</span>
            <span className="hidden sm:inline text-xs text-muted-foreground self-end mb-0.5">跨境电商 ERP</span>
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="md:size-default"
              onClick={() => { setModalTab("login"); setModalOpen(true); }}>
              登录
            </Button>
            <Button size="sm" className="md:size-default bg-gradient-to-r from-sky-500 to-cyan-500 hover:opacity-90 shadow-md shadow-sky-200/50"
              onClick={() => { setModalTab("register"); setModalOpen(true); }}>
              免费注册
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 md:px-6 pt-10 md:pt-20 pb-10 md:pb-16 text-center">
        <div className="inline-block mb-4 md:mb-6">
          <div className="w-20 h-20 md:w-28 md:h-28 rounded-3xl bg-gradient-to-br from-sky-200 via-cyan-100 to-emerald-200 flex items-center justify-center shadow-xl shadow-sky-200/40">
            <ShoppingCart className="w-10 h-10 md:w-14 md:h-14 text-sky-600" />
          </div>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-br from-sky-700 via-indigo-700 to-emerald-700 bg-clip-text text-transparent mb-3 md:mb-5 leading-tight">
          把中国货卖向全球
        </h1>
        <p className="text-base md:text-lg text-muted-foreground max-w-xl mx-auto mb-6 md:mb-10 leading-relaxed">
          一站式跨境电商 ERP · 50+ 平台订单自动同步 · 智能仓储管理 · 自动面单生成 · 资金实时结算
        </p>
        <div className="flex items-center justify-center gap-2 md:gap-3 flex-wrap">
          <Button size="md" className="md:size-lg bg-gradient-to-r from-sky-500 to-cyan-500 hover:opacity-90 shadow-lg shadow-sky-200/50"
            onClick={() => { setModalTab("register"); setModalOpen(true); }}>
            立即免费使用
          </Button>
          <Button size="md" className="md:size-lg" variant="outline"
            onClick={() => { setModalTab("login"); setModalOpen(true); }}>
            已有账号，登录
          </Button>
        </div>
      </section>

      {/* 功能亮点 */}
      <section className="max-w-6xl mx-auto px-4 md:px-6 py-8 md:py-12 flex-1">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
          {features.map((f) => (
            <Card key={f.title} className="backdrop-blur-md bg-card/60 border-border/40 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-4 md:p-6">
                <div className={`w-10 h-10 md:w-12 md:h-12 rounded-xl bg-gradient-to-br ${f.grad} flex items-center justify-center mb-3 md:mb-4`}>
                  <f.icon className="w-5 h-5 md:w-6 md:h-6 text-white" />
                </div>
                <div className="font-semibold text-base md:text-lg mb-1.5">{f.title}</div>
                <div className="text-sm text-muted-foreground leading-relaxed">{f.desc}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Footer — 用 LegalFooter（自动处理合规占位符隐藏） */}
      <LegalFooter />
    </div>
  );
}

const features = [
  { icon: Globe, title: "50+ 平台对接", desc: "TikTok · Shopee · Lazada · Ozon · Mercado · Amazon · Temu 等主流跨境平台", grad: "from-sky-400 to-cyan-500" },
  { icon: Package, title: "智能仓储", desc: "入库上架 · 自动拣货 · 称重打包 · 波次管理 · 实时盘点", grad: "from-emerald-400 to-teal-500" },
  { icon: Truck, title: "物流面单", desc: "云途 · 燕文 · 4PX · 中环等主流渠道 · 自动生成条码面单", grad: "from-violet-400 to-indigo-500" },
  { icon: Wallet, title: "实时结算", desc: "钱包充值 · 自动扣费 · 月结账单 · COD 结算 · 财务对账", grad: "from-amber-400 to-orange-500" },
  { icon: BarChart3, title: "经营分析", desc: "销售趋势 · 利润核算 · 库存周转 · 物流时效 · 商品表现", grad: "from-rose-400 to-pink-500" },
  { icon: ShoppingCart, title: "自动化运营", desc: "订单自动同步 · 自动代打包 · 上架模板 · 智能定价 · 采购建议", grad: "from-blue-400 to-indigo-500" },
];
