// 店铺 OAuth 授权前端服务：封装「获取授权 URL」「回调换 token」两个调用
// 支持多平台：Shopify（需店铺域名）、TikTok Shop（无需输入，直接跳转）
import { projectUrlId, supabase, supabaseUrl } from "@/supabase/client";

async function authHeaders(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return {
    "Content-Type": "application/json",
    "OneDay-App-Id": projectUrlId,
    ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
  };
}

// 获取第三方平台 OAuth 授权跳转 URL
// platform：平台名（Shopify / TikTok Shop / Lazada / Shopee）
// shop：仅 Shopify 需要店铺域名；其余平台传空即可
export async function getOAuthUrl(platform: string, shop?: string): Promise<string> {
  const res = await fetch(`${supabaseUrl}/functions/v1/shop-oauth`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ action: "authorize", platform, shop: shop || undefined }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || "获取授权链接失败");
  }
  return data.url as string;
}

// 回调：用 code 换取 token 并入库
export async function completeOAuth(platform: string, code: string, shop?: string): Promise<void> {
  const res = await fetch(`${supabaseUrl}/functions/v1/shop-oauth`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ action: "callback", platform, code, shop: shop || undefined }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || "授权回调失败");
  }
}
