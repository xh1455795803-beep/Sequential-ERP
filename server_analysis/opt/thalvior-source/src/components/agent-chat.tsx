// 对话式智能助手：右下角悬浮对话面板
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Bot, X, Minus, Send, Sparkles, Store, Package, ShoppingCart, Coins,
  AlertTriangle, FileText, Link2, Check, Loader2, ImagePlus, Camera, Mic, TrendingUp,
} from "lucide-react";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/supabase/client";
import {
  sendAgentMessage, suggestionsForPage,
  type AgentMessage, type AgentCard, type AgentAction, type PendingConfirm,
} from "@/services/agentService";

const T = {
  zh: {
    title: "Thalvior 智能助手",
    placeholder: "输入指令或粘贴商品链接，例如：帮我采集这个链接生成草稿",
    send: "发送",
    thinking: "正在处理…",
    welcome: "你好，我是 Thalvior 智能助手。可以帮你查询店铺、订单、积分，采集链接生成商品草稿，或快速跳转页面。需要刊登等高风险操作时，我会先请你确认。",
    confirm: "确认",
    cancel: "取消",
    hint: "提示",
    usageHint: "普通聊天免费；采集、图片解析等任务成功后按次消耗 AI 积分。",
    linkDetected: "检测到链接：",
    imageReady: "已选择图片（将解析图片生成刊登稿件，消耗 4 积分）",
    uploading: "上传中…",
    uploadFailed: "图片上传失败，请重试",
    listening: "正在听…请说话",
    voiceUnsupported: "当前浏览器不支持语音输入",
    salesTitle: "销售分析",
    topProducts: "热销商品",
    channels: "渠道分布",
    trend: "近{{n}}天趋势",
    vsPrev: "较上期",
    rise: "上升",
    fall: "下降",
    copyright: "采集素材请确认版权，刊登前核对类目与属性，刊登会消耗刊登额度。",
    expiringSoon: "即将到期",
    days: "天",
    drafts: "草稿",
    active: "在售",
    all: "全部",
    view: "查看",
    copied: "草稿已创建",
    noShops: "还没有授权店铺",
    noOrders: "暂无订单数据",
    noProducts: "暂无商品数据",
  },
  en: {
    title: "Thalvior Assistant",
    placeholder: "Type a command or paste a product link, e.g. collect this link into a draft",
    send: "Send",
    thinking: "Thinking…",
    welcome: "Hi, I'm the Thalvior Assistant. I can query your shops, orders, credits, collect links into product drafts, and jump between pages. High-risk actions like listing always require your confirmation.",
    confirm: "Confirm",
    cancel: "Cancel",
    hint: "Tip",
    usageHint: "Free for normal chat; collection, image parsing and other task executions consume AI credits per successful use.",
    linkDetected: "Link detected:",
    imageReady: "Image selected (will be parsed into a listing draft, 4 credits)",
    uploading: "Uploading…",
    uploadFailed: "Upload failed, please retry",
    listening: "Listening… speak now",
    voiceUnsupported: "Speech input is not supported by this browser",
    salesTitle: "Sales Analysis",
    topProducts: "Top Products",
    channels: "Channels",
    trend: "Trend (last {{n}}d)",
    vsPrev: "vs prev",
    rise: "up",
    fall: "down",
    copyright: "Check copyright before using collected assets; review category & attributes before listing. Listing consumes listing quota.",
    expiringSoon: "Expiring",
    days: "d",
    drafts: "Drafts",
    active: "Active",
    all: "All",
    view: "View",
    copied: "Draft created",
    noShops: "No authorized shops yet",
    noOrders: "No order data",
    noProducts: "No product data",
  },
};

interface ChatMessage extends AgentMessage {
  id: number;
}

const fmtPrice = (v: unknown, currency = "USD") => {
  const n = Number(v ?? 0);
  if (Number.isNaN(n)) return "—";
  if (currency === "CNY") return `¥${n.toFixed(2)}`;
  return `${currency} ${n.toFixed(2)}`;
};

const fmtDate = (s: unknown) => {
  if (!s) return "—";
  const d = new Date(String(s));
  return Number.isNaN(d.getTime()) ? String(s) : d.toLocaleDateString();
};


