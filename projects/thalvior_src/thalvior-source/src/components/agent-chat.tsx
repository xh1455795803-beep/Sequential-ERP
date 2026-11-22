// 对话式智能助手：右下角悬浮对话面板
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Bot, X, Minus, Send, Sparkles, Store, Package, ShoppingCart, Coins,
  AlertTriangle, FileText, Link2, Check, Loader2, ImagePlus, Camera, Mic, TrendingUp,
} from "lucide-react";
import { useLanguage } from "@/i18n/LanguageContext";
import { tt } from "@/i18n/tts";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/supabase/client";
import {
  sendAgentMessage, suggestionsForPage,
  type AgentMessage, type AgentCard, type AgentAction, type PendingConfirm,
} from "@/services/agentService";

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
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 0, role: "assistant", content: tt("agent.welcome"), time: Date.now() },
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
      push({ role: "assistant", content: tt("agent.voiceUnsupported") });
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
      push({ role: "assistant", content: tt("agent.voiceUnsupported") });
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
      push({ role: "assistant", content: tt("agent.uploadFailed") });
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
    const msg = content || (detectedLink ? tt("agent.collectLinkMsg", { link: detectedLink }) : imageUrl ? tt("agent.parseImageMsg") : "");
    setInput("");
    setDetectedLink("");
    const imgUrl = imageUrl;
    setImageUrl("");
    setImagePreview("");
    setPendingConfirm(null);
    push({ role: "user", content: msg + (imgUrl ? `\n[🖼️ ${tt("agent.imgAttached")}]` : "") });
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
      push({ role: "assistant", content: err instanceof Error ? err.message : tt("agent.errRequest") });
    } finally {
      setBusy(false);
    }
  }, [input, detectedLink, messages, page]);

  const confirmAction = async (token: string) => {
    setBusy(true);
    try {
      const res = await sendAgentMessage({ message: "", history: messages.slice(-6), page, confirmToken: token, lang: lang === "en" ? "en" : "zh" });
      push({ role: "assistant", content: res.reply, cards: res.cards, actions: res.actions });
      setPendingConfirm(null);
    } catch (err) {
      push({ role: "assistant", content: err instanceof Error ? err.message : tt("agent.errConfirm") });
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
      <div className="flex items-center justify-between border-b bg-primary px-4 py-3 text-primary-foreground">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-harbor">
            <Bot size={18} />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">{tt("agent.title")}</div>
            <div className="text-[11px] text-primary-foreground/70">{tt("agent.alwaysReady")}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-card/10" title={tt("agent.close")}>
            <X size={16} />
          </button>
        </div>
      </div>

      {/* 消息区 */}
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto bg-muted/30 p-3">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
              m.role === "user" ? "bg-primary text-primary-foreground" : "bg-card text-foreground shadow-soft"
            }`}>
              {m.content && <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>}
              {m.role === "assistant" && m.cards && m.cards.length > 0 && (
                <div className="mt-2 space-y-2">
                  {m.cards.map((c, i) => <Card key={i} card={c} jump={jump} lang={lang === "en" ? "en" : "zh"} />)}
                </div>
              )}
              {m.role === "assistant" && m.actions && m.actions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {m.actions.map((a, i) => (
                    <button key={i} onClick={() => jump(a.path)}
                      className="flex items-center gap-1 rounded-lg border border-border bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground hover:bg-accent/70">
                      {a.type === "jump" && <FileText size={12} />} {a.label}
                    </button>
                  ))}
                </div>
              )}
              {m.role === "assistant" && m.pendingConfirm && (
                <ConfirmCard pc={m.pendingConfirm} onConfirm={confirmAction} onCancel={() => setPendingConfirm(null)} />
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl bg-card px-3 py-2 text-xs text-muted-foreground shadow-soft">
              <Loader2 size={14} className="animate-spin" /> {tt("agent.thinking")}
            </div>
          </div>
        )}
      </div>

      {/* 快捷推荐 */}
      <div className="flex gap-1.5 overflow-x-auto border-t border-border bg-card px-3 py-2">
        {suggestions.map((s, i) => (
          <button key={i} onClick={() => send(s)}
            className="flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground hover:border-harbor/40 hover:bg-accent hover:text-foreground">
            <Sparkles size={11} /> {s}
          </button>
        ))}
      </div>

      {/* 输入区 */}
      <div className="border-t border-border bg-card p-3">
        {detectedLink && (
          <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-info-bg px-2.5 py-1.5 text-xs text-info">
            <Link2 size={12} className="shrink-0" />
            <span className="truncate">{tt("agent.linkDetected")} {detectedLink}</span>
            <button onClick={() => setDetectedLink("")} className="ml-auto text-info hover:text-info"><X size={13} /></button>
          </div>
        )}
        {imagePreview && (
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-info-bg px-2.5 py-1.5 text-xs text-info">
            <img src={imagePreview} alt="" className="h-9 w-9 shrink-0 rounded-md border object-cover" />
            <span className="min-w-0 flex-1 truncate">{tt("agent.imageReady")}</span>
            <button onClick={() => { setImageUrl(""); setImagePreview(""); }} className="text-info hover:text-info"><X size={13} /></button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickImage} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploadingImg}
            title={tt("agent.uploadImage")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground hover:border-harbor/40 hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            {uploadingImg ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />}
          </button>
          <button
            onClick={startVoice}
            title={tt("agent.voiceInput")}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border bg-muted text-muted-foreground hover:border-success/40 hover:bg-success-bg hover:text-success ${listening ? "animate-pulse border-success/60 bg-success-bg text-success" : "border-border"}`}
          >
            <Mic size={15} />
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={2}
            placeholder={tt("agent.placeholder")}
            className="flex-1 resize-none rounded-xl border border-border bg-muted px-3 py-2 text-sm outline-none focus:border-harbor focus:bg-card"
          />
          <button onClick={() => send()} disabled={busy || (!input.trim() && !detectedLink && !imageUrl)}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-soft hover:bg-primary/90 disabled:opacity-40">
            <Send size={15} />
          </button>
        </div>
        <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground/60">
          <AlertTriangle size={10} /> {tt("agent.usageHint")}
        </div>
      </div>
    </div>
  );
}

