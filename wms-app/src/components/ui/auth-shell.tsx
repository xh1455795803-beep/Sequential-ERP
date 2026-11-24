/**
 * Thalvior Auth Shell — 登录/注册页
 * 左侧：深色展示区（真实感仓库数据流 + 关键指标）
 * 右侧：表单区
 * 设计原则：克制、无多余装饰、真实数据感
 */
import { Box, Database, Warehouse } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <defs>
        <linearGradient id="tm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="100%" stopColor="#1D4ED8" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="10" fill="url(#tm)" />
      <path d="M12 13h16v4.4h-5.7V29H17.7V17.4H12z" fill="#fff" />
      <path d="M10 30h20" stroke="#fff" strokeOpacity="0.4" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

interface AuthShellProps {
  children: React.ReactNode;
  panelTitle: string;
  panelDesc?: string;
  brandSubtitle?: string;
}

/** 伪终端风格的仓库数据流 —— 模拟真实的仓库操作流水 */
function DataTerminal() {
  const [logs, setLogs] = useState<{ t: string; type: string; msg: string; tone: string }[]>([]);

  useEffect(() => {
    const TYPES = [
      { type: 'INBOUND', tone: 'text-emerald-400', msgs: ['入库完成', '上架至 A-03-07', 'ASN-20261124-001'] },
      { type: 'OUTBOUND', tone: 'text-sky-400', msgs: ['出库单 ODR-48291', '打包完成', '面单已打印'] },
      { type: 'SCAN', tone: 'text-violet-400', msgs: ['扫码识别 SKU-88321', '定位 B-02-11', '数量 24'] },
      { type: 'SYNC', tone: 'text-amber-400', msgs: ['Shopify 同步', '库存推送', '3 家店铺'] },
    ];
    const initial: typeof logs = [];
    for (let i = 0; i < 6; i++) {
      const t = TYPES[Math.floor(Math.random() * TYPES.length)];
      const now = new Date(Date.now() - (6 - i) * 45000);
      initial.push({
        t: now.toLocaleTimeString('zh-CN', { hour12: false }),
        type: t.type,
        msg: t.msgs[Math.floor(Math.random() * t.msgs.length)],
        tone: t.tone,
      });
    }
    setLogs(initial);

    const int = setInterval(() => {
      setLogs((prev) => {
        const t = TYPES[Math.floor(Math.random() * TYPES.length)];
        const next = [
          ...prev.slice(-7),
          {
            t: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
            type: t.type,
            msg: t.msgs[Math.floor(Math.random() * t.msgs.length)],
            tone: t.tone,
          },
        ];
        return next;
      });
    }, 2800);
    return () => clearInterval(int);
  }, []);

  return (
    <div
      className="rounded-lg border border-white/10 bg-black/40 p-3.5 font-data text-[12px] leading-[1.7]"
      style={{ backdropFilter: 'blur(8px)' }}
    >
      <div className="flex items-center gap-1.5 mb-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
        <span className="ml-2 text-[10px] text-slate-500 tracking-wide">thalvior@wms · stream</span>
      </div>
      <div className="space-y-0.5">
        {logs.map((l, i) => (
          <div key={i} className="flex gap-2 animate-[fadeIn_.3s_ease]">
            <span className="text-slate-600 shrink-0">{l.t}</span>
            <span className={`shrink-0 ${l.tone} font-medium`}>{l.type}</span>
            <span className="text-slate-300/90 truncate">{l.msg}</span>
          </div>
        ))}
        <div className="flex gap-2 items-center pt-0.5">
          <span className="text-emerald-400">▸</span>
          <span className="text-slate-500">streaming warehouse events...</span>
          <span className="inline-block h-3 w-1.5 bg-emerald-400 animate-pulse ml-0.5" />
        </div>
      </div>
    </div>
  );
}

