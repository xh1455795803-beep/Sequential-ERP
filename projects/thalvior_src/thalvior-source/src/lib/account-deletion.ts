// 账号注销的前端封装（Wave A / T11，2026-11-17）
//
// 为什么单独一个文件：
//   * 注销是「申请 -> 30 天宽限 -> 匿名化」三段式，UI 需要的状态、文案、调用点都散在
//     数据库 RPC / Edge Function / 静态法务页三处，塞进 profile.tsx 会让那个页面同时
//     关心协议细节。
//   * 文案继续放在本文件而不是 src/i18n/translations.ts：词典主文件由主会话统一接线，
//     多波次并发编辑（合规波也在动法务文案）。等 B 收敛后一次搬进 EXTRA_*，调用点不动。
//
// 安全边界（本文件只调用，不实现）：
//   * request/cancel 走 delete-account Edge Function，EF 再把调用者自己的 JWT 原样转给
//     PostgREST，RPC 内部用 auth.uid() 定位账号 —— 前端永远传不出「别人的 user_id」。
//   * 状态读取直接 SELECT public.account_deletions：这张表只有
//     account_deletions_self_select 一条 RLS 策略，读到的必然只有自己那一行。

import { supabase } from "@/supabase/client";

export type DeletionStatus = "pending" | "executed" | "cancelled";

export type DeletionState = {
  status: DeletionStatus;
  grace_until: string | null;
  requested_at: string;
  note: string | null;
};

export type DeletionCall = {
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
  error?: string;
};

const COPY: Record<string, { zh: string; en: string }> = {
  sectionTitle: { zh: "账号注销", en: "Account deletion" },
  intro: {
    zh: "注销是不可逆的：申请后有 30 天宽限期，期间可以随时撤销；到期后系统匿名化你的身份信息并销毁全部登录态。",
    en: "Deletion is irreversible: a 30-day grace period follows the request and can be cancelled any time inside it; afterwards your identity is anonymized and all sessions destroyed.",
  },
  retained: {
    zh: "订单、发票与对账记录按《会计档案管理办法》《发票管理办法实施细则》保留（税务凭证义务），但其中的手机号、收货地址、店铺名等个人信息会被匿名化。",
    en: "Orders, invoices and reconciliation records are retained (accounting and VAT archival duties), while phone numbers, delivery addresses and store names inside them are anonymized.",
  },
  subAccounts: {
    zh: "若你名下有子账号，注销主账号会一并匿名化子账号的联系方式并停用邀请链接；子账号自身的登录会失效。",
    en: "If you have sub-accounts, deleting the main account anonymizes their contact data and revokes invite tokens; their own logins stop working.",
  },
  statusPending: { zh: "注销申请已提交，将于", en: "Deletion requested; it will execute on" },
  statusPendingTail: { zh: "生效，现在仍可撤销。", en: ". You can still cancel." },
  checkbox: { zh: "我已阅读并理解上述后果，确认申请注销账号", en: "I have read the above and confirm the deletion request" },
  typeToConfirm: { zh: "请输入 DELETE 以最终确认", en: "Type DELETE to finally confirm" },
  requestBtn: { zh: "申请注销账号", en: "Request account deletion" },
  cancelBtn: { zh: "撤销注销申请", en: "Cancel deletion request" },
  requested: { zh: "注销申请已记录，请在到期前保留登录状态以便撤销。", en: "Deletion recorded. Stay signed in until the grace period if you want to cancel." },
  cancelled: { zh: "已撤销注销申请，账号恢复正常。", en: "Deletion request cancelled; the account is active again." },
  fail: { zh: "操作未能完成，请稍后重试或联系客服。", en: "The request could not be completed. Please retry or contact support." },
  busy: { zh: "操作过于频繁，请稍后再试。", en: "Too many attempts. Please try again later." },
};

export function deletionText(lang: string, key: string): string {
  const entry = COPY[key];
  if (!entry) return key;
  return lang === "en" ? entry.en : entry.zh;
}

/** 到期日的本地日期串（读不到待处理申请时返回 null） */
export async function fetchDeletionState(): Promise<DeletionState | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return null;

  const { data, error } = await supabase
    .from("account_deletions")
    .select("status,grace_until,requested_at,note")
    .eq("user_id", user.id)
    .order("requested_at", { ascending: false })
    .limit(2);
  if (error || !data || data.length === 0) return null;

  // 只有待处理的那条对用户有意义；executed 之后账号本身就不该再进这个页面
  const pending = data.find((r) => r.status === "pending");
  if (!pending) return null;
  return {
    status: pending.status as DeletionStatus,
    grace_until: pending.grace_until ?? null,
    requested_at: pending.requested_at,
    note: pending.note ?? null,
  };
}

async function call(action: "request" | "cancel", note?: string): Promise<DeletionCall> {
  const { data, error } = await supabase.functions.invoke("delete-account", {
    body: action === "request" ? { action, note: note ?? null } : { action },
  });
  const body = (data ?? {}) as Record<string, unknown> & { error?: string };
  if (error) {
    // supabase-js 把非 2xx 放进 error.context，它可能是 Response 也可能是状态码
    const ctx = (error as unknown as { context?: unknown }).context;
    const status =
      typeof ctx === "number" ? ctx : ((ctx as { status?: number } | null)?.status ?? 500);
    return { ok: false, status, data: body, error: String(body.error ?? error.message ?? "") };
  }
  if (body.ok !== true) return { ok: false, status: 200, data: body, error: String(body.error ?? "") };
  return { ok: true, status: 200, data: body };
}

export const requestDeletion = (note?: string) => call("request", note);
export const cancelDeletion = () => call("cancel");

/** 宽限期倒计时用的展示串；无效输入退回 '-'，绝不让页面因为日期解析炸掉 */
export function formatGraceDate(iso: string | null, lang: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return lang === "en"
    ? d.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "2-digit" })
    : d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}
