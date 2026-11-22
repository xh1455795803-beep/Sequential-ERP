import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Settings2, Plus, RefreshCw, Info } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { supabase } from "@/supabase/client";
import { useLanguage } from "@/i18n/LanguageContext";
import { toast } from "sonner";

export const Route = createFileRoute("/_layout/finance/fees")({
  component: FeeAccountsPage,
});

type CategoryRow = { id: string; code: string; sort_order: number };
type AccountRow = {
  id: string; user_id: string; category_id: string; code: string; name_key: string;
  is_allocatable: boolean; default_allocation: string; is_negative_allowed: boolean;
  is_active: boolean; sort_order: number;
};

const ALLOC_MODES = ["none", "order_amount_ratio", "sku_quantity_ratio", "order_even"] as const;

function FeeAccountsPage() {
  const { t } = useLanguage();
  const [cats, setCats] = useState<CategoryRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [settings, setSettings] = useState<{ single_fee_threshold: number; dup_account_limit: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ code: "", category: "platform", allocation: "order_amount_ratio", negative: false });
  const [creating, setCreating] = useState(false);

  const catById = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
  const catByCode = useMemo(() => new Map(cats.map((c) => [c.code, c])), [cats]);

  // 科目名：i18n key fee.account.{code}；未翻译（用户新增自定义科目）回退显示 code
  const accName = useCallback((code: string) => {
    const key = `fee.account.${code}`;
    const v = t(key);
    return v === key ? code : v;
  }, [t]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [c, a, s] = await Promise.all([
        supabase.from("fee_categories").select("id, code, sort_order").order("sort_order"),
        supabase.from("fee_accounts").select("*").order("sort_order"),
        supabase.from("fee_settings").select("single_fee_threshold, dup_account_limit").maybeSingle(),
      ]);
      if (c.error) throw new Error(c.error.message);
      if (a.error) throw new Error(a.error.message);
      if (s.error) throw new Error(s.error.message);
      setCats((c.data ?? []) as unknown as CategoryRow[]);
      setAccounts((a.data ?? []) as unknown as AccountRow[]);
      setSettings((s.data as unknown as { single_fee_threshold: number; dup_account_limit: number }) ?? { single_fee_threshold: 10000, dup_account_limit: 2 });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { loadData(); }, [loadData]);

  const grouped = useMemo(() => {
    const m = new Map<string, AccountRow[]>();
    for (const a of accounts) {
      const cat = catById.get(a.category_id)?.code ?? "other";
      const arr = m.get(cat) ?? [];
      arr.push(a);
      m.set(cat, arr);
    }
    for (const arr of m.values()) arr.sort((x, y) => x.sort_order - y.sort_order || x.code.localeCompare(y.code));
    return m;
  }, [accounts, catById]);

  const toggleActive = async (acc: AccountRow) => {
    setToggling(acc.id);
    try {
      const { error: e } = await supabase.from("fee_accounts").update({ is_active: !acc.is_active }).eq("id", acc.id);
      if (e) throw e;
      setAccounts((prev) => prev.map((a) => (a.id === acc.id ? { ...a, is_active: !acc.is_active } : a)));
      toast.success(t(acc.is_active ? "feeMgmt.disabled" : "feeMgmt.enabled"));
    } catch (err) {
      toast.error(`${t("feeMgmt.saveFailed")}: ${err instanceof Error ? err.message : ""}`);
    } finally {
      setToggling(null);
    }
  };

  const saveSettings = async () => {
    if (!settings) return;
    setSavingSettings(true);
    try {
      const threshold = Math.max(0, Number(settings.single_fee_threshold) || 10000);
      const dup = Math.max(1, Math.floor(Number(settings.dup_account_limit) || 2));
      const { error: e } = await supabase.from("fee_settings")
        .upsert({ user_id: (await supabase.auth.getUser()).data.user?.id, single_fee_threshold: threshold, dup_account_limit: dup, updated_at: new Date().toISOString() });
      if (e) throw e;
      setSettings({ single_fee_threshold: threshold, dup_account_limit: dup });
      toast.success(t("feeMgmt.saved"));
    } catch (err) {
      toast.error(`${t("feeMgmt.saveFailed")}: ${err instanceof Error ? err.message : ""}`);
    } finally {
      setSavingSettings(false);
    }
  };

  const createAccount = async () => {
    const code = form.code.trim();
    if (!code || !/^[a-z0-9_]+$/.test(code)) {
      toast.error(t("feeMgmt.codeInvalid"));
      return;
    }
    if (accounts.some((a) => a.code === code)) {
      toast.error(t("feeMgmt.codeExists"));
      return;
    }
    setCreating(true);
    try {
      const cat = catByCode.get(form.category);
      if (!cat) throw new Error("category not found");
      const uid = (await supabase.auth.getUser()).data.user?.id;
      const { error: e } = await supabase.from("fee_accounts").insert({
        user_id: uid, category_id: cat.id, code,
        name_key: `fee.account.${code}`,
        is_allocatable: form.allocation !== "none",
        default_allocation: form.allocation,
        is_negative_allowed: form.negative,
        is_active: true, sort_order: 900,
      });
      if (e) throw e;
      toast.success(t("feeMgmt.saved"));
      setAdding(false);
      setForm({ code: "", category: "platform", allocation: "order_amount_ratio", negative: false });
      await loadData();
    } catch (err) {
      toast.error(`${t("feeMgmt.saveFailed")}: ${err instanceof Error ? err.message : ""}`);
    } finally {
      setCreating(false);
    }
  };

  const allocLabel = (m: string) => t(`feeMgmt.alloc.${m}`);

  const inputCls = "h-8 rounded-md border border-border bg-card px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <div className="space-y-5">
      <PageHeader title={t("feeMgmt.title")} description={t("feeMgmt.desc")} />

      {loading ? (
        <div className="flex h-64 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={20} className="animate-spin" /> {t("fin.loading")}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-border bg-card px-4 py-12 text-center text-sm text-destructive">{error}</div>
      ) : (
        <>
          {/* 异常检测设置 */}
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
              <Settings2 size={15} /> {t("feeMgmt.thresholdTitle")}
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">{t("feeMgmt.thresholdLabel")}</label>
                <input
                  type="number" min={0} step="0.01"
                  value={settings?.single_fee_threshold ?? 10000}
                  onChange={(e) => setSettings((s) => s ? { ...s, single_fee_threshold: Number(e.target.value) } : s)}
                  className={`${inputCls} w-40`}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">{t("feeMgmt.dupLabel")}</label>
                <input
                  type="number" min={1} step="1"
                  value={settings?.dup_account_limit ?? 2}
                  onChange={(e) => setSettings((s) => s ? { ...s, dup_account_limit: Number(e.target.value) } : s)}
                  className={`${inputCls} w-28`}
                />
              </div>
              <Button size="sm" onClick={saveSettings} disabled={savingSettings}>
                {savingSettings ? <Loader2 size={14} className="animate-spin" /> : null} {t("feeMgmt.save")}
              </Button>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Info size={12} /> {t("feeMgmt.thresholdHint")}
              </p>
            </div>
          </div>

          {/* 科目清单（按大类两级展示） */}
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold">{t("feeMgmt.listTitle")}</h3>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={loadData}>
                  <RefreshCw size={13} /> {t("common.refresh")}
                </Button>
                <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => setAdding((v) => !v)}>
                  <Plus size={13} /> {t("feeMgmt.add")}
                </Button>
              </div>
            </div>

            {adding && (
              <div className="flex flex-wrap items-end gap-3 border-b border-border bg-muted/30 px-4 py-3">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">{t("feeMgmt.col.code")}</label>
                  <input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                    placeholder={t("feeMgmt.codePh")} className={`${inputCls} w-52 font-mono`} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">{t("feeMgmt.col.category")}</label>
                  <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className={`${inputCls} w-36`}>
                    {cats.map((c) => <option key={c.id} value={c.code}>{t(`fee.cat.${c.code}`)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">{t("feeMgmt.col.allocation")}</label>
                  <select value={form.allocation} onChange={(e) => setForm((f) => ({ ...f, allocation: e.target.value }))} className={`${inputCls} w-44`}>
                    {ALLOC_MODES.map((m) => <option key={m} value={m}>{allocLabel(m)}</option>)}
                  </select>
                </div>
                <label className="flex items-center gap-1.5 pb-2 text-sm">
                  <input type="checkbox" checked={form.negative} onChange={(e) => setForm((f) => ({ ...f, negative: e.target.checked }))} />
                  {t("feeMgmt.col.negative")}
                </label>
                <Button size="sm" onClick={createAccount} disabled={creating || !form.code.trim()}>
                  {creating ? <Loader2 size={14} className="animate-spin" /> : null} {t("feeMgmt.confirm")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>{t("common.cancel")}</Button>
                <p className="w-full text-xs text-muted-foreground">{t("feeMgmt.codeHint")}</p>
              </div>
            )}

            {accounts.length === 0 ? (
              <EmptyState text={t("feeMgmt.empty")} />
            ) : (
              <div>
                {cats.filter((c) => (grouped.get(c.code) ?? []).length > 0).map((c) => {
                  const list = grouped.get(c.code) ?? [];
                  const activeCount = list.filter((a) => a.is_active).length;
                  return (
                    <div key={c.id}>
                      <div className="flex items-center justify-between bg-muted/40 px-4 py-2">
                        <span className="text-sm font-semibold">{t(`fee.cat.${c.code}`)}</span>
                        <span className="text-xs text-muted-foreground">{t("feeMgmt.catStat", { a: activeCount, b: list.length })}</span>
                      </div>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-muted-foreground">
                            <th className="px-4 py-2 font-medium">{t("feeMgmt.col.code")}</th>
                            <th className="px-3 py-2 font-medium">{t("feeMgmt.col.name")}</th>
                            <th className="px-3 py-2 text-center font-medium">{t("feeMgmt.col.allocatable")}</th>
                            <th className="px-3 py-2 font-medium">{t("feeMgmt.col.allocation")}</th>
                            <th className="px-3 py-2 text-center font-medium">{t("feeMgmt.col.negative")}</th>
                            <th className="px-4 py-2 text-right font-medium">{t("common.statusLabel")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.map((a) => (
                            <tr key={a.id} className={`border-t border-border ${a.is_active ? "" : "opacity-55"}`}>
                              <td className="px-4 py-2.5 font-mono text-xs">{a.code}</td>
                              <td className="px-3 py-2.5">{accName(a.code)}</td>
                              <td className="px-3 py-2.5 text-center text-muted-foreground">{a.is_allocatable ? t("feeMgmt.yes") : t("feeMgmt.no")}</td>
                              <td className="px-3 py-2.5 text-muted-foreground">{a.is_allocatable ? allocLabel(a.default_allocation) : "—"}</td>
                              <td className="px-3 py-2.5 text-center text-muted-foreground">{a.is_negative_allowed ? t("feeMgmt.yes") : t("feeMgmt.no")}</td>
                              <td className="px-4 py-2.5 text-right">
                                <button
                                  onClick={() => toggleActive(a)}
                                  disabled={toggling === a.id}
                                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${a.is_active ? "bg-primary" : "bg-muted-foreground/30"}`}
                                  aria-label={a.is_active ? t("feeMgmt.disable") : t("feeMgmt.enable")}
                                >
                                  {toggling === a.id && <Loader2 size={10} className="absolute left-1/2 -translate-x-1/2 animate-spin text-white" />}
                                  <span className={`ml-0.5 h-4 w-4 rounded-full bg-card shadow transition-transform ${a.is_active ? "translate-x-4" : ""}`} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            {t("feeMgmt.note")}
          </div>
        </>
      )}
    </div>
  );
}