// ===== 卡片渲染 =====
function Card({ card, jump, lang }: { card: AgentCard; jump: (p: string) => void; lang: "zh" | "en" }) {
  switch (card.type) {
    case "shops":
      return <ShopsCard d={card.data as any} jump={jump} lang={lang} />;
    case "orders":
      return <OrdersCard d={card.data as any} jump={jump} lang={lang} />;
    case "products":
      return <ProductsCard d={card.data as any} jump={jump} lang={lang} />;
    case "quota":
      return <QuotaCard d={card.data as any} lang={lang} />;
    case "auth_expiring":
      return <AuthExpiringCard d={card.data as any} jump={jump} lang={lang} />;
    case "collect_result":
      return <CollectResultCard d={card.data as any} jump={jump} lang={lang} />;
    case "image_draft_result":
      return <ImageDraftCard d={card.data as any} jump={jump} lang={lang} />;
    case "batch_collect_result":
      return <BatchCollectCard d={card.data as any} jump={jump} lang={lang} />;
    case "sales_analysis":
      return <SalesAnalysisCard d={card.data as any} jump={jump} lang={lang} />;
    default:
      return null;
  }
}

const rowCls = "flex items-center justify-between gap-2 py-1.5 text-xs border-b border-border/60 last:border-0";

function ShopsCard({ d, jump, lang }: any) {
  const shops = d?.shops ?? [];
  const totalSales = d?.totalSales ?? 0;
  const totalOrders = d?.totalOrders ?? 0;
  return (
    <div className="rounded-xl border border-border bg-card p-2.5 shadow-soft">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs font-semibold text-foreground/80"><Store size={13} /> {tt("agent.shops")} ({shops.length})</span>
        <button onClick={() => jump("/auth")} className="text-[11px] text-harbor hover:underline">{tt("agent.view")} →</button>
      </div>
      <div className="mb-1.5 grid grid-cols-2 gap-1.5">
        <div className="rounded-lg bg-success-bg px-2 py-1"><div className="text-[10px] text-success">{tt("agent.sales30d")}</div><div className="text-xs font-bold text-success">${Number(totalSales).toFixed(2)}</div></div>
        <div className="rounded-lg bg-info-bg px-2 py-1"><div className="text-[10px] text-info">{tt("agent.ordersCount")}</div><div className="text-xs font-bold text-info">{totalOrders}</div></div>
      </div>
      {shops.slice(0, 4).map((s: any, i: number) => (
        <div key={i} className={rowCls}>
          <span className="truncate font-medium text-foreground/80">{s.shop_name || s.name || "—"}</span>
          <span className="shrink-0 text-muted-foreground/60">{s.platform || "—"}</span>
        </div>
      ))}
    </div>
  );
}

