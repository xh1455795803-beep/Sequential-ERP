// Tab B「授权」：forwarder_auths 列表 + 4 种绑定协议新增 + 审核动作
// 核心语义：auth_state（审核到哪一步）与 available_state（当前能不能调用）是两条独立状态，
// 这里分成两列、两组动作，绝不合并（妙手事故：授权成功但库存不可调用）。
import { useState } from "react";
import { Check, KeyRound, Loader2, Plus, ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { tt } from "@/i18n/tts";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { insertRow, queryTable, updateRow, type TableFilter } from "@/lib/data-access";
import { supabase } from "@/supabase/client";
import {
  AUTH_STATE_META, AVAIL_STATE_META, Chip, EmptyRow, EnumBadge, ErrorRow, LoadingRow, Panel,
  PROVIDER_DESC_KEYS, PROVIDER_META, PROTOCOL_DESC_KEYS, PROTOCOL_META, Sel, Td, Th,
  fmtTs, mapAuth, optionLabel, toOptions, useAsyncData, useForwarderOptions,
  type Auth,
} from "./common";

const PROTOCOL_OPTIONS = toOptions(PROTOCOL_META);
const AUTH_STATE_OPTIONS = toOptions(AUTH_STATE_META);
const AVAIL_STATE_OPTIONS = toOptions(AVAIL_STATE_META);
const PROVIDER_OPTIONS = toOptions(PROVIDER_META);

// 列表页投影列：与 mapAuth 一一对应，故意不含 credentials_enc / webhook_secret_enc
const AUTH_SELECT = [
  "id", "forwarder_id", "protocol", "provider", "external_account", "external_tenant_id",
  "app_key", "callback_url", "auth_state", "available_state", "unavailable_reason",
  "push_enabled", "registered_at", "reviewed_at", "authorized_at", "expires_at",
  "last_valid_check_at", "last_error", "created_at", "has_credentials",
].join(",");

/* ------------------------------------------------------------------
 * forwarder-credentials EF：接口凭据的录入与脱敏回读
 * 为什么必须走 EF 而不是 insertRow：credentials_enc / webhook_secret_enc
 * 存的是 AES-256-GCM 密文，加密发生在服务端（密钥是 JWT_SECRET），
 * 浏览器既拿不到密钥也不该拿到明文——所以前端只做「写入 + 回显尾 4 位」。
 * ---------------------------------------------------------------- */
const CRED_EF = "forwarder-credentials";

interface CredMask { present: boolean; length: number; tail: string }
interface CredSummary {
  ok?: boolean;
  auth_id?: string;
  provider?: string;
  adapter_ready?: boolean;
  has_credentials?: boolean;
  endpoint_url?: string;
  app_key?: string;
  merchant_account?: string;
  auth_code?: CredMask;
  app_secret?: CredMask;
  webhook_secret?: CredMask;
  credentials_updated_at?: string;
  error?: string;
}

async function callCredEf(body: Record<string, unknown>): Promise<CredSummary> {
  const { data, error } = await supabase.functions.invoke(CRED_EF, { body });
  if (error) {
    const ctx = (error as { context?: { json?: () => Promise<Record<string, unknown>> } }).context;
    let message = "";
    if (ctx && typeof ctx.json === "function") {
      try {
        const b = await ctx.json();
        message = String(b?.error ?? b?.message ?? "");
      } catch { /* 非 JSON 错误体：退回 error.message */ }
    }
    throw new Error(message || String((error as { message?: string }).message ?? "") || tt("fw.msg.credEfFail"));
  }
  const p = data as CredSummary | null;
  if (p && p.ok === false) throw new Error(String((p as unknown as Record<string, unknown>).error ?? tt("fw.msg.credEfFail")));
  if (p && typeof p.error === "string" && p.error) throw new Error(p.error);
  return (p ?? {}) as CredSummary;
}

type Pending = { row: Auth; kind: "reject" | "suspend" | "unavailable" } | null;

export function AuthPanel() {
  const { forwarders } = useForwarderOptions();
  const [fForwarder, setFForwarder] = useState("");
  const [fProtocol, setFProtocol] = useState("");
  const [fAuth, setFAuth] = useState("");
  const [fAvail, setFAvail] = useState("");
  const [fProvider, setFProvider] = useState("");

  const nameMap = new Map(forwarders.map((f) => [f.id, f.name]));

  const { data, loading, error, reload } = useAsyncData<Auth[]>(
    async () => {
      // 下推：货代 / 货代系统 / 协议 / 授权态 / 可用态 五个标量条件全部作为数据库查询参数（租户由 RLS 收窄）
      const fs: TableFilter[] = [];
      if (fForwarder) fs.push({ field: "forwarder_id", value: fForwarder });
      if (fProtocol) fs.push({ field: "protocol", value: fProtocol });
      if (fAuth) fs.push({ field: "auth_state", value: fAuth });
      if (fAvail) fs.push({ field: "available_state", value: fAvail });
      if (fProvider) fs.push({ field: "provider", value: fProvider });
      const rows = await queryTable("forwarder_auths", {
        filters: fs.length ? fs : undefined,
        order: { field: "created_at" },
        // 显式列投影：credentials_enc / webhook_secret_enc 是密文大字段，
        // 既不该占列表页带宽，也不该让浏览器拿到可离线爆破的密文；
        // 「有没有录凭据」由服务端生成列 has_credentials 回答。
        select: AUTH_SELECT,
      });
      return rows.rows.map(mapAuth);
    },
    [fForwarder, fProtocol, fAuth, fAvail, fProvider, forwarders.length],
    [],
  );

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    forwarder_id: "", protocol: "auth_code", provider: "tfop1", external_account: "", external_tenant_id: "",
    app_key: "", callback_url: "", push_enabled: true, expires_at: "",
    endpoint_url: "", auth_code: "", app_secret: "", webhook_secret: "",
  });
  // 凭据弹窗：credRow 非空即打开；view 为 EF 回读的脱敏现状
  const [credRow, setCredRow] = useState<Auth | null>(null);
  const [credBusy, setCredBusy] = useState(false);
  const [credView, setCredView] = useState<CredSummary | null>(null);
  const [credForm, setCredForm] = useState({
    provider: "tfop1", endpoint_url: "", app_key: "", merchant_account: "",
    auth_code: "", app_secret: "", webhook_secret: "",
  });
  const setCred = (patch: Partial<typeof credForm>) => setCredForm((p) => ({ ...p, ...patch }));
  const set = (patch: Partial<typeof form>) => setForm((p) => ({ ...p, ...patch }));

  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState("");

  const openAdd = () => {
    setForm({
      forwarder_id: fForwarder || forwarders[0]?.id || "",
      protocol: "auth_code", provider: "tfop1", external_account: "", external_tenant_id: "",
      app_key: "", callback_url: "", push_enabled: true, expires_at: "",
      endpoint_url: "", auth_code: "", app_secret: "", webhook_secret: "",
    });
    setOpen(true);
  };

  const create = async () => {
    if (!form.forwarder_id) {
      toast.error(tt("fw.msg.needForwarder"));
      return;
    }
    setSaving(true);
    try {
      const createdId = await insertRow("forwarder_auths", {
        forwarder_id: form.forwarder_id,
        provider: form.provider,
        protocol: form.protocol,
        external_account: form.external_account.trim() || null,
        external_tenant_id: form.external_tenant_id.trim() || null,
        app_key: form.app_key.trim() || null,
        callback_url: form.callback_url.trim() || null,
        push_enabled: form.push_enabled,
        // 新建一律从 registered 起步：审核态必须由动作流转，不允许前端直接写 authorized
        auth_state: "registered",
        available_state: "unknown",
        registered_at: new Date().toISOString(),
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
      });
      // 密钥只在「这次确实填了」时才走 EF：明文不进列表接口，也不写进 forwarder_auths 明文列
      const secret =
        form.endpoint_url.trim() + form.auth_code.trim() + form.app_secret.trim() + form.webhook_secret.trim();
      if (secret && createdId) {
        try {
          await callCredEf({
            action: "set",
            auth_id: createdId,
            provider: form.provider,
            endpoint_url: form.endpoint_url.trim(),
            app_key: form.app_key.trim(),
            merchant_account: form.external_account.trim(),
            auth_code: form.auth_code.trim(),
            app_secret: form.app_secret.trim(),
            webhook_secret: form.webhook_secret.trim(),
          });
        } catch (e2) {
          // 授权行已建好、凭据没进去：不回滚也不假装成功，提示后仍可用行内「接口凭据」补录
          toast.error(`${tt("fw.msg.authCreated")}/${tt("fw.msg.credsSkipped")}：${e2 instanceof Error ? e2.message : ""}`);
          setOpen(false);
          reload();
          return;
        }
      }
      toast.success(tt("fw.msg.authCreated"));
      setOpen(false);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tt("fw.msg.saveFail"));
    } finally {
      setSaving(false);
    }
  };

  // 授权动作：改 forwarder_auths（权威），并把状态镜像回 freight_forwarders.auth_state（冗余列，列表页免 join）
  const applyPatch = async (row: Auth, patch: Record<string, unknown>, mirror: Record<string, unknown>, okKey: string) => {
    setBusyId(row.id);
    try {
      await updateRow("forwarder_auths", row.id, patch);
      try {
        await updateRow("freight_forwarders", row.forwarder_id, mirror);
      } catch {
        // 镜像列同步失败不阻塞主流程：权威值以 forwarder_auths 为准，列表页会显示漂移提示
      }
      toast.success(tt(okKey));
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tt("fw.msg.actionFail"));
    } finally {
      setBusyId("");
    }
  };

  const submit = (row: Auth) =>
    applyPatch(
      row,
      { auth_state: "pending_review", registered_at: row.registered_at || new Date().toISOString() },
      { auth_state: "pending_review" },
      "fw.msg.authSubmitted",
    );
  const approve = (row: Auth) =>
    applyPatch(row, { auth_state: "approved", reviewed_at: new Date().toISOString() }, { auth_state: "approved" }, "fw.msg.authApproved");
  const confirmAuthorized = (row: Auth) =>
    applyPatch(
      row,
      { auth_state: "authorized", authorized_at: new Date().toISOString() },
      { auth_state: "authorized" },
      "fw.msg.authAuthorized",
    );
  const withReason = (row: Auth, kind: NonNullable<Pending>["kind"]) => {
    setReason("");
    setPending({ row, kind });
  };
  const runPending = async () => {
    if (!pending) return;
    const { row, kind } = pending;
    const note = reason.trim();
    setPending(null);
    if (kind === "reject") {
      await applyPatch(
        row,
        { auth_state: "revoked", reviewed_at: new Date().toISOString(), last_error: note || null, available_state: "unavailable", unavailable_reason: note || null },
        { auth_state: "revoked", available_state: "unavailable" },
        "fw.msg.authRejected",
      );
    } else if (kind === "suspend") {
      await applyPatch(
        row,
        { auth_state: "expired", last_error: note || null },
        { auth_state: "expired" },
        "fw.msg.authSuspended",
      );
    } else {
      await applyPatch(
        row,
        { available_state: "unavailable", unavailable_reason: note || null },
        { available_state: "unavailable" },
        "fw.msg.markedUnavailable",
      );
    }
  };
  const markAvailable = (row: Auth) =>
    applyPatch(
      row,
      { available_state: "available", unavailable_reason: null, last_valid_check_at: new Date().toISOString() },
      { available_state: "available" },
      "fw.msg.markedAvailable",
    );

  const openCreds = async (row: Auth) => {
    setCredRow(row);
    setCredView(null);
    setCredBusy(true);
    setCred({
      provider: row.provider || "tfop1",
      endpoint_url: "", app_key: row.app_key || "", merchant_account: row.external_account || "",
      auth_code: "", app_secret: "", webhook_secret: "",
    });
    try {
      const v = await callCredEf({ action: "view", auth_id: row.id });
      setCredView(v);
      setCred((p) => ({ ...p, provider: v.provider || p.provider, endpoint_url: v.endpoint_url || "", merchant_account: v.merchant_account || p.merchant_account }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tt("fw.msg.credLoadFail"));
    } finally {
      setCredBusy(false);
    }
  };

  const saveCreds = async () => {
    if (!credRow) return;
    setCredBusy(true);
    try {
      const v = await callCredEf({ action: "set", auth_id: credRow.id, ...credForm });
      setCredView(v);
      setCred((p) => ({ ...p, auth_code: "", app_secret: "", webhook_secret: "" }));
      toast.success(tt("fw.msg.credsSaved"));
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tt("fw.msg.actionFail"));
    } finally {
      setCredBusy(false);
    }
  };

  const activeFilters = [fForwarder, fProtocol, fAuth, fAvail, fProvider].filter(Boolean).length;
  const colCount = 9;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-border bg-card px-4 py-3">
        <Sel value={fForwarder} onChange={setFForwarder}>
          <option value="">{tt("fw.filt.allForwarders")}</option>
          {forwarders.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </Sel>
        <Sel value={fProvider} onChange={setFProvider}>
          <option value="">{tt("fw.filt.allProviders")}</option>
          {PROVIDER_OPTIONS.map((o) => (
            <option key={o.code} value={o.code}>{tt(o.key)}</option>
          ))}
        </Sel>
        <Sel value={fProtocol} onChange={setFProtocol}>
          <option value="">{tt("fw.filt.allProtocols")}</option>
          {PROTOCOL_OPTIONS.map((o) => (
            <option key={o.code} value={o.code}>{tt(o.key)}</option>
          ))}
        </Sel>
        <Sel value={fAuth} onChange={setFAuth}>
          <option value="">{tt("fw.filt.allAuthStates")}</option>
          {AUTH_STATE_OPTIONS.map((o) => (
            <option key={o.code} value={o.code}>{tt(o.key)}</option>
          ))}
        </Sel>
        <Sel value={fAvail} onChange={setFAvail}>
          <option value="">{tt("fw.filt.allAvailStates")}</option>
          {AVAIL_STATE_OPTIONS.map((o) => (
            <option key={o.code} value={o.code}>{tt(o.key)}</option>
          ))}
        </Sel>
        <span className="text-xs text-muted-foreground">
          {activeFilters > 0 ? tt("fw.ui.filtered", { n: data.length }) : tt("fw.ui.rowCount", { n: data.length })}
        </span>
        <Button
          size="sm"
          className="ml-auto"
          onClick={openAdd}
          disabled={forwarders.length === 0}
          title={forwarders.length === 0 ? tt("fw.hint.needForwarderFirst") : undefined}
        >
          <Plus size={15} className="mr-1.5" />
          {tt("fw.act.newAuth")}
        </Button>
      </div>

      <Panel title={tt("fw.panel.authList")} meta={<span>{tt("fw.hint.twoStates")}</span>}>
        <table className="w-full min-w-[1180px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <Th className="w-[16%]">{tt("fw.col.forwarder")}</Th>
              <Th>{tt("fw.col.provider")}</Th>
              <Th>{tt("fw.col.protocol")}</Th>
              <Th>{tt("fw.col.externalAccount")}</Th>
              <Th>{tt("fw.col.authState")}</Th>
              <Th>{tt("fw.col.availState")}</Th>
              <Th>{tt("fw.col.deadline")}</Th>
              <Th>{tt("fw.col.lastError")}</Th>
              <Th className="text-right">{tt("fw.col.actions")}</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <LoadingRow colSpan={colCount} />
            ) : error ? (
              <ErrorRow colSpan={colCount} message={error} onRetry={reload} />
            ) : data.length === 0 ? (
              <EmptyRow
                colSpan={colCount}
                text={tt("fw.empty.auths")}
                hint={forwarders.length === 0 ? tt("fw.empty.authsNoFw") : tt("fw.empty.authsHint")}
                action={
                  forwarders.length === 0 ? undefined : (
                    <Button size="sm" onClick={openAdd}>
                      <Plus size={14} className="mr-1" />
                      {tt("fw.act.newAuth")}
                    </Button>
                  )
                }
              />
            ) : (
              data.map((row) => {
                const busy = busyId === row.id;
                const canSubmit = row.auth_state === "unregistered" || row.auth_state === "registered";
                const canReview = row.auth_state === "pending_review";
                const canSuspend = row.auth_state === "approved" || row.auth_state === "authorized";
                return (
                  <tr key={row.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/60">
                    <Td className="align-top">
                      <div className="font-medium text-ink">
                        {nameMap.get(row.forwarder_id) ?? tt("fw.tag.deletedForwarder")}
                      </div>
                      {row.push_enabled ? <div className="mt-0.5 text-[10.5px] text-muted-foreground">{tt("fw.tag.pushEnabled")}</div> : null}
                    </Td>
                    <Td className="align-top">
                      <EnumBadge value={row.provider} meta={PROVIDER_META} />
                      <div className="mt-1">
                        {row.has_credentials ? (
                          <Chip tone="ok">{tt("fw.tag.credsSaved")}</Chip>
                        ) : (
                          <Chip tone="warn">{tt("fw.tag.credsMissing")}</Chip>
                        )}
                      </div>
                      {!row.has_credentials && row.provider !== "tfop1" ? (
                        <div className="mt-1 max-w-[150px] text-[10.5px] text-muted-foreground">{tt("fw.hint.credsNeeded")}</div>
                      ) : null}
                    </Td>
                    <Td className="text-muted-foreground">
                      <EnumBadge value={row.protocol} meta={PROTOCOL_META} />
                    </Td>
                    <Td className="text-muted-foreground">
                      {row.external_account || "—"}
                      {row.app_key ? <div className="mt-0.5 text-[10.5px]">{tt("fw.col.appKey")} {row.app_key}</div> : null}
                    </Td>
                    <Td>
                      <EnumBadge value={row.auth_state} meta={AUTH_STATE_META} />
                      <div className="mt-1 text-[10.5px] text-muted-foreground">
                        {row.reviewed_at ? `${tt("fw.col.reviewedAt")} ${fmtTs(row.reviewed_at)}` : fmtTs(row.created_at)}
                      </div>
                    </Td>
                    <Td>
                      <EnumBadge value={row.available_state} meta={AVAIL_STATE_META} />
                      {row.available_state === "unavailable" && row.unavailable_reason ? (
                        <div className="mt-1 max-w-[150px] text-[10.5px] text-destructive">{row.unavailable_reason}</div>
                      ) : null}
                    </Td>
                    <Td className="text-muted-foreground">{row.expires_at ? fmtTs(row.expires_at) : "—"}</Td>
                    <Td className="max-w-[180px] break-words text-[11px] text-destructive">{row.last_error || ""}</Td>
                    <Td>
                      {busy ? (
                        <div className="flex justify-end">
                          <Loader2 size={15} className="animate-spin text-muted-foreground" />
                        </div>
                      ) : (
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => openCreds(row)}>
                            <KeyRound size={11} className="mr-0.5" />
                            {tt("fw.act.creds")}
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={!canSubmit} onClick={() => submit(row)}>
                            {tt("fw.act.submitReview")}
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={!canReview} onClick={() => approve(row)}>
                            {tt("fw.act.approve")}
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={row.auth_state !== "approved"} onClick={() => confirmAuthorized(row)}>
                            {tt("fw.act.confirmAuthorized")}
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={!canReview} onClick={() => withReason(row, "reject")}>
                            <X size={11} className="mr-0.5" />
                            {tt("fw.act.reject")}
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={!canSuspend} onClick={() => withReason(row, "suspend")}>
                            {tt("fw.act.suspend")}
                          </Button>
                          {row.available_state === "available" ? (
                            <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => withReason(row, "unavailable")}>
                              <ShieldAlert size={11} className="mr-0.5" />
                              {tt("fw.act.markUnavailable")}
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => markAvailable(row)}>
                              <Check size={11} className="mr-0.5" />
                              {tt("fw.act.markAvailable")}
                            </Button>
                          )}
                        </div>
                      )}
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Panel>

      {/* 新增授权 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{tt("fw.act.newAuth")}</DialogTitle>
            <DialogDescription>{tt("fw.dialog.authDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>
                {tt("fw.col.forwarder")}
                <span className="text-destructive">*</span>
              </Label>
              <Sel value={form.forwarder_id} onChange={(v) => set({ forwarder_id: v })} className="w-full">
                <option value="">{tt("fw.filt.pickForwarder")}</option>
                {forwarders.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </Sel>
            </div>
            <div className="grid gap-1.5">
              <Label>{tt("fw.col.provider")}</Label>
              <div className="flex flex-wrap gap-1.5">
                {PROVIDER_OPTIONS.map((o) => (
                  <button
                    key={o.code}
                    type="button"
                    onClick={() => set({ provider: o.code })}
                    className={
                      "rounded-md border px-2.5 py-1.5 text-left text-[12px] transition-colors " +
                      (form.provider === o.code
                        ? "border-primary/60 bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground hover:border-primary/30")
                    }
                  >
                    <span className="font-medium">{tt(o.key)}</span>
                    <span className="ml-1 text-[10.5px] text-muted-foreground">{tt(PROVIDER_DESC_KEYS[o.code])}</span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">{tt("fw.hint.providerPick")}</p>
              {form.provider !== "tfop1" ? (
                <p className="rounded-lg bg-warning-bg/60 px-3 py-2 text-[11px] leading-4 text-warning">{tt("fw.hint.providerPending")}</p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label>{tt("fw.col.protocol")}</Label>
              <div className="flex flex-wrap gap-1.5">
                {PROTOCOL_OPTIONS.map((o) => (
                  <button
                    key={o.code}
                    type="button"
                    onClick={() => set({ protocol: o.code })}
                    className={
                      "rounded-md border px-2.5 py-1.5 text-left text-[12px] transition-colors " +
                      (form.protocol === o.code
                        ? "border-primary/60 bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground hover:border-primary/30")
                    }
                  >
                    <span className="font-medium">{tt(o.key)}</span>
                    <span className="ml-1 text-[10.5px] text-muted-foreground">{tt(PROTOCOL_DESC_KEYS[o.code])}</span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">{tt("fw.hint.protocolPick")}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>{tt("fw.col.externalAccount")}</Label>
                <Input value={form.external_account} onChange={(e) => set({ external_account: e.target.value })} placeholder={tt("fw.ph.externalAccount")} />
              </div>
              <div className="grid gap-1.5">
                <Label>{tt("fw.col.externalTenant")}</Label>
                <Input value={form.external_tenant_id} onChange={(e) => set({ external_tenant_id: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>{tt("fw.col.appKey")}</Label>
                <Input value={form.app_key} onChange={(e) => set({ app_key: e.target.value })} placeholder={tt("fw.ph.appKey")} />
              </div>
              <div className="grid gap-1.5">
                <Label>{tt("fw.col.expiresAt")}</Label>
                <Input type="date" value={form.expires_at} onChange={(e) => set({ expires_at: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>{tt("fw.col.callbackUrl")}</Label>
              <Input value={form.callback_url} onChange={(e) => set({ callback_url: e.target.value })} placeholder={tt("fw.ph.callback")} />
              <p className="text-[11px] text-muted-foreground">{tt("fw.hint.callback")}</p>
            </div>
            <div className="grid gap-1.5">
              <Label>{tt("fw.col.endpoint")}</Label>
              <Input value={form.endpoint_url} onChange={(e) => set({ endpoint_url: e.target.value })} placeholder={tt("fw.ph.endpoint")} />
              <p className="text-[11px] text-muted-foreground">{tt("fw.hint.endpoint")}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>{tt("fw.col.authCode")}</Label>
                <Input type="password" autoComplete="new-password" value={form.auth_code} onChange={(e) => set({ auth_code: e.target.value })} placeholder={tt("fw.ph.authCode")} />
              </div>
              <div className="grid gap-1.5">
                <Label>{tt("fw.col.appSecret")}</Label>
                <Input type="password" autoComplete="new-password" value={form.app_secret} onChange={(e) => set({ app_secret: e.target.value })} placeholder={tt("fw.ph.appSecret")} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>{tt("fw.col.webhookSecret")}</Label>
              <Input type="password" autoComplete="new-password" value={form.webhook_secret} onChange={(e) => set({ webhook_secret: e.target.value })} placeholder={tt("fw.ph.webhookSecret")} />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div>
                <div className="text-sm font-medium text-ink">{tt("fw.col.pushEnabled")}</div>
                <div className="text-[11px] text-muted-foreground">{tt("fw.hint.pushEnabled")}</div>
              </div>
              <Switch checked={form.push_enabled} onCheckedChange={(v) => set({ push_enabled: !!v })} />
            </div>
            <div className="rounded-lg bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
              {tt("fw.hint.secretNotStored")}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tt("fw.act.cancel")}
            </Button>
            <Button onClick={create} disabled={saving}>
              {saving ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
              {tt("fw.act.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 接口凭据：只写不回显（服务端加密入库，页面只显示尾 4 位） */}
      <Dialog
        open={!!credRow}
        onOpenChange={(o) => {
          if (!o) {
            setCredRow(null);
            setCredView(null);
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{tt("fw.act.creds")}</DialogTitle>
            <DialogDescription>
              {credRow ? `${nameMap.get(credRow.forwarder_id) ?? ""} · ${optionLabel(PROVIDER_OPTIONS, credRow.provider)}` : ""}
            </DialogDescription>
          </DialogHeader>
          {credRow ? (
            <div className="grid gap-4 py-2">
              <div className="grid gap-1.5">
                <Label>{tt("fw.col.provider")}</Label>
                <div className="flex flex-wrap gap-1.5">
                  {PROVIDER_OPTIONS.map((o) => (
                    <button
                      key={o.code}
                      type="button"
                      onClick={() => setCred({ provider: o.code })}
                      className={
                        "rounded-md border px-2.5 py-1.5 text-left text-[12px] transition-colors " +
                        (credForm.provider === o.code
                          ? "border-primary/60 bg-primary/10 text-primary"
                          : "border-border bg-background text-muted-foreground hover:border-primary/30")
                      }
                    >
                      <span className="font-medium">{tt(o.key)}</span>
                      <span className="ml-1 text-[10.5px] text-muted-foreground">{tt(PROVIDER_DESC_KEYS[o.code])}</span>
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {credForm.provider === "tfop1" ? tt("fw.hint.adapterLive") : tt("fw.hint.adapterPending")}
                </p>
              </div>

              {/* 现状摘要：证明「库里到底有没有」，而不是靠用户记忆 */}
              <div className="grid gap-1.5 rounded-lg border border-border px-3 py-2.5 text-[11.5px]">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{tt("fw.col.endpoint")}</span>
                  <span className="truncate text-ink">{credView?.endpoint_url || "—"}</span>
                </div>
                {([
                  ["auth_code", tt("fw.col.authCode")],
                  ["app_secret", tt("fw.col.appSecret")],
                  ["webhook_secret", tt("fw.col.webhookSecret")],
                ] as const).map(([k, label]) => {
                  const m = credView?.[k];
                  return (
                    <div key={k} className="flex items-center justify-between">
                      <span className="text-muted-foreground">{label}</span>
                      <span className={m?.present ? "text-ink" : "text-destructive"}>
                        {m?.present ? `${m.tail} · ${m.length}${tt("fw.ui.chars")}` : tt("fw.tag.notEntered")}
                      </span>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{tt("fw.col.credentialsUpdatedAt")}</span>
                  <span className="text-ink">{credView?.credentials_updated_at ? fmtTs(credView.credentials_updated_at) : "—"}</span>
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label>{tt("fw.col.endpoint")}</Label>
                <Input value={credForm.endpoint_url} onChange={(e) => setCred({ endpoint_url: e.target.value })} placeholder={tt("fw.ph.endpoint")} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-1.5">
                  <Label>{tt("fw.col.appKey")}</Label>
                  <Input value={credForm.app_key} onChange={(e) => setCred({ app_key: e.target.value })} placeholder={tt("fw.ph.appKey")} />
                </div>
                <div className="grid gap-1.5">
                  <Label>{tt("fw.col.externalAccount")}</Label>
                  <Input value={credForm.merchant_account} onChange={(e) => setCred({ merchant_account: e.target.value })} placeholder={tt("fw.ph.externalAccount")} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-1.5">
                  <Label>{tt("fw.col.authCode")}</Label>
                  <Input type="password" autoComplete="new-password" value={credForm.auth_code} onChange={(e) => setCred({ auth_code: e.target.value })} placeholder={tt("fw.ph.authCodeKeep")} />
                </div>
                <div className="grid gap-1.5">
                  <Label>{tt("fw.col.appSecret")}</Label>
                  <Input type="password" autoComplete="new-password" value={credForm.app_secret} onChange={(e) => setCred({ app_secret: e.target.value })} placeholder={tt("fw.ph.secretKeep")} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>{tt("fw.col.webhookSecret")}</Label>
                <Input type="password" autoComplete="new-password" value={credForm.webhook_secret} onChange={(e) => setCred({ webhook_secret: e.target.value })} placeholder={tt("fw.ph.secretKeep")} />
                <p className="text-[11px] text-muted-foreground">{tt("fw.hint.writeOnly")}</p>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCredRow(null); setCredView(null); }}>
              {tt("fw.act.cancel")}
            </Button>
            <Button onClick={saveCreds} disabled={credBusy}>
              {credBusy ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
              {tt("fw.act.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 驳回 / 暂停 / 标记不可用：需要留痕原因 */}
      <Dialog
        open={!!pending}
        onOpenChange={(o) => {
          if (!o) setPending(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending?.kind === "reject"
                ? tt("fw.act.reject")
                : pending?.kind === "suspend"
                  ? tt("fw.act.suspend")
                  : tt("fw.act.markUnavailable")}
            </DialogTitle>
            <DialogDescription>
              {pending ? `${nameMap.get(pending.row.forwarder_id) ?? ""} · ${optionLabel(PROTOCOL_OPTIONS, pending.row.protocol)}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5 py-2">
            <Label>{tt("fw.col.reason")}</Label>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tt("fw.ph.reason")} />
            <p className="text-[11px] text-muted-foreground">
              {pending?.kind === "reject" ? tt("fw.hint.rejectEffect") : pending?.kind === "suspend" ? tt("fw.hint.suspendEffect") : tt("fw.hint.unavailableEffect")}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              {tt("fw.act.cancel")}
            </Button>
            <Button onClick={runPending}>{tt("fw.act.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
