import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Users, Loader2, Search, Snowflake, Sun, Wallet, Crown } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { supabase } from "@/supabase/client";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/LanguageContext";

export const Route = createFileRoute("/admin/tenants")({
  component: Tenants,
});

interface TenantRow {
  id: string;
  username: string;
  role: string | null;
  status: string;
  created_at: string | null;
  balance: number;
  plan_name: string;
}

function Tenants() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      supabase.from("profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("tenant_quotas").select("*"),
    ]).then(([p, q]) => {
      const profiles = (p.data ?? []) as Array<{
        id: string;
        username: string;
        role: string | null;
        status: string;
        created_at: string | null;
      }>;
      const quotas = (q.data ?? []) as Array<{ user_id: string | null; balance: number; plan_name: string }>;
      const quotaMap = new Map(quotas.map((x) => [x.user_id, x]));
      setRows(
        profiles.map((prof) => {
          const quota = quotaMap.get(prof.id);
          return {
            id: prof.id,
            username: prof.username,
            role: prof.role,
            status: prof.status ?? "active",
            created_at: prof.created_at,
            balance: quota?.balance ?? 0,
            plan_name: quota?.plan_name ?? "",
          };
        })
      );
      setLoading(false);
    });
  };

  useEffect(load, []);

  const filtered = useMemo(() => {
    if (!keyword.trim()) return rows;
    const kw = keyword.toLowerCase();
    return rows.filter((r) => r.username.toLowerCase().includes(kw) || r.id.toLowerCase().includes(kw));
  }, [rows, keyword]);

  const toggleStatus = async (row: TenantRow) => {
    const next = row.status === "frozen" ? "active" : "frozen";
    setTogglingId(row.id);
    const { data, error } = await supabase
      .from("profiles")
      .update({ status: next })
      .eq("id", row.id)
      .select();
    if (error || !data || data.length === 0) {
      toast.error(t("admin.toggleFail"));
      setTogglingId(null);
      return;
    }
    toast.success(next === "frozen" ? t("admin.frozenDone") : t("admin.unfrozenDone"));
    setTogglingId(null);
    load();
  };

  const shortId = (id: string) => (id ? id.slice(0, 8) + "…" : "—");

  return (
    <div className="space-y-5">
      <PageHeader title={t("admin.tenants")} description={t("admin.tenantsDesc")} />

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

      {/* 租户列表 */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            {keyword ? t("admin.noMatch") : t("admin.noTenant")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-5 py-3 font-medium">{t("admin.account")}</th>
                  <th className="px-5 py-3 font-medium">{t("admin.role")}</th>
                  <th className="px-5 py-3 font-medium">{t("admin.status")}</th>
                  <th className="px-5 py-3 font-medium">{t("admin.plan")}</th>
                  <th className="px-5 py-3 font-medium">{t("admin.balance")}</th>
                  <th className="px-5 py-3 font-medium">{t("admin.registeredAt")}</th>
                  <th className="px-5 py-3 text-right font-medium">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const frozen = row.status === "frozen";
                  return (
                    <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                            <Users size={14} />
                          </span>
                          <div className="min-w-0">
                            <div className="truncate font-medium">{row.username}</div>
                            <div className="font-mono text-xs text-muted-foreground">{shortId(row.id)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                            row.role === "admin"
                              ? "bg-violet-50 text-violet-600 border-violet-200"
                              : "bg-slate-50 text-slate-600 border-slate-200"
                          )}
                        >
                          {row.role === "admin" ? t("admin.roleAdmin") : t("admin.roleTenant")}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                            frozen
                              ? "bg-rose-50 text-rose-600 border-rose-200"
                              : "bg-emerald-50 text-emerald-600 border-emerald-200"
                          )}
                        >
                          {frozen ? t("admin.frozen") : t("admin.active")}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {row.plan_name ? (
                          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                            <Crown size={14} className="text-amber-500" /> {row.plan_name}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span className="inline-flex items-center gap-1.5 font-semibold">
                          <Wallet size={14} className="text-amber-500" />
                          {Number(row.balance).toFixed(2)}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {row.created_at ? new Date(row.created_at).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            className={cn("h-8 gap-1 text-xs", frozen ? "text-emerald-600" : "text-rose-600")}
                            onClick={() => toggleStatus(row)}
                            disabled={togglingId === row.id}
                          >
                            {togglingId === row.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : frozen ? (
                              <Sun size={14} />
                            ) : (
                              <Snowflake size={14} />
                            )}
                            {frozen ? t("admin.unfreeze") : t("admin.freeze")}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}