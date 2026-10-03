// 前端触发系统邮件（统一走 mailer 服务）
//
// 约束说明：
// 1) 只能发给自己当前登录邮箱（服务端已强制校验，前端不做此保护也能防轰炸）
// 2) 邮件发送失败绝不影响主流程（注册/登录本身已成功），这里一律静默兜底
import { projectUrlId, supabase, supabaseAnonKey, supabaseUrl } from "@/supabase/client";

export type MailScene = "welcome" | "login_alert";

interface TriggerOptions {
  vars?: Record<string, string>;
  lang?: string;
  /** 同一场景在该小时数内只发一次，避免登录提醒之类高频场景刷屏 */
  dedupeHours?: number;
}

/**
 * 给当前登录用户发送一封系统邮件。
 * 返回 false 表示未发送（未登录 / 邮件缺失 / 被去重 / 服务端异常），调用方无需处理。
 */
export async function sendSystemMail(
  scene: MailScene,
  options: TriggerOptions = {},
): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const email = data.session?.user?.email;
    if (!token || !email) return false;

    const res = await fetch(`${supabaseUrl}/functions/v1/mailer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${token}`,
        "OneDay-App-Id": projectUrlId,
      },
      body: JSON.stringify({
        // 用户令牌放请求体：网关会改写 Authorization 头，且避免自定义头触发 CORS 预检
        accessToken: token,
        action: "send",
        scene,
        email,
        lang: options.lang || "zh",
        vars: options.vars || {},
        ...(options.dedupeHours ? { dedupeHours: options.dedupeHours } : {}),
      }),
    });
    const result = (await res.json().catch(() => ({}))) as { success?: boolean; skipped?: boolean };
    if (!res.ok || result.success !== true) {
      console.warn(`[mailer] ${scene} 发送未成功`, JSON.stringify(result));
      return false;
    }
    return true;
  } catch (e) {
    console.warn(`[mailer] ${scene} 调用异常:`, e instanceof Error ? e.message : String(e));
    return false;
  }
}
