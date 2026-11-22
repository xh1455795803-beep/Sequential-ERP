// 全局命令面板（Cmd/Ctrl+K）：搜订单号/商品名/SKU/店铺名 + 导航到任意页面
// 数据全部真实查库（orders/products/shop_auths），250ms 防抖 + 代次令牌丢弃过期响应
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, CornerDownLeft, ShoppingBag, Package, Store, LayoutDashboard, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/supabase/client";
import { useLanguage } from "@/i18n/LanguageContext";
import { menu, hiddenPages } from "@/components/sidebar";
import { StatusBadge } from "@/components/status-badge";

interface OrderHit { id: string; product: string; buyer: string; amount: number; currency: string; status: string }
interface ProductHit { id: string; name: string; sku: string; price: number; status: string }
interface ShopHit { id: string; shop_name: string; platform: string; status: string }

type CmdItem =
  | { kind: "nav"; key: string; label: string; path: string }
  | { kind: "order"; key: string; hit: OrderHit }
  | { kind: "product"; key: string; hit: ProductHit }
  | { kind: "shop"; key: string; hit: ShopHit };

// 扁平导航清单（父项+子项）
const NAV_ITEMS: { labelKey: string; path: string }[] = (() => {
  const out: { labelKey: string; path: string }[] = [];
  for (const item of menu) {
    if (item.external || item.href) continue; // 站外链接不进导航清单
    out.push({ labelKey: item.labelKey, path: item.path });
    for (const child of item.children ?? []) out.push({ labelKey: child.labelKey, path: child.path });
  }
  // 侧栏已收编的状态态/账号级页面：不进导航，但保留 ⌘K 直达
  for (const hp of hiddenPages) out.push({ labelKey: hp.labelKey, path: hp.path });
  return out;
})();

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<OrderHit[]>([]);
  const [products, setProducts] = useState<ProductHit[]>([]);
  const [shops, setShops] = useState<ShopHit[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  // 打开时重置
  useEffect(() => {
    if (open) {
      setQuery("");
      setOrders([]);
      setProducts([]);
      setShops([]);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // 防抖搜索（250ms）
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setOrders([]); setProducts([]); setShops([]); setLoading(false);
      return;
    }
    setLoading(true);
    const seq = ++seqRef.current;
    const timer = setTimeout(async () => {
      const esc = q.replace(/[%_,()]/g, " ").trim();
      if (!esc) { setLoading(false); return; }
      const safe = `*${esc}*`;
      try {
        const [o, p, s] = await Promise.all([
          supabase.from("orders").select("id,product,buyer,amount,currency,status")
            .or(`id.ilike.${safe},buyer.ilike.${safe},product.ilike.${safe},sku.ilike.${safe},external_order_id.ilike.${safe}`)
            .order("created_at", { ascending: false }).limit(5),
          supabase.from("products").select("id,name,sku,price,status")
            .or(`name.ilike.${safe},sku.ilike.${safe}`)
            .limit(5),
          supabase.from("shop_auths").select("id,shop_name,platform,status")
            .or(`shop_name.ilike.${safe},platform.ilike.${safe}`)
            .limit(5),
        ]);
        if (seq !== seqRef.current) return; // 过期响应丢弃
        setOrders((o.data ?? []) as OrderHit[]);
        setProducts((p.data ?? []) as ProductHit[]);
        setShops((s.data ?? []) as ShopHit[]);
      } catch {
        if (seq === seqRef.current) { setOrders([]); setProducts([]); setShops([]); }
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, open]);

  // 候选列表：静态导航 + 库数据
  const items = useMemo<CmdItem[]>(() => {
    const out: CmdItem[] = [];
    const q = query.trim().toLowerCase();
    const navs = NAV_ITEMS.filter((n) => {
      if (!q) return true;
      const label = t(n.labelKey).toLowerCase();
      return label.includes(q) || n.path.toLowerCase().includes(q);
    });
    // 空查询只展示常用入口，避免长清单淹没
    const navList = q ? navs.slice(0, 6) : navs.slice(0, 8);
    for (const n of navList) out.push({ kind: "nav", key: `nav:${n.path}:${n.labelKey}`, label: t(n.labelKey), path: n.path });
    for (const o of orders) out.push({ kind: "order", key: `order:${o.id}`, hit: o });
    for (const p of products) out.push({ kind: "product", key: `product:${p.id}`, hit: p });
    for (const s of shops) out.push({ kind: "shop", key: `shop:${s.id}`, hit: s });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, orders, products, shops, t]);

  useEffect(() => { setActive((i) => Math.min(i, Math.max(0, items.length - 1))); }, [items.length]);

  const go = useCallback((item: CmdItem) => {
    onOpenChange(false);
    if (item.kind === "nav") navigate({ to: item.path as never });
    else if (item.kind === "order") navigate({ to: `/orders/${encodeURIComponent(item.hit.id)}` as never });
    else if (item.kind === "product") navigate({ to: `/products/${encodeURIComponent(item.hit.id)}` as never });
    else if (item.kind === "shop") navigate({ to: "/auth" as never });
  }, [navigate, onOpenChange]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % Math.max(1, items.length)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + Math.max(1, items.length)) % Math.max(1, items.length)); }
    else if (e.key === "Enter") { e.preventDefault(); const it = items[active]; if (it) go(it); }
  };

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
  const hotkey = isMac ? "⌘K" : "Ctrl K";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[18%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0" onKeyDown={onKeyDown}>
        <DialogTitle className="sr-only">{t("cmdk.title")}</DialogTitle>
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search size={16} className="shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            placeholder={t("cmdk.placeholder")}
            className="h-12 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-placeholder"
          />
          {loading && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
          <kbd className="rounded border border-border bg-surface-sunken px-1.5 py-0.5 font-data text-[10px] text-fg-subtle">{hotkey}</kbd>
        </div>
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-1.5">
          {items.length === 0 && (
            <div className="px-3 py-10 text-center text-sm text-muted-foreground">
              {query.trim() ? t("cmdk.noResult") : t("cmdk.hint")}
            </div>
          )}
          {items.map((it, idx) => {
            const on = idx === active;
            return (
              <button
                key={it.key}
                data-idx={idx}
                onMouseMove={() => setActive(idx)}
                onClick={() => go(it)}
                className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors ${on ? "bg-brand-subtle text-brand" : "text-fg hover:bg-surface-hover"}`}
              >
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${on ? "bg-brand-subtle text-brand" : "bg-surface-sunken text-fg-muted"}`}>
                  {it.kind === "nav" ? <LayoutDashboard size={14} /> : it.kind === "order" ? <ShoppingBag size={14} /> : it.kind === "product" ? <Package size={14} /> : <Store size={14} />}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {it.kind === "nav" ? (
                    <>
                      <span className="font-medium">{it.label}</span>
                      <span className="ml-2 font-data text-[11px] text-muted-foreground">{it.path}</span>
                    </>
                  ) : it.kind === "order" ? (
                    <>
                      <span className="font-data font-medium">{it.hit.id}</span>
                      <span className="ml-2 truncate text-[12px] text-muted-foreground">{it.hit.product || it.hit.buyer || "—"}</span>
                    </>
                  ) : it.kind === "product" ? (
                    <>
                      <span className="font-medium">{it.hit.name}</span>
                      <span className="ml-2 font-data text-[11px] text-muted-foreground">{it.hit.sku}</span>
                    </>
                  ) : (
                    <>
                      <span className="font-medium">{it.hit.shop_name}</span>
                      <span className="ml-2 text-[12px] text-muted-foreground">{it.hit.platform}</span>
                    </>
                  )}
                </span>
                {it.kind === "order" && (
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="font-data text-[12px] text-muted-foreground">{it.hit.currency === "USD" ? "$" : "¥"}{Number(it.hit.amount ?? 0).toFixed(2)}</span>
                    <StatusBadge status={it.hit.status} />
                  </span>
                )}
                {it.kind === "product" && (
                  <span className="font-data shrink-0 text-[12px] text-muted-foreground">${Number(it.hit.price ?? 0).toFixed(2)}</span>
                )}
                {on && <CornerDownLeft size={13} className="shrink-0 text-muted-foreground" />}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><kbd className="rounded border border-border bg-muted px-1">↑</kbd><kbd className="rounded border border-border bg-muted px-1">↓</kbd>{t("cmdk.navigate")}</span>
          <span className="flex items-center gap-1"><kbd className="rounded border border-border bg-muted px-1">↵</kbd>{t("cmdk.open")}</span>
          <span className="flex items-center gap-1"><kbd className="rounded border border-border bg-muted px-1">Esc</kbd>{t("cmdk.close")}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
