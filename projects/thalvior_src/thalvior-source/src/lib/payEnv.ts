// 支付环境分流：微信内置浏览器 / 移动浏览器 / PC
// 微信对「保存付款码 → 相册识别支付」有安全拦截（防付款码诈骗，技术不可绕过），
// 故按 UA 分流引导：微信内长按识别、手机浏览器引导去电脑、PC 保持扫码。
export type PayEnv = "wechat" | "mobile" | "pc";

export function detectPayEnv(): PayEnv {
  if (typeof navigator === "undefined") return "pc";
  const ua = navigator.userAgent || "";
  if (/MicroMessenger/i.test(ua)) return "wechat";
  // iPadOS 13+ 伪装 Macintosh，用触点数辅助识别
  const iPadOS = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
  const isMobile = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(ua) || iPadOS;
  return isMobile ? "mobile" : "pc";
}
