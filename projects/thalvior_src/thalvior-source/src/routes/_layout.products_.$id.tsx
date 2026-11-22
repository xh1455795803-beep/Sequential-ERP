/**
 * /products/$id — 商品编辑 · 单页长滚动改版
 *
 * 改版要点：
 * 1. 单页长滚动布局（移除 Tab 抽屉切换），所有区块自上而下顺序编辑
 * 2. AI 原位嵌入：标题翻译/文案优化嵌在表单旁，图片翻译/场景图/视频生成嵌在图片区
 * 3. 图片区大图拖拽上传（onDrop 真拖拽 + 点击选择）
 * 4. 补齐跨境字段：合规资质 / 供应链溯源 / 多语言信息 / 批量属性映射
 * 5. 多变体连续添加：保存后表单保持打开，可连续添加多组
 * 6. 蓝V/认证信息不放在编辑页（店铺侧概念，采集页展示认领店铺）
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft, Save, Send, Loader2, Upload, Trash2,
  Sparkles, Image as ImageIcon, FileText, Languages,
  Video, Star, Package, Tag, Globe, Eye, EyeOff,
  Plus, Minus, ChevronDown, ChevronUp, Copy,
  CheckCircle2, AlertCircle, Info, X, Grid3X3,
  Layers, Settings, ShoppingBag, Ruler, Weight,
  ShieldCheck, Factory, KeyRound, Wand2, Check,
  Store, Building2, RefreshCcw, FileUp, FileDown, AlertTriangle, FileCheck2, Clock, Rocket, Calculator,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PublishListingDialog } from "@/components/publish-listing-dialog";
import { AiTranslateDialog } from "@/components/ai-translate-dialog";
import { AiListingPanel } from "@/components/ai-listing-panel";
import type { ListingResult } from "@/services/aiListingService";
import { PriceCalcDialog } from "@/components/price-calc-dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import {
  requestLLMStream,
  requestVisionStream,
  generateImage, extractImageUrl,
  translateImage, TRANSLATE_TARGET_LANGS,
  getQuotaBalance,
  getActiveBenefits,
  type BenefitRow,
} from "@/services/aiService";
import {
  fetchProducts,
  fetchTable,
  fetchShops,
  fetchShopListingRules,
  updateRow,
  insertRow,
  deleteRow,
  type ProductRow,
  type ShopRow,
  type ShopListingRuleRow,
} from "@/lib/data-access";
import { supabase, supabaseUrl, projectUrlId } from "@/supabase/client";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAuth } from "@/lib/auth";
import { tt } from "@/i18n/tts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";


// storage bucket：本部署名称解析失效，读写必须用 UUID
const STORAGE_BUCKET_ID = "d1439de1-7fc8-470b-93ba-152887a05385";
export const Route = createFileRoute("/_layout/products_/$id")({
  component: ProductEdit,
});

const CERT_PRESETS = ["CE", "FCC", "RoHS", "UL", "CCC", "UKCA", "PSE", "KC", "TELEC", "MSDS", "UN38.3"];
const LANG_LABEL: Record<string, string> = { en: "pd.lang.en", ja: "pd.lang.ja", ko: "pd.lang.ko", es: "pd.lang.es", fr: "pd.lang.fr", de: "pd.lang.de", pt: "pd.lang.pt", ru: "pd.lang.ru", th: "pd.lang.th", vi: "pd.lang.vi", "zh-TW": "pd.lang.zhTW", ar: "pd.lang.ar", id: "pd.lang.id" };
// 变体轴名 zh → i18n key（EN 模式轴名翻译用；未收录轴名诚实显示原文）
const AXIS_LABEL: Record<string, string> = {
  "颜色": "variant.axis.color", "颜色分类": "variant.axis.color2", "色号": "variant.axis.color3",
  "尺码": "variant.axis.size", "尺寸": "variant.axis.size2", "规格": "variant.axis.spec",
  "材质": "variant.axis.material", "风格": "variant.axis.style", "款式": "variant.axis.model",
  "型号": "variant.axis.model2", "容量": "variant.axis.capacity", "图案": "variant.axis.pattern",
  "花色": "variant.axis.pattern2", "重量": "variant.axis.weight", "功率": "variant.axis.power",
  "电压": "variant.axis.voltage", "口味": "variant.axis.flavor", "香型": "variant.axis.scent",
  "数量": "variant.axis.qty", "包装": "variant.axis.pack", "版本": "variant.axis.version",
  "长度": "variant.axis.length", "宽度": "variant.axis.width", "高度": "variant.axis.height",
  "套装": "variant.axis.bundle",
};
// EN 模式变体属性展示：解析 "轴:值;轴:值"，轴名查 AXIS_LABEL（未命中诚实原文），值不翻译
function variantAttrsDisp(attrs: string, lang: string, t: (k: string) => string): string {
  if (lang !== "en" || !attrs) return attrs;
  return attrs
    .split(/[;；]/)
    .map((seg) => {
      const m = seg.match(/^\s*([^:：]+)([:：].*)?$/);
      if (!m) return seg;
      const label = m[1].trim();
      const key = AXIS_LABEL[label];
      const shown = key ? t(key) : label;
      return m[2] ? shown + ":" + m[2].replace(/^[::]\s*/, " ") : shown;
    })
    .join("; ");
}

// 站点专属字段定义（统一刊登编辑页 · 由店铺规则控制显隐/必填）
// key 与 shop_listing_rules.fields 一一对应
const SITE_FIELDS: { key: string; label: string; hint: string }[] = [
  { key: "site_title", label: "pd.site.site_title", hint: "pd.site.site_title_hint" },
  { key: "site_bullets", label: "pd.site.site_bullets", hint: "pd.site.site_bullets_hint" },
  { key: "site_description", label: "pd.site.site_description", hint: "pd.site.site_description_hint" },
  { key: "site_price", label: "pd.site.site_price", hint: "pd.site.site_price_hint" },
  { key: "site_stock", label: "pd.site.site_stock", hint: "pd.site.site_stock_hint" },
  { key: "fulfill_time", label: "pd.site.fulfill_time", hint: "pd.site.fulfill_time_hint" },
  { key: "shipping_template", label: "pd.site.shipping_template", hint: "pd.site.shipping_template_hint" },
  { key: "ean", label: "pd.site.ean", hint: "pd.site.ean_hint" },
  { key: "ptc", label: "pd.site.ptc", hint: "pd.site.ptc_hint" },
  { key: "manufacturer", label: "pd.site.manufacturer", hint: "pd.site.manufacturer_hint" },
  { key: "eu_responsible", label: "pd.site.eu_responsible", hint: "pd.site.eu_responsible_hint" },
  { key: "eu_doc", label: "pd.upl.eu_doc", hint: "pd.site.eu_doc_hint" },
  { key: "ce_declaration", label: "pd.upl.ce_declaration", hint: "pd.site.ce_declaration_hint" },
  { key: "ce_report", label: "pd.upl.ce_report", hint: "pd.site.ce_report_hint" },
  { key: "label_image", label: "pd.upl.label_image", hint: "pd.site.label_image_hint" },
  { key: "warning_lang", label: "pd.site.warning_lang", hint: "pd.site.warning_lang_hint" },
];

// 文件上传项（存 uploads 规则）
const SITE_UPLOADS: { key: string; label: string; hint: string }[] = [
  { key: "cert_file", label: "pd.upl.cert_file", hint: "pd.upl.cert_file_hint" },
  { key: "eu_doc", label: "pd.upl.eu_doc", hint: "pd.upl.eu_doc_hint" },
  { key: "ce_declaration", label: "pd.upl.ce_declaration", hint: "pd.upl.ce_declaration_hint" },
  { key: "ce_report", label: "pd.upl.ce_report", hint: "pd.upl.ce_report_hint" },
  { key: "label_image", label: "pd.upl.label_image", hint: "pd.upl.label_image_hint" },
];

