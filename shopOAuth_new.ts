// 店铺授权前端服务：统一切到 /functions/v1/authorize-shop
// —— OAuth 型平台：oauth-url → 跳转；oauth-callback → code 换 token 入库
// —— 手动型平台：cred-save → 凭据校验 + 加密入库；cred-verify → 仅校验
// —— list / delete：管理当前用户所有授权
import { projectUrlId, supabase, supabaseUrl } from "@/supabase/client";

async function authHeaders(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return {
    "Content-Type": "application/json",
    "OneDay-App-Id": projectUrlId,
    ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
  };
}

async function callAuthorizeShop(action: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const res = await fetch(`${supabaseUrl}/functions/v1/authorize-shop`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ action, ...body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `authorize-shop ${action} 失败`);
  return data;
}

export async function getOAuthUrl(platform: string, shop?: string): Promise<string> {
  const data = await callAuthorizeShop("oauth-url", { platform, shop: shop || undefined });
  return data.url as string;
}

export async function completeOAuth(platform: string, code: string, shop?: string): Promise<void> {
  await callAuthorizeShop("oauth-callback", { platform, code, shop: shop || undefined });
}

export async function saveManualAuth(params: {
  platform: string; shop_name: string; region?: string;
  credentials: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  return callAuthorizeShop("cred-save", params);
}

export async function verifyManualAuth(
  platform: string, credentials: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return callAuthorizeShop("cred-verify", { platform, credentials });
}

export async function listMyAuth(): Promise<Record<string, unknown>[]> {
  const data = await callAuthorizeShop("list");
  return (data.items ?? []) as Record<string, unknown>[];
}

export async function deleteMyAuth(id: string): Promise<void> {
  await callAuthorizeShop("delete", { id });
}