// storage bucket：本部署名称解析失效，读写必须用 UUID
const STORAGE_BUCKET_ID = "d1439de1-7fc8-470b-93ba-152887a05385";
export function AgentChat({ open, onClose, page }: { open: boolean; onClose: () => void; page: string }) {
  const { lang } = useLanguage();
  const { user } = useAuth();
  const t = T[lang === "en" ? "en" : "zh"];
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 0, role: "assistant", content: t.welcome, time: Date.now() },
  ]);
  const [input, setInput] = useState("");
  const [detectedLink, setDetectedLink] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imagePreview, setImagePreview] = useState("");
  const [uploadingImg, setUploadingImg] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  // 语音输入（Web Speech API）
  const startVoice = () => {
    const w = window as unknown as Record<string, unknown>;
    const SR = (w.SpeechRecognition || w.webkitSpeechRecognition) as (new () => {
      lang: string; interimResults: boolean;
      onresult: (ev: { results: Array<Array<{ transcript: string }>> }) => void;
      onend: () => void; onerror: () => void; start: () => void;
    }) | undefined;
    if (!SR) {
      push({ role: "assistant", content: t.voiceUnsupported });
      return;
    }
    try {
      const rec = new SR();
      rec.lang = lang === "en" ? "en-US" : "zh-CN";
      rec.interimResults = false;
      rec.onresult = (ev) => {
        const text = ev.results?.[0]?.[0]?.transcript || "";
        if (text) setInput((prev) => (prev ? prev + " " + text : text));
      };
      rec.onend = () => setListening(false);
      rec.onerror = () => setListening(false);
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
      push({ role: "assistant", content: t.voiceUnsupported });
    }
  };

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  // 粘贴时提取 URL
  const onPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text");
    const m = text.match(/https?:\/\/[^\s]+/i);
    if (m) setDetectedLink(m[0]);
  };

  // 选择图片 → 上传 storage → 拿公开 URL
  const pickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImg(true);
    try {
      const path = `agent/${Date.now()}_${file.name.replace(/[^\w.\-]/g, "_")}`;
      const { error } = await supabase.storage.from(STORAGE_BUCKET_ID).upload(path, file, { upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from(STORAGE_BUCKET_ID).getPublicUrl(path);
      setImageUrl(data.publicUrl);
      setImagePreview(URL.createObjectURL(file));
      setDetectedLink("");
    } catch {
      push({ role: "assistant", content: t.uploadFailed });
    } finally {
      setUploadingImg(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const push = (m: Omit<ChatMessage, "id" | "time">) => {
    setMessages((prev) => [...prev, { ...m, id: nextId.current++, time: Date.now() }]);
  };

  const send = useCallback(async (raw?: string) => {
    const content = (raw ?? input).trim();
    if (!content && !detectedLink && !imageUrl) return;
    // 提取所有链接：1 个走 collect，多个走批量采集
    const urls = (content.match(/https?:\/\/[^\s"'<>]+/gi) || []);
    const singleLink = urls.length === 1 ? urls[0] : "";
    const multiLinks = urls.length > 1 ? urls : [];
    const msg = content || (detectedLink ? `帮我采集这个链接生成草稿 ${detectedLink}` : imageUrl ? (lang === "en" ? "Please analyze this product image and create a listing draft" : "请解析这张商品图片并生成刊登稿件草稿") : "");
    setInput("");
    setDetectedLink("");
    const imgUrl = imageUrl;
    setImageUrl("");
    setImagePreview("");
    setPendingConfirm(null);
    push({ role: "user", content: msg + (imgUrl ? `\n[🖼️ ${lang === "en" ? "image attached" : "已附图片"}]` : "") });
    setBusy(true);
    try {
      const res = await sendAgentMessage({
        message: msg,
        history: messages.slice(-6),
        page,
        link: detectedLink || singleLink || undefined,
        linkList: multiLinks.length > 0 ? multiLinks : undefined,
        imageUrl: imgUrl || undefined,
        confirmToken: undefined,
        lang: lang === "en" ? "en" : "zh",
      });
      push({ role: "assistant", content: res.reply, cards: res.cards, actions: res.actions, pendingConfirm: res.pending_confirm });
      if (res.pending_confirm) setPendingConfirm(res.pending_confirm);
    } catch (err) {
      push({ role: "assistant", content: err instanceof Error ? err.message : "请求失败，请稍后再试" });
    } finally {
      setBusy(false);
    }
  }, [input, detectedLink, messages, page, t.welcome]);

  const confirmAction = async (token: string) => {
    setBusy(true);
    try {
      const res = await sendAgentMessage({ message: "", history: messages.slice(-6), page, confirmToken: token, lang: lang === "en" ? "en" : "zh" });
      push({ role: "assistant", content: res.reply, cards: res.cards, actions: res.actions });
      setPendingConfirm(null);
    } catch (err) {
      push({ role: "assistant", content: err instanceof Error ? err.message : "确认失败，请重试" });
    } finally {
      setBusy(false);
    }
  };

  const jump = (path: string) => {
    navigate({ to: path as never });
    onClose();
  };

  const suggestions = suggestionsForPage(page, lang === "en" ? "en" : "zh");

  return (
    <div className="pointer-events-auto flex h-full flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl">
      {/* 顶栏 */}
      <div className="flex items-center justify-between border-b bg-gradient-to-r from-slate-900 to-slate-800 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500">
            <Bot size={18} />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">{t.title}</div>
            <div className="text-[11px] text-slate-300">{lang === "en" ? "Always available" : "随时待命"}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-white/10" title={lang === "en" ? "Close" : "关闭"}>
            <X size={16} />
          </button>
        </div>
      </div>

      {/* 消息区 */}
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto bg-muted/30 p-3">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
              m.role === "user" ? "bg-indigo-600 text-white" : "bg-white text-slate-800 shadow-sm"
            }`}>
              {m.content && <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>}
              {m.role === "assistant" && m.cards && m.cards.length > 0 && (
                <div className="mt-2 space-y-2">
                  {m.cards.map((c, i) => <Card key={i} card={c} t={t} jump={jump} lang={lang === "en" ? "en" : "zh"} />)}
                </div>
              )}
              {m.role === "assistant" && m.actions && m.actions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {m.actions.map((a, i) => (
                    <button key={i} onClick={() => jump(a.path)}
                      className="flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100">
                      {a.type === "jump" && <FileText size={12} />} {a.label}
                    </button>
                  ))}
                </div>
              )}
              {m.role === "assistant" && m.pendingConfirm && (
                <ConfirmCard pc={m.pendingConfirm} t={t} onConfirm={confirmAction} onCancel={() => setPendingConfirm(null)} />
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl bg-white px-3 py-2 text-xs text-slate-500 shadow-sm">
              <Loader2 size={14} className="animate-spin" /> {t.thinking}
            </div>
          </div>
        )}
      </div>

      {/* 快捷推荐 */}
      <div className="flex gap-1.5 overflow-x-auto border-t bg-white px-3 py-2">
        {suggestions.map((s, i) => (
          <button key={i} onClick={() => send(s)}
            className="flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700">
            <Sparkles size={11} /> {s}
          </button>
        ))}
      </div>

      {/* 输入区 */}
      <div className="border-t bg-white p-3">
        {detectedLink && (
          <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs text-blue-700">
            <Link2 size={12} className="shrink-0" />
            <span className="truncate">{t.linkDetected} {detectedLink}</span>
            <button onClick={() => setDetectedLink("")} className="ml-auto text-blue-400 hover:text-blue-600"><X size={13} /></button>
          </div>
        )}
        {imagePreview && (
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-violet-50 px-2.5 py-1.5 text-xs text-violet-700">
            <img src={imagePreview} alt="" className="h-9 w-9 shrink-0 rounded-md border object-cover" />
            <span className="min-w-0 flex-1 truncate">{t.imageReady}</span>
            <button onClick={() => { setImageUrl(""); setImagePreview(""); }} className="text-violet-400 hover:text-violet-600"><X size={13} /></button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickImage} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploadingImg}
            title={lang === "en" ? "Upload image" : "上传图片"}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-500 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-600 disabled:opacity-40"
          >
            {uploadingImg ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />}
          </button>
          <button
            onClick={startVoice}
            title={lang === "en" ? "Voice input" : "语音输入"}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border bg-slate-50 text-slate-500 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-600 ${listening ? "animate-pulse border-emerald-400 bg-emerald-50 text-emerald-600" : "border-slate-200"}`}
          >
            <Mic size={15} />
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={2}
            placeholder={t.placeholder}
            className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:bg-white"
          />
          <button onClick={() => send()} disabled={busy || (!input.trim() && !detectedLink && !imageUrl)}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow hover:bg-indigo-700 disabled:opacity-40">
            <Send size={15} />
          </button>
        </div>
        <div className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-400">
          <AlertTriangle size={10} /> {t.usageHint}
        </div>
      </div>
    </div>
  );
}

// ===== 卡片渲染 =====
function Card({ card, t, jump, lang }: { card: AgentCard; t: typeof T.zh; jump: (p: string) => void; lang: "zh" | "en" }) {
  switch (card.type) {
    case "shops":
      return <ShopsCard d={card.data as any} t={t} jump={jump} lang={lang} />;
    case "orders":
      return <OrdersCard d={card.data as any} t={t} jump={jump} lang={lang} />;
    case "products":
      return <ProductsCard d={card.data as any} t={t} jump={jump} lang={lang} />;
    case "quota":
      return <QuotaCard d={card.data as any} t={t} lang={lang} />;
    case "auth_expiring":
      return <AuthExpiringCard d={card.data as any} t={t} jump={jump} lang={lang} />;
    case "collect_result":
      return <CollectResultCard d={card.data as any} t={t} jump={jump} lang={lang} />;
    case "image_draft_result":
      return <ImageDraftCard d={card.data as any} t={t} jump={jump} lang={lang} />;
    case "batch_collect_result":
      return <BatchCollectCard d={card.data as any} t={t} jump={jump} lang={lang} />;
    case "sales_analysis":
      return <SalesAnalysisCard d={card.data as any} t={t} jump={jump} lang={lang} />;
    default:
      return null;
  }
}

const rowCls = "flex items-center justify-between gap-2 py-1.5 text-xs border-b border-slate-100 last:border-0";

function ShopsCard({ d, t, jump, lang }: any) {
  const shops = d?.shops ?? [];
  const totalSales = d?.totalSales ?? 0;
  const totalOrders = d?.totalOrders ?? 0;
  return (
    <div className="rounded-xl border bg-white p-2.5 shadow-sm">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs font-semibold text-slate-700"><Store size={13} /> {lang === "en" ? "Shops" : "店铺"} ({shops.length})</span>
        <button onClick={() => jump("/auth")} className="text-[11px] text-indigo-600 hover:underline">{t.view} →</button>
      </div>
      <div className="mb-1.5 grid grid-cols-2 gap-1.5">
        <div className="rounded-lg bg-emerald-50 px-2 py-1"><div className="text-[10px] text-emerald-600">{lang === "en" ? "Sales (30d)" : "近30天销售额"}</div><div className="text-xs font-bold text-emerald-700">${Number(totalSales).toFixed(2)}</div></div>
        <div className="rounded-lg bg-blue-50 px-2 py-1"><div className="text-[10px] text-blue-600">{lang === "en" ? "Orders" : "订单数"}</div><div className="text-xs font-bold text-blue-700">{totalOrders}</div></div>
      </div>
      {shops.slice(0, 4).map((s: any, i: number) => (
        <div key={i} className={rowCls}>
          <span className="truncate font-medium text-slate-700">{s.shop_name || s.name || "—"}</span>
          <span className="shrink-0 text-slate-400">{s.platform || "—"}</span>
        </div>
      ))}
    </div>
  );
}

function OrdersCard({ d, t, jump, lang }: any) {
  const orders = d?.orders ?? [];
  return (
    <div className="rounded-xl border bg-white p-2.5 shadow-sm">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs font-semibold text-slate-700"><ShoppingCart size={13} /> {lang === "en" ? `Orders (${d?.days ?? 30}d)` : `订单（${d?.days ?? 30}天）`} {orders.length}</span>
        <button onClick={() => jump("/orders")} className="text-[11px] text-indigo-600 hover:underline">{t.view} →</button>
      </div>
      <div className="mb-1.5 grid grid-cols-2 gap-1.5">
        <div className="rounded-lg bg-emerald-50 px-2 py-1"><div className="text-[10px] text-emerald-600">{lang === "en" ? "Total" : "总金额"}</div><div className="text-xs font-bold text-emerald-700">{fmtPrice(d?.totalAmount, "USD")}</div></div>
        <div className="rounded-lg bg-blue-50 px-2 py-1"><div className="text-[10px] text-blue-600">{lang === "en" ? "Orders" : "订单数"}</div><div className="text-xs font-bold text-blue-700">{d?.orderCount ?? orders.length}</div></div>
      </div>
      {orders.slice(0, 4).map((o: any, i: number) => (
        <div key={i} className={rowCls}>
          <span className="truncate font-medium text-slate-700">{o.order_no || o.order_id || "—"}</span>
          <span className="shrink-0 text-slate-400">{fmtPrice(o.total_price ?? o.amount, o.currency)}</span>
        </div>
      ))}
    </div>
  );
}

function ProductsCard({ d, t, jump, lang }: any) {
  const products = d?.products ?? [];
  const byStatus = d?.byStatus ?? {};
  return (
    <div className="rounded-xl border bg-white p-2.5 shadow-sm">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs font-semibold text-slate-700"><Package size={13} /> {lang === "en" ? "Products" : "商品"} ({products.length})</span>
        <button onClick={() => jump("/products")} className="text-[11px] text-indigo-600 hover:underline">{t.view} →</button>
      </div>
      <div className="mb-1.5 flex flex-wrap gap-1.5">
        {Object.entries(byStatus).map(([k, v], i) => (
          <span key={i} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">{k}: <b>{String(v)}</b></span>
        ))}
      </div>
      {products.slice(0, 3).map((p: any, i: number) => (
        <div key={i} className={rowCls}>
          <span className="truncate font-medium text-slate-700">{p.name || "—"}</span>
          <span className="shrink-0 text-slate-400">{fmtPrice(p.price, p.currency)}</span>
        </div>
      ))}
    </div>
  );
}

function QuotaCard({ d, t, lang }: any) {
  return (
    <div className="rounded-xl border bg-white p-2.5 shadow-sm">
      <div className="mb-1 flex items-center gap-1 text-xs font-semibold text-slate-700"><Coins size={13} /> {lang === "en" ? "AI Credits" : "AI 积分"}</div>
      <div className="flex items-center gap-2">
        <span className="text-2xl font-bold text-indigo-600">{Number(d?.credits ?? 0).toLocaleString()}</span>
        <span className="text-xs text-slate-500">{lang === "en" ? "credits available" : "积分可用"}</span>
      </div>
      <div className="mt-1 text-[11px] text-slate-400">
        {d?.plan_name ? `${lang === "en" ? "Plan" : "套餐"}: ${d.plan_name}` : ""}
        {d?.plan_expires_at ? ` · ${lang === "en" ? "expires" : "到期"}: ${fmtDate(d.plan_expires_at)}` : ""}
      </div>
    </div>
  );
}

function AuthExpiringCard({ d, t, jump, lang }: any) {
  const items = d?.items ?? [];
  return (
    <div className="rounded-xl border bg-white p-2.5 shadow-sm">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs font-semibold text-amber-600"><AlertTriangle size={13} /> {lang === "en" ? "Auth expiring" : "授权即将到期"} ({d?.total ?? items.length})</span>
        <button onClick={() => jump("/auth")} className="text-[11px] text-indigo-600 hover:underline">{lang === "en" ? "Renew →" : "去续期 →"}</button>
      </div>
      {items.length === 0 && <div className="py-1 text-xs text-slate-400">{lang === "en" ? "All shop auths are healthy" : "所有店铺授权状态正常"}</div>}
      {items.slice(0, 5).map((s: any, i: number) => (
        <div key={i} className={rowCls}>
          <span className="truncate font-medium text-slate-700">{s.shop_name || s.name || "—"}</span>
          <span className="shrink-0 text-amber-600">{lang === "en" ? "expires" : "到期"}: {fmtDate(s.expires_at ?? s.token_expires_at)}</span>
        </div>
      ))}
    </div>
  );
}

function CollectResultCard({ d, t, jump, lang }: any) {
  if (!d) return null;
  return (
    <div className="rounded-xl border bg-white p-2.5 shadow-sm">
      <div className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-emerald-700"><Check size={13} /> {t.copied}</div>
      <div className="flex gap-2.5">
        {d.image && <img src={d.image} alt="" className="h-16 w-16 shrink-0 rounded-lg border object-cover" />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-slate-800">{d.name || "—"}</div>
          <div className="mt-0.5 text-xs text-slate-500">{fmtPrice(d.price, d.currency)} · {d.platform || "—"}{d.variants_count ? ` · ${d.variants_count} ${lang === "en" ? "variants" : "变体"}` : ""}</div>
          <div className="mt-1 flex gap-1.5">
            <button onClick={() => jump(`/products/${d.draft_id}`)} className="rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-700">{lang === "en" ? "Edit draft" : "去编辑草稿"}</button>
            <button onClick={() => jump("/products")} className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50">{lang === "en" ? "View drafts" : "查看草稿"}</button>
          </div>
          <div className="mt-1 text-[10px] text-slate-400"><AlertTriangle size={10} className="inline" /> {t.copyright}</div>
        </div>
      </div>
    </div>
  );
}

// ===== 图片解析草稿卡片 =====
function ImageDraftCard({ d, t, jump, lang }: any) {
  if (!d) return null;
  return (
    <div className="rounded-xl border bg-white p-2.5 shadow-sm">
      <div className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-violet-700"><Camera size={13} /> {lang === "en" ? "Draft from image" : "图片解析草稿"}</div>
      <div className="flex gap-2.5">
        {d.image && <img src={d.image} alt="" className="h-16 w-16 shrink-0 rounded-lg border object-cover" />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-slate-800">{d.name || "—"}</div>
          <div className="mt-0.5 text-xs text-slate-500">{fmtPrice(d.price, d.currency)} · {d.platform || "—"}{d.attributes_count ? ` · ${d.attributes_count} ${lang === "en" ? "attributes" : "属性"}` : ""}</div>
          <div className="mt-1 flex gap-1.5">
            <button onClick={() => jump(`/products/${d.draft_id}`)} className="rounded-lg bg-violet-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-violet-700">{lang === "en" ? "Edit draft" : "去编辑草稿"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== 批量采集汇总卡片 =====
function BatchCollectCard({ d, t, jump, lang }: any) {
  const items = d?.items ?? [];
  const ok = Number(d?.ok ?? 0);
  const fail = Number(d?.fail ?? 0);
  return (
    <div className="rounded-xl border bg-white p-2.5 shadow-sm">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs font-semibold text-slate-700"><Package size={13} /> {lang === "en" ? "Batch collection" : "批量采集"}: {ok} ✅ / {fail} ❌</span>
        <button onClick={() => jump("/products")} className="text-[11px] text-indigo-600 hover:underline">{t.view} →</button>
      </div>
      <div className="space-y-1">
        {items.slice(0, 5).map((it: any, i: number) => (
          <div key={i} className={rowCls}>
            {it.ok ? (
              <button onClick={() => it.draft_id && jump(`/products/${it.draft_id}`)} className="truncate text-left font-medium text-slate-700 hover:text-indigo-600">
                {it.image && <img src={it.image} alt="" className="mr-1.5 inline h-5 w-5 rounded object-cover align-middle" />}
                {it.name || "—"}
              </button>
            ) : (
              <span className="truncate text-rose-600">✗ {it.name || "—"}</span>
            )}
            {it.ok && <span className="shrink-0 text-slate-400">{fmtPrice(it.price, it.currency)}</span>}
          </div>
        ))}
        {items.length > 5 && <div className="pt-0.5 text-[10px] text-slate-400">+{items.length - 5} {lang === "en" ? "more" : "更多"}</div>}
      </div>
    </div>
  );
}

// ===== 销售分析卡片 =====
function SalesAnalysisCard({ d, t, jump, lang }: any) {
  if (!d) return null;
  const change = d.changePercent;
  const maxChannel = Math.max(1, ...(d.channels ?? []).map((c: any) => Number(c.amount) || 0));
  const maxTrend = Math.max(1, ...(d.trend ?? []).map((x: any) => Number(x.amount) || 0));
  const currency = d.currency || "USD";
  return (
    <div className="rounded-xl border bg-white p-2.5 shadow-sm">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs font-semibold text-slate-700"><TrendingUp size={13} /> {t.salesTitle}（{d.days}d）</span>
        <button onClick={() => jump("/reports")} className="text-[11px] text-indigo-600 hover:underline">{t.view} →</button>
      </div>
      {/* 指标 */}
      <div className="mb-1.5 grid grid-cols-3 gap-1.5">
        <div className="rounded-lg bg-emerald-50 px-2 py-1">
          <div className="text-[10px] text-emerald-600">{lang === "en" ? "Sales" : "销售额"}</div>
          <div className="truncate text-xs font-bold text-emerald-700">{fmtPrice(d.totalAmount, currency)}</div>
        </div>
        <div className="rounded-lg bg-blue-50 px-2 py-1">
          <div className="text-[10px] text-blue-600">{lang === "en" ? "Orders" : "订单"}</div>
          <div className="text-xs font-bold text-blue-700">{d.orderCount}</div>
        </div>
        <div className="rounded-lg bg-amber-50 px-2 py-1">
          <div className="text-[10px] text-amber-600">{lang === "en" ? "vs prev" : "较上期"}</div>
          <div className={`text-xs font-bold ${change === null ? "text-slate-400" : change >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
            {change === null ? "—" : `${change >= 0 ? "↑" : "↓"}${Math.abs(change).toFixed(1)}%`}
          </div>
        </div>
      </div>
      {/* 热销 Top */}
      {(d.topProducts ?? []).length > 0 && (
        <div className="mb-1.5">
          <div className="mb-0.5 text-[10px] font-medium text-slate-500">{t.topProducts}</div>
          {(d.topProducts ?? []).slice(0, 3).map((p: any, i: number) => (
            <div key={i} className={rowCls}>
              <span className="truncate text-slate-700"><b className="mr-1 text-indigo-500">{i + 1}</b>{p.name}</span>
              <span className="shrink-0 text-slate-500">{fmtPrice(p.amount, currency)}<span className="ml-1 text-[10px] text-slate-400">×{p.count}</span></span>
            </div>
          ))}
        </div>
      )}
      {/* 渠道分布 */}
      {(d.channels ?? []).length > 0 && (
        <div className="mb-1.5">
          <div className="mb-0.5 text-[10px] font-medium text-slate-500">{t.channels}</div>
          {(d.channels ?? []).slice(0, 3).map((c: any, i: number) => (
            <div key={i} className="mb-1 flex items-center gap-1.5">
              <span className="w-14 shrink-0 truncate text-[10px] text-slate-500">{c.name}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-indigo-400" style={{ width: `${Math.max(4, (Number(c.amount) / maxChannel) * 100)}%` }} />
              </div>
              <span className="w-14 shrink-0 text-right text-[10px] text-slate-500">{fmtPrice(c.amount, currency)}</span>
            </div>
          ))}
        </div>
      )}
      {/* 迷你趋势 */}
      {(d.trend ?? []).length > 0 && (
        <div>
          <div className="mb-0.5 text-[10px] font-medium text-slate-500">{t.trend.replace("{{n}}", String(d.days))}</div>
          <div className="flex h-8 items-end gap-[2px]">
            {(d.trend ?? []).map((x: any, i: number) => (
              <div key={i} title={`${x.date}: ${x.amount}`}
                className="min-w-[2px] flex-1 rounded-t bg-indigo-300 hover:bg-indigo-500"
                style={{ height: `${Math.max(4, (Number(x.amount) / maxTrend) * 100)}%` }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ===== 高危确认卡片 =====
function ConfirmCard({ pc, t, onConfirm, onCancel }: { pc: PendingConfirm; t: typeof T.zh; onConfirm: (token: string) => void; onCancel: () => void }) {  const [confirming, setConfirming] = useState(false);
  return (
    <div className="mt-2 rounded-xl border-2 border-amber-300 bg-amber-50 p-3 shadow-sm">
      <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700">
        <AlertTriangle size={14} /> {pc.title}
      </div>
      <div className="mt-1.5 whitespace-pre-wrap text-xs text-slate-700">{pc.detail}</div>
      <div className="mt-2 flex gap-2">
        <button
          disabled={confirming}
          onClick={() => { setConfirming(true); onConfirm(pc.token); }}
          className="flex-1 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
          {confirming ? t.thinking : pc.confirm_label || t.confirm}
        </button>
        <button onClick={onCancel} className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
          {pc.cancel_label || t.cancel}
        </button>
      </div>
    </div>
  );
}
