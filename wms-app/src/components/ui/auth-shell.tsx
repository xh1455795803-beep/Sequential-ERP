/**
 * Thalvior Auth Shell — 柔和渐变拟态风（参考小红书 B-end UI 设计）
 * 左侧：品牌故事 + 渐变指标卡 + 实时数据流
 * 右侧：表单区（拟态大圆角卡片）
 * 设计语言：柔和渐变 · 大圆角 · 拟态阴影 · 温暖低饱和色
 */
import { Box, Database, Warehouse, TrendingUp, Package, Activity } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

function BrandMark({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" aria-hidden>
      <defs>
        <linearGradient id="brandG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#818CF8" />
          <stop offset="100%" stopColor="#6366F1" />
        </linearGradient>
      </defs>
      <rect width="44" height="44" rx="12" fill="url(#brandG)" />
      <path d="M13 14h18v5h-6.4v12h-5.2V19H13z" fill="#fff" />
    </svg>
  );
}

interface AuthShellProps {
  children: React.ReactNode;
  panelTitle: string;
  panelDesc?: string;
  brandSubtitle?: string;
}

/** 左侧渐变指标卡 — 参考图里的柔和色彩数据卡 */
function GradientMetricCard({
  label, value, icon: Icon, grad, trend,
}: {
  label: string; value: number; icon: React.ElementType; grad: string; trend?: string;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl p-4 text-white"
      style={{ background: grad, boxShadow: '0 8px 24px -6px rgba(0,0,0,0.18)' }}
    >
      {/* 装饰性光晕 */}
      <div
        className="pointer-events-none absolute -top-6 -right-6 h-24 w-24 rounded-full opacity-40"
        style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.6) 0%, transparent 70%)' }}
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider opacity-85">{label}</span>
        <Icon className="h-4 w-4 opacity-75" />
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums tracking-tight">{value.toLocaleString()}</div>
      {trend && (
        <div className="mt-1 text-[11px] opacity-80">
          <TrendingUp className="mr-0.5 inline h-3 w-3" />
          {trend}
        </div>
      )}
    </div>
  );
}

