import { useState } from "react";
import { cn } from "@/lib/utils";

// ─── 平台 logo ────────────────────────────────────────────────────────────────
// 全部为站内静态资源（/platform-logos/*，随前端产物一起发布），不在运行时引第三方图床：
// 卖家侧网络对 Google / 各类 logo CDN 不稳定，外链会直接变成一排裂图。
// 抓取与更新方式见 ops/scripts/fetch-platform-logos.py + gen-platform-logo-map.py
export const PLATFORM_LOGOS: Record<string, string> = {
  "1688": "/platform-logos/1688.ico",
  "Alibaba 国际站": "/platform-logos/alibaba-com.png",
  "AliExpress": "/platform-logos/aliexpress.svg",
  "Allegro": "/platform-logos/allegro.svg",
  "AllValue": "/platform-logos/allvalue.ico",
  "Amazon": "/platform-logos/amazon.svg",
  "B2W Americanas": "/platform-logos/b2w-americanas.ico",
  "BigCommerce": "/platform-logos/bigcommerce.svg",
  "Cdiscount": "/platform-logos/cdiscount.ico",
  "Coupang": "/platform-logos/coupang.svg",
  "Daraz": "/platform-logos/daraz.png",
  "eBay": "/platform-logos/ebay.svg",
  "eMAG": "/platform-logos/emag.png",
  "Etsy": "/platform-logos/etsy.svg",
  "Fnac": "/platform-logos/fnac.svg",
  "Joom": "/platform-logos/joom.jpg",
  "Jumia": "/platform-logos/jumia.png",
  "Kaufland": "/platform-logos/kaufland.svg",
  "Lazada": "/platform-logos/lazada.png",
  "Magento": "/platform-logos/magento.svg",
  "Mercado Libre": "/platform-logos/mercadolibre.ico",
  "Miravia": "/platform-logos/miravia.ico",
  "Noon": "/platform-logos/noon.png",
  "OnBuy": "/platform-logos/onbuy.ico",
  "OTTO": "/platform-logos/otto.svg",
  "Ozon": "/platform-logos/ozon.png",
  "PrestaShop": "/platform-logos/prestashop.svg",
  "Rakuten": "/platform-logos/rakuten.svg",
  "Salla": "/platform-logos/salla.png",
  "SHEIN": "/platform-logos/shein.svg",
  "ShopBase": "/platform-logos/shopbase.png",
  "Shopee": "/platform-logos/shopee.svg",
  "Shopify": "/platform-logos/shopify.svg",
  "Shopline": "/platform-logos/shopline.png",
  "Temu": "/platform-logos/temu.ico",
  "Tiki": "/platform-logos/tiki.png",
  "TikTok Shop": "/platform-logos/tiktok.svg",
  "UEESHOP": "/platform-logos/ueeshop.ico",
  "Voghion": "/platform-logos/voghion.ico",
  "Walmart": "/platform-logos/walmart.png",
  "Wayfair": "/platform-logos/wayfair.ico",
  "Wildberries": "/platform-logos/wildberries.ico",
  "Wish": "/platform-logos/wish.svg",
  "Wix": "/platform-logos/wix.svg",
  "WooCommerce": "/platform-logos/woocommerce.svg",
  "Yandex Market": "/platform-logos/yandex-market.ico",
  "Zalando": "/platform-logos/zalando.svg",
  "京东印尼": "/platform-logos/jd-id.ico",
  "京东国际": "/platform-logos/jd-com.ico",
  "店匠 Shoplazza": "/platform-logos/shoplazza.ico",
  "敦煌网 DHgate": "/platform-logos/dhgate.jpg",
  "淘宝": "/platform-logos/taobao.svg",
  "Amazon US": "/platform-logos/amazon.svg",
  "Amazon JP": "/platform-logos/amazon.svg",
  "Amazon EU": "/platform-logos/amazon.svg",
  "Amazon CA": "/platform-logos/amazon.svg",
  "Amazon AU": "/platform-logos/amazon.svg",
};

