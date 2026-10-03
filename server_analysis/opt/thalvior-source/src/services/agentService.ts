// 对话式智能助手：前端调用封装
import { projectUrlId, supabase, supabaseUrl } from "@/supabase/client";

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
    throw new Error((result as { error?: string }).reply || (result as { error?: string }).error || `请求失败 (${response.status})`);
  }
  return result as AgentResponse;
}

// ===== 快捷推荐：按当前页面动态推荐 3 条高频指令 =====
const SUGGESTIONS: Array<{ match: (path: string) => boolean; items: Array<{ zh: string; en: string }> }> = [
  {
    match: (p) => p.startsWith("/auth"),
    items: [
      { zh: "哪些店铺授权快到期了？", en: "Which shop auths are expiring?" },
      { zh: "我有哪些店铺？", en: "Show me my shops" },
      { zh: "我的积分还剩多少？", en: "How many credits do I have?" },
    ],
  },
  {
    match: (p) => p.startsWith("/products"),
    items: [
      { zh: "我有哪些商品草稿？", en: "Show my product drafts" },
      { zh: "帮我采集这个链接生成草稿", en: "Collect this link into a draft" },
      { zh: "带我去采集箱", en: "Go to collection box" },
    ],
  },
  {
    match: (p) => p.startsWith("/orders"),
    items: [
      { zh: "最近 7 天订单怎么样？", en: "Orders from the last 7 days?" },
      { zh: "最近 30 天销售多少？", en: "Sales in the last 30 days?" },
      { zh: "带我去数据报表", en: "Go to reports" },
    ],
  },
  {
    match: (p) => p.startsWith("/subscription"),
    items: [
      { zh: "我的积分还剩多少？", en: "How many credits do I have?" },
      { zh: "我有几个店铺？", en: "How many shops do I have?" },
      { zh: "最近 7 天销售如何？", en: "Sales in the last 7 days?" },
    ],
  },
  {
    match: (p) => p.startsWith("/listing"),
    items: [
      { zh: "我有哪些商品草稿？", en: "Show my product drafts" },
      { zh: "哪些店铺授权快到期了？", en: "Which shop auths are expiring?" },
      { zh: "我的积分还剩多少？", en: "How many credits do I have?" },
    ],
  },
  {
    match: (p) => p.startsWith("/inventory") || p.startsWith("/purchase") || p.startsWith("/finance") || p.startsWith("/logistics"),
    items: [
      { zh: "最近 7 天销售如何？", en: "Sales in the last 7 days?" },
      { zh: "我有哪些商品草稿？", en: "Show my product drafts" },
      { zh: "带我去数据报表", en: "Go to reports" },
    ],
  },
  {
    match: () => true, // 兜底（工作台/其他）
    items: [
      { zh: "我有哪些店铺？", en: "Show me my shops" },
      { zh: "最近 7 天订单怎么样？", en: "Orders from the last 7 days?" },
      { zh: "我的积分还剩多少？", en: "How many credits do I have?" },
    ],
  },
];

export function suggestionsForPage(path: string, lang: "zh" | "en"): string[] {
  const found = SUGGESTIONS.find((s) => s.match(path)) ?? SUGGESTIONS[SUGGESTIONS.length - 1];
  return found.items.map((i) => (lang === "en" ? i.en : i.zh));
}
