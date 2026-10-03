// 阿里云短信能力封装：统一通过 Edge Function 调用
// 发送验证码（send）、校验验证码（verify）、重置密码（reset-password）
import { projectUrlId, supabaseUrl } from "@/supabase/client";

async function callSms(body: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${supabaseUrl}/functions/v1/aliyun-sms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "OneDay-App-Id": projectUrlId,
    },
    body: JSON.stringify(body),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = (result as { error?: string }).error || `请求失败: ${response.status}`;
    throw new Error(msg);
  }
  return result as { success: boolean };
}

// 发送短信验证码
export async function sendSmsCode(phone: string): Promise<void> {
  await callSms({ phone, action: "send" });
}

// 校验短信验证码
export async function verifySmsCode(phone: string, code: string): Promise<void> {
  await callSms({ phone, action: "verify", code });
}

// 校验验证码并重置密码
export async function resetPasswordBySms(
  phone: string,
  code: string,
  password: string,
): Promise<void> {
  await callSms({ phone, action: "reset-password", code, password });
}