// 对话式智能助手：前端调用封装
import { projectUrlId, supabase, supabaseUrl } from "@/supabase/client";

import { tt } from "@/i18n/tts";
import { translate } from "@/i18n/translations";
export interface AgentCardData {
  shops?: { shops: Array<Record<string, unknown>>; totalSales: number; totalOrders: number };
  orders?: { orders: Array<Record<string, unknown>>; days: number; totalAmount: number; orderCount: number };
  products?: { products: Array<Record<string, unknown>>; byStatus: Record<string, number>; filter: string | null };
  quota?: { credits: number; plan_name: string; plan_expires_at: string | null };
  auth_expiring?: { items: Array<Record<string, unknown>>; total: number };
  collect_result?: {
    draft_id: string; name: string; price: number; currency: string; image: string;
    platform: string; variants_count: number; source: string;
  };
  image_draft_result?: {
    draft_id: string; name: string; price: number; currency: string; image: string;
    platform: string; attributes_count: number;
  };
  batch_collect_result?: {
    items: Array<{ draft_id?: string; name: string; price?: number; currency?: string; image?: string; platform?: string; ok: boolean }>;
    ok: number; fail: number;
  };
  sales_analysis?: {
    days: number; orderCount: number; totalAmount: number; avgPerDay: number; changePercent: number | null;
    topProducts: Array<{ name: string; amount: number; count: number }>;
    channels: Array<{ name: string; amount: number }>;
    trend: Array<{ date: string; amount: number }>;
    currency: string;
  };
}

export interface AgentCard {
  type: "shops" | "orders" | "products" | "quota" | "auth_expiring" | "collect_result" | "image_draft_result" | "batch_collect_result" | "sales_analysis";
  data: AgentCardData[keyof AgentCardData];
}

export interface AgentAction {
  type: "jump";
  label: string;
  path: string;
}

export interface PendingConfirm {
  token: string;
  title: string;
  detail: string;
  confirm_label: string;
  cancel_label: string;
}

export interface AgentResponse {
  reply: string;
  cards: AgentCard[];
  actions: AgentAction[];
  pending_confirm: PendingConfirm | null;
  intent: string;
  cost: number;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return session ? { Authorization: `Bearer ${session.access_token}` } : {};
}

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
  cards?: AgentCard[];
  actions?: AgentAction[];
  pendingConfirm?: PendingConfirm | null;
  time?: number;
}

export async function sendAgentMessage(params: {
  message: string;
  history: AgentMessage[];
  page: string;
  link?: string;
  confirmToken?: string;
  lang?: "zh" | "en";
  imageUrl?: string;
  linkList?: string[];
}): Promise<AgentResponse> {
  const authHeaders = await getAuthHeaders();
  const lang = params.lang ?? "zh";

  const response = await fetch(`${supabaseUrl}/functions/v1/agent-chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "OneDay-App-Id": projectUrlId,
      "X-Meoo-Project-Url-Id": projectUrlId,
      ...authHeaders,
    },
    body: JSON.stringify({
      message: params.message,
      history: params.history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
      page: params.page,
      link: params.link ?? "",
      lang,
      confirm_token: params.confirmToken ?? "",
      image_url: params.imageUrl ?? "",
      link_list: params.linkList ?? [],
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((result as any).reply || (result as any).error || tt('agent.apiFail', { v1: response.status }));
  }
  return result as AgentResponse;
}

// ===== 快捷推荐：按当前页面动态推荐 3 条高频指令 =====
const SUGGESTIONS: Array<{ match: (path: string) => boolean; items: string[] }> = [
  {
    match: (p) => p.startsWith("/auth"),
    items: [
      "agent.sug.authExpire",
      "agent.sug.myShops",
      "agent.sug.credits",
    ],
  },
  {
    match: (p) => p.startsWith("/products"),
    items: [
      "agent.sug.drafts",
      "agent.sug.collectLink",
      "agent.sug.gotoCollect",
    ],
  },
  {
    match: (p) => p.startsWith("/orders"),
    items: [
      "agent.sug.orders7d",
      "agent.sug.sales30d",
      "agent.sug.gotoReports",
    ],
  },
  {
    match: (p) => p.startsWith("/subscription"),
    items: [
      "agent.sug.credits",
      "agent.sug.shopsCount",
      "agent.sug.sales7d",
    ],
  },
  {
    match: (p) => p.startsWith("/listing"),
    items: [
      "agent.sug.drafts",
      "agent.sug.authExpire",
      "agent.sug.credits",
    ],
  },
  {
    match: (p) => p.startsWith("/inventory") || p.startsWith("/purchase") || p.startsWith("/finance") || p.startsWith("/logistics"),
    items: [
      "agent.sug.sales7d",
      "agent.sug.drafts",
      "agent.sug.gotoReports",
    ],
  },
  {
    match: () => true, // 兜底（工作台/其他）
    items: [
      "agent.sug.myShops",
      "agent.sug.orders7d",
      "agent.sug.credits",
    ],
  },
];

export function suggestionsForPage(path: string, lang: "zh" | "en"): string[] {
  const found = SUGGESTIONS.find((s) => s.match(path)) ?? SUGGESTIONS[SUGGESTIONS.length - 1];
  return found.items.map((k) => translate(k, lang));
}
