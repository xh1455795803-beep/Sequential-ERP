/**
 * /ai/resources — 增值资源
 *
 * 图片翻译次数包（独立计费，微信支付购买后入账 translate_packs，优先消耗次数包）
 * AI 模特（第三方：易点，即将上线）
 *
 * 说明：次数包为独立资源包，不占用「AI 工作台」积分池；购买后图片翻译优先消耗次数包。
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Package, Languages, Sparkles, BadgeCheck, Hourglass, Info, X, Loader2, Check, Calendar } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import {
  getTranslatePacks, TRANSLATE_PACK_OPTIONS,
  createWechatPayOrder, queryWechatPayOrder,
  type TranslatePackRow, type WechatPayOrderResult,
} from "@/services/aiService";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_layout/ai/resources")({
  component: AiResources,
});

/* ═══════════════════════════════════════════════════════════
   微信支付覆盖层（次数包购买）
   ═══════════════════════════════════════════════════════════ */
function WechatPayOverlay({
  order, amount, onClose, onPaid,
}: {
  order: WechatPayOrderResult; amount: number; onClose: () => void; onPaid: () => void;
}) {
  const [seconds, setSeconds] = useState(300);
  const [querying, setQuerying] = useState(false);

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  const handleCheck = useCallback(async () => {
    setQuerying(true);
    try {
      const r = await queryWechatPayOrder(order.order_no);
      if (r.status === "paid" || r.status === "SUCCESS") {
        toast.success("支付成功！次数包已到账");
        onPaid();
      } else {
        toast.error("尚未完成支付，请扫码后在微信中确认");
      }
    } catch {
      toast.error("查询失败，请稍后重试");
    } finally {
      setQuerying(false);
    }
  }, [order.order_no, onPaid]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-md rounded-2xl bg-card p-8 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <X size={16} />
        </button>

        <div className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M8.5 11.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm7 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" fill="#07C160"/>
              <path d="M12 2C6.48 2 2 5.92 2 10.67c0 2.87 1.69 5.42 4.27 7.07l-.94 2.83c-.1.3.22.57.5.4l3.33-1.95c.9.22 1.86.35 2.84.35 5.52 0 10-3.92 10-8.67S17.52 2 12 2z" fill="#07C160"/>
            </svg>
          </div>
          <h3 className="font-display text-lg font-semibold text-ink">微信扫码支付</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            扫码支付 · <span className="font-semibold text-ink">¥{amount.toFixed(2)}</span>
          </p>
        </div>

        <div className="relative mx-auto my-6 aspect-square w-56 overflow-hidden rounded-xl border border-border bg-white p-3">
          {order.code_url ? (
            <QRCodeSVG value={order.code_url} size={200} className="h-full w-full" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">二维码生成中…</div>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-center gap-2 text-sm">
            <Calendar size={14} className="text-muted-foreground" />
            <span className="text-muted-foreground">
              剩余 <span className={cn("font-data font-semibold", seconds < 60 ? "text-rose-500" : "text-ink")}>
                {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
              </span>
            </span>
          </div>
          <Button className="w-full" variant="outline" onClick={handleCheck} disabled={querying}>
            {querying && <Loader2 size={14} className="mr-1.5 animate-spin" />}
            <Check size={14} className="mr-1.5 text-success" />
            我已完成支付
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   主页面
   ═══════════════════════════════════════════════════════════ */
function AiResources() {
  const { user } = useAuth();
  const [packs, setPacks] = useState<TranslatePackRow[]>([]);
  const [payingCode, setPayingCode] = useState<string | null>(null);
  const [payingAmount, setPayingAmount] = useState(0);
  const [order, setOrder] = useState<WechatPayOrderResult | null>(null);

  const load = useCallback(() => {
    getTranslatePacks().then(setPacks).catch(() => setPacks([]));
  }, []);

  useEffect(() => { load(); }, [load]);

  const totalRemaining = packs.reduce((s, p) => s + (p.remaining ?? 0), 0);

  /* ── 购买次数包 ── */
  const handleBuy = async (code: string, price: number) => {
    if (!user) { toast.error("请先登录"); return; }
    setPayingCode(code);
    setPayingAmount(price);
    const loadingId = toast.loading("正在创建微信支付订单…");
    try {
      const o = await createWechatPayOrder(price, "native", { packageType: "translate_pack", packCode: code });
      toast.dismiss(loadingId);
      setOrder(o);
    } catch (e) {
      toast.dismiss(loadingId);
      toast.error(e instanceof Error ? e.message : "创建订单失败");
      setPayingCode(null);
    }
  };

  const handlePaid = () => { setOrder(null); setPayingCode(null); void load(); };

  return (
    <div className="space-y-6">
      <PageHeader
        title="增值资源"
        description="图片翻译次数包与 AI 模特等增值服务（独立计费，不占用积分池）"
      />

      {/* 已购次数包 */}
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-border/70 bg-card p-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
          <Languages size={20} className="text-primary" />
        </div>
        <div>
          <p className="text-sm font-medium text-ink">我的图片翻译次数包</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {packs.length === 0
              ? "暂未购买次数包（图片翻译将按 2 积分/次 从「AI 工作台」积分池扣除）"
              : <>剩余 <span className="text-base font-semibold text-primary">{totalRemaining}</span> 次</>}
          </p>
        </div>
        {packs.length > 0 && (
          <div className="ml-auto flex flex-col gap-1">
            {packs.map((p) => (
              <span key={p.id} className="text-xs text-muted-foreground">
                {p.name}：剩余 {p.remaining}/{p.total} 次
                {p.expires_at ? ` · ${new Date(p.expires_at).toLocaleDateString("zh-CN")} 到期` : ""}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 档位 + 购买 */}
      <section>
        <h3 className="mb-4 flex items-center gap-2 font-display text-base font-semibold text-ink">
          <Package size={16} className="text-primary" /> 图片翻译次数包
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {TRANSLATE_PACK_OPTIONS.map((opt) => (
            <div
              key={opt.code}
              className="relative flex flex-col rounded-2xl border border-border/70 bg-card p-5"
            >
              {opt.tag && (
                <span className="absolute right-4 top-4 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                  {opt.tag}
                </span>
              )}
              <p className="text-sm font-medium text-ink">{opt.name}</p>
              <p className="mt-2 text-2xl font-bold text-ink">
                ¥{opt.price}
                <span className="ml-1 text-xs font-normal text-muted-foreground">/ {opt.count} 次</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{opt.desc}</p>
              <div className="mt-4 flex-1" />
              <Button
                className="w-full"
                disabled={payingCode === opt.code}
                onClick={() => handleBuy(opt.code, opt.price)}
              >
                {payingCode === opt.code && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                立即购买
              </Button>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          支持第三方翻译引擎：阿里 AI · 顶秀译图 · 象寄（接入顺序以商务进度为准）。次数包与积分池相互独立，购买后图片翻译优先消耗次数包，有效期 1 年。
        </p>
      </section>

      {/* AI 模特 */}
      <section>
        <h3 className="mb-4 flex items-center gap-2 font-display text-base font-semibold text-ink">
          <Sparkles size={16} className="text-primary" /> AI 模特
        </h3>
        <div className="rounded-2xl border border-border/70 bg-card p-5">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
              <BadgeCheck size={22} className="text-muted-foreground" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-ink">真人模特换装 / 商品上身效果</p>
              <p className="mt-1 text-xs text-muted-foreground">
                服装、饰品、箱包等品类，上传商品图即可生成真人上身效果。由第三方服务「易点」提供，按张计费，独立结算。
              </p>
            </div>
            <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
              即将上线
            </span>
          </div>
        </div>
      </section>

      <div className="rounded-2xl border border-dashed border-border/60 bg-muted/30 p-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-2 font-medium text-ink">
          <Hourglass size={14} /> 计费说明
        </div>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>图片翻译：有次数包优先消耗次数包，无次数包时按 2 积分/次 从「AI 工作台」积分池扣除（每日赠送 20，当日清零）。</li>
          <li>次数包有效期 1 年，过期后剩余次数不退还、不累计；同档位续购自动叠加剩余次数。</li>
          <li>AI 模特由第三方计费，与平台积分体系相互独立。</li>
        </ul>
      </div>

      {order && (
        <WechatPayOverlay
          order={order}
          amount={payingAmount}
          onClose={() => { setOrder(null); setPayingCode(null); }}
          onPaid={handlePaid}
        />
      )}
    </div>
  );
}
