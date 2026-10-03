import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Wallet, Loader2, Plus, Search, ArrowDownLeft, ArrowUpRight, Crown } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { supabase } from "@/supabase/client";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/LanguageContext";

export const Route = createFileRoute("/admin/quotas")({
  component: Quotas,
});

interface QuotaRow {
  id: string;
  user_id: string;
  balance: number;
  plan_id: string | null;
  plan_name: string;
  plan_expires_at: string | null;
  updated_at: string;
}

interface PlanRow {
  id: string;
  name: string;
  plan_key: string;
  price: number;
  quota: number;
}

interface RechargeRow {
  id: string;
  user_id: string;
  amount: number;
  method: string;
  created_at: string;
}

interface UsageRow {
  id: string;
  user_id: string;
  service_name: string;
  cost: number;
  status: string;
  created_at: string;
}

function Quotas() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<QuotaRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [recharges, setRecharges] = useState<RechargeRow[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addAmount, setAddAmount] = useState<Record<string, string>>({});
  const [assignPlan, setAssignPlan] = useState<Record<string, string>>({});
  const [keyword, setKeyword] = useState("");

  const load = () => {
    setLoading(true);
    Promise.all([
      supabase.from("tenant_quotas").select("*").order("updated_at", { ascending: false }),
      supabase.from("subscription_plans").select("*").order("sort_order", { ascending: true }),
      supabase.from("quota_recharges").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("ai_usage_logs").select("*").order("created_at", { ascending: false }).limit(200),
    ]).then(([q, p, r, u]) => {
      setRows((q.data ?? []) as QuotaRow[]);
      setPlans((p.data ?? []) as PlanRow[]);
      setRecharges((r.data ?? []) as RechargeRow[]);
      setUsage((u.data ?? []) as UsageRow[]);
      setLoading(false);
    });
  };

  useEffect(load, []);

  // 搜索过滤（按租户 ID 模糊匹配）
  const filteredRows = useMemo(() => {
    if (!keyword.trim()) return rows;
    return rows.filter((r) => r.user_id.toLowerCase().includes(keyword.toLowerCase()));
  }, [rows, keyword]);

  const addQuota = async (row: QuotaRow) => {
    const amount = Number(addAmount[row.id] ?? 0);
    if (!amount || amount <= 0) {
      toast.error(t("admin.invalidAmount"));
      return;
    }
    const newBalance = Number(row.balance) + amount;
    const { error } = await supabase
      .from("tenant_quotas")
      .update({ balance: newBalance, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) {
      toast.error(`${t("admin.topUpFail")}: ${error.message}`);
      return;
    }
    // 同步写入充值流水（管理员增补）
    await supabase.from("quota_recharges").insert({ user_id: row.user_id, amount, method: t("admin.adminTopUp") });
    toast.success(t("admin.topUpDone", { amount }));
    setAddAmount((prev) => ({ ...prev, [row.id]: "" }));
    load();
  };

  const shortId = (id: string) => (id ? id.slice(0, 8) + "…" : "—");

  // 分配套餐：更新 tenant_quotas 的套餐字段，并写入 subscriptions 记录
  const assignPlanToTenant = async (row: QuotaRow) => {
    const planId = assignPlan[row.id];
    if (!planId) return;
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    const { data, error } = await supabase
      .from("tenant_quotas")
      .update({
        plan_id: plan.id,
        plan_name: plan.name,
        plan_expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .select();
    if (error || !data || data.length === 0) {
      toast.error(t("admin.assignFail"));
      return;
    }
    // 写入订阅记录
    await supabase.from("subscriptions").insert({
      user_id: row.user_id,
      plan_id: plan.id,
      plan_name: plan.name,
      amount: plan.price,
      status: "active",
      started_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    });
    toast.success(t("admin.assignDone", { plan: plan.name }));
    setAssignPlan((prev) => ({ ...prev, [row.id]: "" }));
    load();
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t("admin.quotaTitle")} description={t("admin.quotaDesc")} />

      {/* 搜索 */}
      <div className="relative w-full max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={t("admin.searchTenant")}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* 租户额度列表 */}
      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-3 text-sm font-semibold">{t("admin.quotaList")}</div>
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : filteredRows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            {keyword ? t("admin.noMatch") : t("admin.noQuota")}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-5 py-3 font-medium">{t("admin.tenantId")}</th>
                <th className="px-5 py-3 font-medium">{t("admin.plan")}</th>
                <th className="px-5 py-3 font-medium">{t("admin.balance")}</th>
                <th className="px-5 py-3 font-medium">{t("admin.updatedAt")}</th>
                <th className="px-5 py-3 text-right font-medium">{t("admin.topUp")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="max-w-[200px] truncate px-5 py-3 font-mono text-xs text-muted-foreground">
                    {row.user_id}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      {row.plan_name ? (
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                          <Crown size={14} className="text-amber-500" /> {row.plan_name}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      <select
                        value={assignPlan[row.id] ?? ""}
                        onChange={(e) => setAssignPlan((prev) => ({ ...prev, [row.id]: e.target.value }))}
                        className="h-7 rounded-md border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                      >
                        <option value="">{t("admin.assignPlan")}</option>
                        {plans.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      {assignPlan[row.id] && (
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => assignPlanToTenant(row)}>
                          {t("admin.assign")}
                        </Button>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1.5 font-semibold">
                      <Wallet size={14} className="text-amber-500" />
                      {Number(row.balance).toFixed(2)}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {new Date(row.updated_at).toLocaleString()}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Input
                        type="number"
                        value={addAmount[row.id] ?? ""}
                        onChange={(e) => setAddAmount((prev) => ({ ...prev, [row.id]: e.target.value }))}
                        placeholder={t("admin.quota")}
                        className="h-8 w-24"
                      />
                      <Button size="sm" variant="outline" onClick={() => addQuota(row)}>
                        <Plus size={14} /> {t("admin.topUpBtn")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 充值流水 */}
      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-3 text-sm font-semibold">{t("admin.rechargeLog")}</div>
        {recharges.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">{t("admin.noRecharge")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-5 py-3 font-medium">{t("admin.tenant")}</th>
                <th className="px-5 py-3 font-medium">{t("admin.amount")}</th>
                <th className="px-5 py-3 font-medium">{t("admin.method")}</th>
                <th className="px-5 py-3 font-medium">{t("admin.time")}</th>
              </tr>
            </thead>
            <tbody>
              {recharges.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{shortId(r.user_id)}</td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-600">
                      <ArrowDownLeft size={14} /> +{Number(r.amount).toFixed(2)}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{r.method}</td>
                  <td className="px-5 py-3 text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 消耗流水 */}
      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-3 text-sm font-semibold">{t("admin.usageLog")}</div>
        {usage.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">{t("admin.noUsage")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-5 py-3 font-medium">{t("admin.tenant")}</th>
                <th className="px-5 py-3 font-medium">{t("admin.capability")}</th>
                <th className="px-5 py-3 font-medium">{t("admin.cost")}</th>
                <th className="px-5 py-3 font-medium">{t("admin.status")}</th>
                <th className="px-5 py-3 font-medium">{t("admin.time")}</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{shortId(u.user_id)}</td>
                  <td className="px-5 py-3 font-medium">{u.service_name}</td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-rose-600">
                      <ArrowUpRight size={14} /> -{Number(u.cost).toFixed(2)}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className={cn("text-xs font-medium", u.status === "成功" ? "text-emerald-600" : "text-rose-600")}>
                      {t(u.status)}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{new Date(u.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}