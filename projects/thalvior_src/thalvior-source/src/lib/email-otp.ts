// 邮箱验证码通道：调用自建 Edge Function `email-otp`
//
// 为什么不用 Supabase 自带的 signInWithOtp({ email })：
// 自托管 GoTrue 在本环境发不出信（容器内 DNS 把 smtp.qq.com 解析到 IPv6，
// Docker bridge 不支持 IPv6，且 GoTrue 失败时无日志），所以改由 email-otp 函数
// 直连 QQ 邮箱 SMTP 投递；验证码本体仍由 GoTrue 原生签发，校验/过期/一次性
// 全部交给 GoTrue，前端只用 verifyOtp({ email, token, type: 'email' }) 换会话。
import { projectUrlId, supabase, supabaseAnonKey, supabaseUrl } from "@/supabase/client";

import { tt } from "@/i18n/tts";
export type OtpScene = "login" | "register" | "reset";

async function callEmailOtp(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const session = (await supabase.auth.getSession()).data.session;
  const res = await fetch(`${supabaseUrl}/functions/v1/email-otp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseAnonKey,
      "OneDay-App-Id": projectUrlId,
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    /* 非 JSON 响应 */
  }
  if (!res.ok || data.success === false) {
    throw new Error(typeof data?.error === "string" ? data.error : tt('lib.emailOtp.unavailable'));
  }
  return data;
}

// 发送验证码（scene: login | register | reset）
export async function sendEmailCode(email: string, scene: OtpScene): Promise<{ isNewUser: boolean }> {
  const data = await callEmailOtp({ action: "send", email: email.trim().toLowerCase(), scene });
  return { isNewUser: data.isNewUser === true };
}

// Wave A/T8 (2026-11-17): 删除了 checkEmailRegistered()。
// 它调用 email-otp 的 action="check"，那是一个不设限的「这个邮箱注册过吗」预言机，
// 而全仓无人调用它（登录/注册页只用 sendEmailCode），删除不影响任何流程。
// 服务端同名分支已一并移除；账号存在性现在只在 email-otp 内部用于选择签发方式。