function OrdersCard({ d, jump, lang }: any) {
  const orders = d?.orders ?? [];
  return (
    <div className="rounded-xl border border-border bg-card p-2.5 shadow-soft">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs font-semibold text-foreground/80"><ShoppingCart size={13} /> {tt("agent.ordersDays", { n: d?.days ?? 30 })} {orders.length}</span>
        <button onClick={() => jump("/orders")} className="text-[11px] text-harbor hover:underline">{tt("agent.view")} →</button>
      </div>
      <div className="mb-1.5 grid grid-cols-2 gap-1.5">
        <div className="rounded-lg bg-success-bg px-2 py-1"><div className="text-[10px] text-success">{tt("agent.total")}</div><div className="text-xs font-bold text-success">{fmtPrice(d?.totalAmount, "USD")}</div></div>
        <div className="rounded-lg bg-info-bg px-2 py-1"><div className="text-[10px] text-info">{tt("agent.ordersCount")}</div><div className="text-xs font-bold text-info">{d?.orderCount ?? orders.length}</div></div>
      </div>
      {orders.slice(0, 4).map((o: any, i: number) => (
        <div key={i} className={rowCls}>
          <span className="truncate font-medium text-foreground/80">{o.order_no || o.order_id || "—"}</span>
          <span className="shrink-0 text-muted-foreground/60">{fmtPrice(o.total_price ?? o.amount, o.currency)}</span>
        </div>
      ))}
    </div>
  );
}

function ProductsCard({ d, jump, lang }: any) {
  const products = d?.products ?? [];
  const byStatus = d?.byStatus ?? {};
  return (
    <div className="rounded-xl border border-border bg-card p-2.5 shadow-soft">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs font-semibold text-foreground/80"><Package size={13} /> {tt("agent.products")} ({products.length})</span>
        <button onClick={() => jump("/products")} className="text-[11px] text-harbor hover:underline">{tt("agent.view")} →</button>
      </div>
      <div className="mb-1.5 flex flex-wrap gap-1.5">
        {Object.entries(byStatus).map(([k, v], i) => (
          <span key={i} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{k}: <b>{String(v)}</b></span>
        ))}
      </div>
      {products.slice(0, 3).map((p: any, i: number) => (
        <div key={i} className={rowCls}>
          <span className="truncate font-medium text-foreground/80">{p.name || "—"}</span>
          <span className="shrink-0 text-muted-foreground/60">{fmtPrice(p.price, p.currency)}</span>
        </div>
      ))}
    </div>
  );
}

function QuotaCard({ d, lang }: any) {
  return (
    <div className="rounded-xl border border-border bg-card p-2.5 shadow-soft">
      <div className="mb-1 flex items-center gap-1 text-xs font-semibold text-foreground/80"><Coins size={13} /> {tt("agent.aiCredits")}</div>
      <div className="flex items-center gap-2">
        <span className="text-2xl font-bold text-harbor">{Number(d?.credits ?? 0).toLocaleString()}</span>
        <span className="text-xs text-muted-foreground">{tt("agent.creditsAvailable")}</span>
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground/60">
        {d?.plan_name ? `${tt("agent.plan")}: ${d.plan_name}` : ""}
        {d?.plan_expires_at ? ` · ${tt("agent.expires")}: ${fmtDate(d.plan_expires_at)}` : ""}
      </div>
    </div>
  );
}

function AuthExpiringCard({ d, jump, lang }: any) {
  const items = d?.items ?? [];
  return (
    <div className="rounded-xl border border-border bg-card p-2.5 shadow-soft">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs font-semibold text-warning"><AlertTriangle size={13} /> {tt("agent.authExpiring")} ({d?.total ?? items.length})</span>
        <button onClick={() => jump("/auth")} className="text-[11px] text-harbor hover:underline">{tt("agent.renew")}</button>
      </div>
      {items.length === 0 && <div className="py-1 text-xs text-muted-foreground/60">{tt("agent.authHealthy")}</div>}
      {items.slice(0, 5).map((s: any, i: number) => (
        <div key={i} className={rowCls}>
          <span className="truncate font-medium text-foreground/80">{s.shop_name || s.name || "—"}</span>
          <span className="shrink-0 text-warning">{tt("agent.expires")}: {fmtDate(s.expires_at ?? s.token_expires_at)}</span>
        </div>
      ))}
    </div>
  );
}