/** 顶部关键指标 —— 从 Supabase 实时拉 */
function LiveMetrics() {
  const [data, setData] = useState({ warehouses: 0, skus: 0, todayInbound: 0, connected: true });

  useEffect(() => {
    (async () => {
      try {
        const [wh, sku, inb] = await Promise.all([
          supabase.from('wms_warehouses').select('id', { count: 'exact', head: true }),
          supabase.from('wms_inventory').select('product_id', { count: 'exact', head: true }),
          supabase.from('wms_inbound_receipts').select('*').gte('created_at', new Date(new Date().setHours(0, 0, 0)).toISOString()),
        ]);
        setData({
          warehouses: wh.count || 0,
          skus: sku.count || 0,
          todayInbound: inb.data?.length || 0,
          connected: true,
        });
      } catch {
        setData((d) => ({ ...d, connected: false }));
      }
    })();
  }, []);

  const metrics = [
    { label: '仓库', value: data.warehouses, icon: LucideWarehouse },
    { label: 'SKU 种类', value: data.skus, icon: Box },
    { label: '今日入库', value: data.todayInbound, icon: Database },
  ];

  return (
    <div className="grid grid-cols-3 gap-2.5">
      {metrics.map((m) => {
        const Icon = m.icon;
        return (
          <div key={m.label} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <Icon className="h-3 w-3" />
              <span>{m.label}</span>
            </div>
            <div className="mt-1 font-data text-lg font-semibold text-slate-200 tabular-nums">
              {m.value}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AuthShell({ children, panelTitle, panelDesc, brandSubtitle = 'WMS · 仓库管理系统' }: AuthShellProps) {
  return (
    <div className="grid min-h-dvh bg-card lg:grid-cols-[1.1fr_1fr]">
      {/* ============ 左侧展示区（深色） ============ */}
      <aside
        className="relative hidden flex-col justify-between overflow-hidden p-10 xl:p-14 lg:flex"
        style={{ background: '#0B1120' }}
      >
        {/* 极淡的网格 + 顶部淡光（克制装饰） */}
        <svg className="pointer-events-none absolute inset-0 opacity-[0.03]" aria-hidden>
          <defs>
            <pattern id="ag" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#fff" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#ag)" />
        </svg>

        {/* Top: Logo + 连接状态 */}
        <div className="relative flex items-center justify-between">
          <a href="/" className="flex items-center gap-3">
            <BrandMark size={40} />
            <div>
              <div className="font-display text-lg font-semibold text-slate-100">thalvior</div>
              <div className="text-[10.5px] tracking-[0.2em] text-slate-500 uppercase">{brandSubtitle}</div>
            </div>
          </a>
          <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 px-2.5 py-1 text-[10.5px] text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            系统在线
          </div>
        </div>

        {/* Middle: 标题区 */}
        <div className="relative max-w-lg">
          <div className="mb-4 flex items-center gap-2">
            <span className="h-px w-8 bg-blue-500/60" />
            <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-blue-400">Trusted by warehouse teams</span>
          </div>
          <h2 className="font-display text-[28px] xl:text-[34px] font-semibold leading-[1.2] tracking-tight text-slate-100">
            专业级仓储管理<br />
            <span className="text-slate-400 font-normal">为你的仓库，提供精准控制</span>
          </h2>
          <p className="mt-4 text-[13.5px] leading-relaxed text-slate-500">{panelDesc}</p>

          {/* 终端 + 指标 */}
          <div className="mt-8 space-y-3">
            <LiveMetrics />
            <DataTerminal />
          </div>
        </div>

        {/* Bottom: 版权 */}
        <div className="relative flex items-center justify-between text-[11px] text-slate-600">
          <span>© 2026 thalvior.fun — Built for modern logistics</span>
          <span className="font-data tracking-wider">v1.0.2</span>
        </div>
      </aside>

      {/* ============ 右侧表单区 ============ */}
      <main className="relative grid place-items-center bg-card px-4 py-10 sm:px-6">
        <div className="relative w-full max-w-md">
          {/* 移动端显示品牌 */}
          <div className="mb-8 text-center lg:hidden">
            <a href="/" className="mx-auto mb-3 flex w-fit items-center gap-2.5">
              <BrandMark size={36} />
              <span className="font-display text-lg font-semibold text-fg">thalvior</span>
            </a>
            <p className="text-xs text-fg-muted">{brandSubtitle}</p>
          </div>

          <div className="rise-in">{children}</div>
        </div>
      </main>

      {/* 淡入动画 */}
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateX(-4px); } to { opacity: 1; transform: none; } }
        .rise-in { animation: riseIn 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
        @keyframes riseIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      `}</style>
    </div>
  );
}
