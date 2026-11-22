/**
 * /ai/resources — 增值资源
 *
 * 图片翻译次数包（独立计费，微信支付购买后入账 translate_packs，优先消耗次数包）
 * AI 模特（第三方：易点，即将上线）
 *
 * 说明：次数包为独立资源包，不占用「AI 工作台」积分池；购买后图片翻译优先消耗次数包。
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { useLanguage } from "@/i18n/LanguageContext";
import { detectPayEnv } from "@/lib/payEnv";

import { tt } from "@/i18n/tts";
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
  const { t } = useLanguage(); // 修复：原文件使用 t 但未定义
  const payEnv = useMemo(() => detectPayEnv(), []); // wechat / mobile / pc 分流
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
        toast.success(tt('ai.res.paySuccess'));
        onPaid();
      } else {
        toast.error(tt('sub.pay.notPaidYet'));
      }
    } catch {
      toast.error(tt('sub.pay.queryFailed'));
    } finally {
      setQuerying(false);
    }
  }, [order.order_no, onPaid]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-md rounded-xl bg-card p-8 shadow-lift" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-4 top-4 rounded-md p-1 text-fg-muted hover:bg-surface-hover hover:text-fg">
          <X size={16} />
        </button>

        <div className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-success-bg">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M8.5 11.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm7 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" fill="var(--wechat)"/>
              <path d="M12 2C6.48 2 2 5.92 2 10.67c0 2.87 1.69 5.42 4.27 7.07l-.94 2.83c-.1.3.22.57.5.4l3.33-1.95c.9.22 1.86.35 2.84.35 5.52 0 10-3.92 10-8.67S17.52 2 12 2z" fill="var(--wechat)"/>
            </svg>
          </div>
          <h3 className="font-display text-lg font-semibold text-fg">
            {payEnv === "wechat" ? t("sub.pay.envWechatTitle") : payEnv === "mobile" ? t("sub.pay.envMobileTitle") : tt('ai.res.wechatPay')}
          </h3>
          <p className="mt-1 text-sm text-fg-muted">
            {t('ai.res.scanPay')} · <span className="font-semibold text-fg">¥{amount.toFixed(2)}</span>
          </p>
        </div>

        <div className={cn("relative mx-auto my-6 aspect-square overflow-hidden rounded-xl border border-border bg-card p-3", payEnv === "wechat" ? "w-64" : "w-56")}>
          {order.code_url ? (
            <QRCodeSVG value={order.code_url} size={200} className="h-full w-full" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-fg-muted">{tt('ai.res.qrGenerating')}</div>
          )}
        </div>

        {payEnv !== "pc" && (
          <p className="-mt-3 mb-3 text-center text-[11px] text-fg-muted">
            {payEnv === "wechat" ? t("sub.pay.envWechatHint") : t("sub.pay.envMobileHint")}
          </p>
        )}

        <div className="space-y-3">
          <div className="flex items-center justify-center gap-2 text-sm">
            <Calendar size={14} className="text-fg-muted" />
            <span className="text-fg-muted">
              {t('ai.res.remaining')} <span className={cn("font-data font-semibold", seconds < 60 ? "text-destructive" : "text-fg")}>
                {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
              </span>
            </span>
          </div>
          <Button className="w-full" variant="outline" onClick={handleCheck} disabled={querying}>
            {querying && <Loader2 size={14} className="mr-1.5 animate-spin" />}
            <Check size={14} className="mr-1.5 text-success" />
            {t('ai.res.paidDone')}
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
  const { t } = useLanguage(); // 修复：原文件使用 t 但未定义
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
    if (!user) { toast.error(tt('pd.loginRequired')); return; }
    setPayingCode(code);
    setPayingAmount(price);
    const loadingId = toast.loading(tt('sub.toast.creatingOrder'));
    try {
      const o = await createWechatPayOrder(price, "native", { packageType: "translate_pack", packCode: code });
      toast.dismiss(loadingId);
      setOrder(o);
    } catch (e) {
      toast.dismiss(loadingId);
      toast.error(e instanceof Error ? e.message : tt('sub.toast.orderFailed'));
      setPayingCode(null);
    }
  };

  const handlePaid = () => { setOrder(null); setPayingCode(null); void load(); };

  return (
    <div className="space-y-6">
      <PageHeader
        title={tt('nav.ai.resources')}
        description={tt('ai.res.desc')}
      />

      {/* 已购次数包 */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border/70 bg-card p-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
          <Languages size={20} className="text-primary" />
        </div>
        <div>
          <p className="text-sm font-medium text-fg">{tt('ai.res.myPackages')}</p>
          <p className="mt-0.5 text-xs text-fg-muted">
            {packs.length === 0
              ? tt('ai.res.nonePurchased')
              : <>{tt('ai.res.remaining')}<span className="text-base font-semibold text-primary">{totalRemaining}</span>{tt('ai.res.usesSuffix')}</>}
          </p>
        </div>
        {packs.length > 0 && (
          <div className="ml-auto flex flex-col gap-1">
            {packs.map((p) => (
              <span key={p.id} className="text-xs text-fg-muted">
                {p.name}：{tt('ai.res.pkgRemaining', { rem: p.remaining, tot: p.total })}
                {p.expires_at ? tt('ai.res.expiresOn', { v1: new Date(p.expires_at).toLocaleDateString("zh-CN") }) : ""}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 档位 + 购买 */}
      <section>
        <h3 className="mb-4 flex items-center gap-2 font-display text-base font-semibold text-fg">
          <Package size={16} className="text-primary" />{tt('ai.res.pkgTitle')}
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {TRANSLATE_PACK_OPTIONS.map((opt) => (
            <div
              key={opt.code}
              className="relative flex flex-col rounded-xl border border-border/70 bg-card p-5"
            >
              {opt.tag && (
                <span className="absolute right-4 top-4 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                  {opt.tag}
                </span>
              )}
              <p className="text-sm font-medium text-fg">{opt.name}</p>
              <p className="mt-2 text-2xl font-bold text-fg">
                ¥{opt.price}
                <span className="ml-1 text-xs font-normal text-fg-muted">{tt('ai.res.countUnit', { n: opt.count })}</span>
              </p>
              <p className="mt-1 text-xs text-fg-muted">{opt.desc}</p>
              <div className="mt-4 flex-1" />
              <Button
                className="w-full"
                disabled={payingCode === opt.code}
                onClick={() => handleBuy(opt.code, opt.price)}
              >
                {payingCode === opt.code && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                {t('ai.res.buyNow')}
              </Button>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-fg-muted">
          {t('ai.res.thirdPartyNote')}
        </p>
      </section>

      {/* AI 模特 */}
      <section>
        <h3 className="mb-4 flex items-center gap-2 font-display text-base font-semibold text-fg">
          <Sparkles size={16} className="text-primary" /> AI{tt('ai.res.modelTab')}
        </h3>
        <div className="rounded-xl border border-border/70 bg-card p-5">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface-sunken">
              <BadgeCheck size={22} className="text-fg-muted" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-fg">{tt('ai.res.modelDesc')}</p>
              <p className="mt-1 text-xs text-fg-muted">
                {tt('ai.res.tryon.desc')}
              </p>
            </div>
            <span className="rounded-full bg-surface-sunken px-3 py-1 text-xs text-fg-muted">
              {tt('ai.res.comingSoon')}
            </span>
          </div>
        </div>
      </section>

      <div className="rounded-xl border border-dashed border-border/60 bg-surface-sunken/30 p-4 text-xs text-fg-muted">
        <div className="flex items-center gap-2 font-medium text-fg">
          <Hourglass size={14} />{tt('ai.res.billingTitle')}
        </div>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>{tt('ai.res.imgTrans')}：{tt('ai.res.onlyBy')}「{tt('ai.res.standalonePkg')}」{tt('ai.res.billingSuffix')}，{tt('ai.res.noCreditA')}I{tt('ai.res.credits')}；{tt('ai.res.needPackageHint')}，{tt('ai.res.buyFirstHint')}。</li>
          <li>{tt('ai.res.pkgValidity')}1{tt('ai.res.yearSuffix')}，{tt('ai.res.noRefundHint')}、{tt('ai.res.notStacked')}；{tt('ai.res.autoStackHint')}。</li>
          <li>AI{tt('ai.res.modelThirdParty')}，{tt('ai.res.independentOfCredits')}。</li>
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
