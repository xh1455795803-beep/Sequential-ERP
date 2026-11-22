import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  DollarSign,
  ShoppingCart,
  Package,
  Boxes,
  PackageCheck,
  CreditCard,
  AlertTriangle,
  RefreshCw,
  Rocket,
  Truck,
  Globe,
  Languages,
  ClipboardList,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchInventory } from "@/lib/data-access";
import { supabase } from "@/supabase/client";
import { ACTIVE_AUTH_STATUSES } from "@/lib/shop-status";
import { useLanguage } from "@/i18n/LanguageContext";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { CHART_CATEGORICAL, CHART_TOOLTIP, useChartPalette } from "@/components/chart-theme";
import { tt } from "@/i18n/tts";
import { Card } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";

export const Route = createFileRoute("/_layout/dashboard")({
  component: Dashboard,
});

interface RecentOrder {
  id: string;
  product: string;
  channel: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
}

const WEEK_ZH = ["日", "一", "二", "三", "四", "五", "六"];

function getISOWeek(d: Date): number {
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((+target - +yearStart) / 86400000 + 1) / 7);
}
function sameISOWeek(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && getISOWeek(a) === getISOWeek(b);
}

type IconType = typeof DollarSign;

function Dashboard() {
  const { t, lang } = useLanguage();
  const chartColors = useChartPalette();
  const [productCount, setProductCount] = useState(0);
  const [stockTotal, setStockTotal] = useState(0);
  const [lowStock, setLowStock] = useState(0);
  const [todaySales, setTodaySales] = useState(0);
  const [todayOrders, setTodayOrders] = useState(0);
  const [monthSales, setMonthSales] = useState(0);
  const [toShip, setToShip] = useState(0);
  const [toPay, setToPay] = useState(0);
  const [collectTodo, setCollectTodo] = useState(0);
  const [authExpiring, setAuthExpiring] = useState(0);
  const [salesDelta, setSalesDelta] = useState<number | null>(null);
  const [ordersDelta, setOrdersDelta] = useState<number | null>(null);
  const [userName, setUserName] = useState("");
  const [trend, setTrend] = useState<{ date: string; sales: number; orders: number }[]>([]);
  const [weeklyProfit, setWeeklyProfit] = useState<{ week: string; profit: number; sales: number }[]>([]);
  const [topProducts, setTopProducts] = useState<{ name: string; orders: number; amount: number }[]>([]);
  const [inventoryHealth, setInventoryHealth] = useState<{ name: string; value: number; color: string }[]>([]);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState<{ key: string; count: number; sev: "danger" | "warn"; to: string }[]>([]);
  const [shipAmount, setShipAmount] = useState(0);
  const [payAmount, setPayAmount] = useState(0);

  useEffect(() => {
    let alive = true;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const startOfMonth = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), 1);

    // KPI：全部走 DB 端真实过滤/精确计数（head count），无任何写死数据
    const loadKpis = async () => {
      const [todayRes, yestRes, monthRes, shipRes, payRes, prodRes, shipAmtRes, payAmtRes] = await Promise.all([
        supabase.from("orders").select("amount").gte("created_at", startOfToday.toISOString()),
        supabase
          .from("orders")
          .select("amount")
          .gte("created_at", startOfYesterday.toISOString())
          .lt("created_at", startOfToday.toISOString()),
        supabase.from("orders").select("amount").gte("created_at", startOfMonth.toISOString()),
        supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "待发货"),
        supabase.from("orders").select("id", { count: "exact", head: true }).in("status", ["待付款", "待支付"]),
        supabase.from("products").select("id", { count: "exact", head: true }),
        // 今日待办按关联金额排序：待发货/待付款订单金额合计（真实 DB 查询）
        supabase.from("orders").select("amount").eq("status", "待发货").limit(10000),
        supabase.from("orders").select("amount").in("status", ["待付款", "待支付"]).limit(10000),
      ]);
      if (!alive) return;
      const tRows = (todayRes.data ?? []) as { amount: number }[];
      const yRows = (yestRes.data ?? []) as { amount: number }[];
      const mRows = (monthRes.data ?? []) as { amount: number }[];
      const tSum = tRows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
      const ySum = yRows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
      setTodayOrders(tRows.length);
      setTodaySales(tSum);
      setMonthSales(mRows.reduce((s, r) => s + Number(r.amount ?? 0), 0));
      setSalesDelta(ySum > 0 ? ((tSum - ySum) / ySum) * 100 : null);
      setOrdersDelta(yRows.length > 0 ? ((tRows.length - yRows.length) / yRows.length) * 100 : null);
      setToShip(shipRes.count ?? 0);
      setToPay(payRes.count ?? 0);
      setProductCount(prodRes.count ?? 0);
      setShipAmount(((shipAmtRes.data ?? []) as { amount: number }[]).reduce((acc, r) => acc + Number(r.amount ?? 0), 0));
      setPayAmount(((payAmtRes.data ?? []) as { amount: number }[]).reduce((acc, r) => acc + Number(r.amount ?? 0), 0));
    };

    // 作战面板异常警报：四类真实 DB 查询（超时未发货/同步失败/库存低于安全线/授权即将到期），无异常整条隐藏
    const loadAlerts = async () => {
      const cutoff48h = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const [overRes, syncRes, lowRes, authRes] = await Promise.all([
        supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "待发货").lt("created_at", cutoff48h),
        supabase.from("order_sync_logs").select("id", { count: "exact", head: true }).eq("status", "失败").gte("created_at", since24h),
        supabase.from("inventory").select("id", { count: "exact", head: true }).eq("status", "偏低"),
        supabase.from("shop_auths").select("id", { count: "exact", head: true })
          .in("status", [...ACTIVE_AUTH_STATUSES]).lt("token_expires_at", new Date(Date.now() + 30 * 86400e3).toISOString()).gt("token_expires_at", new Date().toISOString()),
      ]);
      if (!alive) return;
      const next: { key: string; count: number; sev: "danger" | "warn"; to: string }[] = [];
      if ((overRes.count ?? 0) > 0) next.push({ key: "overdueShip", count: overRes.count ?? 0, sev: "danger", to: "/orders/to-ship" });
      if ((syncRes.count ?? 0) > 0) next.push({ key: "syncFail", count: syncRes.count ?? 0, sev: "danger", to: "/orders" });
      if ((lowRes.count ?? 0) > 0) next.push({ key: "lowStock", count: lowRes.count ?? 0, sev: "warn", to: "/inventory/low-stock" });
      if ((authRes.count ?? 0) > 0) next.push({ key: "authExpiring", count: authRes.count ?? 0, sev: "warn", to: "/auth" });
      setAlerts(next);
    };

    // 走势（近 30 天）+ 最新订单
    const loadTrend = async () => {
      const since = new Date(startOfToday);
      since.setDate(since.getDate() - 29);
      const { data: rows } = await supabase
        .from("orders")
        .select("id, product, channel, amount, currency, status, created_at")
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .limit(500);
      if (!alive) return;
      const all = (rows ?? []) as RecentOrder[];
      const days: { date: string; sales: number; orders: number }[] = [];
      for (let i = 29; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dayOrders = all.filter((o) => {
          const od = new Date(o.created_at);
          return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth() && od.getDate() === d.getDate();
        });
        days.push({
          date: `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
          sales: dayOrders.reduce((s, o) => s + Number(o.amount ?? 0), 0),
          orders: dayOrders.length,
        });
      }
      setTrend(days);
      setRecentOrders(all.slice(0, 8));

      // 周利润（近 8 周，按 ISO 周分组；无真实利润表时按 amount × 0.22 估算）
      const weeks: { key: string; label: string; profit: number; sales: number }[] = [];
      for (let w = 7; w >= 0; w--) {
        const d = new Date();
        d.setDate(d.getDate() - w * 7);
        const iso = `${d.getFullYear()}-W${String(getISOWeek(d)).padStart(2, "0")}`;
        const label = lang === "en" ? `W${8 - w}` : `第 ${8 - w} 周`;
        const wkOrders = all.filter((o) => {
          const od = new Date(o.created_at);
          return sameISOWeek(od, d);
        });
        const sales = wkOrders.reduce((s, o) => s + Number(o.amount ?? 0), 0);
        weeks.push({ key: iso, label, sales, profit: sales * 0.22 });
      }
      setWeeklyProfit(weeks);

      // 热销商品 Top 6
      const prodMap = new Map<string, { name: string; orders: number; amount: number }>();
      for (const o of all) {
        const name = (o.product || "—").trim();
        const cur = prodMap.get(name) ?? { name, orders: 0, amount: 0 };
        cur.orders += 1;
        cur.amount += Number(o.amount ?? 0);
        prodMap.set(name, cur);
      }
      setTopProducts([...prodMap.values()].sort((a, b) => b.amount - a.amount).slice(0, 6));
    };

    const loadUserName = async () => {
      const { data: session } = await supabase.auth.getSession();
      const userId = session?.session?.user?.id;
      if (!userId) return;
      const { data } = await supabase.from("profiles").select("username").eq("id", userId).maybeSingle();
      if (alive && data?.username) setUserName(data.username);
    };

    const countEq = async (table: string, col: string, val: string) => {
      try {
        const { count } = await (supabase.from(table as any).select("id", { count: "exact", head: true }) as any).eq(col, val);
        return count ?? 0;
      } catch {
        return 0;
      }
    };

    Promise.allSettled([
      loadKpis(),
      loadAlerts(),
      loadTrend(),
      loadUserName(),
      fetchInventory()
        .then((inv) => {
          if (!alive) return;
          setStockTotal(inv.reduce((s, i) => s + Number(i.available ?? 0), 0));
          setLowStock(inv.filter((i) => Number(i.available) <= Number(i.safety_stock ?? 0)).length);
          // 库存健康：健康 / 预警 / 缺货
          let healthy = 0, warn = 0, out = 0;
          for (const i of inv) {
            const avail = Number(i.available ?? 0);
            const safety = Number(i.safety_stock ?? 0);
            if (avail <= 0) out++;
            else if (avail <= safety) warn++;
            else healthy++;
          }
          const healthyColor = "var(--cargo-teal)";
          const warnColor = "var(--cargo-orange)";
          const outColor = "var(--cargo-red, var(--destructive))";
          setInventoryHealth([
            { name: lang === "en" ? "Healthy" : "健康", value: healthy, color: healthyColor },
            { name: lang === "en" ? "Warning" : "预警", value: warn, color: warnColor },
            { name: lang === "en" ? "Out of Stock" : "缺货", value: out, color: outColor },
          ]);
        })
        .catch(() => undefined),
      countEq("collect_items", "status", "待处理").then((v) => {
        if (alive) setCollectTodo(v);
      }),
supabase.from("shop_auths").select("id", { count: "exact", head: true })
        .in("status", [...ACTIVE_AUTH_STATUSES]).lt("token_expires_at", new Date(Date.now() + 30 * 86400e3).toISOString()).gt("token_expires_at", new Date().toISOString())
      .then((res) => {
        if (alive) setAuthExpiring(res.count ?? 0);
      }),
    ]).finally(() => {
      if (alive) setLoading(false);
    });

    return () => {
      alive = false;
    };
  }, []);

  /* 渠道分布：直接复用 loadTrend 已取回的订单明细（近 7 天 / ≤500 条，含 channel、amount），
     不新增查询。超过 8 个渠道时取前 8 家，占比一律对全量金额计算，避免切片之和与百分比不一致。 */
  const channelStats = useMemo(() => {
    const map = new Map<string, { name: string; orders: number; amount: number }>();
    let totalAmount = 0;
    let from = "";
    let to = "";
    for (const o of recentOrders) {
      const key = (o.channel ?? "").trim() || "—";
      const cur = map.get(key) ?? { name: key, orders: 0, amount: 0 };
      const amt = Number(o.amount) || 0;
      cur.orders += 1;
      cur.amount += amt;
      map.set(key, cur);
      totalAmount += amt;
      const d = (o.created_at ?? "").slice(0, 10);
      if (d) {
        if (!from || d < from) from = d;
        if (!to || d > to) to = d;
      }
    }
    const rows = [...map.values()].sort((a, b) => b.amount - a.amount || b.orders - a.orders);
    return {
      rows: rows.slice(0, 8),
      totalAmount,
      channelCount: rows.length,
      range: from ? (from === to ? from : `${from} ~ ${to}`) : "",
    };
  }, [recentOrders]);

  const fmtMoney = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtNum = (n: number) => n.toLocaleString();

  const formatDate = (d: Date) => {
    if (lang === "en") {
      return d.toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "2-digit" });
    }
    return tt("dash.dateWeek", { v1: d.getFullYear(), v2: String(d.getMonth() + 1).padStart(2, "0"), v3: String(d.getDate()).padStart(2, "0"), v4: WEEK_ZH[d.getDay()] });
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    if (lang === "en") {
      return d.toLocaleDateString("en-US", { month: "short", day: "2-digit" }) + ` ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  /* v6.4：KPI 图标从"淡彩方块底 + 白图标"改成"模块色线性图标"。
     tintCls 那种 12% 透明度的色块底是模板视觉的另一个识别特征，
     而且 8 个色块底在 12px 文本旁边只会让第一屏显得花。
     色相走 --cargo-*，暗色模式由 .dark 里的同名变量自动接管。 */
  const kpis: { label: string; value: string; prefix?: string; delta: number | null; icon: IconType; numCls?: string; iconColor: string }[] = [
    { label: t("dash.todayOrders"), value: fmtNum(todayOrders), delta: todayOrders > 0 ? ordersDelta : null, icon: ShoppingCart, iconColor: "var(--cargo-blue)" },
    { label: t("dash.todaySales"), value: fmtMoney(todaySales), prefix: "$", delta: todaySales > 0 ? salesDelta : null, icon: DollarSign, iconColor: "var(--cargo-gold)" },
    { label: t("dash.kpi.monthSales"), value: fmtMoney(monthSales), prefix: "$", delta: null, icon: TrendingUp, iconColor: "var(--cargo-gold)" },
    { label: t("dash.todoShip"), value: fmtNum(toShip), delta: null, icon: PackageCheck, numCls: toShip > 0 ? "text-warn-ink" : "", iconColor: "var(--cargo-orange)" },
    { label: t("dash.todoPay"), value: fmtNum(toPay), delta: null, icon: CreditCard, numCls: toPay > 0 ? "text-warn-ink" : "", iconColor: "var(--cargo-violet)" },
    { label: t("dash.products"), value: fmtNum(productCount), delta: null, icon: Package, iconColor: "var(--cargo-teal)" },
    { label: t("dash.todoStock"), value: fmtNum(lowStock), delta: null, icon: AlertTriangle, numCls: lowStock > 0 ? "text-danger-ink" : "", iconColor: "var(--cargo-teal)" },
    { label: t("dash.stock"), value: fmtNum(stockTotal), delta: null, icon: Boxes, iconColor: "var(--cargo-teal)" },
  ];

  const quickActions: { label: string; to: string; icon: IconType }[] = [
    { label: t("dash.qa.listing"), to: "/listing/index", icon: Rocket },
    { label: t("dash.qa.batchShip"), to: "/orders/to-ship", icon: Truck },
    { label: t("dash.qa.syncOrders"), to: "/orders", icon: RefreshCw },
    { label: t("dash.qa.collect"), to: "/products/collect", icon: Globe },
    { label: t("dash.qa.pricing"), to: "/products/pricing", icon: Languages },
    { label: t("dash.qa.purchase"), to: "/purchase/orders", icon: ClipboardList },
    { label: t("dash.qa.aiListing"), to: "/ai/listing", icon: Sparkles },
    { label: t("dash.qa.profit"), to: "/finance/profit", icon: TrendingUp },
  ];

  // 今日待办：按关联金额降序（金额相同/无金额按原紧急度顺序，稳定排序）
  const todoRows = [
    { label: t("dash.todoShip"), count: toShip, amount: shipAmount, to: "/orders/to-ship", dot: "var(--primary)" },
    // 批量 6：/orders/pending-payment 独立路由已删除，待付款改由订单列表页内的状态带承载
    { label: t("dash.todoPay"), count: toPay, amount: payAmount, to: "/orders", dot: "var(--warning)" },
    { label: t("dash.todoStock"), count: lowStock, amount: 0, to: "/inventory/low-stock", dot: "var(--destructive)" },
    { label: t("dash.todoCollect"), count: collectTodo, amount: 0, to: "/products/collect", dot: "var(--muted-foreground)" },
    { label: t("dash.todoAuth"), count: authExpiring, amount: 0, to: "/auth", dot: "var(--warning)" },
  ].sort((a, b) => b.amount - a.amount);

  // 第 2 批：通用数据表列定义（渲染层；取值与含义与原列表一致）
  // 窄视口下按优先级收列：订单号/商品/金额/状态常显，渠道 <sm 隐藏，时间 <md 隐藏
  const recentColumns: DataTableColumn<RecentOrder>[] = [
    { key: "id", header: t("dash.col.orderNo"), render: (o) => <span className="font-data truncate text-foreground">{o.id}</span> },
    { key: "channel", header: t("dash.col.channel"), headerClassName: "hidden sm:table-cell", cellClassName: "hidden sm:table-cell", render: (o) => <span className="truncate text-muted-foreground">{o.channel || "—"}</span> },
    { key: "product", header: t("dash.col.product"), render: (o) => <span className="truncate text-muted-foreground">{o.product || "—"}</span> },
    { key: "amount", header: t("dash.col.amount"), align: "right", cellClassName: "whitespace-nowrap", render: (o) => <span className="tabular-nums text-foreground">{o.currency || "USD"} {Number(o.amount ?? 0).toFixed(2)}</span> },
    { key: "status", header: t("dash.col.status"), render: (o) => <StatusBadge status={o.status} /> },
    { key: "created_at", header: t("dash.col.time"), align: "right", headerClassName: "hidden md:table-cell", cellClassName: "hidden md:table-cell", render: (o) => <span className="tabular-nums text-muted-foreground/70">{formatTime(o.created_at)}</span> },
  ];

  return (
    <div className="space-y-4">
      {/* 页头：欢迎语 + 日期 + 快捷主操作
          v6.4：标题从 24px 降到 18px/600。ERP 工作台不是落地页，
          24px 的欢迎语会把第一屏的高度让给一句没有信息量的话。 */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold leading-6 tracking-[-0.01em] text-foreground">
            {t("dash.welcome")}{userName ? (lang === "en" ? `, ${userName}` : `，${userName}`) : ""}
          </h1>
          <p className="mt-1 text-sm text-fg-muted tabular-nums">{formatDate(new Date())}</p>
        </div>
        <div className="hidden gap-2 sm:flex">
          <Link
            to="/orders"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-surface-raised px-3 text-sm text-fg transition-colors hover:border-brand hover:text-brand-ink-text"
          >
            <RefreshCw size={14} />
            {t("dash.qa.syncOrders")}
          </Link>
          <Link
            to="/listing/index"
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-cta px-3 text-sm font-medium text-white transition-colors hover:bg-cta-hover"
          >
            <Rocket size={14} />
            {t("dash.qa.listing")}
          </Link>
        </div>
      </div>

      {/* 异常警报：v6.4 从"每条一张粉彩横幅"改成单卡 + 发丝分隔行。
          整版淡色块是模板味最重的一处 —— 告警的强度应该来自语义色条和数字，
          不是来自把整行涂色。 */}
      {alerts.length > 0 && (
        <div className="overflow-hidden rounded-[4px] border border-border bg-card">
          {alerts.map((a) => (
            <Link
              key={a.key}
              to={a.to}
              className="flex h-9 items-center gap-2.5 border-b border-l-2 border-border/50 px-3.5 text-sm transition-colors last:border-b-0 hover:bg-surface-hover"
              style={{
                borderLeftColor: a.sev === "danger" ? "var(--destructive)" : "var(--warning)",
              }}
            >
              <AlertTriangle
                size={14}
                className="shrink-0"
                style={{ color: a.sev === "danger" ? "var(--destructive)" : "var(--warning)" }}
              />
              <span className="min-w-0 flex-1 truncate text-fg">
                {t(`dash.alert.${a.key}`, { v1: a.count })}
              </span>
              <span
                className="shrink-0 font-semibold tabular-nums"
                style={{ color: a.sev === "danger" ? "var(--danger-ink)" : "var(--warn-ink)" }}
              >
                {a.count}
              </span>
              <ArrowRight size={13} className="shrink-0 text-fg-subtle" />
            </Link>
          ))}
        </div>
      )}

      {/* 核心指标：v6.4 从 8 张独立白卡改成 1 张卡 + 发丝分隔网格。
          等宽同构的卡片阵列是"后台模板"的识别特征；Element / 领星 的做法是
          一个容器内部分格，靠 1px 分隔线而不是靠 8 个边框来组织信息。
          图标去掉淡彩方块底，只留 14px 模块色图标贴在标签前。 */}
      <div className="overflow-hidden rounded-[4px] border border-border bg-card">
        <div className="grid grid-cols-2 gap-px bg-border/60 sm:grid-cols-4">
          {kpis.map((k) => {
            const zero = k.value === "0" || k.value === "0.00";
            return (
              <div key={k.label} className="bg-card px-3.5 py-3">
                <div className="flex min-w-0 items-center gap-1.5">
                  <k.icon
                    size={14}
                    className={zero ? "shrink-0 text-fg-subtle" : "shrink-0"}
                    style={zero ? undefined : { color: k.iconColor }}
                  />
                  <span className={`truncate text-xs ${zero ? "text-fg-subtle" : "text-fg-muted"}`}>{k.label}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                  <div className="flex min-w-0 items-baseline gap-1">
                    {loading ? (
                      <span className="text-2xl font-semibold leading-none text-fg-subtle tabular-nums">—</span>
                    ) : (
                      <>
                        {k.prefix && <span className={`text-sm ${zero ? "text-fg-subtle" : "text-fg-muted"}`}>{k.prefix}</span>}
                        <span className={`truncate text-2xl font-semibold leading-none tracking-[-0.02em] tabular-nums ${k.numCls || (zero ? "text-fg-subtle/70" : "text-fg")}`}>
                          {k.value}
                        </span>
                      </>
                    )}
                  </div>
                  {k.delta !== null && (
                    <span
                      className={`inline-flex shrink-0 items-center gap-0.5 rounded-[3px] px-1 py-0.5 text-xs font-medium tabular-nums ${
                        k.delta >= 0 ? "bg-success-subtle text-success" : "bg-danger-subtle text-destructive"
                      }`}
                    >
                      {k.delta >= 0 ? "↑" : "↓"} {Math.abs(k.delta).toFixed(1)}%
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 今日待办：单卡五格，发丝分隔 */}
      <div className="overflow-hidden rounded-[4px] border border-border/70 bg-card shadow-soft">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-base font-medium text-fg">{t("dash.todo")}</h2>
          <span className="text-sm text-fg-muted tabular-nums">{t("dash.todoPending", { n: todoRows.reduce((s, r) => s + r.count, 0) })}</span>
        </div>
        {/* 末位补跨列：5 项在 2/3 列下会留下一个露出分隔底色的空格 */}
        <div className="grid grid-cols-2 gap-px bg-border/50 [&>a:last-child]:col-span-2 sm:grid-cols-3 sm:[&>a:last-child]:col-span-2 lg:grid-cols-5 lg:[&>a:last-child]:col-span-1">
          {todoRows.map((row) => (
            <Link
              key={row.label}
              to={row.to}
              className="group bg-card px-4 py-3 transition-colors hover:bg-surface-hover/70"
            >
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: row.dot }} />
                <span className="truncate text-sm text-fg-muted transition-colors group-hover:text-fg">{row.label}</span>
              </div>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span className={`text-lg font-semibold leading-none tabular-nums ${row.count > 0 ? "text-fg" : "text-fg-subtle/60"}`}>
                  {row.count}
                </span>
                {row.amount > 0 && (
                  <span className="font-data text-xs text-fg-subtle tabular-nums">${fmtMoney(row.amount)}</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* 经营大盘·第一行：周利润 + 库存健康 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="rounded-[4px] border border-border bg-card p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-medium text-fg">{lang === "en" ? "Weekly Performance" : "经营走势（近 8 周）"}</h2>
              <p className="mt-0.5 text-xs text-fg-subtle">{lang === "en" ? "Sales & estimated profit" : "销售额 × 估算利润率 22%"}</p>
            </div>
            <div className="flex items-center gap-3 text-xs text-fg-muted">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: chartColors.c1 }} />{lang === "en" ? "Sales" : "销售额"}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: "var(--cargo-violet)" }} />{lang === "en" ? "Profit (est.)" : "估算利润"}
              </span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={weeklyProfit} margin={{ top: 8, right: 8, left: -20, bottom: 0 }} barCategoryGap="28%">
              <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 5" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: chartColors.axis }} axisLine={{ stroke: chartColors.grid }} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: chartColors.axis }} axisLine={false} tickLine={false} width={52} />
              <Tooltip
                {...CHART_TOOLTIP}
                formatter={(v, n) => {
                  const isProfit = String(n).includes(lang === "en" ? "Profit" : "利润");
                  return [`$${fmtMoney(Number(v))}`, String(n)];
                }}
              />
              <Bar dataKey="sales" name={lang === "en" ? "Sales" : "销售额"} fill={chartColors.c1} radius={[3, 3, 0, 0]} />
              <Bar dataKey="profit" name={lang === "en" ? "Profit (est.)" : "估算利润"} fill="var(--cargo-violet)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="rounded-[4px] border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-medium text-fg">{lang === "en" ? "Inventory Health" : "库存健康"}</h2>
            <span className="text-xs text-fg-subtle tabular-nums">{lang === "en" ? "Total SKUs" : "SKU 总数"} {inventoryHealth.reduce((s, x) => s + x.value, 0)}</span>
          </div>
          {inventoryHealth.reduce((s, x) => s + x.value, 0) === 0 ? (
            <div className="flex h-[220px] items-center justify-center text-sm text-fg-subtle">
              {loading ? "…" : t("common.empty")}
            </div>
          ) : (
            <>
              <div className="relative mt-1 h-[150px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={inventoryHealth.filter((x) => x.value > 0)}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={68}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {inventoryHealth.filter((x) => x.value > 0).map((r) => (
                        <Cell key={r.name} fill={r.color} />
                      ))}
                    </Pie>
                    <Tooltip {...CHART_TOOLTIP} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xs text-fg-subtle">{lang === "en" ? "Healthy" : "健康"}</span>
                  <span className="text-lg font-semibold leading-none tracking-[-0.02em] text-fg tabular-nums">
                    {inventoryHealth.find((x) => x.name === (lang === "en" ? "Healthy" : "健康"))?.value ?? 0}
                  </span>
                </div>
              </div>
              <div className="mt-2 space-y-1.5">
                {inventoryHealth.map((r) => {
                  const total = inventoryHealth.reduce((s, x) => s + x.value, 0);
                  const pct = total > 0 ? (r.value / total) * 100 : 0;
                  return (
                    <div key={r.name} className="flex items-center gap-2 text-xs">
                      <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: r.color }} />
                      <span className="truncate text-fg-muted">{r.name}</span>
                      <span className="ml-auto font-semibold text-fg tabular-nums">{r.value}</span>
                      <span className="w-10 text-right text-fg-subtle tabular-nums">{pct.toFixed(0)}%</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* 经营大盘·第二行：热销商品 + 近 30 天走势 */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="rounded-[4px] border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-medium text-fg">{lang === "en" ? "Top Products" : "热销商品 Top 6"}</h2>
            <span className="text-xs text-fg-subtle">{lang === "en" ? "Last 30 days" : "近 30 天"}</span>
          </div>
          {topProducts.length === 0 ? (
            <div className="flex h-[240px] items-center justify-center text-sm text-fg-subtle">
              {loading ? "…" : t("common.empty")}
            </div>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {topProducts.map((p, i) => {
                const max = topProducts[0]?.amount || 1;
                const pct = (p.amount / max) * 100;
                return (
                  <li key={p.name} className="text-sm">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-[10px] font-semibold text-fg-muted tabular-nums">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-fg" title={p.name}>{p.name}</span>
                      <span className="shrink-0 text-xs text-fg-subtle tabular-nums">{p.orders}{lang === "en" ? " orders" : " 单"}</span>
                      <span className="shrink-0 text-right text-sm font-semibold text-fg tabular-nums">${fmtMoney(p.amount)}</span>
                    </div>
                    <div className="mt-1 ml-7 h-1 overflow-hidden rounded-full bg-surface-inset">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: chartColors.c1 }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="flex xl:col-span-2">
          <Card className="w-full rounded-[4px] border border-border bg-card p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-base font-medium text-fg">{t("dash.trend30")}</h2>
              <div className="flex items-center gap-3.5 text-xs text-fg-muted">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-primary" />{t("dash.sales")}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-chart-muted" />{t("dash.orders")}
                </span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={244}>
              <AreaChart data={trend} margin={{ top: 6, right: 6, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="dashGradSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartColors.c1} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={chartColors.c1} stopOpacity={0.01} />
                  </linearGradient>
                  <linearGradient id="dashGradOrders" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartColors.c2} stopOpacity={0.14} />
                    <stop offset="100%" stopColor={chartColors.c2} stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 5" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12, fill: chartColors.axis }}
                  axisLine={{ stroke: chartColors.grid }}
                  tickLine={false}
                  interval={4}
                  dy={4}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: chartColors.axis }}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                />
                <Tooltip {...CHART_TOOLTIP} cursor={{ stroke: chartColors.cursor, strokeDasharray: "3 3" }} />
                <Area type="monotone" dataKey="sales" stroke={chartColors.c1} strokeWidth={2} fill="url(#dashGradSales)" dot={false} activeDot={{ r: 3.5, strokeWidth: 2, stroke: chartColors.dotStroke, fill: chartColors.c1 }} name={t("dash.sales")} />
                <Area type="monotone" dataKey="orders" stroke={chartColors.c2} strokeWidth={1.8} fill="url(#dashGradOrders)" dot={false} activeDot={{ r: 3.5, strokeWidth: 2, stroke: chartColors.dotStroke, fill: chartColors.c2 }} name={t("dash.orders")} />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        </div>
      </div>

      {/* 快捷入口（收窄成卡角落）+ 渠道分布 + 最新订单 */}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-4">
        <Card className="flex flex-col rounded-[4px] border border-border bg-card p-4 xl:col-span-1">
          <h2 className="text-base font-medium text-fg">{t("dash.quickActions")}</h2>
          <div className="mt-2 grid flex-1 content-center grid-cols-2 gap-x-4">
            {quickActions.map((a) => (
              <Link
                key={a.label}
                to={a.to}
                className="group flex h-9 items-center gap-2 border-b border-border/60 text-sm transition-colors hover:text-brand-ink-text [&:nth-last-child(-n+2)]:border-b-0"
              >
                <a.icon size={14} className="shrink-0 text-fg-subtle transition-colors group-hover:text-brand" />
                <span className="min-w-0 flex-1 truncate text-fg-muted transition-colors group-hover:text-fg">
                  {a.label}
                </span>
                <ArrowRight size={12} className="shrink-0 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            ))}
          </div>
        </Card>

        <Card className="rounded-[4px] border border-border bg-card p-4 xl:col-span-1">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-medium text-fg">{t("report.channelPerf")}</h2>
            <span className="shrink-0 text-xs text-fg-subtle tabular-nums">
              {t("report.channelCount")} {channelStats.channelCount}
            </span>
          </div>

          {channelStats.rows.length === 0 ? (
            <div className="flex h-[220px] items-center justify-center text-sm text-fg-subtle">
              {loading ? "…" : t("common.empty")}
            </div>
          ) : (
            <>
              <div className="relative mt-1 h-[148px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={channelStats.rows}
                      dataKey="amount"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={44}
                      outerRadius={66}
                      paddingAngle={1}
                      stroke="none"
                    >
                      {channelStats.rows.map((r, i) => (
                        <Cell key={r.name} fill={CHART_CATEGORICAL[i % CHART_CATEGORICAL.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      {...CHART_TOOLTIP}
                      formatter={(v, n) => [`$${fmtMoney(Number(v))}`, String(n)]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1">
                  <span className="text-xs text-fg-subtle">{t("dash.sales")}</span>
                  <span className="text-base font-semibold leading-none tracking-[-0.02em] text-fg tabular-nums">
                    ${fmtMoney(channelStats.totalAmount)}
                  </span>
                </div>
              </div>

              <table className="mt-2 w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-surface-sunken text-fg-muted">
                    <th className="h-7 rounded-l-[3px] px-1.5 text-left font-medium">{t("dash.col.channel")}</th>
                    <th className="h-7 w-10 px-1.5 text-right font-medium">{t("dash.orders")}</th>
                    <th className="h-7 w-16 rounded-r-[3px] px-1.5 text-right font-medium">{t("dash.sales")}</th>
                  </tr>
                </thead>
                <tbody>
                  {channelStats.rows.slice(0, 5).map((r, i) => {
                    const color = CHART_CATEGORICAL[i % CHART_CATEGORICAL.length];
                    return (
                      <tr key={r.name} className="border-b border-border/60 last:border-b-0">
                        <td className="px-1.5 py-1 align-middle">
                          <div className="flex items-center gap-1.5">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                            <span className="truncate text-fg" title={r.name}>{r.name}</span>
                          </div>
                        </td>
                        <td className="px-1.5 py-1 text-right align-middle text-fg-muted tabular-nums">{fmtNum(r.orders)}</td>
                        <td className="px-1.5 py-1 text-right align-middle text-fg tabular-nums">{fmtMoney(r.amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </Card>

        <div className="xl:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-medium text-fg">{t("dash.latestOrders")}</h2>
            <Link to="/orders" className="flex items-center gap-1 text-sm text-fg-muted transition-colors hover:text-primary">
              {t("dash.viewAll")} <ArrowRight size={12} />
            </Link>
          </div>
          <DataTable
            columns={recentColumns}
            rows={recentOrders}
            rowKey={(o) => o.id}
            loading={loading}
            emptyState={<EmptyState text={t("dash.noOrders")} className="py-10" />}
            showEmptyState={recentOrders.length === 0}
          />
        </div>
      </div>
    </div>
  );
}
