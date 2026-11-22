// 登录态持久化工具：统一管理 Supabase session 的存储位置
// - 勾选「7 天免登录」：session 存 localStorage（关闭浏览器后仍登录，靠 refresh token 长续期）
// - 未勾选：session 同样存 localStorage，但额外签发「仅当前标签页持有的会话票据」
//
// 实现见 @/lib/auth-storage：v2 起 token 恒定单一载体，切换偏好时不再搬迁 token，
// 彻底避免多标签页互相把对方踢下线（v1 的「来回重新登录」根因）。
import { supabase } from "@/supabase/client";
import { getRememberPreference, setRememberPreference } from "@/lib/auth-storage";

function authTokenKeys(storage: Storage): string[] {
  try {
    return Object.keys(storage).filter((k) => k.includes("auth-token"));
  } catch {
    return [];
  }
}

// 登录成功后按 remember 决定会话约束。
// Supabase 写入本地存储是异步的，先 getSession 等其就绪再设置偏好。
export async function applySessionPersistence(remember: boolean): Promise<void> {
  await supabase.auth.getSession();
  // 记住模式：确保票据限制被清除（防止上一次「未勾选」残留的票据把本次登录又限制住）
  if (remember && !getRememberPreference()) {
    setRememberPreference(true);
    return;
  }
  if (getRememberPreference() !== remember) {
    setRememberPreference(remember);
  }
}

/**
 * 静默续期：距过期不足阈值时主动 refresh，避免页面长时间停留在后台后一次性续期失败。
 * 返回当前是否仍处于登录态。
 */
export async function keepSessionAlive(thresholdMs = 5 * 60 * 1000): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return false;
  const expiresAt = (session.expires_at ?? 0) * 1000;
  if (expiresAt - Date.now() > thresholdMs) return true;
  const { data: refreshed } = await supabase.auth.refreshSession();
  return !!refreshed.session;
}

// 退出登录时清理本地残留的登录态（localStorage + sessionStorage）
export function clearSessionStorage(): void {
  authTokenKeys(localStorage).forEach((k) => localStorage.removeItem(k));
  authTokenKeys(sessionStorage).forEach((k) => sessionStorage.removeItem(k));
  try {
    localStorage.removeItem("meoo.auth.sessionExpireAt");
    localStorage.removeItem("meoo.auth.tabTicket");
    sessionStorage.removeItem("meoo.auth.tabTicket");
  } catch {
    /* ignore */
  }
}
