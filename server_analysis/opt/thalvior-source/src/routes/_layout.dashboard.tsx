import { createFileRoute, Link } from "@tanstack/react-router";
import { TrendingUp, TrendingDown, ArrowRight, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchProducts, fetchInventory } from "@/lib/data-access";
import { supabase } from "@/supabase/client";
import { useLanguage } from "@/i18n/LanguageContext";
import { StatusBadge } from "@/components/status-badge";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
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

function Dashboard() {
  const { t, lang } = useLanguage();
  const [productCount, setProductCount] = useState(0);
  const [stockTotal, setStockTotal] = useState(0);
  const [todaySales, setTodaySales] = useState(0);
  const [todayOrders, setTodayOrders] = useState(0);
  const [salesDelta, setSalesDelta] = useState<number | null>(null);
  const [ordersDelta, setOrdersDelta] = useState<number | null>(null);
  const [userName, setUserName] = useState("");
  const [trend, setTrend] = useState<{ date: string; sales: number; orders: number }[]>([]);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [todoCounts, setTodoCounts] = useState({ pay: 0, audit: 0, stock: 0, auth: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchProducts().then((p) => setProductCount(p.length)).catch((e) => console.error("load products failed", e)),
      fetchInventory().then((inv) => setStockTotal(inv.reduce((s, i) => s + Number(i.available ?? 0), 0))).catch((e) => console.error("load inventory failed", e)),
      loadDashboardData().catch((e) => console.error("load dashboard data failed", e)),
      loadUserName(),
    ]).finally(() => setLoading(false));
  }, []);

  const loadUserName = async () => {
    const { data: session } = await supabase.auth.getSession();
    const userId = session?.session?.user?.id;
    if (!userId) return;
    const { data } = await supabase.from("profiles").select("username").eq("id", userId).maybeSingle();
    if (data?.username) setUserName(data.username);
  };

  const loadDashboardData = async () => {
    const { data: orders } = await supabase
      .from("orders")
      .select("id, product, channel, amount, currency, status, created_at")
      .order("created_at", { ascending: false })
      .limit(400);
    const orderRows = (orders ?? []) as RecentOrder[];

    const now = new Date();
    const isSameDay = (d: Date, target: Date) =>
      d.getFullYear() === target.getFullYear() && d.getMonth() === target.getMonth() && d.getDate() === target.getDate();
    const todayRows = orderRows.filter((o) => isSameDay(new Date(o.created_at), now));
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const yesterdayRows = orderRows.filter((o) => isSameDay(new Date(o.created_at), yesterday));

    const todaySalesVal = todayRows.reduce((s, o) => s + Number(o.amount ?? 0), 0);
    const yesterdaySalesVal = yesterdayRows.reduce((s, o) => s + Number(o.amount ?? 0), 0);
    setTodaySales(todaySalesVal);
    setTodayOrders(todayRows.length);
    setSalesDelta(yesterdaySalesVal > 0 ? ((todaySalesVal - yesterdaySalesVal) / yesterdaySalesVal) * 100 : null);
    setOrdersDelta(yesterdayRows.length > 0 ? ((todayRows.length - yesterdayRows.length) / yesterdayRows.length) * 100 : null);

    // 近 30 天走势
    const days: { date: string; sales: number; orders: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const dayOrders = orderRows.filter((o) => {
        const od = new Date(o.created_at);
        return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth() && od.getDate() === d.getDate();
      });
      days.push({
        date: key,
        sales: dayOrders.reduce((s, o) => s + Number(o.amount ?? 0), 0),
        orders: dayOrders.length,
      });
    }
    setTrend(days);
    setRecentOrders(orderRows.slice(0, 8));

    // 待办计数（全部来自真实表）
    const pay = orderRows.filter((o) => o.status === "待付款" || o.status === "待支付").length;
    const audit = orderRows.filter((o) => o.status === "待审核").length;
    const { data: inventory } = await supabase.from("inventory").select("available, safety_stock");
    const invRows = (inventory ?? []) as { available: number; safety_stock: number }[];
    const stock = invRows.filter((i) => Number(i.available) <= Number(i.safety_stock ?? 0)).length;
    let authExpiring = 0;
    try {
      const { count } = await supabase
        .from("shop_auths")
        .select("id", { count: "exact", head: true })
        .eq("status", "即将到期");
      authExpiring = count ?? 0;
    } catch {
      authExpiring = 0;
    }
    setTodoCounts({ pay, audit, stock, auth: authExpiring });
  };

  const formatDate = (d: Date) => {
    if (lang === "en") {
      return d.toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "2-digit" });
    }
    return `${d.getFullYear()} / ${String(d.getMonth() + 1).padStart(2, "0")} / ${String(d.getDate()).padStart(2, "0")} 周${WEEK_ZH[d.getDay()]}`;
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    if (lang === "en") {
      return d.toLocaleDateString("en-US", { month: "short", day: "2-digit" }) + ` ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const kpis = [
    { label: t("dash.todaySales"), value: `$${todaySales.toFixed(2)}`, delta: salesDelta },
    { label: t("dash.todayOrders"), value: todayOrders.toLocaleString(), delta: ordersDelta },
    { label: t("dash.products"), value: productCount.toLocaleString(), delta: null },
    { label: t("dash.stock"), value: stockTotal.toLocaleString(), delta: null },
  ];

  const todoRows = [
    { label: t("dash.todoPay"), count: todoCounts.pay, to: "/orders" },
    { label: t("dash.todoAudit"), count: todoCounts.audit, to: "/orders" },
    { label: t("dash.todoStock"), count: todoCounts.stock, to: "/inventory" },
    { label: t("dash.todoAuth"), count: todoCounts.auth, to: "/auth" },
  ];

  return (
    <div className="space-y-8 pt-1">
      {/* 标题区（无框） */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="manifest-eyebrow">{t("dash.overview")}</div>
          <h1 className="mt-2 text-[21px] font-semibold tracking-tight text-foreground">
            {t("dash.welcome")}{userName ? `，${userName}` : ""}
          </h1>
        </div>
        <div className="font-data text-[12.5px] text-muted-foreground">{formatDate(new Date())}</div>
      </div>

      {/* KPI：无框大数字 + 发丝竖线 */}
      <div className="grid grid-cols-2 border-t border-b border-border xl:grid-cols-4">
        {kpis.map((k, i) => (
          <div
            key={k.label}
            className={`px-6 py-6 ${i > 0 ? "border-l border-border max-xl:odd:border-l-0" : ""} ${i >= 2 ? "max-xl:border-t max-xl:border-border" : ""}`}
          >
            <div className="text-[11.5px] text-muted-foreground">{k.label}</div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="font-data text-[30px] font-medium leading-none tracking-tight text-foreground">
                {loading ? "—" : k.value}
              </span>
              {k.delta !== null && (
                <span className={`flex items-center gap-0.5 text-[11.5px] ${k.delta >= 0 ? "text-muted-foreground" : "text-destructive"}`}>
                  {k.delta >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  {k.delta >= 0 ? "+" : ""}{k.delta.toFixed(1)}%
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 走势 + 待办 */}
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
        {/* 销售走势 30 天：黑灰双线，无渐变填充 */}
        <div className="xl:col-span-2">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-foreground">{t("dash.trend30")}</h2>
            <div className="flex items-center gap-4 text-[12px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-[2px] w-4 bg-[#1d1d1f]" />{t("dash.sales")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-[2px] w-4 bg-[#c8c8cc]" />{t("dash.orders")}
              </span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={trend} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#f2f2f2" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "#9a9a9e" }}
                axisLine={{ stroke: "#f0f0f0" }}
                tickLine={false}
                interval={4}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#9a9a9e" }}
                axisLine={false}
                tickLine={false}
                width={52}
              />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: "1px solid #f0f0f0", fontSize: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.06)" }}
                labelStyle={{ color: "#5a5a5e" }}
              />
              <Line type="monotone" dataKey="sales" stroke="#1d1d1f" strokeWidth={1.6} dot={false} name={t("dash.sales")} />
              <Line type="monotone" dataKey="orders" stroke="#c8c8cc" strokeWidth={1.5} dot={false} name={t("dash.orders")} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* 待办：4 条发丝行 + 黑按钮 */}
        <div>
          <h2 className="mb-1 text-[14px] font-semibold text-foreground">{t("dash.todo")}</h2>
          <p className="mb-4 text-[12px] text-muted-foreground">{t("dash.todoDesc")}</p>
          <div className="border-t border-border">
            {todoRows.map((row) => (
              <Link
                key={row.label}
                to={row.to}
                className="flex items-center justify-between border-b border-border py-3.5 transition-colors hover:opacity-70"
              >
                <span className="text-[13px] text-[#5a5a5e]">{row.label}</span>
                <span className="flex items-center gap-1">
                  <span className={`font-data text-[16px] font-medium ${row.count > 0 ? "text-foreground" : "text-[#c8c8cc]"}`}>
                    {row.count}
                  </span>
                  <ArrowRight size={13} className="text-[#c8c8cc]" />
                </span>
              </Link>
            ))}
          </div>
          <Link
            to="/auth"
            className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-foreground/85"
          >
            <Plus size={14} strokeWidth={2.2} />
            {t("dash.connectShop")}
          </Link>
        </div>
      </div>

      {/* 最新订单：裸表格 */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-foreground">{t("dash.latestOrders")}</h2>
          <Link to="/orders" className="flex items-center gap-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground">
            {t("dash.viewAll")} <ArrowRight size={12} />
          </Link>
        </div>
        <div className="border-t border-border">
          {/* 表头 */}
          <div className="hidden grid-cols-[1.4fr_0.8fr_1.6fr_0.9fr_0.8fr_0.9fr] gap-4 border-b border-border px-2 py-2.5 text-[11.5px] text-muted-foreground md:grid">
            <span>{t("dash.col.orderNo")}</span>
            <span>{t("dash.col.channel")}</span>
            <span>{t("dash.col.product")}</span>
            <span>{t("dash.col.amount")}</span>
            <span>{t("dash.col.status")}</span>
            <span className="text-right">{t("dash.col.time")}</span>
          </div>
          {recentOrders.length === 0 && (
            <div className="px-2 py-10 text-center text-[13px] text-[#9a9a9e]">{t("dash.noOrders")}</div>
          )}
          {recentOrders.map((o) => (
            <Link
              key={o.id}
              to="/orders"
              className="grid grid-cols-2 gap-x-4 gap-y-1 border-b border-border px-2 py-3.5 text-[13px] transition-colors hover:bg-[#fafafa] md:grid-cols-[1.4fr_0.8fr_1.6fr_0.9fr_0.8fr_0.9fr] md:items-center"
            >
              <span className="font-data truncate text-foreground">{o.id}</span>
              <span className="truncate text-[#5a5a5e] md:text-[#5a5a5e]">{o.channel || "—"}</span>
              <span className="col-span-2 truncate text-[#5a5a5e] md:col-span-1">{o.product || "—"}</span>
              <span className="font-data text-foreground">{o.currency || "USD"} {Number(o.amount ?? 0).toFixed(2)}</span>
              <span><StatusBadge status={o.status} /></span>
              <span className="font-data text-right text-[#9a9a9e]">{formatTime(o.created_at)}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