function ProductEdit() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { t, lang } = useLanguage();
  const { user, status: authStatus } = useAuth();

  const isNew = id === "new";
  const isNewRef = useRef(isNew);
  if (isNew !== isNewRef.current) isNewRef.current = isNew;

  // 刊登发布引擎（P0-1）：真实发布到已授权 WooCommerce 店铺
  const [publishOpen, setPublishOpen] = useState(false);
  // P0-2：AI 产品翻译 + 一键算价
  const [translateOpen, setTranslateOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);


  /* ── 状态 ── */
  const [product, setProduct] = useState<ProductRow | null>(null);
  const [variants, setVariants] = useState<any[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [balance, setBalance] = useState(999);

  // 表单字段
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [stock, setStock] = useState("");
  const [status, setStatus] = useState("draft");
  const [images, setImages] = useState<string[]>([]);
  const [imagesBackup, setImagesBackup] = useState<(string | null)[]>([]);
  const [mtMenuIdx, setMtMenuIdx] = useState<number | null>(null);
  const [mtBusyIdx, setMtBusyIdx] = useState<number | null>(null);

  // AI 图片翻译：翻完直接覆盖该图位（原图备份可恢复），即时落库
  const translateProductImage = async (idx: number, lang: string) => {
    if (mtBusyIdx !== null) return;
    const srcUrl = images[idx];
    if (!srcUrl) return;
    setMtBusyIdx(idx);
    setMtMenuIdx(null);
    try {
      const newUrl = await translateImage(srcUrl, lang);
      const next = images.slice();
      next[idx] = newUrl;
      const nextBackup = imagesBackup.slice();
      while (nextBackup.length < images.length) nextBackup.push(null);
      nextBackup[idx] = srcUrl;
      setImages(next);
      setImagesBackup(nextBackup);
      const { error } = await supabase.from("products").update({
        images: next,
        primary_image: next[primaryImage] ?? null,
        images_backup: nextBackup,
      }).eq("id", id);
      if (error) throw error;
      toast.success(t("pd.imgTranslatedOverwritten", { n: idx + 1 }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("pd.translateFailed"));
    } finally {
      setMtBusyIdx(null);
    }
  };

  const restoreProductImage = async (idx: number) => {
    const backup = imagesBackup[idx];
    if (!backup) return;
    const next = images.slice();
    next[idx] = backup;
    const nextBackup = imagesBackup.slice();
    nextBackup[idx] = null;
    setImages(next);
    setImagesBackup(nextBackup);
    const { error } = await supabase.from("products").update({
      images: next,
      primary_image: next[primaryImage] ?? null,
      images_backup: nextBackup,
    }).eq("id", id);
    if (error) { toast.error(t("pd.restoreFailed")); return; }
    toast.success(t("pd.restored"));
  };
  const [primaryImage, setPrimaryImage] = useState(0);
  // 高级字段
  const [seoTitle, setSeoTitle] = useState("");
  const [seoKeywords, setSeoKeywords] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [weight, setWeight] = useState("");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [shippingFee, setShippingFee] = useState("");
  const [freeShipping, setFreeShipping] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [sourcePlatform, setSourcePlatform] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [collecting, setCollecting] = useState(false);

  // 变体规格组合
  const [specGroups, setSpecGroups] = useState<{ name: string; values: string[] }[]>([]);
  const [specName, setSpecName] = useState("");
  const [specValues, setSpecValues] = useState("");
  const [pendingVariants, setPendingVariants] = useState<{ sku: string; attrs: string; price: string; stock: string }[]>([]);
  const [savingVariants, setSavingVariants] = useState(false);

  // 跨境字段
  const [certifications, setCertifications] = useState<string[]>([]);
  const [certInput, setCertInput] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [originCountry, setOriginCountry] = useState("");
  const [hsCode, setHsCode] = useState("");
  const [factoryCert, setFactoryCert] = useState("");
  const [multilingual, setMultilingual] = useState<{ lang: string; title: string; description: string }[]>([]);
  const [mlLang, setMlLang] = useState("en");
  const [mlTitle, setMlTitle] = useState("");
  const [mlDesc, setMlDesc] = useState("");
  const [attrPairs, setAttrPairs] = useState<{ name: string; value: string }[]>([]);
  const [attrName, setAttrName] = useState("");
  const [attrValue, setAttrValue] = useState("");

  // AI 工具状态
  const [aiStreaming, setAiStreaming] = useState(false);
  const [aiTarget, setAiTarget] = useState<string | null>(null);
  const [aiPartial, setAiPartial] = useState("");
  const [aiCopying, setAiCopying] = useState(false);
  const [aiVisionCopying, setAiVisionCopying] = useState(false);
  const [aiImageGen, setAiImageGen] = useState<string | null>(null);
  const [videoGen, setVideoGen] = useState<string | null>(null);
  const [translationTargetLang, setTranslationTargetLang] = useState("en");
  const [translateTitleLang, setTranslateTitleLang] = useState("en");
  const [titleTranslating, setTitleTranslating] = useState(false);
  const [copyOptimizeResult, setCopyOptimizeResult] = useState("");
  const [titleFreeBenefit, setTitleFreeBenefit] = useState<BenefitRow | null>(null);
  const [sceneGenPrompt, setSceneGenPrompt] = useState("");
  const aiPartialRef = useRef("");

  // 变体编辑
  const [showVariantForm, setShowVariantForm] = useState(false);
  const [editingVariantIdx, setEditingVariantIdx] = useState<number | null>(null);
  const [variantSku, setVariantSku] = useState("");
  const [variantAttrs, setVariantAttrs] = useState("");
  const [variantPrice, setVariantPrice] = useState("");
  const [variantStock, setVariantStock] = useState("");

  // 图片拖拽
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── 店铺与站点刊登（统一刊登编辑页） ── */
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [listingRules, setListingRules] = useState<ShopListingRuleRow[]>([]);
  const [selectedShopId, setSelectedShopId] = useState<string>("");
  // 站点专属字段
  const [siteTitle, setSiteTitle] = useState("");
  const [siteBullets, setSiteBullets] = useState("");
  const [siteDescription, setSiteDescription] = useState("");
  const [sitePrice, setSitePrice] = useState("");
  const [siteStock, setSiteStock] = useState("");
  const [fulfillTime, setFulfillTime] = useState("");
  const [shippingTemplate, setShippingTemplate] = useState("");
  const [eanMap, setEanMap] = useState<Record<string, string>>({});
  const [ptc, setPtc] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [euResponsible, setEuResponsible] = useState("");
  const [euDocUrl, setEuDocUrl] = useState("");
  const [ceDeclarationUrl, setCeDeclarationUrl] = useState("");
  const [ceReportUrl, setCeReportUrl] = useState("");
  const [labelImageUrl, setLabelImageUrl] = useState("");
  const [warningLang, setWarningLang] = useState("");
  const [certFileUrl, setCertFileUrl] = useState("");
  const [uploadingSiteFile, setUploadingSiteFile] = useState(false);
  // 切换店铺确认
  const [switchConfirmOpen, setSwitchConfirmOpen] = useState(false);
  const [pendingShopId, setPendingShopId] = useState("");
  // 同步基础库
  const [syncingFromBase, setSyncingFromBase] = useState(false);

  /* ── 加载商品 ── */
  const loadProduct = useCallback(async () => {
    if (isNewRef.current) { setLoading(false); return; }
    setLoading(true);
    try {
      const all = await fetchProducts();
      const p = all.find((x) => x.id === id);
      if (p) {
        setProduct(p);
        setName(p.name ?? "");
        setDescription(p.description ?? "");
        setCategory(p.category ?? "");
        setSku(p.sku ?? "");
        setPrice(p.price != null ? String(p.price) : "");
        setCost((p as any).cost != null ? String((p as any).cost) : "");
        setStock(p.stock != null ? String(p.stock) : "");
        setStatus(p.status ?? "draft");
        setSourcePlatform((p as any).source_platform ?? "");
        setSourceUrl((p as any).source_url ?? "");
        const imgs = Array.isArray((p as any).images) ? (p as any).images : [];
        setImages(imgs);
        setImagesBackup(Array.isArray((p as any).images_backup) ? (p as any).images_backup : []);
        setPrimaryImage((p as any).primary_image != null ? imgs.indexOf((p as any).primary_image as string) : 0);
        const extras = (p as any).extras ?? {};
        setSeoTitle(extras.seo_title ?? "");
        setSeoKeywords(extras.seo_keywords ?? "");
        setSeoDescription(extras.seo_description ?? "");
        setWeight(extras.weight ?? "");
        setLength(extras.length ?? "");
        setWidth(extras.width ?? "");
        setHeight(extras.height ?? "");
        setShippingFee(extras.shipping_fee != null ? String(extras.shipping_fee) : "");
        setFreeShipping(extras.free_shipping === true);
        setTags(Array.isArray(extras.tags) ? extras.tags : []);
        setCertifications(Array.isArray(extras.certifications) ? extras.certifications : []);
        const sc = extras.supply_chain ?? {};
        setSupplierName(sc.supplier_name ?? "");
        setOriginCountry(sc.origin_country ?? "");
        setHsCode(sc.hs_code ?? "");
        setFactoryCert(sc.factory_cert ?? "");
        setMultilingual(Array.isArray(extras.multilingual) ? extras.multilingual : []);
        setAttrPairs(Array.isArray(extras.attributes) ? extras.attributes : []);
        // 站点刊登（统一刊登编辑页）
        setSelectedShopId(p.shop_id ?? "");
        const site = extras.site ?? {};
        setSiteTitle(site.site_title ?? "");
        setSiteBullets(site.site_bullets ?? "");
        setSiteDescription(site.site_description ?? "");
        setSitePrice(site.site_price != null ? String(site.site_price) : "");
        setSiteStock(site.site_stock != null ? String(site.site_stock) : "");
        setFulfillTime(site.fulfill_time ?? "");
        setShippingTemplate(site.shipping_template ?? "");
        setPtc(site.ptc ?? "");
        setManufacturer(site.manufacturer ?? "");
        setEuResponsible(site.eu_responsible ?? "");
        setEuDocUrl(site.eu_doc ?? "");
        setCeDeclarationUrl(site.ce_declaration ?? "");
        setCeReportUrl(site.ce_report ?? "");
        setLabelImageUrl(site.label_image ?? "");
        setWarningLang(site.warning_lang ?? "");
        setCertFileUrl(site.cert_file ?? "");
        setEanMap(extras.ean_map && typeof extras.ean_map === "object" ? (extras.ean_map as Record<string, string>) : {});
      }
      const vs = await fetchTable("product_variants");
      setVariants(vs.filter((v: any) => v.product_id === id));
    } catch (e) { /* 变体表查询失败静默 */ }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { void loadProduct(); }, [loadProduct]);
  useEffect(() => { void getQuotaBalance().then(setBalance).catch(() => {}); }, []);
  // 加载店铺列表与店铺刊登规则
  useEffect(() => {
    fetchShops().then(setShops).catch(() => {});
    fetchShopListingRules().then(setListingRules).catch(() => {});
    // 活动权益：AI 生成标题 60 天免费
    getActiveBenefits()
      .then((bs) => {
        const b = bs.find((x) => x.benefit_key === "title_free");
        setTitleFreeBenefit(b ?? null);
      })
      .catch(() => {});
  }, []);

  /* ── 保存 ── */
  const handleSave = async (publish = false) => {
    if (!user) { toast.error(t("pd.loginRequired")); return; }
    if (!name.trim()) { toast.error(t("pd.nameRequired")); return; }
    // 发布前按当前店铺规则校验（公共 + 规则必填）
    if (publish) {
      const failed = publishChecks.filter((c) => !c.pass);
      if (failed.length > 0) {
        const firstFailed = failed[0];
        const findErr = (label: string): string => {
          const fk = SITE_FIELDS.find((f) => f.label === label)?.key;
          if (fk) return siteFieldErrorText(fk);
          const uk = SITE_UPLOADS.find((u) => u.label === label)?.key;
          if (uk) return uploadErrorText(uk);
          return "";
        };
        const ruleErr = currentRule && selectedShopId ? findErr(firstFailed.label) : "";
        toast.error(ruleErr || t("pd.checkFailed", { item: t(firstFailed.label), extra: firstFailed.label === "pd.check.desc" ? t("pd.check.descExtra") : "" }));
        document.getElementById("publish-check")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
    setSaving(true);
    try {
      const extras: Record<string, unknown> = {};
      if (seoTitle) extras.seo_title = seoTitle;
      if (seoKeywords) extras.seo_keywords = seoKeywords;
      if (seoDescription) extras.seo_description = seoDescription;
      if (weight) extras.weight = weight;
      if (length) extras.length = length;
      if (width) extras.width = width;
      if (height) extras.height = height;
      if (shippingFee) extras.shipping_fee = shippingFee;
      extras.free_shipping = freeShipping;
      if (tags.length) extras.tags = tags;
      if (certifications.length) extras.certifications = certifications;
      const sc: Record<string, string> = {};
      if (supplierName) sc.supplier_name = supplierName;
      if (originCountry) sc.origin_country = originCountry;
      if (hsCode) sc.hs_code = hsCode;
      if (factoryCert) sc.factory_cert = factoryCert;
      if (Object.keys(sc).length) extras.supply_chain = sc;
      if (multilingual.length) extras.multilingual = multilingual;
      if (attrPairs.length) extras.attributes = attrPairs;
      // 站点刊登内容（统一刊登编辑页 · 随店铺规则保存）
      if (selectedShopId) {
        const site: Record<string, unknown> = {};
        if (siteTitle) site.site_title = siteTitle;
        if (siteBullets) site.site_bullets = siteBullets;
        if (siteDescription) site.site_description = siteDescription;
        if (sitePrice) site.site_price = Number(sitePrice);
        if (siteStock) site.site_stock = Number(siteStock);
        if (fulfillTime) site.fulfill_time = fulfillTime;
        if (shippingTemplate) site.shipping_template = shippingTemplate;
        if (ptc) site.ptc = ptc;
        if (manufacturer) site.manufacturer = manufacturer;
        if (euResponsible) site.eu_responsible = euResponsible;
        if (euDocUrl) site.eu_doc = euDocUrl;
        if (ceDeclarationUrl) site.ce_declaration = ceDeclarationUrl;
        if (ceReportUrl) site.ce_report = ceReportUrl;
        if (labelImageUrl) site.label_image = labelImageUrl;
        if (warningLang) site.warning_lang = warningLang;
        if (certFileUrl) site.cert_file = certFileUrl;
        if (Object.keys(site).length) extras.site = site;
        if (Object.keys(eanMap).length) extras.ean_map = eanMap;
      } else {
        // 取消绑定店铺时移除站点内容（不残留）
        delete (extras as any).site;
        delete (extras as any).ean_map;
      }
      const oldExtras = ((product as any)?.extras ?? {}) as Record<string, unknown>;
      if (oldExtras.source_product_id) extras.source_product_id = oldExtras.source_product_id;

      const patch: Record<string, unknown> = {
        name: name.trim(), description, category, sku,
        price: price ? Number(price) : null,
        cost: cost ? Number(cost) : null,
        stock: stock ? Number(stock) : null,
        status: publish ? "published" : status,
        images, primary_image: images[primaryImage] ?? null,
        images_backup: imagesBackup,
        source_platform: sourcePlatform, source_url: sourceUrl,
        shop_id: selectedShopId || null,
        extras,
      };
      let savedId: string = id;
      if (isNewRef.current) {
        const now = new Date().toISOString();
        savedId = await insertRow("products", { ...patch, created_at: now, updated_at: now });
        toast.success(t("pd.created"));
      } else {
        patch.updated_at = new Date().toISOString();
        await updateRow("products", id, patch);
        toast.success(publish ? t("pd.published") : t("common.saved"));
      }
      // 待保存变体随商品一并落库（新建商品此时才有真实 product_id，避免 product_id='new' 被外键/CHECK 拒绝）
      if (pendingVariants.length) {
        try {
          const { added, updated } = await persistPendingVariants(savedId);
          setPendingVariants([]);
          setSpecGroups([]);
          toast.success(t("pd.variantsSavedWithProduct", { added, updated: updated ? t("pd.variantsUpdatedSuffix", { n: updated }) : "" }));
        } catch (ve) {
          toast.error(t("pd.variantWriteFail", { msg: ve instanceof Error ? ve.message : t("common.unknownError") }));
        }
      }
      if (isNewRef.current) {
        // 跳转到真实商品页，后续编辑（含继续添加变体）均正常落库
        navigate({ to: "/products/$id", params: { id: savedId } });
      } else {
        await loadProduct();
      }
    } catch (e) { toast.error(t("pd.saveFail", { msg: e instanceof Error ? e.message : t("common.unknownError") })); }
    finally { setSaving(false); }
  };

  /* ── 图片上传（点击 + 拖拽共用） ── */
  const uploadFiles = async (files: File[]) => {
    if (!files.length) return;
    for (const file of files) {
      if (!file.type.startsWith("image/")) { toast.error(t("pd.notImage", { name: file.name })); continue; }
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from(STORAGE_BUCKET_ID).upload(path, file, { upsertReply: false } as any);
      if (error) { toast.error(t("pd.uploadFail", { msg: error.message })); continue; }
      const { data: urlData } = supabase.storage.from(STORAGE_BUCKET_ID).getPublicUrl(path);
      setImages((prev) => [...prev, urlData.publicUrl]);
      toast.success(t("pd.imgUploaded"));
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    await uploadFiles(files);
  };

  const handleImageDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    await uploadFiles(files);
  };

  const removeImage = (idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
    if (primaryImage >= idx) setPrimaryImage(Math.max(0, primaryImage - 1));
  };

  /* ── 标签 ── */
  const addTag = () => {
    const val = tagInput.trim();
    if (val && !tags.includes(val)) { setTags([...tags, val]); setTagInput(""); }
  };

  /* ── 合规资质 ── */
  const addCert = (val: string) => {
    const v = val.trim().toUpperCase();
    if (v && !certifications.includes(v)) { setCertifications([...certifications, v]); setCertInput(""); }
  };

  /* ── 多语言信息 ── */
  const addMultilingual = () => {
    if (!mlTitle.trim()) { toast.error(t("pd.mlTitleRequired")); return; }
    setMultilingual((prev) => [...prev.filter((m) => m.lang !== mlLang), { lang: mlLang, title: mlTitle.trim(), description: mlDesc.trim() }]);
    setMlTitle(""); setMlDesc("");
    toast.success(t("pd.mlAdded", { lang: LANG_LABEL[mlLang] ? t(LANG_LABEL[mlLang]) : mlLang }));
  };

  /* ── 批量属性映射 ── */
  const addAttrPair = () => {
    if (!attrName.trim()) { toast.error(t("pd.attrNameRequired")); return; }
    setAttrPairs((prev) => [...prev, { name: attrName.trim(), value: attrValue.trim() }]);
    setAttrName(""); setAttrValue("");
  };

  /* ── 变体 ── */
  const resetVariantFields = () => {
    setVariantSku(""); setVariantAttrs(""); setVariantPrice(""); setVariantStock("");
    setEditingVariantIdx(null);
  };
  const resetVariantForm = () => {
    resetVariantFields();
    setShowVariantForm(false);
  };

  const handleEditVariant = (idx: number) => {
    const v = variants[idx];
    setVariantSku(v.sku ?? ""); setVariantAttrs(v.attributes ?? "");
    setVariantPrice(v.price != null ? String(v.price) : "");
    setVariantStock(v.stock != null ? String(v.stock) : "");
    setEditingVariantIdx(idx); setShowVariantForm(true);
  };

  // 单条变体保存
  // - 新商品（尚未创建，id="new"）：不能写库（外键/CHECK 拒绝 product_id='new'），
  //   只进入本地「待保存」草稿，点页面底部保存商品时随商品一起落库
  // - 已存在商品：直接落库；keepOpen=true 时保存后清空字段、表单保持打开，便于连续录入
  const handleSaveVariant = async (keepOpen: boolean) => {
    const skuV = variantSku.trim();
    const attrsV = variantAttrs.trim();
    if (!skuV) { toast.error(t("pd.variantSkuRequired")); return; }
    if (!attrsV) { toast.error(t("pd.variantAttrsRequired")); return; }
    const item = { sku: skuV, attrs: attrsV, price: variantPrice, stock: variantStock };

    if (isNewRef.current) {
      let merged = false;
      setPendingVariants((prev) => {
        const i = prev.findIndex((p) => p.attrs === item.attrs || p.sku === item.sku);
        if (i >= 0) {
          merged = true;
          const next = [...prev];
          next[i] = { ...item };
          return next;
        }
        return [...prev, item];
      });
      toast.success(merged ? t("pd.pendingUpdated") : keepOpen ? t("pd.pendingAddedContinue") : t("pd.pendingAddedSave"));
      if (keepOpen) { setVariantSku(""); setVariantAttrs(""); setVariantPrice(""); setVariantStock(""); }
      else resetVariantForm();
      return;
    }

    const now = new Date().toISOString();
    const row = {
      product_id: id, sku: item.sku, attributes: item.attrs,
      price: item.price ? Number(item.price) : null,
      stock: item.stock ? Number(item.stock) : null,
      updated_at: now,
    };
    try {
      if (editingVariantIdx !== null) {
        await updateRow("product_variants", variants[editingVariantIdx].id, row);
        toast.success(t("pd.variantUpdated"));
        resetVariantForm();
      } else {
        await insertRow("product_variants", { ...row, created_at: now });
        toast.success(keepOpen ? t("pd.variantAddedContinue") : t("pd.variantAdded"));
        if (keepOpen) { setVariantSku(""); setVariantAttrs(""); setVariantPrice(""); setVariantStock(""); }
        else resetVariantForm();
      }
      await loadProduct();
    } catch (e) { toast.error(t("pd.variantSaveFail", { msg: e instanceof Error ? e.message : t("common.unknownError") })); }
  };

  const handleDeleteVariant = async (idx: number) => {
    try {
      await deleteRow("product_variants", variants[idx].id);
      toast.success(t("pd.variantDeleted")); await loadProduct();
    } catch (e) { toast.error(t("pd.deleteFail", { msg: e instanceof Error ? e.message : t("common.unknownError") })); }
  };

  /* ── 变体：规格组合生成 ── */
  const activeSpecGroups = specGroups.filter((g) => g.name.trim() && g.values.length > 0);
  const comboCount = activeSpecGroups.length ? activeSpecGroups.reduce((acc, g) => acc * g.values.length, 1) : 0;

  const addSpecGroup = () => {
    const name = specName.trim();
    const values = specValues.split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!name) { toast.error(t("pd.specNameRequired")); return; }
    if (!values.length) { toast.error(t("pd.specValuesRequired")); return; }
    if (specGroups.some((g) => g.name === name)) { toast.error(t("pd.specExists", { name })); return; }
    setSpecGroups([...specGroups, { name, values }]);
    setSpecName(""); setSpecValues("");
  };

  const removeSpecGroup = (idx: number) => setSpecGroups(specGroups.filter((_, i) => i !== idx));

  const generateVariants = () => {
    if (!activeSpecGroups.length) { toast.error(t("pd.specGroupRequired")); return; }
    let combos: string[][] = [[]];
    for (const g of activeSpecGroups) {
      const next: string[][] = [];
      for (const a of combos) for (const v of g.values) next.push([...a, `${g.name.trim()}:${v}`]);
      combos = next;
    }
    const base = sku.trim() || "V";
    const defaultPrice = price ? String(price) : "";
    const defaultStock = stock ? String(stock) : "";
    // 与已有待保存草稿合并：同属性组合不重复生成，保留用户已改过的 SKU/价格/库存
    setPendingVariants((prev) => {
      const next = [...prev];
      combos.forEach((combo, i) => {
        const attrs = combo.join(" / ");
        if (next.some((p) => p.attrs === attrs)) return;
        let seq = i + 1;
        let skuName = `${base}-${seq}`;
        while (next.some((p) => p.sku === skuName)) { seq++; skuName = `${base}-${seq}`; }
        next.push({ sku: skuName, attrs, price: defaultPrice, stock: defaultStock });
      });
      return next;
    });
    toast.success(t("pd.combosGenerated", { n: combos.length }));
  };

  const removePending = (idx: number) => setPendingVariants(pendingVariants.filter((_, i) => i !== idx));

  // 把待保存变体批量落库到指定商品（新建商品必须在拿到真实 id 之后调用）
  const persistPendingVariants = async (productId: string) => {
    const now = new Date().toISOString();
    const existing = productId === id ? [...variants] : [];
    let added = 0, updated = 0;
    for (const pv of pendingVariants) {
      const dup = existing.find((v) => String(v.attributes || "") === pv.attrs);
      const row = {
        product_id: productId, sku: pv.sku.trim(),
        attributes: pv.attrs,
        price: pv.price ? Number(pv.price) : null,
        stock: pv.stock ? Number(pv.stock) : null,
      };
      if (dup) { await updateRow("product_variants", dup.id, row); updated++; }
      else { await insertRow("product_variants", { ...row, created_at: now }); added++; }
    }
    return { added, updated };
  };

  // 已存在商品页：把待保存组合直接落库（新商品页不显示此按钮，变体随商品主表单一并保存）
  const saveAllVariants = async () => {
    if (!pendingVariants.length) return;
    setSavingVariants(true);
    try {
      const { added, updated } = await persistPendingVariants(id);
      toast.success(t("pd.variantsSaved", { added, updated }));
      setPendingVariants([]);
      setSpecGroups([]);
      await loadProduct();
    } catch (e) {
      toast.error(t("pd.variantSaveFail", { msg: e instanceof Error ? e.message : t("common.unknownError") }));
    } finally { setSavingVariants(false); }
  };

  /* ── P0-2：已落库的 AI 多语言（products.i18n） ── */
  const aiI18nEntries = useMemo(() => {
    const raw = (product as unknown as { i18n?: Record<string, { name?: string; description?: string }> } | null)?.i18n;
    const out: { lang: string; name?: string; description?: string }[] = [];
    if (raw && typeof raw === "object") {
      Object.entries(raw).forEach(([k, v]) => {
        if (v && typeof v === "object" && (v.name || v.description)) {
          out.push({ lang: k, name: v.name, description: v.description });
        }
      });
    }
    return out;
  }, [product]);

  /* ── AI：标题翻译（原位） ── */
  const handleTranslateTitle = async () => {
    if (!user) { toast.error(t("pd.loginRequired")); return; }
    if (!name.trim()) { toast.error(t("pd.nameRequiredFirst")); return; }
    setTitleTranslating(true);
    try {
      let result = "";
      await requestLLMStream(
        [{ role: "user", content: `Translate the following product title into ${LANG_LABEL[translateTitleLang] ?? translateTitleLang} (${translateTitleLang}). Output ONLY the translated title, no quotes, no extra text.\n\nTitle: ${name}` }],
        (chunk) => { result += chunk; setName(result.trim()); },
        { serviceKey: "title_gen" }
      );
      toast.success(t("pd.titleTranslated", { lang: LANG_LABEL[translateTitleLang] ? t(LANG_LABEL[translateTitleLang]) : translateTitleLang }));
    } catch { toast.error(t("pd.titleTranslateFailed")); }
    finally { setTitleTranslating(false); }
  };

  /* ── AI：图片文字翻译（原位） ── */
  const handleStartTranslateImage = async () => {
    if (!user) { toast.error(t("pd.loginRequired")); return; }
    if (!images.length) { toast.error(t("pd.imagesRequiredFirst")); return; }
    setAiTarget("image-translate"); setAiStreaming(true); setAiPartial(""); aiPartialRef.current = "";
    try {
      const { data: blob } = await supabase.storage.from(STORAGE_BUCKET_ID).download(images[0]);
      if (!blob) throw new Error("DOWNLOAD_IMAGE_FAILED");
      const b64 = await blobToBase64(blob);
      await requestVisionStream(
        [{ role: "user", content: [
          { type: "image_url", image_url: { url: b64 } },
          { type: "text", text: `Extract all text from this product image and translate it into ${LANG_LABEL[translationTargetLang] ?? translationTargetLang}.` }
        ] }],
        (chunk) => { aiPartialRef.current += chunk; setAiPartial(aiPartialRef.current); }
      );
    } catch (e) { setAiPartial(t("pd.translateFailPrefix", { msg: e instanceof Error ? (e.message === "DOWNLOAD_IMAGE_FAILED" ? t("pd.downloadFailed") : e.message) : t("common.unknownError") })); }
    finally { setAiStreaming(false); }
  };

  const handleCopyTranslation = () => { navigator.clipboard.writeText(aiPartial); toast.success(t("pd.copyTranslationDone")); };

  /* ── AI：文案优化（原位） ── */
  const handleOptimizeCopy = async () => {
    if (!user) { toast.error(t("pd.loginRequired")); return; }
    if (!name && !description) { toast.error(t("pd.basicInfoRequiredFirst")); return; }
    setAiCopying(true); setCopyOptimizeResult("");
    try {
      let result = "";
      await requestLLMStream(
        [{ role: "user", content: `Optimize the marketing copy for the following cross-border e-commerce product, including: 1) an optimized product title (in English) 2) five bullet points (in English) 3) a product description (in English, within 200 words)\n\nProduct name: ${name}\nProduct description: ${description}\nCategory: ${category}` }],
        (chunk) => { result += chunk; setCopyOptimizeResult(result); },
        { serviceKey: "desc_gen" }
      );
    } catch { toast.error(t("pd.copyOptimizeFailed")); }
    finally { setAiCopying(false); }
  };

  const applyCopyToDescription = () => {
    if (!copyOptimizeResult) return;
    setDescription((prev) => (prev ? prev + "\n\n" : "") + copyOptimizeResult);
    toast.success(t("pd.appliedToDesc"));
  };

  /* ── AI Listing：一键应用到产品草稿（联动 publish-listing） ── */
  const applyAiListing = async (r: ListingResult, lang: string) => {
    const title = (r.title ?? "").trim();
    const bullets = (r.bullet_points ?? []).join("\n");
    const desc = (r.description ?? "").trim();
    if (lang === "zh") {
      if (title) setName(title);
      if (desc) setDescription(desc);
    }
    // 绑定店铺时同步站点刊登草稿字段（统一刊登编辑页）
    if (selectedShopId) {
      if (title) setSiteTitle(title);
      if (bullets) setSiteBullets(bullets);
      if (desc) setSiteDescription(desc);
    }
    if (lang !== "zh") {
      try {
        const { data: cur } = await supabase.from("products").select("i18n").eq("id", id).maybeSingle();
        const i18n = { ...(((cur?.i18n as Record<string, unknown>) ?? {}) as Record<string, Record<string, unknown>>) };
        i18n[lang] = {
          ...(i18n[lang] ?? {}),
          name: title, description: desc,
          bullet_points: r.bullet_points ?? [], search_terms: r.search_terms ?? [],
          listing_updated_at: new Date().toISOString(),
        };
        const { error } = await supabase.from("products").update({ i18n: i18n as any, updated_at: new Date().toISOString() }).eq("id", id);
        if (error) throw new Error(error.message);
      } catch (e) {
        toast.error(t("ai.listing.applyFail", { msg: e instanceof Error ? e.message : t("common.unknownError") }));
        return;
      }
    }
    toast.success(t("ai.listing.applied"), { duration: 2500 });
  };

  /* ── AI：场景图生成 ── */
  const handleGenSceneImage = async () => {
    if (!user) { toast.error(t("pd.loginRequired")); return; }
    if (!images.length) { toast.error(t("pd.imagesRequiredFirst")); return; }
    setAiImageGen("generating");
    try {
      const prompt = sceneGenPrompt || `Professional e-commerce product photography of ${name || "product"}, studio lighting, white background, high quality, commercial style`;
      const resp = await generateImage(prompt); const url = extractImageUrl(resp); if (!url) throw new Error("IMAGE_GEN_FAILED");
      setImages((prev) => [...prev, url]);
      toast.success(t("pd.sceneImgGenerated"));
      setAiImageGen(null);
    } catch { toast.error(t("pd.sceneImgFailed")); setAiImageGen(null); }
  };

  /* ── AI：商品视频生成 ── */
  const handleGenVideo = async () => {
    if (!user) { toast.error(t("pd.loginRequired")); return; }
    if (!name && !images.length) { toast.error(t("pd.infoOrImageRequired")); return; }
    setVideoGen("generating");
    try {
      const prompt = `Product showcase scene for ${name || "product"}: professional e-commerce video storyboard, product centered, clean background, dramatic lighting, cinematic composition`;
      const resp = await generateImage(prompt); const url = extractImageUrl(resp); if (!url) throw new Error("IMAGE_GEN_FAILED");
      setImages((prev) => [...prev, url]);
      toast.success(t("pd.storyboardGenerated"));
      setVideoGen(null);
    } catch { toast.error(t("pd.genFailed")); setVideoGen(null); }
  };

  const handleAiVisionCopy = async () => {
    if (!user) { toast.error(t("pd.loginRequired")); return; }
    if (!images.length) { toast.error(t("pd.imagesRequiredFirst")); return; }
    setAiVisionCopying(true); setAiPartial(""); aiPartialRef.current = "";
    try {
      const { data: blob } = await supabase.storage.from(STORAGE_BUCKET_ID).download(images[0]);
      if (!blob) throw new Error("DOWNLOAD_IMAGE_FAILED");
      const b64 = await blobToBase64(blob);
      await requestVisionStream(
        [{ role: "user", content: [
          { type: "image_url", image_url: { url: b64 } },
          { type: "text", text: "Generate cross-border e-commerce product copy for this product image, including a title (English), five bullet points (English), and a short description (English)" }
        ] }],
        (chunk) => { aiPartialRef.current += chunk; setAiPartial(aiPartialRef.current); }
      );
    } catch (e) { setAiPartial(t("pd.genFailPrefix", { msg: e instanceof Error ? (e.message === "DOWNLOAD_IMAGE_FAILED" ? t("pd.downloadFailed") : e.message) : t("common.unknownError") })); }
    finally { setAiVisionCopying(false); }
  };

  /* ── 利润计算 ── */
  const profit = useMemo(() => {
    const p = Number(price) || 0;
    const c = Number(cost) || 0;
    return p - c;
  }, [price, cost]);

  const profitMargin = useMemo(() => {
    const p = Number(price) || 0;
    return p > 0 ? ((profit / p) * 100).toFixed(1) : "0.0";
  }, [profit, price]);

  /* ── 店铺规则（统一刊登编辑页） ── */
  const currentShop = useMemo(() => shops.find((s) => s.id === selectedShopId) ?? null, [shops, selectedShopId]);
  const currentRule = useMemo(() => listingRules.find((r) => r.shop_id === selectedShopId) ?? null, [listingRules, selectedShopId]);
  const ruleConfigured = !!currentRule && currentRule.enabled !== false;

  const hasSiteContent = () => Boolean(
    siteTitle || siteBullets || siteDescription || sitePrice || siteStock ||
    fulfillTime || shippingTemplate || ptc || manufacturer || euResponsible ||
    euDocUrl || ceDeclarationUrl || ceReportUrl || labelImageUrl || warningLang ||
    certFileUrl || Object.keys(eanMap).length
  );

  const clearSiteFields = () => {
    setSiteTitle(""); setSiteBullets(""); setSiteDescription("");
    setSitePrice(""); setSiteStock(""); setFulfillTime(""); setShippingTemplate("");
    setPtc(""); setManufacturer(""); setEuResponsible("");
    setEuDocUrl(""); setCeDeclarationUrl(""); setCeReportUrl("");
    setLabelImageUrl(""); setWarningLang(""); setCertFileUrl("");
    setEanMap({});
  };

  // 字段显隐/必填/报错（未配置规则时默认显示、不强制必填）
  const siteFieldVisible = (key: string): boolean => {
    if (!selectedShopId) return false;
    if (!ruleConfigured) return true;
    const f = currentRule.fields?.[key];
    return f ? f.visible !== false : true;
  };
  const siteFieldRequired = (key: string): boolean => {
    if (!ruleConfigured) return false;
    const f = currentRule.fields?.[key];
    return f?.required === true;
  };
  const siteFieldErrorText = (key: string): string => {
    if (!ruleConfigured) return "";
    return currentRule.fields?.[key]?.error_text ?? "";
  };
  const uploadVisible = (key: string): boolean => {
    if (!selectedShopId) return false;
    if (!ruleConfigured) return true;
    const u = currentRule.uploads?.[key];
    return u ? u.enabled !== false : true;
  };
  const uploadRequired = (key: string): boolean => {
    if (!ruleConfigured) return false;
    const u = currentRule.uploads?.[key];
    return u?.required === true;
  };
  const uploadErrorText = (key: string): string => {
    if (!ruleConfigured) return "";
    return currentRule.uploads?.[key]?.error_text ?? "";
  };

  // 切换店铺：已有站点内容时先弹窗确认
  const handleShopSelect = (shopId: string) => {
    if (shopId === selectedShopId) return;
    if (hasSiteContent()) {
      setPendingShopId(shopId);
      setSwitchConfirmOpen(true);
      return;
    }
    setSelectedShopId(shopId);
  };
  const confirmSwitchShop = () => {
    clearSiteFields();
    setSelectedShopId(pendingShopId);
    setSwitchConfirmOpen(false);
    setPendingShopId("");
  };

  // 从产品基础库同步更新（只覆盖公共部分，站点专属保留）
  const handleSyncFromBase = useCallback(async () => {
    const srcId = (product as any)?.extras?.source_product_id as string | undefined;
    if (!srcId) { toast.error(t("pd.noSourceProduct")); return; }
    setSyncingFromBase(true);
    try {
      const all = await fetchProducts();
      const src = all.find((x) => x.id === srcId);
      if (!src) { toast.error(t("pd.sourceNotFound")); return; }
      const extras = (src as any).extras ?? {};
      setName(src.name ?? "");
      setDescription(src.description ?? "");
      setCategory(src.category ?? "");
      setSku(src.sku ?? "");
      setPrice(src.price != null ? String(src.price) : "");
      setCost(src.cost != null ? String(src.cost) : "");
      setStock(src.stock != null ? String(src.stock) : "");
      setSourcePlatform(src.source_platform ?? "");
      setSourceUrl(src.source_url ?? "");
      const imgs = Array.isArray(src.images) ? src.images : [];
      setImages(imgs);
      setPrimaryImage((src as any).primary_image != null ? imgs.indexOf((src as any).primary_image as string) : 0);
      setWeight(extras.weight ?? "");
      setLength(extras.length ?? "");
      setWidth(extras.width ?? "");
      setHeight(extras.height ?? "");
      setShippingFee(extras.shipping_fee != null ? String(extras.shipping_fee) : "");
      setFreeShipping(extras.free_shipping === true);
      setTags(Array.isArray(extras.tags) ? extras.tags : []);
      setCertifications(Array.isArray(extras.certifications) ? extras.certifications : []);
      const sc = extras.supply_chain ?? {};
      setSupplierName(sc.supplier_name ?? "");
      setOriginCountry(sc.origin_country ?? "");
      setHsCode(sc.hs_code ?? "");
      setFactoryCert(sc.factory_cert ?? "");
      setMultilingual(Array.isArray(extras.multilingual) ? extras.multilingual : []);
      setAttrPairs(Array.isArray(extras.attributes) ? extras.attributes : []);
      // 源商品变体只复制为当前商品的「待保存」草稿，绝不直接挂到 variants
      // （否则编辑/删除会误操作源商品的变体行）；保存时作为当前商品的新变体落库
      const vs = await fetchTable("product_variants");
      const srcVs = vs.filter((v: any) => v.product_id === srcId);
      setPendingVariants(srcVs.map((v: any) => ({
        sku: v.sku ?? "",
        attrs: v.attributes ?? "",
        price: v.price != null ? String(v.price) : "",
        stock: v.stock != null ? String(v.stock) : "",
      })));
      toast.success(isNew
        ? t("pd.syncedWithPendingVariants")
        : t("pd.syncedWithPendingCombos"));
    } catch (e) {
      toast.error(t("pd.syncFail", { msg: e instanceof Error ? e.message : t("common.unknownError") }));
    } finally {
      setSyncingFromBase(false);
    }
  }, [product]);

  // 站点文件上传（证书/欧代/CE 等 → product-images bucket）
  const uploadSiteFile = async (file: File, target: (url: string) => void) => {    if (!file) return;
    setUploadingSiteFile(true);
    try {
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `site-docs/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from(STORAGE_BUCKET_ID).upload(path, file, { upsertReply: false } as any);
      if (error) { toast.error(t("pd.uploadFail", { msg: error.message })); return; }
      const { data: urlData } = supabase.storage.from(STORAGE_BUCKET_ID).getPublicUrl(path);
      target(urlData.publicUrl);
      toast.success(t("pd.fileUploaded"));
    } finally {
      setUploadingSiteFile(false);
    }
  };

  /* ── Excel 导入导出（按当前店铺规则生成模板/校验） ── */
  const excelColumnOf = (key: string): { col: string; get: () => string; set: (v: string) => void } | null => {
    switch (key) {
      case "site_title": return { col: t("pd.site.site_title"), get: () => siteTitle, set: setSiteTitle };
      case "site_bullets": return { col: t("pd.site.site_bullets"), get: () => siteBullets, set: setSiteBullets };
      case "site_description": return { col: t("pd.site.site_description"), get: () => siteDescription, set: setSiteDescription };
      case "site_price": return { col: t("pd.site.site_price"), get: () => sitePrice, set: setSitePrice };
      case "site_stock": return { col: t("pd.site.site_stock"), get: () => siteStock, set: setSiteStock };
      case "fulfill_time": return { col: t("pd.site.fulfill_time"), get: () => fulfillTime, set: setFulfillTime };
      case "shipping_template": return { col: t("pd.site.shipping_template"), get: () => shippingTemplate, set: setShippingTemplate };
      case "ptc": return { col: t("pd.site.ptc"), get: () => ptc, set: setPtc };
      case "manufacturer": return { col: t("pd.site.manufacturer"), get: () => manufacturer, set: setManufacturer };
      case "eu_responsible": return { col: t("pd.site.eu_responsible"), get: () => euResponsible, set: setEuResponsible };
      case "warning_lang": return { col: t("pd.site.warning_lang"), get: () => warningLang, set: setWarningLang };
      default: return null;
    }
  };
  const excelUploadOf = (key: string): { col: string; get: () => string; set: (v: string) => void } | null => {
    switch (key) {
      case "cert_file": return { col: t("pd.xl.certFileLink"), get: () => certFileUrl, set: setCertFileUrl };
      case "eu_doc": return { col: t("pd.xl.euDocLink"), get: () => euDocUrl, set: setEuDocUrl };
      case "ce_declaration": return { col: t("pd.xl.ceDeclLink"), get: () => ceDeclarationUrl, set: setCeDeclarationUrl };
      case "ce_report": return { col: t("pd.xl.ceReportLink"), get: () => ceReportUrl, set: setCeReportUrl };
      case "label_image": return { col: t("pd.xl.labelImgLink"), get: () => labelImageUrl, set: setLabelImageUrl };
      default: return null;
    }
  };
  const handleExportExcel = async () => {
    if (!selectedShopId) { toast.error(t("pd.selectShopForExport")); return; }
    const XLSX = (await import("xlsx")).default;
    const row: Record<string, string | number> = {
      [t("pd.xl.spuCode")]: sku, [t("pd.xl.spuName")]: name, [t("pd.xl.category")]: category, [t("pd.xl.basePrice")]: price, [t("pd.xl.costPrice")]: cost, [t("pd.xl.baseStock")]: stock,
      [`${t("pd.xl.len")}(cm)`]: length, [`${t("pd.xl.wid")}(cm)`]: width, [`${t("pd.xl.hei")}(cm)`]: height, [`${t("pd.xl.netWeight")}(kg)`]: weight,
    };
    SITE_FIELDS.forEach((f) => {
      if (!siteFieldVisible(f.key)) return;
      if (f.key === "ean") {
        row[t("pd.xl.ean")] = Object.entries(eanMap).map(([s, e]) => `${s}:${e}`).join("; ");
        return;
      }
      const c = excelColumnOf(f.key);
      if (c) row[c.col] = c.get();
    });
    SITE_UPLOADS.forEach((u) => {
      if (!uploadVisible(u.key)) return;
      const c = excelUploadOf(u.key);
      if (c) row[c.col] = c.get();
    });
    const ws = XLSX.utils.json_to_sheet([row]);
    ws["!cols"] = Object.keys(row).map(() => ({ wch: 24 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, t("pd.xl.sheet"));
    XLSX.writeFile(wb, t("pd.xl.fileName", { name: currentShop?.name ?? t("pd.defaultShopName") }));
    toast.success(t("pd.exportDone"));
  };
  const excelImportRef = useRef<HTMLInputElement>(null);
  const handleImportExcel = async (file: File) => {
    if (!selectedShopId) { toast.error(t("pd.selectShopForImport")); return; }
    try {
      const XLSX = (await import("xlsx")).default;
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(ws, { defval: "" });
      if (rows.length === 0) { toast.error(t("pd.sheetEmpty")); return; }
      const r = rows[0];
      const get = (k: string) => (r[k] != null ? String(r[k]).trim() : "");
      // 按当前店铺规则校验必填列
      const missing: string[] = [];
      SITE_FIELDS.forEach((f) => {
        if (f.key === "ean" || !siteFieldRequired(f.key)) return;
        const c = excelColumnOf(f.key);
        if (c && !get(c.col)) missing.push(c.col);
      });
      if (siteFieldRequired("ean") && !get(t("pd.xl.ean"))) missing.push("EAN-13");
      SITE_UPLOADS.forEach((u) => {
        if (!uploadRequired(u.key)) return;
        const c = excelUploadOf(u.key);
        if (c && !get(c.col)) missing.push(c.col);
      });
      if (missing.length) { toast.error(t("pd.importMissingCols", { cols: missing.join("、") })); return; }
      // 回填字段
      SITE_FIELDS.forEach((f) => {
        if (!siteFieldVisible(f.key)) return;
        if (f.key === "ean") {
          const eanVal = get(t("pd.xl.ean"));
          if (eanVal) {
            const m: Record<string, string> = {};
            eanVal.split(";").forEach((pair) => {
              const [s, e] = pair.split(":").map((x) => x.trim());
              if (s && e) m[s] = e;
            });
            if (Object.keys(m).length) setEanMap(m);
          }
          return;
        }
        const c = excelColumnOf(f.key);
        if (c && get(c.col)) c.set(get(c.col));
      });
      SITE_UPLOADS.forEach((u) => {
        if (!uploadVisible(u.key)) return;
        const c = excelUploadOf(u.key);
        if (c && get(c.col)) c.set(get(c.col));
      });
      toast.success(t("pd.importDone"));
    } catch (e) {
      toast.error(t("pd.importFail", { msg: e instanceof Error ? e.message : t("common.unknownError") }));
    }
  };

  /* ── 发布检查（公共必填 + 当前店铺规则必填） ── */
  const publishChecks = useMemo(() => {
    const checks: { label: string; pass: boolean }[] = [
      { label: "pd.check.name", pass: name.trim().length > 0 },
      { label: "pd.check.desc", pass: description.length >= 20 },
      { label: "pd.check.image", pass: images.length > 0 },
      { label: "pd.check.price", pass: Number(price) > 0 },
      { label: "products.col.category", pass: category.trim().length > 0 },
      { label: "SKU", pass: sku.trim().length > 0 },
      { label: "pd.check.logistics", pass: weight.trim().length > 0 || (length.trim().length > 0 && width.trim().length > 0 && height.trim().length > 0) },
    ];
    // 店铺规则必填（仅当选了店铺且规则已配置）
    if (selectedShopId && ruleConfigured) {
      const miss = (label: string) => checks.push({ label, pass: false });
      SITE_FIELDS.forEach((f) => {
        if (!siteFieldRequired(f.key)) return;
        let pass = true;
        switch (f.key) {
          case "site_title": pass = siteTitle.trim().length > 0; break;
          case "site_bullets": pass = siteBullets.trim().length > 0; break;
          case "site_description": pass = siteDescription.trim().length > 0; break;
          case "site_price": pass = Number(sitePrice) > 0; break;
          case "site_stock": pass = siteStock.trim().length > 0; break;
          case "fulfill_time": pass = fulfillTime.trim().length > 0; break;
          case "shipping_template": pass = shippingTemplate.trim().length > 0; break;
          case "ean": pass = Object.keys(eanMap).length > 0 && Object.values(eanMap).every((v) => v && v.trim().length > 0); break;
          case "ptc": pass = ptc.trim().length > 0; break;
          case "manufacturer": pass = manufacturer.trim().length > 0; break;
          case "eu_responsible": pass = euResponsible.trim().length > 0; break;
          case "eu_doc": pass = euDocUrl.trim().length > 0; break;
          case "ce_declaration": pass = ceDeclarationUrl.trim().length > 0; break;
          case "ce_report": pass = ceReportUrl.trim().length > 0; break;
          case "label_image": pass = labelImageUrl.trim().length > 0; break;
          case "warning_lang": pass = warningLang.trim().length > 0; break;
        }
        if (!pass) miss(f.label);
      });
      SITE_UPLOADS.forEach((u) => {
        if (!uploadRequired(u.key)) return;
        let pass = true;
        switch (u.key) {
          case "cert_file": pass = certFileUrl.trim().length > 0; break;
          case "eu_doc": pass = euDocUrl.trim().length > 0; break;
          case "ce_declaration": pass = ceDeclarationUrl.trim().length > 0; break;
          case "ce_report": pass = ceReportUrl.trim().length > 0; break;
          case "label_image": pass = labelImageUrl.trim().length > 0; break;
        }
        if (!pass) miss(u.label);
      });
    }
    return checks;
  }, [name, description, images, price, category, sku, weight, length, width, height,
      selectedShopId, ruleConfigured, currentRule,
      siteTitle, siteBullets, siteDescription, sitePrice, siteStock, fulfillTime,
      shippingTemplate, eanMap, ptc, manufacturer, euResponsible, euDocUrl,
      ceDeclarationUrl, ceReportUrl, labelImageUrl, warningLang, certFileUrl]);

  const allChecksPass = publishChecks.every((c) => c.pass);


  /* ── 智能抓取：来源链接 → collect Edge Function → 回填表单 ── */
  const handleCollect = useCallback(async () => {
    if (!sourceUrl.trim()) {
      toast.error(t("pd.sourceLinkRequired"));
      return;
    }
    if (!/^https?:\/\//i.test(sourceUrl.trim())) {
      toast.error(t("pd.linkInvalid"));
      return;
    }
    setCollecting(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const authHeaders: Record<string, string> = session
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};
      const response = await fetch(`${supabaseUrl}/functions/v1/collect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "OneDay-App-Id": projectUrlId,
          ...authHeaders,
        },
        body: JSON.stringify({ url: sourceUrl.trim() }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error((result as { error?: string }).error || t("pd.collectFailed", { status: response.status }));
      }
      const d = (result as { data: any }).data;
      let filled = false;
      if (d.name && d.name !== "未命名商品") { setName(d.name); filled = true; }
      if (d.description) { setDescription(d.description); filled = true; }
      if (d.sku) { setSku(d.sku); filled = true; }
      if (d.price && Number(d.price) > 0) { setPrice(String(d.price)); filled = true; }
      if (d.category) { setCategory(d.category); filled = true; }
      if (d.brand) { setTags((prev) => (prev.includes(d.brand) ? prev : [...prev, d.brand])); filled = true; }
      if (d.images && Array.isArray(d.images) && d.images.length > 0) {
        const urls = d.images.filter((u: string) => /^https?:\/\//i.test(u));
        if (urls.length > 0) {
          setImages((prev) => [...new Set([...urls, ...prev])]);
          setPrimaryImage(0);
          filled = true;
        }
      }
      if (d.platform) { setSourcePlatform(d.platform); }
      toast.success(filled ? t("pd.collectSuccess") : t("pd.collectNoFields"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("pd.collectError"));
    } finally {
      setCollecting(false);
    }
  }, [sourceUrl, t]);
  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-fg-muted" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* ═══ 顶部操作栏 ═══ */}
      <div className="sticky top-0 z-20 -mx-4 border-b border-border bg-card/95 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="shrink-0" onClick={() => navigate({ to: "/products" })}>
              <ArrowLeft size={18} />
            </Button>
            <div>
              <h1 className="font-display text-lg font-semibold text-fg">
                {isNew ? t("pd.newProduct") : (name || t("pd.editProduct"))}
              </h1>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-muted">
                <Badge variant={status === "published" ? "default" : "outline"} className="text-[10px]">
                  {status === "published" ? t("st.published") : status === "draft" ? t("st.draft") : (() => { const sk = `status.${status}`; const sv = t(sk); return sv === sk ? status : sv; })()}
                </Badge>
                {sku && <span>SKU: {sku}</span>}
                {category && <span>· {category}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isNew && (
              <Button variant="outline" size="sm" onClick={() => setTranslateOpen(true)}>
                <Languages size={14} className="mr-1.5" /> {t("ai.tr.actionBtn")}
              </Button>
            )}
            {!isNew && (
              <Button variant="outline" size="sm" onClick={() => setCalcOpen(true)}>
                <Calculator size={14} className="mr-1.5" /> {t("pc.actionBtn")}
              </Button>
            )}
            {!isNew && (
              <Button variant="outline" size="sm" onClick={() => setPublishOpen(true)}>
                <Rocket size={14} className="mr-1.5" /> {t("publish.toShop")}
              </Button>
            )}
            {!isNew && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => document.getElementById("publish-check")?.scrollIntoView({ behavior: "smooth", block: "center" })}
              >
                <Send size={14} className="mr-1.5" /> {t("pd.publishOptimize")}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => handleSave(false)} disabled={saving}>
              {saving ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Save size={14} className="mr-1.5" />}
              {t("pd.saveDraft")}
            </Button>
            <Button size="sm" onClick={() => handleSave(true)} disabled={saving}>
              {saving ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Send size={14} className="mr-1.5" />}
              {t("pd.savePublish")}
            </Button>
          </div>
        </div>
      </div>

      {/* ═══ 店铺选择（统一刊登编辑页） ═══ */}
      {shops.length > 0 && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Store size={16} className="text-primary" />
              <span className="text-sm font-semibold text-fg">{t("pd.listingShop")}</span>
            </div>
            <select
              value={selectedShopId}
              onChange={(e) => handleShopSelect(e.target.value)}
              className="h-8 rounded-xl border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
            >
              <option value="">{t("pd.noShopBound")}</option>
              {shops.filter((s) => s.status === "正常" || s.id === selectedShopId).map((s) => (
                <option key={s.id} value={s.id}>{t("products.shopWithRegion", { name: s.name, region: s.region || s.platform })}</option>
              ))}
            </select>
            {currentShop && (
              <Badge className="bg-primary/10 text-primary hover:bg-primary/10">
                <Building2 size={11} className="mr-1" />{currentShop.region || currentShop.platform}
              </Badge>
            )}
            {selectedShopId && !ruleConfigured && (
              <span className="text-xs text-warning">{t("pd.noRuleConfigured")}</span>
            )}
            {!isNew && (product as any)?.extras?.source_product_id && (
              <Button variant="outline" size="sm" onClick={handleSyncFromBase} disabled={syncingFromBase}>
                {syncingFromBase ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <RefreshCcw size={14} className="mr-1.5" />}
                {t("pd.syncFromSource")}
              </Button>
            )}
            {selectedShopId && (
              <>
                <Button variant="outline" size="sm" onClick={handleExportExcel}>
                  <FileDown size={14} className="mr-1.5" />{t("pd.exportTemplate")}
                </Button>
                <Button variant="outline" size="sm" onClick={() => excelImportRef.current?.click()}>
                  <FileUp size={14} className="mr-1.5" />{t("pd.importLabel")}
                </Button>
                <input ref={excelImportRef} type="file" accept=".xlsx,.xls" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportExcel(f); e.target.value = ""; }} />
              </>
            )}
          </div>
        </div>
      )}

      {/* ═══ 利润速览条 ═══ */}
      {(price || cost) && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-4 py-3 text-sm">
          <span className="text-fg-muted">{t("pd.cost")} ¥{(Number(cost) || 0).toFixed(2)}</span>
          <span className="text-fg-muted">→</span>
          <span className="text-fg-muted">{t("pd.price")} ¥{(Number(price) || 0).toFixed(2)}</span>
          <span className="text-fg-muted">→</span>
          <span className={cn("font-semibold", profit >= 0 ? "text-success" : "text-destructive")}>
            {t("pd.profit")} ¥{profit.toFixed(2)} ({profitMargin}%)
          </span>
        </div>
      )}

      {/* ═══ 单页长滚动主网格 ═══ */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* 左：主编辑列 */}
        <div className="space-y-5 lg:col-span-2">

          {/* ── 基本信息（AI 原位：标题翻译 / 文案优化） ── */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-fg">{t("pd.name")} *</label>
              <div className="flex items-center gap-1.5">
                <select
                  value={translateTitleLang} onChange={(e) => setTranslateTitleLang(e.target.value)}
                  className="rounded-xl border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
                >
                  {Object.entries(LANG_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
                </select>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleTranslateTitle} disabled={titleTranslating}>
                  {titleTranslating ? <Loader2 size={13} className="mr-1 animate-spin" /> : <Languages size={13} className="mr-1" />}
                  {t("pd.aiTranslateTitle")}
                  <span className="ml-1 rounded bg-surface-sunken px-1 text-[10px] text-fg-muted">
                    {titleFreeBenefit ? t("pd.freeBenefit") : t("pd.credits1")}
                  </span>
                </Button>
              </div>
            </div>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder={t("pd.namePlaceholder")}
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-fg outline-none transition-colors focus:border-primary"
            />
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="block text-sm font-medium text-fg">{t("pd.desc")}</label>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleOptimizeCopy} disabled={aiCopying}>
                  {aiCopying ? <Loader2 size={13} className="mr-1 animate-spin" /> : <Wand2 size={13} className="mr-1" />}
                  {t("pd.aiOptimizeCopy")}
                  <span className="ml-1 rounded bg-surface-sunken px-1 text-[10px] text-fg-muted">{t("pd.credits5")}</span>
                </Button>
              </div>
              <textarea
                value={description} onChange={(e) => setDescription(e.target.value)}
                rows={4} placeholder={t("pd.descPlaceholder")}
                className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-fg outline-none transition-colors focus:border-primary"
              />
              <p className="mt-1 text-xs text-fg-muted">{t("pd.charCount", { n: description.length })}</p>
            </div>
            {copyOptimizeResult && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                    <Sparkles size={13} /> {t("pd.aiResult")}
                  </span>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => { navigator.clipboard.writeText(copyOptimizeResult); toast.success(t("common.copied")); }}>
                      <Copy size={11} className="mr-1" />{t("common.copy")}
                    </Button>
                    <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={applyCopyToDescription}>
                      <Check size={11} className="mr-1" />{t("pd.applyToDesc")}
                    </Button>
                  </div>
                </div>
                <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl bg-background p-2.5 text-xs text-fg">{copyOptimizeResult}</div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-fg">{t("products.col.category")}</label>
                <input
                  type="text" value={category} onChange={(e) => setCategory(e.target.value)}
                  placeholder={t("pd.categoryPlaceholder")}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-fg outline-none transition-colors focus:border-primary"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-fg">SKU</label>
                <input
                  type="text" value={sku} onChange={(e) => setSku(e.target.value)}
                  placeholder="SKU-001"
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-fg outline-none transition-colors focus:border-primary"
                />
              </div>
            </div>
          </div>

          {/* 价格与库存 */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="mb-4 flex items-center gap-2 font-display text-sm font-semibold text-fg">
              <Tag size={15} className="text-primary" /> {t("pd.priceStock")}
            </h3>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-fg-muted">{t("pd.priceCny")}</label>
                <input
                  type="number" value={price} onChange={(e) => setPrice(e.target.value)}
                  placeholder="0.00" min="0" step="0.01"
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 font-data text-sm text-fg outline-none transition-colors focus:border-primary"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-fg-muted">{t("pd.costCny")}</label>
                <input
                  type="number" value={cost} onChange={(e) => setCost(e.target.value)}
                  placeholder="0.00" min="0" step="0.01"
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 font-data text-sm text-fg outline-none transition-colors focus:border-primary"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-fg-muted">{t("products.col.stock")}</label>
                <input
                  type="number" value={stock} onChange={(e) => setStock(e.target.value)}
                  placeholder="0" min="0"
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 font-data text-sm text-fg outline-none transition-colors focus:border-primary"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-fg-muted">{t("pd.publishStatus")}</label>
                <select
                  value={status} onChange={(e) => setStatus(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-fg outline-none transition-colors focus:border-primary"
                >
                  <option value="draft">{t("st.draft")}</option>
                  <option value="published">{t("st.published")}</option>
                  <option value="archived">{t("st.archived")}</option>
                </select>
              </div>
            </div>
          </div>

          {/* 物流与运费 */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="mb-4 flex items-center gap-2 font-display text-sm font-semibold text-fg">
              <Weight size={15} className="text-chart-3" /> {t("pd.logistics")}
            </h3>
            <p className="mb-4 text-xs text-fg-muted">{t("pd.logisticsHint")}</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-fg-muted">{t("pd.weight")} (kg)</label>
                <input type="number" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="0.00" step="0.01" min="0"
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 font-data text-sm text-fg outline-none transition-colors focus:border-primary" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-fg-muted">{t("pd.len")} (cm)</label>
                <input type="number" value={length} onChange={(e) => setLength(e.target.value)} placeholder="0" step="0.1" min="0"
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 font-data text-sm text-fg outline-none transition-colors focus:border-primary" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-fg-muted">{t("pd.wid")} (cm)</label>
                <input type="number" value={width} onChange={(e) => setWidth(e.target.value)} placeholder="0" step="0.1" min="0"
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 font-data text-sm text-fg outline-none transition-colors focus:border-primary" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-fg-muted">{t("pd.hei")} (cm)</label>
                <input type="number" value={height} onChange={(e) => setHeight(e.target.value)} placeholder="0" step="0.1" min="0"
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 font-data text-sm text-fg outline-none transition-colors focus:border-primary" />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-fg-muted">{t("pd.shippingFeeOpt")}</label>
                <input type="number" value={shippingFee} onChange={(e) => setShippingFee(e.target.value)} placeholder="0.00" step="0.01" min="0"
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 font-data text-sm text-fg outline-none transition-colors focus:border-primary" />
              </div>
              <div className="flex items-end pb-2.5">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-fg">
                  <input type="checkbox" checked={freeShipping} onChange={(e) => setFreeShipping(e.target.checked)} className="h-4 w-4 rounded border-border text-primary focus:ring-primary" />
                  {t("pd.freeShipping")}
                </label>
              </div>
            </div>
          </div>

          {/* 来源信息 */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="mb-4 flex items-center gap-2 font-display text-sm font-semibold text-fg">
              <Globe size={15} className="text-chart-2" /> {t("pd.sourceInfo")}
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-fg-muted">{t("pd.sourcePlatform")}</label>
                <input
                  type="text" value={sourcePlatform} onChange={(e) => setSourcePlatform(e.target.value)}
                  placeholder="Amazon / Shopify / 1688..."
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-fg outline-none transition-colors focus:border-primary"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-fg-muted">{t("pd.sourceLink")}</label>
                <div className="flex gap-2">
                  <input
                    type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-fg outline-none transition-colors focus:border-primary"
                  />
                  <Button
                    type="button" variant="outline" size="sm" onClick={handleCollect} disabled={collecting}
                    className="shrink-0 whitespace-nowrap"
                  >
                    {collecting ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Wand2 className="mr-1 h-3.5 w-3.5" />
                    )}
                    {collecting ? t("pd.collecting") : t("pd.smartCollect")}
                  </Button>
                </div>
                <p className="mt-1.5 text-xs text-fg-muted">
                  {t("pd.collectHint")}
                </p>
              </div>
            </div>
          </div>

          {/* ── 图片素材（AI 原位：图片翻译 / 场景图 / 视频生成；大图拖拽上传） ── */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-fg">
                <ImageIcon size={15} className="text-chart-4" /> {t("pd.images")}
                <span className="text-xs font-normal text-fg-muted">{t("pd.imageCount", { n: images.length })}</span>
              </h3>
              <div className="flex flex-wrap gap-1.5">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90">
                  <Upload size={13} /> {t("pd.uploadImages")}
                  <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} />
                </label>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleStartTranslateImage} disabled={aiStreaming}>
                  {aiStreaming && aiTarget === "image-translate" ? <Loader2 size={13} className="mr-1 animate-spin" /> : <Languages size={13} className="mr-1" />}
                  {t("pd.imgTranslate")}
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleGenSceneImage} disabled={!!aiImageGen}>
                  {aiImageGen ? <Loader2 size={13} className="mr-1 animate-spin" /> : <ImageIcon size={13} className="mr-1" />}
                  {t("pd.sceneImg")}
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleGenVideo} disabled={!!videoGen}>
                  {videoGen ? <Loader2 size={13} className="mr-1 animate-spin" /> : <Video size={13} className="mr-1" />}
                  {t("pd.videoGen")}
                </Button>
              </div>
            </div>

            {/* 拖拽上传区 */}
            <div
              className={cn(
                "mb-3 flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-8 transition-colors",
                dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
              )}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleImageDrop}
            >
              <div className={cn("flex h-12 w-12 items-center justify-center rounded-full", dragOver ? "bg-primary/15" : "bg-surface-sunken")}>
                <Upload size={22} className={dragOver ? "text-primary" : "text-fg-muted"} />
              </div>
              <p className="mt-2 text-sm font-medium text-fg">{dragOver ? t("pd.dropToUpload") : t("pd.clickOrDrag")}</p>
              <p className="mt-0.5 text-xs text-fg-muted">{t("pd.uploadHint")}</p>
            </div>

            {mtMenuIdx !== null && images[mtMenuIdx] && (
              <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/5 px-3 py-1">
                <span className="text-xs text-fg-muted">{t("pd.chooseMtLang", { n: mtMenuIdx + 1 })}</span>
                {TRANSLATE_TARGET_LANGS.map((l) => (
                  <button key={l.code} type="button" onClick={() => translateProductImage(mtMenuIdx, l.code)} disabled={mtBusyIdx !== null}
                    className="rounded-full border border-border px-2 py-0.5 text-[11px] text-fg-muted transition-colors hover:border-primary hover:text-fg disabled:opacity-50">
                    {t(l.labelKey)}
                  </button>
                ))}
                <button type="button" onClick={() => setMtMenuIdx(null)} className="ml-1 text-[11px] text-fg-muted hover:text-fg">{t("common.cancel")}</button>
              </div>
            )}
            {images.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-10">
                <ImageIcon size={28} className="text-fg-muted/40" />
                <p className="mt-2 text-sm text-fg-muted">{t("pd.noImages")}</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {images.map((src, idx) => (
                  <div key={idx} className="group relative aspect-square overflow-hidden rounded-xl border border-border">
                    <img src={src} alt={`img-${idx}`} className="h-full w-full object-cover" />
                    {idx === primaryImage && (
                      <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-white">
                        <Star size={10} /> {t("pd.mainImage")}
                      </div>
                    )}
                    {mtBusyIdx === idx && (
                      <div className="absolute inset-0 flex items-center justify-center bg-ink/40">
                        <Loader2 size={22} className="animate-spin text-white" />
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-ink/80 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                      <div className="flex items-center gap-1">
                        {idx !== primaryImage && (
                          <button onClick={() => setPrimaryImage(idx)} className="rounded bg-card/20 px-2 py-1 text-[10px] text-white backdrop-blur-sm hover:bg-card/30">
                            {t("pd.setMain")}
                          </button>
                        )}
                        <button onClick={() => setMtMenuIdx(mtMenuIdx === idx ? null : idx)} disabled={mtBusyIdx !== null} className="rounded bg-primary/80 px-2 py-1 text-[10px] text-white backdrop-blur-sm hover:bg-primary disabled:opacity-50">
                          {mtBusyIdx === idx ? t("pd.translating") : t("pd.aiTranslate")}
                        </button>
                        {imagesBackup[idx] && (
                          <button onClick={() => restoreProductImage(idx)} className="rounded bg-card/20 px-2 py-1 text-[10px] text-white backdrop-blur-sm hover:bg-card/30">
                            {t("pd.restoreOriginal")}
                          </button>
                        )}
                      </div>
                      <button onClick={() => removeImage(idx)} className="ml-auto rounded bg-destructive/80 p-1 text-white hover:bg-destructive">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
                <label className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border transition-colors hover:border-primary/40">
                  <Plus size={24} className="text-fg-muted" />
                  <span className="mt-1 text-xs text-fg-muted">{t("pd.addMore")}</span>
                  <input type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} />
                </label>
              </div>
            )}

            {/* 图片翻译结果（原位） */}
            {(aiStreaming && aiTarget === "image-translate" || (!aiStreaming && aiTarget === "image-translate" && aiPartial)) && (
              <div className="mt-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                    <Languages size={13} /> {t("pd.mtResult")}
                    <select
                      value={translationTargetLang} onChange={(e) => setTranslationTargetLang(e.target.value)}
                      className="rounded border border-border bg-background px-1.5 py-0.5 text-[11px] font-normal outline-none focus:border-primary"
                    >
                      {Object.entries(LANG_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
                    </select>
                  </span>
                  {!aiStreaming && aiPartial && (
                    <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={handleCopyTranslation}>
                      <Copy size={11} className="mr-1" />{t("pd.copyResult")}
                    </Button>
                  )}
                </div>
                <div className="max-h-40 overflow-y-auto rounded-xl bg-surface-sunken p-3 text-xs whitespace-pre-wrap text-fg">
                  {aiPartial}{aiStreaming && <span className="inline-block h-3 w-1 animate-pulse bg-primary" />}
                </div>
              </div>
            )}

            {/* 场景图 prompt */}
            <div className="mt-3 flex gap-2">
              <input
                type="text" value={sceneGenPrompt} onChange={(e) => setSceneGenPrompt(e.target.value)}
                placeholder={t("pd.scenePromptPlaceholder")}
                className="flex-1 rounded-xl border border-border bg-background px-3 py-1 text-xs outline-none focus:border-primary"
              />
              {videoGen && <span className="flex items-center gap-1 text-xs text-fg-muted"><Loader2 size={12} className="animate-spin" /> {t("pd.generating")}</span>}
            </div>
          </div>

          {/* ── AI Listing（生成/优化/评分多平台 Listing → 应用到产品草稿/刊登草稿） ── */}
          {!isNew && product && (
            <AiListingPanel
              productId={id}
              productName={name || (product.name ?? "")}
              collectSource={sourceUrl ? [sourcePlatform, sourceUrl].filter(Boolean).join(" · ") : null}
              shopSelected={!!selectedShopId}
              onApply={(r, lang) => { void applyAiListing(r, lang); }}
            />
          )}

          {/* ── 站点专属信息（统一刊登编辑页 · 随店铺规则显隐/必填） ── */}
          {selectedShopId && (
            <div className="rounded-xl border border-border bg-card p-5 space-y-5">
              <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-fg">
                <Store size={15} className="text-chart-2" />{t("pd.siteSpecific")}
                {currentShop && <span className="text-xs font-normal text-fg-muted">（{currentShop.name} · {currentShop.region || currentShop.platform}）</span>}
                {ruleConfigured && <span className="text-xs font-normal text-success">{t("pd.ruleApplied")}</span>}
              </h3>
              {!ruleConfigured && (
                <p className="text-xs text-warning">{t("pd.noRuleHint")}</p>
              )}

              {/* 当地语言 */}
              {siteFieldVisible("site_title") && (
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                    <Languages size={13} className="text-chart-2" /> {t("pd.site.site_title")}{siteFieldRequired("site_title") && <span className="text-destructive">*</span>}
                  </label>
                  <input type="text" value={siteTitle} onChange={(e) => setSiteTitle(e.target.value)} placeholder={currentShop ? t("pd.siteTitlePhShop", { region: currentShop.region || t("pd.localLang") }) : t("pd.siteTitlePh")}
                    className="w-full rounded-xl border border-border bg-background px-3 py-1 text-sm outline-none focus:border-primary" />
                </div>
              )}
              {siteFieldVisible("site_bullets") && (
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                    <Wand2 size={13} className="text-chart-2" /> {t("pd.site.site_bullets")}{siteFieldRequired("site_bullets") && <span className="text-destructive">*</span>}
                  </label>
                  <textarea value={siteBullets} onChange={(e) => setSiteBullets(e.target.value)} rows={3}
                    placeholder={t("pd.bulletsPh")}
                    className="w-full rounded-xl border border-border bg-background px-3 py-1 text-sm outline-none focus:border-primary" />
                </div>
              )}
              {siteFieldVisible("site_description") && (
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                    <FileText size={13} className="text-chart-2" /> {t("pd.site.site_description")}{siteFieldRequired("site_description") && <span className="text-destructive">*</span>}
                  </label>
                  <textarea value={siteDescription} onChange={(e) => setSiteDescription(e.target.value)} rows={4}
                    placeholder={t("pd.site.site_description_hint")}
                    className="w-full rounded-xl border border-border bg-background px-3 py-1 text-sm outline-none focus:border-primary" />
                </div>
              )}

              {/* 站点销售 */}
              {(siteFieldVisible("site_price") || siteFieldVisible("site_stock")) && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {siteFieldVisible("site_price") && (
                    <div>
                      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                        <Tag size={13} className="text-chart-3" /> {t("pd.site.site_price")}{siteFieldRequired("site_price") && <span className="text-destructive">*</span>}
                      </label>
                      <input type="number" value={sitePrice} onChange={(e) => setSitePrice(e.target.value)} placeholder={t("pd.pricePh")}
                        className="w-full rounded-xl border border-border bg-background px-3 py-1 text-sm outline-none focus:border-primary" />
                    </div>
                  )}
                  {siteFieldVisible("site_stock") && (
                    <div>
                      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                        <Package size={13} className="text-chart-3" /> {t("pd.site.site_stock")}{siteFieldRequired("site_stock") && <span className="text-destructive">*</span>}
                      </label>
                      <input type="number" value={siteStock} onChange={(e) => setSiteStock(e.target.value)} placeholder={t("pd.stockPh")}
                        className="w-full rounded-xl border border-border bg-background px-3 py-1 text-sm outline-none focus:border-primary" />
                    </div>
                  )}
                </div>
              )}
              {(siteFieldVisible("fulfill_time") || siteFieldVisible("shipping_template")) && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {siteFieldVisible("fulfill_time") && (
                    <div>
                      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                        <Clock size={13} className="text-chart-3" /> {t("pd.site.fulfill_time")}{siteFieldRequired("fulfill_time") && <span className="text-destructive">*</span>}
                      </label>
                      <select value={fulfillTime} onChange={(e) => setFulfillTime(e.target.value)}
                        className="w-full rounded-xl border border-border bg-background px-3 py-1 text-sm outline-none focus:border-primary">
                        <option value="">{t("pd.fulfillPh")}</option>
                        <option value={tt('pd.fulfillOpt1')}>{t("pd.fulfillOpt1")}</option>
                        <option value={tt('pd.fulfillOpt2')}>{t("pd.fulfillOpt2")}</option>
                        <option value={tt('pd.fulfillOpt3')}>{t("pd.fulfillOpt3")}</option>
                        <option value={tt('pd.fulfillOpt4')}>{t("pd.fulfillOpt4")}</option>
                      </select>
                    </div>
                  )}
                  {siteFieldVisible("shipping_template") && (
                    <div>
                      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                        <Ruler size={13} className="text-chart-3" /> {t("pd.site.shipping_template")}{siteFieldRequired("shipping_template") && <span className="text-destructive">*</span>}
                      </label>
                      <input type="text" value={shippingTemplate} onChange={(e) => setShippingTemplate(e.target.value)} placeholder={t("pd.shippingTplPh")}
                        className="w-full rounded-xl border border-border bg-background px-3 py-1 text-sm outline-none focus:border-primary" />
                    </div>
                  )}
                </div>
              )}

              {/* 欧盟合规 */}
              {(siteFieldVisible("ptc") || siteFieldVisible("manufacturer") || siteFieldVisible("eu_responsible") || siteFieldVisible("warning_lang")) && (
                <div className="space-y-3 rounded-xl border border-border bg-surface-sunken/30 p-4">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-fg"><ShieldCheck size={13} className="text-chart-4" /> {t("pd.euCompliance")}</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {siteFieldVisible("ptc") && (
                      <div>
                        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                          {t("pd.site.ptc")}{siteFieldRequired("ptc") && <span className="text-destructive">*</span>}
                        </label>
                        <input type="text" value={ptc} onChange={(e) => setPtc(e.target.value)} placeholder={t("pd.site.ptc_hint")}
                          className="w-full rounded-xl border border-border bg-background px-3 py-1 text-sm outline-none focus:border-primary" />
                      </div>
                    )}
                    {siteFieldVisible("manufacturer") && (
                      <div>
                        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                          {t("pd.site.manufacturer")}{siteFieldRequired("manufacturer") && <span className="text-destructive">*</span>}
                        </label>
                        <input type="text" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} placeholder={t("pd.manufacturerPh")}
                          className="w-full rounded-xl border border-border bg-background px-3 py-1 text-sm outline-none focus:border-primary" />
                      </div>
                    )}
                    {siteFieldVisible("eu_responsible") && (
                      <div>
                        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                          {t("pd.site.eu_responsible")}{siteFieldRequired("eu_responsible") && <span className="text-destructive">*</span>}
                        </label>
                        <input type="text" value={euResponsible} onChange={(e) => setEuResponsible(e.target.value)} placeholder={t("pd.site.eu_responsible_hint")}
                          className="w-full rounded-xl border border-border bg-background px-3 py-1 text-sm outline-none focus:border-primary" />
                      </div>
                    )}
                    {siteFieldVisible("warning_lang") && (
                      <div>
                        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                          {t("pd.site.warning_lang")}{siteFieldRequired("warning_lang") && <span className="text-destructive">*</span>}
                        </label>
                        <input type="text" value={warningLang} onChange={(e) => setWarningLang(e.target.value)} placeholder={tt('pd.site.warning_lang_hint')}
                          className="w-full rounded-xl border border-border bg-background px-3 py-1 text-sm outline-none focus:border-primary" />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 文件上传项（按规则显隐/必填） */}
              <div className="space-y-3">
                {uploadVisible("cert_file") && (
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                      <FileCheck2 size={13} className="text-success" /> {t("pd.upl.cert_file")}{uploadRequired("cert_file") && <span className="text-destructive">*</span>}
                    </label>
                    {certFileUrl ? (
                      <div className="flex items-center gap-2">
                        <a href={certFileUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline">{certFileUrl.split("/").pop()}</a>
                        <Button size="sm" variant="ghost" className="h-6 text-[11px] text-destructive" onClick={() => setCertFileUrl("")}>{t("common.remove")}</Button>
                      </div>
                    ) : (
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-1 text-xs text-fg-muted hover:border-primary/50 hover:text-primary">
                        <Upload size={13} /> {t("pd.selectFile")}{uploadingSiteFile && <Loader2 size={12} className="animate-spin" />}
                        <input type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadSiteFile(f, setCertFileUrl); e.target.value = ""; }} />
                      </label>
                    )}
                  </div>
                )}
                {uploadVisible("eu_doc") && (
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                      <FileCheck2 size={13} className="text-success" /> {t("pd.upl.eu_doc")}{uploadRequired("eu_doc") && <span className="text-destructive">*</span>}
                    </label>
                    {euDocUrl ? (
                      <div className="flex items-center gap-2">
                        <a href={euDocUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline">{euDocUrl.split("/").pop()}</a>
                        <Button size="sm" variant="ghost" className="h-6 text-[11px] text-destructive" onClick={() => setEuDocUrl("")}>{t("common.remove")}</Button>
                      </div>
                    ) : (
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-1 text-xs text-fg-muted hover:border-primary/50 hover:text-primary">
                        <Upload size={13} /> {t("pd.selectFile")}{uploadingSiteFile && <Loader2 size={12} className="animate-spin" />}
                        <input type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadSiteFile(f, setEuDocUrl); e.target.value = ""; }} />
                      </label>
                    )}
                  </div>
                )}
                {uploadVisible("ce_declaration") && (
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                      <FileCheck2 size={13} className="text-success" /> {t("pd.upl.ce_declaration")}{uploadRequired("ce_declaration") && <span className="text-destructive">*</span>}
                    </label>
                    {ceDeclarationUrl ? (
                      <div className="flex items-center gap-2">
                        <a href={ceDeclarationUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline">{ceDeclarationUrl.split("/").pop()}</a>
                        <Button size="sm" variant="ghost" className="h-6 text-[11px] text-destructive" onClick={() => setCeDeclarationUrl("")}>{t("common.remove")}</Button>
                      </div>
                    ) : (
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-1 text-xs text-fg-muted hover:border-primary/50 hover:text-primary">
                        <Upload size={13} /> {t("pd.selectFile")}{uploadingSiteFile && <Loader2 size={12} className="animate-spin" />}
                        <input type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadSiteFile(f, setCeDeclarationUrl); e.target.value = ""; }} />
                      </label>
                    )}
                  </div>
                )}
                {uploadVisible("ce_report") && (
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                      <FileCheck2 size={13} className="text-success" /> {t("pd.upl.ce_report")}{uploadRequired("ce_report") && <span className="text-destructive">*</span>}
                    </label>
                    {ceReportUrl ? (
                      <div className="flex items-center gap-2">
                        <a href={ceReportUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline">{ceReportUrl.split("/").pop()}</a>
                        <Button size="sm" variant="ghost" className="h-6 text-[11px] text-destructive" onClick={() => setCeReportUrl("")}>{t("common.remove")}</Button>
                      </div>
                    ) : (
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-1 text-xs text-fg-muted hover:border-primary/50 hover:text-primary">
                        <Upload size={13} /> {t("pd.selectFile")}{uploadingSiteFile && <Loader2 size={12} className="animate-spin" />}
                        <input type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadSiteFile(f, setCeReportUrl); e.target.value = ""; }} />
                      </label>
                    )}
                  </div>
                )}
                {uploadVisible("label_image") && (
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                      <ImageIcon size={13} className="text-success" /> {t("pd.upl.label_image")}{uploadRequired("label_image") && <span className="text-destructive">*</span>}
                    </label>
                    {labelImageUrl ? (
                      <div className="flex items-center gap-2">
                        <img src={labelImageUrl} alt={t("pd.labelImageAlt")} className="h-10 w-10 rounded object-cover" />
                        <Button size="sm" variant="ghost" className="h-6 text-[11px] text-destructive" onClick={() => setLabelImageUrl("")}>{t("common.remove")}</Button>
                      </div>
                    ) : (
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-1 text-xs text-fg-muted hover:border-primary/50 hover:text-primary">
                        <Upload size={13} /> {t("pd.selectFile")}{uploadingSiteFile && <Loader2 size={12} className="animate-spin" />}
                        <input type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadSiteFile(f, setLabelImageUrl); e.target.value = ""; }} />
                      </label>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── 跨境信息：合规资质 / 供应链溯源 / 多语言信息 / 批量属性映射 ── */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-5">
            <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-fg">
              <Globe size={15} className="text-chart-2" />{t("pd.crossBorder")}
            </h3>

            {/* 合规资质 */}
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                <ShieldCheck size={13} className="text-success" />{t("pd.certs")}
              </label>
              <div className="mb-2 flex flex-wrap gap-2">
                {certifications.map((c) => (
                  <span key={c} className="inline-flex items-center gap-1 rounded-full bg-success/10 px-3 py-1 text-xs font-medium text-success">
                    {c}
                    <button onClick={() => setCertifications(certifications.filter((x) => x !== c))} className="hover:text-destructive"><X size={11} /></button>
                  </span>
                ))}
                {certifications.length === 0 && <span className="text-xs text-fg-muted">{t("pd.noCerts")}</span>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {CERT_PRESETS.filter((c) => !certifications.includes(c)).map((c) => (
                  <button key={c} onClick={() => addCert(c)} className="rounded-full border border-border px-2.5 py-1 text-[11px] text-fg-muted transition-colors hover:border-primary/50 hover:text-primary">
                    + {c}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  type="text" value={certInput} onChange={(e) => setCertInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCert(certInput))}
                  placeholder={t("pd.certPlaceholder")}
                  className="flex-1 rounded-xl border border-border bg-background px-3 py-1 text-xs outline-none focus:border-primary"
                />
                <Button size="sm" variant="outline" onClick={() => addCert(certInput)}><Plus size={13} />{t("pd.add")}</Button>
              </div>
            </div>

            {/* 供应链溯源 */}
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                <Factory size={13} className="text-chart-3" />{t("pd.supplyChain")}
              </label>
              <div className="grid grid-cols-2 gap-3">
                <input type="text" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder={t("pd.supplierPh")} className="rounded-xl border border-border bg-background px-3 py-1 text-xs outline-none focus:border-primary" />
                <input type="text" value={originCountry} onChange={(e) => setOriginCountry(e.target.value)} placeholder={t("pd.originPh")} className="rounded-xl border border-border bg-background px-3 py-1 text-xs outline-none focus:border-primary" />
                <input type="text" value={hsCode} onChange={(e) => setHsCode(e.target.value)} placeholder={t("pd.hsPh")} className="rounded-xl border border-border bg-background px-3 py-1 text-xs outline-none focus:border-primary" />
                <input type="text" value={factoryCert} onChange={(e) => setFactoryCert(e.target.value)} placeholder={t("pd.factoryCertPh")} className="rounded-xl border border-border bg-background px-3 py-1 text-xs outline-none focus:border-primary" />
              </div>
            </div>

            {/* 多语言信息 */}
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                <Languages size={13} className="text-chart-2" />{t("pd.multilingual")}
              </label>
              {multilingual.length > 0 && (
                <div className="mb-2 space-y-1.5">
                  {multilingual.map((m) => (
                    <div key={m.lang} className="flex items-start justify-between gap-2 rounded-xl border border-border bg-surface-sunken/40 px-3 py-1">
                      <div className="min-w-0">
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{LANG_LABEL[m.lang] ? t(LANG_LABEL[m.lang]) : m.lang}</span>
                        <p className="mt-1 truncate text-xs font-medium text-fg">{m.title}</p>
                        {m.description && <p className="truncate text-[11px] text-fg-muted">{m.description}</p>}
                      </div>
                      <button onClick={() => setMultilingual(multilingual.filter((x) => x.lang !== m.lang))} className="text-fg-muted hover:text-destructive"><X size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
              {aiI18nEntries.length > 0 && (
                <div className="mb-2 space-y-1.5">
                  {aiI18nEntries.map((v) => (
                    <div key={`ai-${v.lang}`} className="flex items-start gap-2 rounded-xl border border-dashed border-border bg-surface-sunken/20 px-3 py-1">
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-chart-2/10 px-2 py-0.5 text-[10px] font-semibold text-chart-2">{LANG_LABEL[v.lang] ? t(LANG_LABEL[v.lang]) : v.lang} · AI</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-fg">{v.name}</p>
                        {v.description && <p className="truncate text-[11px] text-fg-muted">{v.description}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[120px_1fr_1fr_auto]">
                <select value={mlLang} onChange={(e) => setMlLang(e.target.value)} className="rounded-xl border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary">
                  {Object.entries(LANG_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
                </select>
                <input type="text" value={mlTitle} onChange={(e) => setMlTitle(e.target.value)} placeholder={t("pd.mlTitlePh")} className="rounded-xl border border-border bg-background px-3 py-1 text-xs outline-none focus:border-primary" />
                <input type="text" value={mlDesc} onChange={(e) => setMlDesc(e.target.value)} placeholder={t("pd.mlDescPh")} className="rounded-xl border border-border bg-background px-3 py-1 text-xs outline-none focus:border-primary" />
                <Button size="sm" variant="outline" onClick={addMultilingual}><Plus size={13} />{t("pd.add")}</Button>
              </div>
            </div>

            {/* 批量属性映射 */}
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                <KeyRound size={13} className="text-chart-4" />{t("pd.attrMapping")}
              </label>
              {attrPairs.length > 0 && (
                <div className="mb-2 overflow-hidden rounded-xl border border-border">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-border bg-surface-sunken">
                      <tr>
                        <th className="px-3 py-1 font-medium text-fg-muted whitespace-nowrap">{t("pd.attrName")}</th>
                        <th className="px-3 py-1 font-medium text-fg-muted whitespace-nowrap">{t("pd.attrValue")}</th>
                        <th className="w-10 px-2 py-1 whitespace-nowrap" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {attrPairs.map((a, i) => (
                        <tr key={i}>
                          <td className="px-3 py-1.5 font-medium text-fg align-middle">{a.name}</td>
                          <td className="px-3 py-1.5 text-fg-muted align-middle">{a.value}</td>
                          <td className="px-2 py-1.5 align-middle"><button onClick={() => setAttrPairs(attrPairs.filter((_, x) => x !== i))} className="text-fg-muted hover:text-destructive"><X size={12} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <input type="text" value={attrName} onChange={(e) => setAttrName(e.target.value)} placeholder={t("pd.attrNamePh")} className="rounded-xl border border-border bg-background px-3 py-1 text-xs outline-none focus:border-primary" />
                <input type="text" value={attrValue} onChange={(e) => setAttrValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addAttrPair())} placeholder={t("pd.attrValuePh")} className="rounded-xl border border-border bg-background px-3 py-1 text-xs outline-none focus:border-primary" />
                <Button size="sm" variant="outline" onClick={addAttrPair}><Plus size={13} />{t("pd.add")}</Button>
              </div>
            </div>
          </div>

          {/* ── 变体管理（连续添加多组） ── */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-fg">
                <Layers size={15} className="text-chart-2" /> {t("pd.variants")}
                <span className="text-xs font-normal text-fg-muted">
                  {t("pd.variantCount", { saved: variants.length, pending: pendingVariants.length ? t("pd.variantPendingSuffix", { n: pendingVariants.length }) : "" })}
                </span>
              </h3>
              <Button size="sm" variant="outline" onClick={() => { resetVariantFields(); setShowVariantForm(true); }}>
                <Plus size={14} className="mr-1" /> {t("pd.addVariant")}
              </Button>
            </div>

            {/* 规格组合生成器 */}
            <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
              <p className="mb-2 text-sm font-medium text-fg">{t("pd.comboDesc")}</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text" value={specName} onChange={(e) => setSpecName(e.target.value)}
                  placeholder={t("pd.specNamePh")}
                  className="flex-1 rounded-xl border border-border bg-background px-3 py-1 text-sm outline-none focus:border-primary"
                />
                <input
                  type="text" value={specValues} onChange={(e) => setSpecValues(e.target.value)}
                  placeholder={t("pd.specValuesPh")}
                  className="flex-[2] rounded-xl border border-border bg-background px-3 py-1 text-sm outline-none focus:border-primary"
                />
                <Button size="sm" variant="outline" onClick={addSpecGroup}>
                  <Plus size={14} className="mr-1" />{t("pd.addSpec")}
                </Button>
              </div>

              {specGroups.length > 0 && (
                <div className="mt-3 space-y-2">
                  {specGroups.map((g, gi) => (
                    <div key={gi} className="flex flex-wrap items-center gap-2 rounded-xl bg-background px-3 py-1 text-sm">
                      <span className="font-medium text-fg">{g.name}：</span>
                      {g.values.map((v, vi) => (
                        <span key={vi} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary">{v}</span>
                      ))}
                      <button
                        onClick={() => removeSpecGroup(gi)}
                        className="ml-auto text-fg-muted hover:text-destructive"
                        title={t("pd.deleteSpec")}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  <Button size="sm" onClick={generateVariants} disabled={comboCount === 0}>
                    <Sparkles size={13} className="mr-1" /> {t("pd.generateCombos", { n: comboCount })}
                  </Button>
                </div>
              )}
            </div>

            {/* 待保存组合 */}
            {pendingVariants.length > 0 && (
              <div className="mb-4 rounded-xl border border-border bg-background p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-medium text-fg">
                    {isNew
                      ? t("pd.pendingVariantsHint", { n: pendingVariants.length })
                      : t("pd.pendingCombos", { n: pendingVariants.length })}
                  </p>
                  {isNew ? (
                    <Button size="sm" variant="ghost" onClick={() => setPendingVariants([])}>
                      <X size={14} className="mr-1" /> {t("pd.clearAll")}
                    </Button>
                  ) : (
                    <Button size="sm" onClick={saveAllVariants} disabled={savingVariants}>
                      {savingVariants ? t("pd.saving") : <><Check size={14} className="mr-1" /> {t("pd.saveAllVariants")}</>}
                    </Button>
                  )}
                </div>
                <div className="max-h-72 overflow-auto rounded-xl border border-border">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 border-b border-border bg-surface-sunken">
                      <tr>
                        <th className="px-3 py-1 font-medium text-fg-muted whitespace-nowrap">SKU</th>
                        <th className="px-3 py-1 font-medium text-fg-muted whitespace-nowrap">{t("pd.attrs")}</th>
                        <th className="px-3 py-1 font-medium text-fg-muted whitespace-nowrap">{t("products.col.price")}</th>
                        <th className="px-3 py-1 font-medium text-fg-muted whitespace-nowrap">{t("products.col.stock")}</th>
                        <th className="px-3 py-1 font-medium text-fg-muted whitespace-nowrap"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {pendingVariants.map((pv, pi) => (
                        <tr key={pi}>
                          <td className="px-3 py-1.5 align-middle">
                            <input
                              type="text" value={pv.sku}
                              onChange={(e) => setPendingVariants(pendingVariants.map((x, i) => (i === pi ? { ...x, sku: e.target.value } : x)))}
                              className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
                            />
                          </td>
                          <td className="px-3 py-1.5 text-xs text-fg align-middle">{variantAttrsDisp(pv.attrs, lang, t)}</td>
                          <td className="px-3 py-1.5 align-middle">
                            <input
                              type="number" value={pv.price}
                              onChange={(e) => setPendingVariants(pendingVariants.map((x, i) => (i === pi ? { ...x, price: e.target.value } : x)))}
                              className="w-24 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
                            />
                          </td>
                          <td className="px-3 py-1.5 align-middle">
                            <input
                              type="number" value={pv.stock}
                              onChange={(e) => setPendingVariants(pendingVariants.map((x, i) => (i === pi ? { ...x, stock: e.target.value } : x)))}
                              className="w-24 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
                            />
                          </td>
                          <td className="px-3 py-1.5 align-middle">
                            <button onClick={() => removePending(pi)} className="text-fg-muted hover:text-destructive"><X size={14} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[11px] text-fg-muted">
                  {isNew
                    ? t("pd.variantNoteNew")
                    : t("pd.variantNoteEdit")}
                </p>
              </div>
            )}

            {/* 变体表单：保存后保持打开，连续添加多组 */}
            {showVariantForm && (
              <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-medium text-fg">{editingVariantIdx !== null ? t("pd.editVariant") : t("pd.newVariant")}</p>
                  {editingVariantIdx === null && (
                    <span className="text-[11px] text-fg-muted">
                      {isNew ? t("pd.variantFormHintNew") : t("pd.variantFormHintEdit")}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <input type="text" value={variantSku} onChange={(e) => setVariantSku(e.target.value)} placeholder="SKU" className="rounded-xl border border-border bg-background px-3 py-1 text-sm outline-none focus:border-primary" />
                  <input type="text" value={variantAttrs} onChange={(e) => setVariantAttrs(e.target.value)} placeholder={t("pd.variantAttrsPh")} className="rounded-xl border border-border bg-background px-3 py-1 text-sm outline-none focus:border-primary" />
                  <input type="number" value={variantPrice} onChange={(e) => setVariantPrice(e.target.value)} placeholder={t("products.col.price")} className="rounded-xl border border-border bg-background px-3 py-1 text-sm outline-none focus:border-primary" />
                  <input type="number" value={variantStock} onChange={(e) => setVariantStock(e.target.value)} placeholder={t("products.col.stock")} className="rounded-xl border border-border bg-background px-3 py-1 text-sm outline-none focus:border-primary" />
                </div>
                <div className="mt-3 flex gap-2">
                  {editingVariantIdx !== null ? (
                    <Button size="sm" onClick={() => handleSaveVariant(false)}>{t("pd.saveChanges")}</Button>
                  ) : (
                    <>
                      <Button size="sm" onClick={() => handleSaveVariant(false)}>
                        {isNew ? t("pd.addPending") : t("common.save")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleSaveVariant(true)}>
                        <Plus size={13} className="mr-1" />{isNew ? t("pd.addAndContinue") : t("pd.saveAndContinue")}
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" onClick={resetVariantForm}>{t("common.done")}</Button>
                </div>
              </div>
            )}

            {/* 变体列表（待保存草稿展示在上方独立表格中） */}
            {variants.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12">
                <Layers size={32} className="text-fg-muted/40" />
                <p className="mt-2 text-sm text-fg-muted">
                  {pendingVariants.length > 0
                    ? t("pd.variantsEmptyNew")
                    : isNew
                      ? t("pd.variantsEmptyWithHints")
                      : t("pd.variantsEmpty")}
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border bg-surface-sunken">
                    <tr>
                      <th className="px-4 py-2.5 font-medium text-fg-muted whitespace-nowrap">SKU</th>
                      <th className="px-4 py-2.5 font-medium text-fg-muted whitespace-nowrap">{t("pd.attrs")}</th>
                      {siteFieldVisible("ean") && (
                        <th className="px-4 py-2.5 font-medium text-fg-muted whitespace-nowrap">
                          EAN-13 {siteFieldRequired("ean") && <span className="text-destructive">*</span>}
                        </th>
                      )}
                      <th className="px-4 py-2.5 font-medium text-fg-muted whitespace-nowrap">{t("products.col.price")}</th>
                      <th className="px-4 py-2.5 font-medium text-fg-muted whitespace-nowrap">{t("products.col.stock")}</th>
                      <th className="px-4 py-2.5 font-medium text-fg-muted whitespace-nowrap">{t("common.actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {variants.map((v, idx) => (
                      <tr key={v.id} className="hover:bg-surface-hover">
                        <td className="px-4 py-2.5 font-data align-middle whitespace-nowrap">{v.sku}</td>
                        <td className="px-4 py-2.5 align-middle">{variantAttrsDisp(v.attributes, lang, t)}</td>
                        {siteFieldVisible("ean") && (
                          <td className="px-4 py-2.5 align-middle">
                            <input
                              type="text" value={eanMap[v.sku] ?? ""}
                              onChange={(e) => setEanMap((prev) => ({ ...prev, [v.sku]: e.target.value }))}
                              placeholder={t("pd.eanPh")}
                              className="w-36 rounded-md border border-border bg-background px-2 py-1 font-data text-xs outline-none focus:border-primary"
                            />
                          </td>
                        )}
                        <td className="px-4 py-2.5 font-data align-middle whitespace-nowrap">{v.price != null ? `¥${Number(v.price).toFixed(2)}` : "—"}</td>
                        <td className="px-4 py-2.5 font-data align-middle whitespace-nowrap">{v.stock ?? "—"}</td>
                        <td className="px-4 py-2.5 align-middle">
                          <div className="flex gap-2">
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleEditVariant(idx)}>{t("common.edit")}</Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:bg-danger-bg" onClick={() => handleDeleteVariant(idx)}>{t("common.delete")}</Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── AI 工具区（完整工具 + AI 看图写文案） ── */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="mb-1 flex items-center gap-2 font-display text-sm font-semibold text-fg">
              <Sparkles size={15} className="text-chart-1" />{t("pd.aiTools")}
            </h3>
            <p className="mb-4 text-xs text-fg-muted">{t("pd.aiToolsHint")}</p>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* AI 看图写文案 */}
              <div className="rounded-xl border border-border bg-surface-sunken/30 p-4">
                <h4 className="mb-1 flex items-center gap-2 text-sm font-semibold text-fg">
                  <Sparkles size={14} className="text-chart-1" />{t("pd.aiCopyFromImage")}
                </h4>
                <p className="mb-3 text-xs text-fg-muted">{t("pd.aiCopyHint")}</p>
                <Button className="w-full" size="sm" variant="outline" onClick={handleAiVisionCopy} disabled={aiVisionCopying}>
                  {aiVisionCopying ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Sparkles size={14} className="mr-1.5" />}
                  {t("pd.startGenerate")}
                </Button>
                {(aiVisionCopying || aiPartial) && (
                  <div className="mt-3 max-h-48 overflow-y-auto rounded-xl bg-background p-3 text-xs whitespace-pre-wrap text-fg">
                    {aiPartial}{aiVisionCopying && <span className="inline-block h-3 w-1 animate-pulse bg-primary" />}
                  </div>
                )}
              </div>

              {/* 工具提示 */}
              <div className="rounded-xl border border-border bg-surface-sunken/30 p-4">
                <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
                  <Info size={14} className="text-chart-3" />{t("pd.quickTips")}
                </h4>
                <ul className="space-y-1.5 text-xs text-fg-muted">
                  <li className="flex gap-1.5"><Languages size={12} className="mt-0.5 shrink-0 text-primary" /> {t("pd.tip1")}</li>
                  <li className="flex gap-1.5"><Wand2 size={12} className="mt-0.5 shrink-0 text-primary" /> {t("pd.tip2")}</li>
                  <li className="flex gap-1.5"><ImageIcon size={12} className="mt-0.5 shrink-0 text-primary" /> {t("pd.tip3")}</li>
                  <li className="flex gap-1.5"><Layers size={12} className="mt-0.5 shrink-0 text-primary" /> {t("pd.tip4")}</li>
                </ul>
              </div>
            </div>
          </div>

          {/* ── 高级设置：SEO / 物流 / 标签 ── */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-5">
            <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-fg">
              <Settings size={15} className="text-chart-4" />{t("pd.advanced")}
            </h3>

            {/* 标签 */}
            <div>
              <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
                <Tag size={14} className="text-chart-4" />{t("pd.tags")}
              </h4>
              <div className="flex flex-wrap gap-2 mb-3">
                {tags.map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                    {tag}
                    <button onClick={() => setTags(tags.filter((tt) => tt !== tag))} className="hover:text-destructive"><X size={12} /></button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text" value={tagInput} onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
                  placeholder={t("pd.tagPh")}
                  className="flex-1 rounded-xl border border-border bg-background px-3 py-1 text-sm outline-none focus:border-primary"
                />
                <Button size="sm" variant="outline" onClick={addTag}><Plus size={14} />{t("pd.add")}</Button>
              </div>
            </div>
          </div>
        </div>

        {/* 右：发布检查 + 快速预览 */}
        <div className="space-y-5">
          <div id="publish-check" className="rounded-xl border border-border bg-card p-5 scroll-mt-28">
            <h3 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold text-fg">
              {allChecksPass ? <CheckCircle2 size={15} className="text-success" /> : <AlertCircle size={15} className="text-warning" />}
              {t("pd.publishCheck")}
            </h3>
            <div className="space-y-2">
              {publishChecks.map((c) => (
                <div key={c.label} className="flex items-center gap-2 text-sm">
                  {c.pass ? <CheckCircle2 size={14} className="shrink-0 text-success" /> : <AlertCircle size={14} className="shrink-0 text-fg-muted" />}
                  <span className={c.pass ? "text-fg" : "text-fg-muted"}>{t(c.label)}</span>
                </div>
              ))}
            </div>
            {allChecksPass && (
              <Button className="mt-4 w-full" size="sm" onClick={() => handleSave(true)} disabled={saving}>
                <Send size={14} className="mr-1.5" />{t("pd.publishNow")}
              </Button>
            )}
          </div>

          {images[0] && (
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold text-fg">
                <Eye size={15} className="text-chart-4" />{t("pd.quickPreview")}
              </h3>
              <div className="overflow-hidden rounded-xl border border-border">
                <img src={images[0]} alt={t("pd.previewAlt")} className="aspect-square w-full object-cover" />
              </div>
              <p className="mt-2 text-sm font-medium text-fg line-clamp-1">{name || t("pd.unnamedProduct")}</p>
              <p className="mt-0.5 font-data text-sm font-semibold text-primary">¥{Number(price || 0).toFixed(2)}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {certifications.slice(0, 4).map((c) => (
                  <span key={c} className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">{c}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ 切换店铺确认弹窗 ═══ */}
      <AlertDialog open={switchConfirmOpen} onOpenChange={(o) => { if (!o) setSwitchConfirmOpen(false); }}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-warning" />{t("pd.switchShop")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("pd.switchShopConfirmA")}<b>{t("pd.siteSpecificContent")}</b>{t("pd.switchShopConfirmB")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSwitchShop} className="bg-warning text-white hover:bg-warning">{t("pd.confirmSwitch")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ═══ 底部保存栏 ═══ */}
      <div className="sticky bottom-0 flex items-center justify-between rounded-xl border border-border bg-card/95 px-5 py-3 backdrop-blur-md">
        <div className="text-xs text-fg-muted">
          {isNew ? t("pd.newProduct") : t("pd.lastUpdated", { time: product?.updated_at ? new Date(product.updated_at as string).toLocaleString(lang === "en" ? "en-US" : "zh-CN") : "—" })}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => handleSave(false)} disabled={saving}>
            {saving ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Save size={14} className="mr-1.5" />}
            {t("common.save")}
          </Button>
          <Button size="sm" onClick={() => handleSave(true)} disabled={saving}>
            {saving ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Send size={14} className="mr-1.5" />}
            {t("pd.savePublish")}
          </Button>
        </div>
      </div>

      {/* 刊登发布引擎：刊登到店铺 */}
      <PublishListingDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        product={isNew ? null : { id, name: name || "", sku: sku || "" }}
      />

      {/* P0-2：AI 产品翻译 + 一键算价 */}
      <AiTranslateDialog
        open={translateOpen}
        onOpenChange={setTranslateOpen}
        product={isNew ? null : { id, name: name || "", description: description || "" }}
      />
      <PriceCalcDialog
        open={calcOpen}
        onOpenChange={setCalcOpen}
        product={isNew ? null : { id, cost: cost ? Number(cost) : null }}
        onApply={(p) => { setPrice(String(p)); }}
      />
    </div>
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