function CollectResultCard({ d, jump, lang }: any) {
  if (!d) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-2.5 shadow-soft">
      <div className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-success"><Check size={13} /> {tt("agent.copied")}</div>
      <div className="flex gap-2.5">
        {d.image && <img src={d.image} alt="" className="h-16 w-16 shrink-0 rounded-lg border object-cover" />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-foreground">{d.name || "—"}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{fmtPrice(d.price, d.currency)} · {d.platform || "—"}{d.variants_count ? ` · ${d.variants_count} ${tt("agent.variants")}` : ""}</div>
          <div className="mt-1 flex gap-1.5">
            <button onClick={() => jump(`/products/${d.draft_id}`)} className="rounded-lg bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90">{tt("agent.editDraft")}</button>
            <button onClick={() => jump("/products")} className="rounded-lg border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent">{tt("agent.viewDrafts")}</button>
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground/60"><AlertTriangle size={10} className="inline" /> {tt("agent.copyright")}</div>
        </div>
      </div>
    </div>
  );
}

// ===== 图片解析草稿卡片 =====
function ImageDraftCard({ d, jump, lang }: any) {
  if (!d) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-2.5 shadow-soft">
      <div className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-info"><Camera size={13} /> {tt("agent.draftFromImage")}</div>
      <div className="flex gap-2.5">
        {d.image && <img src={d.image} alt="" className="h-16 w-16 shrink-0 rounded-lg border object-cover" />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-foreground">{d.name || "—"}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{fmtPrice(d.price, d.currency)} · {d.platform || "—"}{d.attributes_count ? ` · ${d.attributes_count} ${tt("agent.attributes")}` : ""}</div>
          <div className="mt-1 flex gap-1.5">
            <button onClick={() => jump(`/products/${d.draft_id}`)} className="rounded-lg bg-harbor px-2 py-1 text-[11px] font-medium text-white hover:bg-harbor/90">{tt("agent.editDraft")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== 批量采集汇总卡片 =====
function BatchCollectCard({ d, jump, lang }: any) {
  const items = d?.items ?? [];
  const ok = Number(d?.ok ?? 0);
  const fail = Number(d?.fail ?? 0);
  return (
    <div className="rounded-xl border border-border bg-card p-2.5 shadow-soft">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs font-semibold text-foreground/80"><Package size={13} /> {tt("agent.batchCollect")}: {ok} ✅ / {fail} ❌</span>
        <button onClick={() => jump("/products")} className="text-[11px] text-harbor hover:underline">{tt("agent.view")} →</button>
      </div>
      <div className="space-y-1">
        {items.slice(0, 5).map((it: any, i: number) => (
          <div key={i} className={rowCls}>
            {it.ok ? (
              <button onClick={() => it.draft_id && jump(`/products/${it.draft_id}`)} className="truncate text-left font-medium text-foreground/80 hover:text-harbor">
                {it.image && <img src={it.image} alt="" className="mr-1.5 inline h-5 w-5 rounded object-cover align-middle" />}
                {it.name || "—"}
              </button>
            ) : (
              <span className="truncate text-destructive">✗ {it.name || "—"}</span>
            )}
            {it.ok && <span className="shrink-0 text-muted-foreground/60">{fmtPrice(it.price, it.currency)}</span>}
          </div>
        ))}
        {items.length > 5 && <div className="pt-0.5 text-[10px] text-muted-foreground/60">+{items.length - 5} {tt("agent.more")}</div>}
      </div>
    </div>
  );
}

// ===== 销售分析卡片 =====
function SalesAnalysisCard({ d, jump, lang }: any) {
  if (!d) return null;
  const change = d.changePercent;
  const maxChannel = Math.max(1, ...(d.channels ?? []).map((c: any) => Number(c.amount) || 0));
  const maxTrend = Math.max(1, ...(d.trend ?? []).map((x: any) => Number(x.amount) || 0));
  const currency = d.currency || "USD";
  return (
    <div className="rounded-xl border border-border bg-card p-2.5 shadow-soft">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs font-semibold text-foreground/80"><TrendingUp size={13} /> {tt("agent.salesTitle")}（{d.days}d）</span>
        <button onClick={() => jump("/reports")} className="text-[11px] text-harbor hover:underline">{tt("agent.view")} →</button>
      </div>
      {/* 指标 */}
      <div className="mb-1.5 grid grid-cols-3 gap-1.5">
        <div className="rounded-lg bg-success-bg px-2 py-1">
          <div className="text-[10px] text-success">{tt("agent.sales")}</div>
          <div className="truncate text-xs font-bold text-success">{fmtPrice(d.totalAmount, currency)}</div>
        </div>
        <div className="rounded-lg bg-info-bg px-2 py-1">
          <div className="text-[10px] text-info">{tt("agent.orders")}</div>
          <div className="text-xs font-bold text-info">{d.orderCount}</div>
        </div>
        <div className="rounded-lg bg-warning-bg px-2 py-1">
          <div className="text-[10px] text-warning">{tt("agent.vsPrev")}</div>
          <div className={`text-xs font-bold ${change === null ? "text-muted-foreground/60" : change >= 0 ? "text-success" : "text-destructive"}`}>
            {change === null ? "—" : `${change >= 0 ? "↑" : "↓"}${Math.abs(change).toFixed(1)}%`}
          </div>
        </div>
      </div>
      {/* 热销 Top */}
      {(d.topProducts ?? []).length > 0 && (
        <div className="mb-1.5">
          <div className="mb-0.5 text-[10px] font-medium text-muted-foreground">{tt("agent.topProducts")}</div>
          {(d.topProducts ?? []).slice(0, 3).map((p: any, i: number) => (
            <div key={i} className={rowCls}>
              <span className="truncate text-foreground/80"><b className="mr-1 text-harbor">{i + 1}</b>{p.name}</span>
              <span className="shrink-0 text-muted-foreground">{fmtPrice(p.amount, currency)}<span className="ml-1 text-[10px] text-muted-foreground/60">×{p.count}</span></span>
            </div>
          ))}
        </div>
      )}
      {/* 渠道分布 */}
      {(d.channels ?? []).length > 0 && (
        <div className="mb-1.5">
          <div className="mb-0.5 text-[10px] font-medium text-muted-foreground">{tt("agent.channels")}</div>
          {(d.channels ?? []).slice(0, 3).map((c: any, i: number) => (
            <div key={i} className="mb-1 flex items-center gap-1.5">
              <span className="w-14 shrink-0 truncate text-[10px] text-muted-foreground">{c.name}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-harbor/60" style={{ width: `${Math.max(4, (Number(c.amount) / maxChannel) * 100)}%` }} />
              </div>
              <span className="w-14 shrink-0 text-right text-[10px] text-muted-foreground">{fmtPrice(c.amount, currency)}</span>
            </div>
          ))}
        </div>
      )}
      {/* 迷你趋势 */}
      {(d.trend ?? []).length > 0 && (
        <div>
          <div className="mb-0.5 text-[10px] font-medium text-muted-foreground">{tt("agent.trend", { n: d.days })}</div>
          <div className="flex h-8 items-end gap-[2px]">
            {(d.trend ?? []).map((x: any, i: number) => (
              <div key={i} title={`${x.date}: ${x.amount}`}
                className="min-w-[2px] flex-1 rounded-t bg-harbor/30 hover:bg-harbor/60"
                style={{ height: `${Math.max(4, (Number(x.amount) / maxTrend) * 100)}%` }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ===== 高危确认卡片 =====
function ConfirmCard({ pc, onConfirm, onCancel }: { pc: PendingConfirm; onConfirm: (token: string) => void; onCancel: () => void }) {  const [confirming, setConfirming] = useState(false);
  return (
    <div className="mt-2 rounded-xl border-2 border-warning/40 bg-warning-bg p-3 shadow-sm">
      <div className="flex items-center gap-1.5 text-xs font-bold text-warning">
        <AlertTriangle size={14} /> {pc.title}
      </div>
      <div className="mt-1.5 whitespace-pre-wrap text-xs text-foreground/80">{pc.detail}</div>
      <div className="mt-2 flex gap-2">
        <button
          disabled={confirming}
          onClick={() => { setConfirming(true); onConfirm(pc.token); }}
          className="flex-1 rounded-lg bg-warning px-3 py-1.5 text-xs font-semibold text-white hover:bg-warning/90 disabled:opacity-50">
          {confirming ? tt("agent.thinking") : pc.confirm_label || tt("agent.confirm")}
        </button>
        <button onClick={onCancel} className="flex-1 rounded-lg border border-input bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent">
          {pc.cancel_label || tt("agent.cancel")}
        </button>
      </div>
    </div>
  );
}