// 无 logo 时的兜底视觉：名称首字母 + 按名称哈希出的稳定渐变色
const platformStyle: Record<string, { letter: string; color: string }> = {
  Shopify: { letter: "S", color: "from-emerald-500 to-teal-400" },
  "TikTok Shop": { letter: "T", color: "from-slate-700 to-slate-900" },
  Lazada: { letter: "L", color: "from-[#4E5969] to-[#4E5969]" },
  Shopee: { letter: "S", color: "from-orange-500 to-amber-400" },
  "Amazon US": { letter: "A", color: "from-amber-500 to-orange-400" },
  "Amazon JP": { letter: "A", color: "from-amber-500 to-orange-400" },
  "Amazon EU": { letter: "A", color: "from-amber-500 to-orange-400" },
  "Amazon CA": { letter: "A", color: "from-amber-500 to-orange-400" },
  "Amazon AU": { letter: "A", color: "from-amber-500 to-orange-400" },
  eBay: { letter: "e", color: "from-[#4E5969] to-[#4E5969]" },
  Walmart: { letter: "W", color: "from-sky-500 to-blue-500" },
  Etsy: { letter: "E", color: "from-orange-500 to-rose-400" },
  Temu: { letter: "T", color: "from-rose-500 to-pink-500" },
  SHEIN: { letter: "S", color: "from-slate-800 to-slate-950" },
  AliExpress: { letter: "A", color: "from-red-500 to-orange-500" },
  "Mercado Libre": { letter: "M", color: "from-yellow-500 to-amber-600" },
  Coupang: { letter: "C", color: "from-rose-500 to-red-500" },
  Noon: { letter: "N", color: "from-emerald-600 to-teal-500" },
  Ozon: { letter: "O", color: "from-[#4E5969] to-[#4E5969]" },
  Wildberries: { letter: "W", color: "from-slate-600 to-slate-800" },
  WooCommerce: { letter: "W", color: "from-slate-600 to-slate-800" },
  BigCommerce: { letter: "B", color: "from-orange-600 to-amber-500" },
  Magento: { letter: "M", color: "from-orange-500 to-amber-600" },
  PrestaShop: { letter: "P", color: "from-rose-500 to-orange-400" },
  Allegro: { letter: "A", color: "from-orange-400 to-amber-500" },
  Kaufland: { letter: "K", color: "from-red-500 to-rose-600" },
  "Yandex Market": { letter: "Y", color: "from-yellow-400 to-red-500" },
  Wish: { letter: "W", color: "from-teal-400 to-emerald-500" },
  Wix: { letter: "W", color: "from-slate-800 to-slate-950" },
  Daraz: { letter: "D", color: "from-orange-500 to-red-600" },
  Jumia: { letter: "J", color: "from-amber-400 to-orange-600" },
  "1688": { letter: "1", color: "from-orange-500 to-orange-700" },
  "淘宝": { letter: "淘", color: "from-orange-400 to-red-500" },
};

const PALETTE = [
  "from-sky-500 to-blue-500",
  "from-emerald-500 to-teal-400",
  "from-amber-500 to-orange-400",
  "from-rose-500 to-pink-500",
  "from-violet-500 to-purple-500",
  "from-cyan-500 to-sky-400",
  "from-lime-500 to-emerald-500",
  "from-orange-500 to-red-500",
  "from-indigo-500 to-blue-400",
  "from-fuchsia-500 to-pink-400",
  "from-teal-500 to-cyan-400",
  "from-slate-600 to-slate-800",
];

export function styleOf(name: string) {
  const hit = platformStyle[name];
  if (hit) return hit;
  const ch = (name.trim().match(/[A-Za-z]/)?.[0] ?? name.trim().charAt(0) ?? "?").toUpperCase();
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return { letter: ch, color: PALETTE[h % PALETTE.length] };
}

const BOX: Record<string, string> = {
  xs: "h-6 w-6 rounded-md",
  sm: "h-7 w-7 rounded-md",
  md: "h-9 w-9 rounded-lg",
  lg: "h-10 w-10 rounded-lg",
  xl: "h-12 w-12 rounded-xl",
};
const TEXT: Record<string, string> = { xs: "text-[11px]", sm: "text-[12px]", md: "text-[14px]", lg: "text-[16px]", xl: "text-[18px]" };

/** 平台 logo：有官方图标就显示图标（白底小方块，明暗主题都稳），否则退回字母芯片。
 *  logoUrl 优先（后台 platform_configs.logo_url 可覆盖），图片加载失败自动降级，不留裂图。 */
export function PlatformLogo({
  name,
  logoUrl,
  size = "md",
  className,
}: {
  name: string;
  logoUrl?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const src = (logoUrl || PLATFORM_LOGOS[name] || "").trim();
  const st = styleOf(name);
  if (!src || broken) {
    return (
      <span className={cn("flex shrink-0 items-center justify-center bg-gradient-to-br font-bold text-white shadow-soft", BOX[size], TEXT[size], st.color, className)}>
        {st.letter}
      </span>
    );
  }
  return (
    <span className={cn("flex shrink-0 items-center justify-center overflow-hidden border border-black/[0.07] bg-white p-[3px] shadow-soft", BOX[size], className)}>
      <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className="max-h-full max-w-full object-contain" />
    </span>
  );
}