/** 实时数据流 — 柔和毛玻璃风格 */
function DataFeed() {
  const [logs, setLogs] = useState<{ t: string; type: string; msg: string; tone: string }[]>([]);

  useEffect(() => {
    const TYPES = [
      { type: 'INBOUND', tone: 'text-emerald-600', msgs: ['入库完成', '上架至 A-03-07', 'ASN 到货'] },
      { type: 'OUTBOUND', tone: 'text-sky-600', msgs: ['出库单打印', '打包完成', '面单已生成'] },
      { type: 'SCAN', tone: 'text-violet-600', msgs: ['扫码识别', '库位确认', '数量校验通过'] },
      { type: 'SYNC', tone: 'text-amber-600', msgs: ['Shopify 同步', '库存推送成功', '多店铺更新'] },
    ];
    const initial: typeof logs = [];
    for (let i = 0; i < 5; i++) {
      const t = TYPES[Math.floor(Math.random() * TYPES.length)];
      initial.push({
        t: new Date(Date.now() - (5 - i) * 40000).toLocaleTimeString('zh-CN', { hour12: false }),
        type: t.type, msg: t.msgs[Math.floor(Math.random() * t.msgs.length)], tone: t.tone,
      });
    }
    setLogs(initial);
    const int = setInterval(() => {
      setLogs((prev) => {
        const t = TYPES[Math.floor(Math.random() * TYPES.length)];
        return [
          ...prev.slice(-6),
          { t: new Date().toLocaleTimeString('zh-CN', { hour12: false }), type: t.type, msg: t.msgs[Math.floor(Math.random() * t.msgs.length)], tone: t.tone },
        ];
      });
    }, 3200);
    return () => clearInterval(int);
  }, []);

  return (
    <div
      className="rounded-2xl border border-white/60 bg-white/70 p-4 backdrop-blur-xl"
      style={{ boxShadow: '0 4px 16px -4px rgba(99, 102, 241, 0.12)' }}
    >
      <div className="mb-3 flex items-center gap-2">
        <div className="flex gap-1.5">
          <span className="h-2 w-2 rounded-full bg-rose-400" />
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
        </div>
        <span className="ml-1 text-[11px] font-medium tracking-wider text-slate-500 uppercase">Live · 仓库操作流</span>
        <span className="ml-auto flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          实时
        </span>
      </div>
      <div className="space-y-1.5">
        {logs.map((l, i) => (
          <div key={i} className="flex items-center gap-2 text-[12px]">
            <span className="font-mono text-slate-400 tabular-nums">{l.t}</span>
            <span className={`font-semibold ${l.tone}`}>{l.type}</span>
            <span className="truncate text-slate-600">{l.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 从 Supabase 拉实时指标 */
function LiveMetrics() {
  const [data, setData] = useState({ warehouses: 0, skus: 0, todayInbound: 0 });

  useEffect(() => {
    (async () => {
      try {
        const [wh, sku, inb] = await Promise.all([
          supabase.from('wms_warehouses').select('id', { count: 'exact', head: true }),
          supabase.from('wms_inventory').select('product_id', { count: 'exact', head: true }),
          supabase.from('wms_inbound_receipts').select('*').gte('created_at', new Date(new Date().setHours(0, 0, 0)).toISOString()),
        ]);
        setData({ warehouses: wh.count || 0, skus: sku.count || 0, todayInbound: inb.data?.length || 0 });
      } catch { /* leave 0 */ }
    })();
  }, []);

  return (
    <div className="grid grid-cols-3 gap-3">
      <GradientMetricCard label="仓库数量" value={data.warehouses} icon={Warehouse}
        grad="linear-gradient(135deg, #6366F1 0%, #818CF8 100%)" trend="在线" />
      <GradientMetricCard label="SKU 种类" value={data.skus} icon={Package}
        grad="linear-gradient(135deg, #06B6D4 0%, #22D3EE 100%)" />
      <GradientMetricCard label="今日入库" value={data.todayInbound} icon={Activity}
        grad="linear-gradient(135deg, #10b981 0%, #34D399 100%)" trend="自动" />
    </div>
  );
}

export function AuthShell({ children, panelTitle, panelDesc, brandSubtitle = 'WMS · 智能仓储管理' }: AuthShellProps) {
  return (
    <div
      className="min-h-dvh bg-gradient-to-br from-indigo-50 via-violet-50 to-pink-50"
    >
      {/* 背景装饰 — 柔和光晕 */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -left-20 h-96 w-96 rounded-full bg-indigo-300/30 blur-3xl" />
        <div className="absolute top-1/3 -right-32 h-[28rem] w-[28rem] rounded-full bg-violet-300/25 blur-3xl" />
        <div className="absolute bottom-0 left-1/4 h-80 w-80 rounded-full bg-pink-200/25 blur-3xl" />
      </div>

      <div className="relative mx-auto grid min-h-dvh max-w-7xl lg:grid-cols-[1.1fr_1fr]">
        {/* ============ 左侧：品牌故事区 ============ */}
        <aside className="relative hidden flex-col justify-between p-10 xl:p-12 lg:flex">
          {/* Top: Logo */}
          <a href="/" className="flex items-center gap-3">
            <BrandMark size={44} />
            <div>
              <div className="text-xl font-bold tracking-tight text-slate-800">thalvior</div>
              <div className="text-[11px] font-medium tracking-[0.18em] text-indigo-500 uppercase">{brandSubtitle}</div>
            </div>
          </a>

          {/* Middle: 主文案 + 指标 + 数据流 */}
          <div className="max-w-lg space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200/60 bg-white/70 px-3 py-1.5 text-[11px] font-medium text-indigo-600 backdrop-blur">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" />
              SaaS 级仓库管理 · 已服务多行业客户
            </div>

            <h1 className="font-display text-[38px] xl:text-[44px] font-bold leading-[1.15] tracking-tight text-slate-900">
              让仓库管理
              <span
                className="block bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 bg-clip-text text-transparent"
              >更简单、更高效</span>
            </h1>

            <p className="text-[14px] leading-[1.7] text-slate-600 max-w-md">
              一套系统覆盖入库、上架、拣货、打包、出库全链路。ERP 订单自动同步，PDA 扫码即作业。
            </p>

            {/* 渐变指标卡 */}
            <LiveMetrics />

            {/* 实时数据流 */}
            <DataFeed />
          </div>

          {/* Bottom */}
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>© 2026 thalvior.fun</span>
            <span className="font-mono tracking-wider">v1.0.2</span>
          </div>
        </aside>

        {/* ============ 右侧：表单卡片 ============ */}
        <main className="relative grid place-items-center px-4 py-10 sm:px-6">
          {/* 表单大卡片 — 拟态风 */}
          <div
            className="w-full max-w-md rounded-3xl bg-white p-8"
            style={{ boxShadow: '0 24px 64px -16px rgba(99, 102, 241, 0.25), 0 8px 24px -8px rgba(15, 23, 42, 0.08)' }}
          >
            {/* 移动端品牌 */}
            <div className="mb-7 text-center lg:hidden">
              <BrandMark size={44} />
              <div className="mt-3 text-lg font-bold text-slate-800">thalvior</div>
              <div className="text-xs text-slate-500">{brandSubtitle}</div>
            </div>

            {/* 标题 */}
            <div className="mb-6">
              <h2 className="text-[22px] font-bold tracking-tight text-slate-900">{panelTitle}</h2>
              {panelDesc && <p className="mt-1.5 text-[13px] text-slate-500">{panelDesc}</p>}
            </div>

            <div className="fade-up">{children}</div>
          </div>

          {/* 底部版权（移动端） */}
          <div className="mt-6 text-center text-[11px] text-slate-400 lg:hidden">
            © 2026 thalvior.fun — WMS 智能仓库管理
          </div>
        </main>
      </div>

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: none; }
        }
        .fade-up { animation: fadeUp 0.5s cubic-bezier(0.16, 1, 0.3, 1); }
      `}</style>
    </div>
  );
}
