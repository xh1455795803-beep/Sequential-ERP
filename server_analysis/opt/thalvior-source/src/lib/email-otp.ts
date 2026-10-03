// 邮箱验证码通道：调用自建 Edge Function `email-otp`
//
// 为什么不用 Supabase 自带的 signInWithOtp({ email })：
// 自托管 GoTrue 在本环境发不出信（容器内 DNS 把 smtp.qq.com 解析到 IPv6，
// Docker bridge 不支持 IPv6，且 GoTrue 失败时无日志），所以改由 email-otp 函数
// 直连 QQ 邮箱 SMTP 投递；验证码本体仍由 GoTrue 原生签发，校验/过期/一次性
// 全部交给 GoTrue，前端只用 verifyOtp({ email, token, type: 'email' }) 换会话。
import { projectUrlId, supabase, supabaseAnonKey, supabaseUrl } from "@/supabase/client";

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
    throw new Error(typeof data?.error === "string" ? data.error : "邮件验证码服务暂时不可用");
  }
  return data;
}

// 发送验证码（scene: login | register | reset）
export async function sendEmailCode(email: string, scene: OtpScene): Promise<{ isNewUser: boolean }> {
  const data = await callEmailOtp({ action: "send", email: email.trim().toLowerCase(), scene });
  return { isNewUser: data.isNewUser === true };
}

// 查询邮箱是否已注册（不消耗发送额度，用于在发送前给出准确提示）
export async function checkEmailRegistered(email: string): Promise<boolean> {
  try {
    const data = await callEmailOtp({ action: "check", email: email.trim().toLowerCase() });
    return data.exists === true;
  } catch {
    // 查询失败不阻断主流程，交由发送接口给出最终判定
    return true;
  }
}
