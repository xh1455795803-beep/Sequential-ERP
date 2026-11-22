// 刊登发布引擎前端服务：统一走 /functions/v1/publish-listing
// action: create-listing / list-listings / delete-listing
import { projectUrlId, supabase, supabaseUrl } from "@/supabase/client";

import { tt } from "@/i18n/tts";
export interface ListingRecord {
  id: string;
  shop_auth_id: string | null;
  product_id: string | null;
  platform: string;
  status: "发布中" | "部分成功" | "失败" | "已下线" | string;
  wc_product_id: string | null;
  error_message: string | null;
  created_at: string | null;
  updated_at: string | null;
  shop_auths?: { shop_name: string; platform: string } | null;
  products?: { name: string; image: string; sku: string } | null;
}

export interface CreateListingResult {
  ok: boolean;
  listing_id: string;
  wc_product_id: string;
  permalink: string | null;
  message: string;
  sku_mapped: number;
}

async function authHeaders(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return {
    "Content-Type": "application/json",
    "OneDay-App-Id": projectUrlId,
    ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
  };
}

async function callPublishListing(action: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const res = await fetch(`${supabaseUrl}/functions/v1/publish-listing`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ action, ...body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "publish-listing request failed");
  return data;
}

// 刊登：把产品库商品真实发布到已授权 WooCommerce 店铺
export async function createListing(productId: string, shopAuthId: string): Promise<CreateListingResult> {
  return (await callPublishListing("create-listing", { product_id: productId, shop_auth_id: shopAuthId })) as unknown as CreateListingResult;
}

// 刊登记录（分页）
export async function listListings(page = 1, pageSize = 10): Promise<{ items: ListingRecord[]; total: number; page: number; page_size: number }> {
  return (await callPublishListing("list-listings", { page, page_size: pageSize })) as unknown as { items: ListingRecord[]; total: number; page: number; page_size: number };
}

// 下架：删除远程 WooCommerce 商品并本地标记「已下线」
export async function deleteListing(listingId: string): Promise<{ ok: boolean; message: string }> {
  return (await callPublishListing("delete-listing", { listing_id: listingId })) as unknown as { ok: boolean; message: string };
}
