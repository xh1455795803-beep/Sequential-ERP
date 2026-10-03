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
  Store, Building2, RefreshCcw, FileUp, FileDown, AlertTriangle, FileCheck2, Clock,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import {
  requestLLMStream,
  requestVisionStream,
  generateImage, extractImageUrl,
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
import * as XLSX from "xlsx";
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
const LANG_LABEL: Record<string, string> = { en: "英语", ja: "日语", ko: "韩语", es: "西班牙语", fr: "法语", de: "德语", pt: "葡萄牙语", ru: "俄语", th: "泰语", vi: "越南语", "zh-TW": "繁体中文", ar: "阿拉伯语", id: "印尼语" };

// 站点专属字段定义（统一刊登编辑页 · 由店铺规则控制显隐/必填）
// key 与 shop_listing_rules.fields 一一对应
const SITE_FIELDS: { key: string; label: string; hint: string }[] = [
  { key: "site_title", label: "当地语言标题", hint: "该店铺站点使用的当地语言商品标题" },
  { key: "site_bullets", label: "当地语言卖点", hint: "每行一条卖点，如：材质防水 / 五年质保" },
  { key: "site_description", label: "当地语言详情", hint: "该店铺站点的详细描述（当地语言）" },
  { key: "site_price", label: "站点售价", hint: "该店铺站点的实际售价（当地货币）" },
  { key: "site_stock", label: "站点库存", hint: "该店铺站点的可售库存数量" },
  { key: "fulfill_time", label: "备货时效", hint: "如：现货 24h 内发出 / 7-15 天备货" },
  { key: "shipping_template", label: "运费模板", hint: "选择该店铺绑定的运费模板" },
  { key: "ean", label: "EAN-13 条码", hint: "SKU 表格中为每个变体填写 EAN-13（欧盟店必填）" },
  { key: "ptc", label: "PTC 商品税务编码", hint: "欧盟商品税务编码（如适用）" },
  { key: "manufacturer", label: "制造商信息", hint: "制造商名称与地址（欧盟法规要求）" },
  { key: "eu_responsible", label: "欧盟责任人（欧代）", hint: "名称 / 地址 / 邮箱" },
  { key: "eu_doc", label: "欧代授权文件", hint: "上传欧盟代表授权书（.pdf/.jpg）" },
  { key: "ce_declaration", label: "CE 符合性声明", hint: "上传 CE 符合性声明文件" },
  { key: "ce_report", label: "产品检测报告", hint: "上传检测报告（如 EN/IEC 报告）" },
  { key: "label_image", label: "产品标签图", hint: "上传产品标签图（含制造商/进口商信息）" },
  { key: "warning_lang", label: "对应语言警示语", hint: "当地语言的安全警示语" },
];

// 文件上传项（存 uploads 规则）
const SITE_UPLOADS: { key: string; label: string; hint: string }[] = [
  { key: "cert_file", label: "本地证书（TISI/SIRIM）", hint: "东南亚店铺本地认证证书上传" },
  { key: "eu_doc", label: "欧代授权文件", hint: "欧盟代表授权书" },
  { key: "ce_declaration", label: "CE 符合性声明", hint: "CE 声明文件" },
  { key: "ce_report", label: "产品检测报告", hint: "检测报告文件" },
  { key: "label_image", label: "产品标签图", hint: "标签图片" },
];

function ProductEdit() {
  const { id } = Route.useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { user, status: authStatus } = useAuth();

  const isNew = id === "new";
  const isNewRef = useRef(isNew);
  if (isNew !== isNewRef.current) isNewRef.current = isNew;


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
    if (!user) { toast.error("请先登录"); return; }
    if (!name.trim()) { toast.error("请填写商品名称"); return; }
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
        toast.error(ruleErr || `发布检查未通过：${firstFailed.label}${firstFailed.label === "商品描述（≥20字）" ? "（至少 20 字）" : ""} 不能为空`);
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
        source_platform: sourcePlatform, source_url: sourceUrl,
        shop_id: selectedShopId || null,
        extras,
      };
      if (isNewRef.current) {
        const now = new Date().toISOString();
        await insertRow("products", { ...patch, created_at: now, updated_at: now });
        toast.success("商品已创建");
      } else {
        patch.updated_at = new Date().toISOString();
        await updateRow("products", id, patch);
        toast.success(publish ? "商品已发布" : "保存成功");
      }
      await loadProduct();
    } catch (e) { toast.error("保存失败：" + (e instanceof Error ? e.message : "未知错误")); }
    finally { setSaving(false); }
  };

  /* ── 图片上传（点击 + 拖拽共用） ── */
  const uploadFiles = async (files: File[]) => {
    if (!files.length) return;
    for (const file of files) {
      if (!file.type.startsWith("image/")) { toast.error(`${file.name} 不是图片`); continue; }
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from(STORAGE_BUCKET_ID).upload(path, file, { upsertReply: false } as any);
      if (error) { toast.error(`上传失败：${error.message}`); continue; }
      const { data: urlData } = supabase.storage.from(STORAGE_BUCKET_ID).getPublicUrl(path);
      setImages((prev) => [...prev, urlData.publicUrl]);
      toast.success("图片已上传");
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
    if (!mlTitle.trim()) { toast.error("请填写多语言标题"); return; }
    setMultilingual((prev) => [...prev.filter((m) => m.lang !== mlLang), { lang: mlLang, title: mlTitle.trim(), description: mlDesc.trim() }]);
    setMlTitle(""); setMlDesc("");
    toast.success(`已添加${LANG_LABEL[mlLang] ?? mlLang}信息`);
  };

  /* ── 批量属性映射 ── */
  const addAttrPair = () => {
    if (!attrName.trim()) { toast.error("请填写属性名"); return; }
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

  const handleSaveVariant = async () => {
    const now = new Date().toISOString();
    const row = {
      product_id: id, sku: variantSku, attributes: variantAttrs,
      price: variantPrice ? Number(variantPrice) : null,
      stock: variantStock ? Number(variantStock) : null,
      updated_at: now,
    };
    try {
      if (editingVariantIdx !== null) {
        await updateRow("product_variants", variants[editingVariantIdx].id, row);
        toast.success("变体已更新");
        resetVariantForm();
      } else {
        await insertRow("product_variants", { ...row, created_at: now });
        toast.success("变体已添加，可继续添加下一组");
        resetVariantFields();
        setShowVariantForm(true); // 保持表单打开，连续添加
      }
      await loadProduct();
    } catch (e) { toast.error("变体保存失败：" + (e instanceof Error ? e.message : "未知错误")); }
  };

  const handleDeleteVariant = async (idx: number) => {
    try {
      await deleteRow("product_variants", variants[idx].id);
      toast.success("变体已删除"); await loadProduct();
    } catch (e) { toast.error("删除失败：" + (e instanceof Error ? e.message : "未知错误")); }
  };

  /* ── 变体：规格组合生成 ── */
  const activeSpecGroups = specGroups.filter((g) => g.name.trim() && g.values.length > 0);
  const comboCount = activeSpecGroups.length ? activeSpecGroups.reduce((acc, g) => acc * g.values.length, 1) : 0;

  const addSpecGroup = () => {
    const name = specName.trim();
    const values = specValues.split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!name) { toast.error("请填写规格名（如 颜色 / 尺寸）"); return; }
    if (!values.length) { toast.error("请填写选项值，用逗号分隔（如 红,蓝,绿）"); return; }
    if (specGroups.some((g) => g.name === name)) { toast.error(`规格「${name}」已存在`); return; }
    setSpecGroups([...specGroups, { name, values }]);
    setSpecName(""); setSpecValues("");
  };

  const removeSpecGroup = (idx: number) => setSpecGroups(specGroups.filter((_, i) => i !== idx));

  const generateVariants = () => {
    if (!activeSpecGroups.length) { toast.error("请先添加规格组（规格名 + 选项值）"); return; }
    let combos: string[][] = [[]];
    for (const g of activeSpecGroups) {
      const next: string[][] = [];
      for (const a of combos) for (const v of g.values) next.push([...a, `${g.name.trim()}:${v}`]);
      combos = next;
    }
    const base = sku.trim() || "V";
    const defaultPrice = price ? String(price) : "";
    const defaultStock = stock ? String(stock) : "";
    setPendingVariants(combos.map((attrs, i) => ({
      sku: `${base}-${i + 1}`,
      attrs: attrs.join(" / "),
      price: defaultPrice,
      stock: defaultStock,
    })));
    toast.success(`已生成 ${combos.length} 个组合，可修改 SKU/价格/库存后保存`);
  };

  const removePending = (idx: number) => setPendingVariants(pendingVariants.filter((_, i) => i !== idx));

  const saveAllVariants = async () => {
    if (!pendingVariants.length) return;
    setSavingVariants(true);
    try {
      const now = new Date().toISOString();
      const existing = [...variants];
      let added = 0, updated = 0;
      for (const pv of pendingVariants) {
        const dup = existing.find((v) => String(v.attributes || "") === pv.attrs);
        const row = {
          product_id: id, sku: pv.sku,
          attributes: pv.attrs,
          price: pv.price ? Number(pv.price) : null,
          stock: pv.stock ? Number(pv.stock) : null,
        };
        if (dup) { await updateRow("product_variants", dup.id, row); updated++; }
        else { await insertRow("product_variants", { ...row, created_at: now }); added++; }
      }
      toast.success(`变体保存完成：新增 ${added} 个，更新 ${updated} 个`);
      setPendingVariants([]);
      setSpecGroups([]);
      await loadProduct();
    } catch (e) {
      toast.error("变体保存失败：" + (e instanceof Error ? e.message : "未知错误"));
    } finally { setSavingVariants(false); }
  };

  /* ── AI：标题翻译（原位） ── */
  const handleTranslateTitle = async () => {
    if (!user) { toast.error("请先登录"); return; }
    if (!name.trim()) { toast.error("请先填写商品名称"); return; }
    setTitleTranslating(true);
    try {
      let result = "";
      await requestLLMStream(
        [{ role: "user", content: `Translate the following product title into ${LANG_LABEL[translateTitleLang] ?? translateTitleLang} (${translateTitleLang}). Output ONLY the translated title, no quotes, no extra text.\n\nTitle: ${name}` }],
        (chunk) => { result += chunk; setName(result.trim()); },
        { serviceKey: "title_gen" }
      );
      toast.success(`标题已翻译为${LANG_LABEL[translateTitleLang] ?? translateTitleLang}`);
    } catch { toast.error("标题翻译失败"); }
    finally { setTitleTranslating(false); }
  };

  /* ── AI：图片文字翻译（原位） ── */
  const handleStartTranslateImage = async () => {
    if (!user) { toast.error("请先登录"); return; }
    if (!images.length) { toast.error("请先上传商品图片"); return; }
    setAiTarget("image-translate"); setAiStreaming(true); setAiPartial(""); aiPartialRef.current = "";
    try {
      const { data: blob } = await supabase.storage.from(STORAGE_BUCKET_ID).download(images[0]);
      if (!blob) throw new Error("下载图片失败");
      const b64 = await blobToBase64(blob);
      await requestVisionStream(
        [{ role: "user", content: [
          { type: "image_url", image_url: { url: b64 } },
          { type: "text", text: `Extract all text from this product image and translate it into ${LANG_LABEL[translationTargetLang] ?? translationTargetLang}.` }
        ] }],
        (chunk) => { aiPartialRef.current += chunk; setAiPartial(aiPartialRef.current); }
      );
    } catch (e) { setAiPartial("翻译失败：" + (e instanceof Error ? e.message : "未知错误")); }
    finally { setAiStreaming(false); }
  };

  const handleCopyTranslation = () => { navigator.clipboard.writeText(aiPartial); toast.success("已复制翻译结果"); };

  /* ── AI：文案优化（原位） ── */
  const handleOptimizeCopy = async () => {
    if (!user) { toast.error("请先登录"); return; }
    if (!name && !description) { toast.error("请先填写商品基本信息"); return; }
    setAiCopying(true); setCopyOptimizeResult("");
    try {
      let result = "";
      await requestLLMStream(
        [{ role: "user", content: `请为以下跨境电商商品优化营销文案，包括：1）优化后的商品标题（英文）2）五点产品卖点（英文Bullet Points）3）产品描述（英文，200字以内）\n\n商品名称：${name}\n商品描述：${description}\n分类：${category}` }],
        (chunk) => { result += chunk; setCopyOptimizeResult(result); },
        { serviceKey: "desc_gen" }
      );
    } catch { toast.error("文案优化失败"); }
    finally { setAiCopying(false); }
  };

  const applyCopyToDescription = () => {
    if (!copyOptimizeResult) return;
    setDescription((prev) => (prev ? prev + "\n\n" : "") + copyOptimizeResult);
    toast.success("已应用到描述，可继续编辑");
  };

  /* ── AI：场景图生成 ── */
  const handleGenSceneImage = async () => {
    if (!user) { toast.error("请先登录"); return; }
    if (!images.length) { toast.error("请先上传商品图片"); return; }
    setAiImageGen("generating");
    try {
      const prompt = sceneGenPrompt || `Professional e-commerce product photography of ${name || "product"}, studio lighting, white background, high quality, commercial style`;
      const resp = await generateImage(prompt); const url = extractImageUrl(resp); if (!url) throw new Error("图片生成失败");
      setImages((prev) => [...prev, url]);
      toast.success("场景图已生成并添加到图片列表");
      setAiImageGen(null);
    } catch { toast.error("场景图生成失败"); setAiImageGen(null); }
  };

  /* ── AI：商品视频生成 ── */
  const handleGenVideo = async () => {
    if (!user) { toast.error("请先登录"); return; }
    if (!name && !images.length) { toast.error("请先填写商品信息或上传图片"); return; }
    setVideoGen("generating");
    try {
      const prompt = `Product showcase scene for ${name || "product"}: professional e-commerce video storyboard, product centered, clean background, dramatic lighting, cinematic composition`;
      const resp = await generateImage(prompt); const url = extractImageUrl(resp); if (!url) throw new Error("图片生成失败");
      setImages((prev) => [...prev, url]);
      toast.success("视频分镜图已生成，已添加到图片列表");
      setVideoGen(null);
    } catch { toast.error("生成失败"); setVideoGen(null); }
  };

  const handleAiVisionCopy = async () => {
    if (!user) { toast.error("请先登录"); return; }
    if (!images.length) { toast.error("请先上传商品图片"); return; }
    setAiVisionCopying(true); setAiPartial(""); aiPartialRef.current = "";
    try {
      const { data: blob } = await supabase.storage.from(STORAGE_BUCKET_ID).download(images[0]);
      if (!blob) throw new Error("下载图片失败");
      const b64 = await blobToBase64(blob);
      await requestVisionStream(
        [{ role: "user", content: [
          { type: "image_url", image_url: { url: b64 } },
          { type: "text", text: "请为这张商品图片生成跨境电商产品文案，包括：标题（英文）、五点卖点（英文）、简短描述（英文）" }
        ] }],
        (chunk) => { aiPartialRef.current += chunk; setAiPartial(aiPartialRef.current); }
      );
    } catch (e) { setAiPartial("生成失败：" + (e instanceof Error ? e.message : "未知错误")); }
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
    if (!srcId) { toast.error("当前草稿未绑定产品基础库来源（请通过「分发刊登」创建）"); return; }
    setSyncingFromBase(true);
    try {
      const all = await fetchProducts();
      const src = all.find((x) => x.id === srcId);
      if (!src) { toast.error("未找到来源产品（可能已被删除）"); return; }
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
      // 同步变体（并入待保存组合，点击「保存变体」落库；不静默删除草稿既有变体）
      const vs = await fetchTable("product_variants");
      const srcVs = vs.filter((v: any) => v.product_id === srcId);
      setPendingVariants(srcVs.map((v: any) => ({
        sku: v.sku ?? "",
        attrs: v.attributes ?? "",
        price: v.price != null ? String(v.price) : "",
        stock: v.stock != null ? String(v.stock) : "",
      })));
      setVariants(srcVs);
      toast.success("已从产品基础库同步公共信息（变体已并入待保存组合，请点击「保存变体」确认；站点专属内容已保留）");
    } catch (e) {
      toast.error("同步失败：" + (e instanceof Error ? e.message : "未知错误"));
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
      if (error) { toast.error(`上传失败：${error.message}`); return; }
      const { data: urlData } = supabase.storage.from(STORAGE_BUCKET_ID).getPublicUrl(path);
      target(urlData.publicUrl);
      toast.success("文件已上传");
    } finally {
      setUploadingSiteFile(false);
    }
  };

  /* ── Excel 导入导出（按当前店铺规则生成模板/校验） ── */
  const excelColumnOf = (key: string): { col: string; get: () => string; set: (v: string) => void } | null => {
    switch (key) {
      case "site_title": return { col: "当地语言标题", get: () => siteTitle, set: setSiteTitle };
      case "site_bullets": return { col: "当地语言卖点", get: () => siteBullets, set: setSiteBullets };
      case "site_description": return { col: "当地语言详情", get: () => siteDescription, set: setSiteDescription };
      case "site_price": return { col: "站点售价", get: () => sitePrice, set: setSitePrice };
      case "site_stock": return { col: "站点库存", get: () => siteStock, set: setSiteStock };
      case "fulfill_time": return { col: "备货时效", get: () => fulfillTime, set: setFulfillTime };
      case "shipping_template": return { col: "运费模板", get: () => shippingTemplate, set: setShippingTemplate };
      case "ptc": return { col: "PTC 商品税务编码", get: () => ptc, set: setPtc };
      case "manufacturer": return { col: "制造商信息", get: () => manufacturer, set: setManufacturer };
      case "eu_responsible": return { col: "欧盟责任人（欧代）", get: () => euResponsible, set: setEuResponsible };
      case "warning_lang": return { col: "对应语言警示语", get: () => warningLang, set: setWarningLang };
      default: return null;
    }
  };
  const excelUploadOf = (key: string): { col: string; get: () => string; set: (v: string) => void } | null => {
    switch (key) {
      case "cert_file": return { col: "本地证书链接", get: () => certFileUrl, set: setCertFileUrl };
      case "eu_doc": return { col: "欧代授权文件链接", get: () => euDocUrl, set: setEuDocUrl };
      case "ce_declaration": return { col: "CE 声明链接", get: () => ceDeclarationUrl, set: setCeDeclarationUrl };
      case "ce_report": return { col: "检测报告链接", get: () => ceReportUrl, set: setCeReportUrl };
      case "label_image": return { col: "产品标签图链接", get: () => labelImageUrl, set: setLabelImageUrl };
      default: return null;
    }
  };
  const handleExportExcel = () => {
    if (!selectedShopId) { toast.error("请先选择刊登店铺（模板按店铺规则生成）"); return; }
    const row: Record<string, string | number> = {
      "SPU编码": sku, "SPU名称": name, "分类": category, "基础售价": price, "成本价": cost, "基础库存": stock,
      "长(cm)": length, "宽(cm)": width, "高(cm)": height, "净重(kg)": weight,
    };
    SITE_FIELDS.forEach((f) => {
      if (!siteFieldVisible(f.key)) return;
      if (f.key === "ean") {
        row["EAN-13（按SKU填写，多SKU用分号分隔）"] = Object.entries(eanMap).map(([s, e]) => `${s}:${e}`).join("; ");
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
    XLSX.utils.book_append_sheet(wb, ws, "刊登信息");
    XLSX.writeFile(wb, `${currentShop?.name ?? "商品"}-刊登信息.xlsx`);
    toast.success("已导出当前店铺刊登模板");
  };
  const excelImportRef = useRef<HTMLInputElement>(null);
  const handleImportExcel = async (file: File) => {
    if (!selectedShopId) { toast.error("请先选择刊登店铺（导入按该店铺规则校验）"); return; }
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(ws, { defval: "" });
      if (rows.length === 0) { toast.error("表格为空"); return; }
      const r = rows[0];
      const get = (k: string) => (r[k] != null ? String(r[k]).trim() : "");
      // 按当前店铺规则校验必填列
      const missing: string[] = [];
      SITE_FIELDS.forEach((f) => {
        if (f.key === "ean" || !siteFieldRequired(f.key)) return;
        const c = excelColumnOf(f.key);
        if (c && !get(c.col)) missing.push(c.col);
      });
      if (siteFieldRequired("ean") && !get("EAN-13（按SKU填写，多SKU用分号分隔）")) missing.push("EAN-13");
      SITE_UPLOADS.forEach((u) => {
        if (!uploadRequired(u.key)) return;
        const c = excelUploadOf(u.key);
        if (c && !get(c.col)) missing.push(c.col);
      });
      if (missing.length) { toast.error(`导入校验未通过，以下必填列缺失：${missing.join("、")}`); return; }
      // 回填字段
      SITE_FIELDS.forEach((f) => {
        if (!siteFieldVisible(f.key)) return;
        if (f.key === "ean") {
          const eanVal = get("EAN-13（按SKU填写，多SKU用分号分隔）");
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
      toast.success("导入成功，已按当前店铺规则回填站点字段（请检查后保存）");
    } catch (e) {
      toast.error("导入失败：" + (e instanceof Error ? e.message : "未知错误"));
    }
  };

  /* ── 发布检查（公共必填 + 当前店铺规则必填） ── */
  const publishChecks = useMemo(() => {
    const checks: { label: string; pass: boolean }[] = [
      { label: "商品名称", pass: name.trim().length > 0 },
      { label: "商品描述（≥20字）", pass: description.length >= 20 },
      { label: "至少一张图片", pass: images.length > 0 },
      { label: "价格 > 0", pass: Number(price) > 0 },
      { label: "分类", pass: category.trim().length > 0 },
      { label: "SKU", pass: sku.trim().length > 0 },
      { label: "物流信息（重量/尺寸）", pass: weight.trim().length > 0 || (length.trim().length > 0 && width.trim().length > 0 && height.trim().length > 0) },
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
      toast.error(t("请先填写来源链接"));
      return;
    }
    if (!/^https?:\/\//i.test(sourceUrl.trim())) {
      toast.error(t("链接格式不正确"));
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
        throw new Error((result as { error?: string }).error || `采集失败 (${response.status})`);
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
      toast.success(filled ? `抓取成功，已回填商品信息` : t("链接已识别，但未提取到商品字段，请检查链接是否有效"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "抓取失败，请检查链接或稍后重试");
    } finally {
      setCollecting(false);
    }
  }, [sourceUrl, t]);
  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
              <h1 className="font-display text-lg font-bold text-ink">
                {isNew ? "新建商品" : name || "编辑商品"}
              </h1>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant={status === "published" ? "default" : "outline"} className="text-[10px]">
                  {status === "published" ? "已发布" : status === "draft" ? "草稿" : status}
                </Badge>
                {sku && <span>SKU: {sku}</span>}
                {category && <span>· {category}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isNew && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => document.getElementById("publish-check")?.scrollIntoView({ behavior: "smooth", block: "center" })}
              >
                <Send size={14} className="mr-1.5" /> 发布优化
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => handleSave(false)} disabled={saving}>
              {saving ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Save size={14} className="mr-1.5" />}
              保存草稿
            </Button>
            <Button size="sm" onClick={() => handleSave(true)} disabled={saving}>
              {saving ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Send size={14} className="mr-1.5" />}
              保存并发布
            </Button>
          </div>
        </div>
      </div>

      {/* ═══ 店铺选择（统一刊登编辑页） ═══ */}
      {shops.length > 0 && (
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Store size={16} className="text-primary" />
              <span className="text-sm font-semibold text-ink">刊登店铺</span>
            </div>
            <select
              value={selectedShopId}
              onChange={(e) => handleShopSelect(e.target.value)}
              className="h-9 rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
            >
              <option value="">未绑定店铺（基础库）</option>
              {shops.filter((s) => s.status === "正常" || s.id === selectedShopId).map((s) => (
                <option key={s.id} value={s.id}>{s.name}（{s.region || s.platform}）</option>
              ))}
            </select>
            {currentShop && (
              <Badge className="bg-primary/10 text-primary hover:bg-primary/10">
                <Building2 size={11} className="mr-1" />{currentShop.region || currentShop.platform}
              </Badge>
            )}
            {selectedShopId && !ruleConfigured && (
              <span className="text-xs text-amber-600">该店铺未配置刊登规则，字段默认全部显示（可在后台【店铺规则配置】设置显隐/必填）</span>
            )}
            {!isNew && (product as any)?.extras?.source_product_id && (
              <Button variant="outline" size="sm" onClick={handleSyncFromBase} disabled={syncingFromBase}>
                {syncingFromBase ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <RefreshCcw size={14} className="mr-1.5" />}
                从产品基础库同步更新
              </Button>
            )}
            {selectedShopId && (
              <>
                <Button variant="outline" size="sm" onClick={handleExportExcel}>
                  <FileDown size={14} className="mr-1.5" />导出模板
                </Button>
                <Button variant="outline" size="sm" onClick={() => excelImportRef.current?.click()}>
                  <FileUp size={14} className="mr-1.5" />导入
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
          <span className="text-muted-foreground">成本 ¥{(Number(cost) || 0).toFixed(2)}</span>
          <span className="text-muted-foreground">→</span>
          <span className="text-muted-foreground">售价 ¥{(Number(price) || 0).toFixed(2)}</span>
          <span className="text-muted-foreground">→</span>
          <span className={cn("font-semibold", profit >= 0 ? "text-success" : "text-rose-500")}>
            利润 ¥{profit.toFixed(2)} ({profitMargin}%)
          </span>
        </div>
      )}

      {/* ═══ 单页长滚动主网格 ═══ */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* 左：主编辑列 */}
        <div className="space-y-5 lg:col-span-2">

          {/* ── 基本信息（AI 原位：标题翻译 / 文案优化） ── */}
          <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-ink">商品名称 *</label>
              <div className="flex items-center gap-1.5">
                <select
                  value={translateTitleLang} onChange={(e) => setTranslateTitleLang(e.target.value)}
                  className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
                >
                  {Object.entries(LANG_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleTranslateTitle} disabled={titleTranslating}>
                  {titleTranslating ? <Loader2 size={13} className="mr-1 animate-spin" /> : <Languages size={13} className="mr-1" />}
                  AI 翻译标题
                  <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                    {titleFreeBenefit ? "免费（权益）" : "1 积分"}
                  </span>
                </Button>
              </div>
            </div>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="输入商品名称"
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-ink outline-none transition-colors focus:border-primary"
            />
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="block text-sm font-medium text-ink">商品描述</label>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleOptimizeCopy} disabled={aiCopying}>
                  {aiCopying ? <Loader2 size={13} className="mr-1 animate-spin" /> : <Wand2 size={13} className="mr-1" />}
                  AI 优化文案
                  <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">5 积分</span>
                </Button>
              </div>
              <textarea
                value={description} onChange={(e) => setDescription(e.target.value)}
                rows={4} placeholder="详细描述商品特性、材质、使用场景..."
                className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-ink outline-none transition-colors focus:border-primary"
              />
              <p className="mt-1 text-xs text-muted-foreground">{description.length} 字</p>
            </div>
            {copyOptimizeResult && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                    <Sparkles size={13} /> AI 优化结果
                  </span>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => { navigator.clipboard.writeText(copyOptimizeResult); toast.success("已复制"); }}>
                      <Copy size={11} className="mr-1" />复制
                    </Button>
                    <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={applyCopyToDescription}>
                      <Check size={11} className="mr-1" />应用到描述
                    </Button>
                  </div>
                </div>
                <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-background p-2.5 text-xs text-foreground">{copyOptimizeResult}</div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink">分类</label>
                <input
                  type="text" value={category} onChange={(e) => setCategory(e.target.value)}
                  placeholder="如：电子产品"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-ink outline-none transition-colors focus:border-primary"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink">SKU</label>
                <input
                  type="text" value={sku} onChange={(e) => setSku(e.target.value)}
                  placeholder="SKU-001"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-ink outline-none transition-colors focus:border-primary"
                />
              </div>
            </div>
          </div>

          {/* 价格与库存 */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="mb-4 flex items-center gap-2 font-display text-sm font-semibold text-ink">
              <Tag size={15} className="text-primary" /> 价格与库存
            </h3>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">售价 (¥)</label>
                <input
                  type="number" value={price} onChange={(e) => setPrice(e.target.value)}
                  placeholder="0.00" min="0" step="0.01"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 font-data text-sm text-ink outline-none transition-colors focus:border-primary"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">成本 (¥)</label>
                <input
                  type="number" value={cost} onChange={(e) => setCost(e.target.value)}
                  placeholder="0.00" min="0" step="0.01"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 font-data text-sm text-ink outline-none transition-colors focus:border-primary"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">库存</label>
                <input
                  type="number" value={stock} onChange={(e) => setStock(e.target.value)}
                  placeholder="0" min="0"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 font-data text-sm text-ink outline-none transition-colors focus:border-primary"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">发布状态</label>
                <select
                  value={status} onChange={(e) => setStatus(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-ink outline-none transition-colors focus:border-primary"
                >
                  <option value="draft">草稿</option>
                  <option value="published">已发布</option>
                  <option value="archived">归档</option>
                </select>
              </div>
            </div>
          </div>

          {/* 物流与运费 */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="mb-4 flex items-center gap-2 font-display text-sm font-semibold text-ink">
              <Weight size={15} className="text-chart-3" /> 物流与运费
            </h3>
            <p className="mb-4 text-xs text-muted-foreground">跨境电商平台按包裹重量与尺寸计算运费，请如实填写</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">重量 (kg)</label>
                <input type="number" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="0.00" step="0.01" min="0"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 font-data text-sm text-ink outline-none transition-colors focus:border-primary" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">长 (cm)</label>
                <input type="number" value={length} onChange={(e) => setLength(e.target.value)} placeholder="0" step="0.1" min="0"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 font-data text-sm text-ink outline-none transition-colors focus:border-primary" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">宽 (cm)</label>
                <input type="number" value={width} onChange={(e) => setWidth(e.target.value)} placeholder="0" step="0.1" min="0"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 font-data text-sm text-ink outline-none transition-colors focus:border-primary" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">高 (cm)</label>
                <input type="number" value={height} onChange={(e) => setHeight(e.target.value)} placeholder="0" step="0.1" min="0"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 font-data text-sm text-ink outline-none transition-colors focus:border-primary" />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">运费 (可选)</label>
                <input type="number" value={shippingFee} onChange={(e) => setShippingFee(e.target.value)} placeholder="0.00" step="0.01" min="0"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 font-data text-sm text-ink outline-none transition-colors focus:border-primary" />
              </div>
              <div className="flex items-end pb-2.5">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
                  <input type="checkbox" checked={freeShipping} onChange={(e) => setFreeShipping(e.target.checked)} className="h-4 w-4 rounded border-border text-primary focus:ring-primary" />
                  包邮（卖家承担运费）
                </label>
              </div>
            </div>
          </div>

          {/* 来源信息 */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="mb-4 flex items-center gap-2 font-display text-sm font-semibold text-ink">
              <Globe size={15} className="text-chart-2" /> 来源信息
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">来源平台</label>
                <input
                  type="text" value={sourcePlatform} onChange={(e) => setSourcePlatform(e.target.value)}
                  placeholder="Amazon / Shopify / 1688..."
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-ink outline-none transition-colors focus:border-primary"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">来源链接</label>
                <div className="flex gap-2">
                  <input
                    type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full flex-1 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-ink outline-none transition-colors focus:border-primary"
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
                    {collecting ? t("抓取中...") : t("智能抓取")}
                  </Button>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {t("填写商品链接后点击智能抓取，自动回填商品信息；1688 等反爬平台可能无法抓取，可手动填写")}
                </p>
              </div>
            </div>
          </div>

          {/* ── 图片素材（AI 原位：图片翻译 / 场景图 / 视频生成；大图拖拽上传） ── */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
                <ImageIcon size={15} className="text-chart-4" /> 商品图片
                <span className="text-xs font-normal text-muted-foreground">（{images.length} 张）</span>
              </h3>
              <div className="flex flex-wrap gap-1.5">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90">
                  <Upload size={13} /> 上传图片
                  <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} />
                </label>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleStartTranslateImage} disabled={aiStreaming}>
                  {aiStreaming && aiTarget === "image-translate" ? <Loader2 size={13} className="mr-1 animate-spin" /> : <Languages size={13} className="mr-1" />}
                  图片翻译
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleGenSceneImage} disabled={!!aiImageGen}>
                  {aiImageGen ? <Loader2 size={13} className="mr-1 animate-spin" /> : <ImageIcon size={13} className="mr-1" />}
                  场景图
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleGenVideo} disabled={!!videoGen}>
                  {videoGen ? <Loader2 size={13} className="mr-1 animate-spin" /> : <Video size={13} className="mr-1" />}
                  视频生成
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
              <div className={cn("flex h-12 w-12 items-center justify-center rounded-full", dragOver ? "bg-primary/15" : "bg-muted")}>
                <Upload size={22} className={dragOver ? "text-primary" : "text-muted-foreground"} />
              </div>
              <p className="mt-2 text-sm font-medium text-ink">{dragOver ? "松开上传" : "点击或拖拽图片到此上传"}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">支持 JPG、PNG、WebP，可多选 / 多张拖入</p>
            </div>

            {images.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-10">
                <ImageIcon size={28} className="text-muted-foreground/40" />
                <p className="mt-2 text-sm text-muted-foreground">暂无图片，请拖拽或点击上方区域上传</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {images.map((src, idx) => (
                  <div key={idx} className="group relative aspect-square overflow-hidden rounded-xl border border-border">
                    <img src={src} alt={`img-${idx}`} className="h-full w-full object-cover" />
                    {idx === primaryImage && (
                      <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-white">
                        <Star size={10} /> 主图
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-ink/80 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                      {idx !== primaryImage && (
                        <button onClick={() => setPrimaryImage(idx)} className="rounded bg-white/20 px-2 py-1 text-[10px] text-white backdrop-blur-sm hover:bg-white/30">
                          设为主图
                        </button>
                      )}
                      <button onClick={() => removeImage(idx)} className="ml-auto rounded bg-rose-500/80 p-1 text-white hover:bg-rose-500">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
                <label className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border transition-colors hover:border-primary/40">
                  <Plus size={24} className="text-muted-foreground" />
                  <span className="mt-1 text-xs text-muted-foreground">添加更多</span>
                  <input type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} />
                </label>
              </div>
            )}

            {/* 图片翻译结果（原位） */}
            {(aiStreaming && aiTarget === "image-translate" || (!aiStreaming && aiTarget === "image-translate" && aiPartial)) && (
              <div className="mt-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                    <Languages size={13} /> 图片文字翻译结果
                    <select
                      value={translationTargetLang} onChange={(e) => setTranslationTargetLang(e.target.value)}
                      className="rounded border border-border bg-background px-1.5 py-0.5 text-[11px] font-normal outline-none focus:border-primary"
                    >
                      {Object.entries(LANG_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </span>
                  {!aiStreaming && aiPartial && (
                    <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={handleCopyTranslation}>
                      <Copy size={11} className="mr-1" />复制结果
                    </Button>
                  )}
                </div>
                <div className="max-h-40 overflow-y-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap text-foreground">
                  {aiPartial}{aiStreaming && <span className="inline-block h-3 w-1 animate-pulse bg-primary" />}
                </div>
              </div>
            )}

            {/* 场景图 prompt */}
            <div className="mt-3 flex gap-2">
              <input
                type="text" value={sceneGenPrompt} onChange={(e) => setSceneGenPrompt(e.target.value)}
                placeholder="场景图描述，如：阳光下的户外露营场景（留空则自动生成白底商业图）"
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary"
              />
              {videoGen && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 size={12} className="animate-spin" /> 生成中...</span>}
            </div>
          </div>

          {/* ── 站点专属信息（统一刊登编辑页 · 随店铺规则显隐/必填） ── */}
          {selectedShopId && (
            <div className="rounded-2xl border border-chart-2/30 bg-card p-5 space-y-5">
              <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
                <Store size={15} className="text-chart-2" /> 站点专属信息
                {currentShop && <span className="text-xs font-normal text-muted-foreground">（{currentShop.name} · {currentShop.region || currentShop.platform}）</span>}
                {ruleConfigured && <span className="text-xs font-normal text-emerald-600">✓ 已按店铺规则显示</span>}
              </h3>
              {!ruleConfigured && (
                <p className="text-xs text-amber-600">该店铺尚未配置刊登规则，以下字段默认全部显示且不强制必填；建议管理员到【店铺规则配置】设置显隐与必填。</p>
              )}

              {/* 当地语言 */}
              {siteFieldVisible("site_title") && (
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Languages size={13} className="text-chart-2" /> 当地语言标题{siteFieldRequired("site_title") && <span className="text-rose-500">*</span>}
                  </label>
                  <input type="text" value={siteTitle} onChange={(e) => setSiteTitle(e.target.value)} placeholder={currentShop ? `${currentShop.region || "当地"}语言标题（必填）` : "该店铺站点的当地语言标题"}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                </div>
              )}
              {siteFieldVisible("site_bullets") && (
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Wand2 size={13} className="text-chart-2" /> 当地语言卖点{siteFieldRequired("site_bullets") && <span className="text-rose-500">*</span>}
                  </label>
                  <textarea value={siteBullets} onChange={(e) => setSiteBullets(e.target.value)} rows={3}
                    placeholder="每行一条卖点，如：&#10;材质防水，适合户外使用&#10;五年质保，售后无忧"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                </div>
              )}
              {siteFieldVisible("site_description") && (
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <FileText size={13} className="text-chart-2" /> 当地语言详情{siteFieldRequired("site_description") && <span className="text-rose-500">*</span>}
                  </label>
                  <textarea value={siteDescription} onChange={(e) => setSiteDescription(e.target.value)} rows={4}
                    placeholder="该店铺站点的详细描述（当地语言）"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                </div>
              )}

              {/* 站点销售 */}
              {(siteFieldVisible("site_price") || siteFieldVisible("site_stock")) && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {siteFieldVisible("site_price") && (
                    <div>
                      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <Tag size={13} className="text-chart-3" /> 站点售价{siteFieldRequired("site_price") && <span className="text-rose-500">*</span>}
                      </label>
                      <input type="number" value={sitePrice} onChange={(e) => setSitePrice(e.target.value)} placeholder="该店铺站点的实际售价"
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                    </div>
                  )}
                  {siteFieldVisible("site_stock") && (
                    <div>
                      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <Package size={13} className="text-chart-3" /> 站点库存{siteFieldRequired("site_stock") && <span className="text-rose-500">*</span>}
                      </label>
                      <input type="number" value={siteStock} onChange={(e) => setSiteStock(e.target.value)} placeholder="该店铺站点的可售库存"
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                    </div>
                  )}
                </div>
              )}
              {(siteFieldVisible("fulfill_time") || siteFieldVisible("shipping_template")) && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {siteFieldVisible("fulfill_time") && (
                    <div>
                      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <Clock size={13} className="text-chart-3" /> 备货时效{siteFieldRequired("fulfill_time") && <span className="text-rose-500">*</span>}
                      </label>
                      <select value={fulfillTime} onChange={(e) => setFulfillTime(e.target.value)}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary">
                        <option value="">请选择备货时效</option>
                        <option value="现货，24h 内发出">现货，24h 内发出</option>
                        <option value="3-7 天备货">3-7 天备货</option>
                        <option value="7-15 天备货">7-15 天备货</option>
                        <option value="15-30 天备货">15-30 天备货</option>
                      </select>
                    </div>
                  )}
                  {siteFieldVisible("shipping_template") && (
                    <div>
                      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <Ruler size={13} className="text-chart-3" /> 运费模板{siteFieldRequired("shipping_template") && <span className="text-rose-500">*</span>}
                      </label>
                      <input type="text" value={shippingTemplate} onChange={(e) => setShippingTemplate(e.target.value)} placeholder="如：标准配送 / 经济配送"
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                    </div>
                  )}
                </div>
              )}

              {/* 欧盟合规 */}
              {(siteFieldVisible("ptc") || siteFieldVisible("manufacturer") || siteFieldVisible("eu_responsible") || siteFieldVisible("warning_lang")) && (
                <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-ink"><ShieldCheck size={13} className="text-chart-4" /> 欧盟合规信息</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {siteFieldVisible("ptc") && (
                      <div>
                        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          PTC 商品税务编码{siteFieldRequired("ptc") && <span className="text-rose-500">*</span>}
                        </label>
                        <input type="text" value={ptc} onChange={(e) => setPtc(e.target.value)} placeholder="欧盟商品税务编码（如适用）"
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                      </div>
                    )}
                    {siteFieldVisible("manufacturer") && (
                      <div>
                        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          制造商信息{siteFieldRequired("manufacturer") && <span className="text-rose-500">*</span>}
                        </label>
                        <input type="text" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} placeholder="制造商名称与地址"
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                      </div>
                    )}
                    {siteFieldVisible("eu_responsible") && (
                      <div>
                        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          欧盟责任人（欧代）{siteFieldRequired("eu_responsible") && <span className="text-rose-500">*</span>}
                        </label>
                        <input type="text" value={euResponsible} onChange={(e) => setEuResponsible(e.target.value)} placeholder="名称 / 地址 / 邮箱"
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                      </div>
                    )}
                    {siteFieldVisible("warning_lang") && (
                      <div>
                        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          对应语言警示语{siteFieldRequired("warning_lang") && <span className="text-rose-500">*</span>}
                        </label>
                        <input type="text" value={warningLang} onChange={(e) => setWarningLang(e.target.value)} placeholder="当地语言的安全警示语"
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 文件上传项（按规则显隐/必填） */}
              <div className="space-y-3">
                {uploadVisible("cert_file") && (
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <FileCheck2 size={13} className="text-success" /> 本地证书（TISI/SIRIM）{uploadRequired("cert_file") && <span className="text-rose-500">*</span>}
                    </label>
                    {certFileUrl ? (
                      <div className="flex items-center gap-2">
                        <a href={certFileUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline">{certFileUrl.split("/").pop()}</a>
                        <Button size="sm" variant="ghost" className="h-6 text-[11px] text-rose-500" onClick={() => setCertFileUrl("")}>移除</Button>
                      </div>
                    ) : (
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary">
                        <Upload size={13} /> 选择文件{uploadingSiteFile && <Loader2 size={12} className="animate-spin" />}
                        <input type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadSiteFile(f, setCertFileUrl); e.target.value = ""; }} />
                      </label>
                    )}
                  </div>
                )}
                {uploadVisible("eu_doc") && (
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <FileCheck2 size={13} className="text-success" /> 欧代授权文件{uploadRequired("eu_doc") && <span className="text-rose-500">*</span>}
                    </label>
                    {euDocUrl ? (
                      <div className="flex items-center gap-2">
                        <a href={euDocUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline">{euDocUrl.split("/").pop()}</a>
                        <Button size="sm" variant="ghost" className="h-6 text-[11px] text-rose-500" onClick={() => setEuDocUrl("")}>移除</Button>
                      </div>
                    ) : (
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary">
                        <Upload size={13} /> 选择文件{uploadingSiteFile && <Loader2 size={12} className="animate-spin" />}
                        <input type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadSiteFile(f, setEuDocUrl); e.target.value = ""; }} />
                      </label>
                    )}
                  </div>
                )}
                {uploadVisible("ce_declaration") && (
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <FileCheck2 size={13} className="text-success" /> CE 符合性声明{uploadRequired("ce_declaration") && <span className="text-rose-500">*</span>}
                    </label>
                    {ceDeclarationUrl ? (
                      <div className="flex items-center gap-2">
                        <a href={ceDeclarationUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline">{ceDeclarationUrl.split("/").pop()}</a>
                        <Button size="sm" variant="ghost" className="h-6 text-[11px] text-rose-500" onClick={() => setCeDeclarationUrl("")}>移除</Button>
                      </div>
                    ) : (
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary">
                        <Upload size={13} /> 选择文件{uploadingSiteFile && <Loader2 size={12} className="animate-spin" />}
                        <input type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadSiteFile(f, setCeDeclarationUrl); e.target.value = ""; }} />
                      </label>
                    )}
                  </div>
                )}
                {uploadVisible("ce_report") && (
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <FileCheck2 size={13} className="text-success" /> 产品检测报告{uploadRequired("ce_report") && <span className="text-rose-500">*</span>}
                    </label>
                    {ceReportUrl ? (
                      <div className="flex items-center gap-2">
                        <a href={ceReportUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline">{ceReportUrl.split("/").pop()}</a>
                        <Button size="sm" variant="ghost" className="h-6 text-[11px] text-rose-500" onClick={() => setCeReportUrl("")}>移除</Button>
                      </div>
                    ) : (
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary">
                        <Upload size={13} /> 选择文件{uploadingSiteFile && <Loader2 size={12} className="animate-spin" />}
                        <input type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadSiteFile(f, setCeReportUrl); e.target.value = ""; }} />
                      </label>
                    )}
                  </div>
                )}
                {uploadVisible("label_image") && (
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <ImageIcon size={13} className="text-success" /> 产品标签图{uploadRequired("label_image") && <span className="text-rose-500">*</span>}
                    </label>
                    {labelImageUrl ? (
                      <div className="flex items-center gap-2">
                        <img src={labelImageUrl} alt="标签图" className="h-10 w-10 rounded object-cover" />
                        <Button size="sm" variant="ghost" className="h-6 text-[11px] text-rose-500" onClick={() => setLabelImageUrl("")}>移除</Button>
                      </div>
                    ) : (
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary">
                        <Upload size={13} /> 选择文件{uploadingSiteFile && <Loader2 size={12} className="animate-spin" />}
                        <input type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadSiteFile(f, setLabelImageUrl); e.target.value = ""; }} />
                      </label>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── 跨境信息：合规资质 / 供应链溯源 / 多语言信息 / 批量属性映射 ── */}
          <div className="rounded-2xl border border-border bg-card p-5 space-y-5">
            <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
              <Globe size={15} className="text-chart-2" /> 跨境信息
            </h3>

            {/* 合规资质 */}
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <ShieldCheck size={13} className="text-success" /> 合规资质认证
              </label>
              <div className="mb-2 flex flex-wrap gap-2">
                {certifications.map((c) => (
                  <span key={c} className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600">
                    {c}
                    <button onClick={() => setCertifications(certifications.filter((x) => x !== c))} className="hover:text-rose-500"><X size={11} /></button>
                  </span>
                ))}
                {certifications.length === 0 && <span className="text-xs text-muted-foreground">未添加，如 CE / FCC / RoHS</span>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {CERT_PRESETS.filter((c) => !certifications.includes(c)).map((c) => (
                  <button key={c} onClick={() => addCert(c)} className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary">
                    + {c}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  type="text" value={certInput} onChange={(e) => setCertInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCert(certInput))}
                  placeholder="自定义资质，回车添加"
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary"
                />
                <Button size="sm" variant="outline" onClick={() => addCert(certInput)}><Plus size={13} />添加</Button>
              </div>
            </div>

            {/* 供应链溯源 */}
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Factory size={13} className="text-chart-3" /> 供应链溯源
              </label>
              <div className="grid grid-cols-2 gap-3">
                <input type="text" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="供应商名称" className="rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary" />
                <input type="text" value={originCountry} onChange={(e) => setOriginCountry(e.target.value)} placeholder="原产国（如 China / Vietnam）" className="rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary" />
                <input type="text" value={hsCode} onChange={(e) => setHsCode(e.target.value)} placeholder="HS 编码（如 8518.30）" className="rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary" />
                <input type="text" value={factoryCert} onChange={(e) => setFactoryCert(e.target.value)} placeholder="工厂资质（如 ISO9001 / BSCI）" className="rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary" />
              </div>
            </div>

            {/* 多语言信息 */}
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Languages size={13} className="text-chart-2" /> 多语言信息（多语言变体）
              </label>
              {multilingual.length > 0 && (
                <div className="mb-2 space-y-1.5">
                  {multilingual.map((m) => (
                    <div key={m.lang} className="flex items-start justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
                      <div className="min-w-0">
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{LANG_LABEL[m.lang] ?? m.lang}</span>
                        <p className="mt-1 truncate text-xs font-medium text-ink">{m.title}</p>
                        {m.description && <p className="truncate text-[11px] text-muted-foreground">{m.description}</p>}
                      </div>
                      <button onClick={() => setMultilingual(multilingual.filter((x) => x.lang !== m.lang))} className="text-muted-foreground hover:text-rose-500"><X size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[120px_1fr_1fr_auto]">
                <select value={mlLang} onChange={(e) => setMlLang(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-2 text-xs outline-none focus:border-primary">
                  {Object.entries(LANG_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <input type="text" value={mlTitle} onChange={(e) => setMlTitle(e.target.value)} placeholder="该语言标题" className="rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary" />
                <input type="text" value={mlDesc} onChange={(e) => setMlDesc(e.target.value)} placeholder="该语言描述（可选）" className="rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary" />
                <Button size="sm" variant="outline" onClick={addMultilingual}><Plus size={13} />添加</Button>
              </div>
            </div>

            {/* 批量属性映射 */}
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <KeyRound size={13} className="text-chart-4" /> 批量属性映射
              </label>
              {attrPairs.length > 0 && (
                <div className="mb-2 overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-border bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 font-medium text-muted-foreground">属性名</th>
                        <th className="px-3 py-2 font-medium text-muted-foreground">属性值</th>
                        <th className="w-10 px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {attrPairs.map((a, i) => (
                        <tr key={i}>
                          <td className="px-3 py-1.5 font-medium text-ink">{a.name}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{a.value}</td>
                          <td className="px-2 py-1.5"><button onClick={() => setAttrPairs(attrPairs.filter((_, x) => x !== i))} className="text-muted-foreground hover:text-rose-500"><X size={12} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <input type="text" value={attrName} onChange={(e) => setAttrName(e.target.value)} placeholder="属性名，如 Color / Size / Material" className="rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary" />
                <input type="text" value={attrValue} onChange={(e) => setAttrValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addAttrPair())} placeholder="属性值，如 Black / XL / Cotton" className="rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary" />
                <Button size="sm" variant="outline" onClick={addAttrPair}><Plus size={13} />添加</Button>
              </div>
            </div>
          </div>

          {/* ── 变体管理（连续添加多组） ── */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
                <Layers size={15} className="text-chart-2" /> 商品变体
                <span className="text-xs font-normal text-muted-foreground">（{variants.length} 个）</span>
              </h3>
              <Button size="sm" variant="outline" onClick={() => { resetVariantFields(); setShowVariantForm(true); }}>
                <Plus size={14} className="mr-1" /> 添加变体
              </Button>
            </div>

            {/* 规格组合生成器 */}
            <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
              <p className="mb-2 text-sm font-medium text-ink">按规格组合批量生成变体（如 颜色 × 尺寸，自动生成全部组合）</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text" value={specName} onChange={(e) => setSpecName(e.target.value)}
                  placeholder="规格名（如 颜色）"
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <input
                  type="text" value={specValues} onChange={(e) => setSpecValues(e.target.value)}
                  placeholder="选项值，逗号分隔（如 红,蓝,绿）"
                  className="flex-[2] rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <Button size="sm" variant="outline" onClick={addSpecGroup}>
                  <Plus size={14} className="mr-1" /> 添加规格
                </Button>
              </div>

              {specGroups.length > 0 && (
                <div className="mt-3 space-y-2">
                  {specGroups.map((g, gi) => (
                    <div key={gi} className="flex flex-wrap items-center gap-2 rounded-lg bg-background px-3 py-2 text-sm">
                      <span className="font-medium text-ink">{g.name}：</span>
                      {g.values.map((v, vi) => (
                        <span key={vi} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary">{v}</span>
                      ))}
                      <button
                        onClick={() => removeSpecGroup(gi)}
                        className="ml-auto text-muted-foreground hover:text-rose-500"
                        title="删除该规格"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  <Button size="sm" onClick={generateVariants} disabled={comboCount === 0}>
                    <Sparkles size={13} className="mr-1" /> 生成变体组合（{comboCount} 个）
                  </Button>
                </div>
              )}
            </div>

            {/* 待保存组合 */}
            {pendingVariants.length > 0 && (
              <div className="mb-4 rounded-xl border border-border bg-background p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-medium text-ink">待保存组合（{pendingVariants.length} 个）</p>
                  <Button size="sm" onClick={saveAllVariants} disabled={savingVariants}>
                    {savingVariants ? "保存中…" : <><Check size={14} className="mr-1" /> 保存全部变体</>}
                  </Button>
                </div>
                <div className="max-h-72 overflow-auto rounded-lg border border-border">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 border-b border-border bg-muted/60">
                      <tr>
                        <th className="px-3 py-2 font-medium text-muted-foreground">SKU</th>
                        <th className="px-3 py-2 font-medium text-muted-foreground">属性</th>
                        <th className="px-3 py-2 font-medium text-muted-foreground">价格</th>
                        <th className="px-3 py-2 font-medium text-muted-foreground">库存</th>
                        <th className="px-3 py-2 font-medium text-muted-foreground"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {pendingVariants.map((pv, pi) => (
                        <tr key={pi}>
                          <td className="px-3 py-1.5">
                            <input
                              type="text" value={pv.sku}
                              onChange={(e) => setPendingVariants(pendingVariants.map((x, i) => (i === pi ? { ...x, sku: e.target.value } : x)))}
                              className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
                            />
                          </td>
                          <td className="px-3 py-1.5 text-xs text-ink">{pv.attrs}</td>
                          <td className="px-3 py-1.5">
                            <input
                              type="number" value={pv.price}
                              onChange={(e) => setPendingVariants(pendingVariants.map((x, i) => (i === pi ? { ...x, price: e.target.value } : x)))}
                              className="w-24 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <input
                              type="number" value={pv.stock}
                              onChange={(e) => setPendingVariants(pendingVariants.map((x, i) => (i === pi ? { ...x, stock: e.target.value } : x)))}
                              className="w-24 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <button onClick={() => removePending(pi)} className="text-muted-foreground hover:text-rose-500"><X size={14} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">重复保存同一属性组合会更新原变体，不会重复添加</p>
              </div>
            )}

            {/* 变体表单：保存后保持打开，连续添加多组 */}
            {showVariantForm && (
              <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-medium text-ink">{editingVariantIdx !== null ? "编辑变体" : "新建变体"}</p>
                  {editingVariantIdx === null && (
                    <span className="text-[11px] text-muted-foreground">保存后表单保持打开，可连续添加多组</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <input type="text" value={variantSku} onChange={(e) => setVariantSku(e.target.value)} placeholder="SKU" className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                  <input type="text" value={variantAttrs} onChange={(e) => setVariantAttrs(e.target.value)} placeholder="属性（如 红色/XL）" className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                  <input type="number" value={variantPrice} onChange={(e) => setVariantPrice(e.target.value)} placeholder="价格" className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                  <input type="number" value={variantStock} onChange={(e) => setVariantStock(e.target.value)} placeholder="库存" className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                </div>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={handleSaveVariant}>保存</Button>
                  {editingVariantIdx === null && (
                    <Button size="sm" variant="outline" onClick={handleSaveVariant}>
                      <Plus size={13} className="mr-1" />保存并继续添加
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={resetVariantForm}>完成</Button>
                </div>
              </div>
            )}

            {/* 变体列表 */}
            {variants.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12">
                <Layers size={32} className="text-muted-foreground/40" />
                <p className="mt-2 text-sm text-muted-foreground">暂无变体，点击上方按钮添加</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border bg-muted/50">
                    <tr>
                      <th className="px-4 py-2.5 font-medium text-muted-foreground">SKU</th>
                      <th className="px-4 py-2.5 font-medium text-muted-foreground">属性</th>
                      {siteFieldVisible("ean") && (
                        <th className="px-4 py-2.5 font-medium text-muted-foreground">
                          EAN-13 {siteFieldRequired("ean") && <span className="text-rose-500">*</span>}
                        </th>
                      )}
                      <th className="px-4 py-2.5 font-medium text-muted-foreground">价格</th>
                      <th className="px-4 py-2.5 font-medium text-muted-foreground">库存</th>
                      <th className="px-4 py-2.5 font-medium text-muted-foreground">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {variants.map((v, idx) => (
                      <tr key={v.id} className="hover:bg-muted/30">
                        <td className="px-4 py-2.5 font-data">{v.sku}</td>
                        <td className="px-4 py-2.5">{v.attributes}</td>
                        {siteFieldVisible("ean") && (
                          <td className="px-4 py-2.5">
                            <input
                              type="text" value={eanMap[v.sku] ?? ""}
                              onChange={(e) => setEanMap((prev) => ({ ...prev, [v.sku]: e.target.value }))}
                              placeholder="13 位条码"
                              className="w-36 rounded-md border border-border bg-background px-2 py-1 font-data text-xs outline-none focus:border-primary"
                            />
                          </td>
                        )}
                        <td className="px-4 py-2.5 font-data">{v.price != null ? `¥${Number(v.price).toFixed(2)}` : "—"}</td>
                        <td className="px-4 py-2.5 font-data">{v.stock ?? "—"}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex gap-2">
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleEditVariant(idx)}>编辑</Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs text-rose-500 hover:bg-rose-50" onClick={() => handleDeleteVariant(idx)}>删除</Button>
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
          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="mb-1 flex items-center gap-2 font-display text-sm font-semibold text-ink">
              <Sparkles size={15} className="text-chart-1" /> AI 工具区
            </h3>
            <p className="mb-4 text-xs text-muted-foreground">标题翻译 / 文案优化 / 图片翻译已嵌入对应区块；以下提供更多 AI 能力</p>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* AI 看图写文案 */}
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <h4 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
                  <Sparkles size={14} className="text-chart-1" /> AI 看图写文案
                </h4>
                <p className="mb-3 text-xs text-muted-foreground">基于商品主图，AI 自动生成完整的商品文案</p>
                <Button className="w-full" size="sm" variant="outline" onClick={handleAiVisionCopy} disabled={aiVisionCopying}>
                  {aiVisionCopying ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Sparkles size={14} className="mr-1.5" />}
                  开始生成
                </Button>
                {(aiVisionCopying || aiPartial) && (
                  <div className="mt-3 max-h-48 overflow-y-auto rounded-lg bg-background p-3 text-xs whitespace-pre-wrap text-foreground">
                    {aiPartial}{aiVisionCopying && <span className="inline-block h-3 w-1 animate-pulse bg-primary" />}
                  </div>
                )}
              </div>

              {/* 工具提示 */}
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
                  <Info size={14} className="text-chart-3" /> 快捷提示
                </h4>
                <ul className="space-y-1.5 text-xs text-muted-foreground">
                  <li className="flex gap-1.5"><Languages size={12} className="mt-0.5 shrink-0 text-primary" /> 商品名称旁「AI 翻译标题」：一键翻译为 14 种语言</li>
                  <li className="flex gap-1.5"><Wand2 size={12} className="mt-0.5 shrink-0 text-primary" /> 商品描述旁「AI 优化文案」：生成英文营销文案，可一键应用到描述</li>
                  <li className="flex gap-1.5"><ImageIcon size={12} className="mt-0.5 shrink-0 text-primary" /> 图片区：图片翻译 / 场景图生成 / 视频生成原位操作</li>
                  <li className="flex gap-1.5"><Layers size={12} className="mt-0.5 shrink-0 text-primary" /> 变体支持连续添加，一次录入多组 SKU</li>
                </ul>
              </div>
            </div>
          </div>

          {/* ── 高级设置：SEO / 物流 / 标签 ── */}
          <div className="rounded-2xl border border-border bg-card p-5 space-y-5">
            <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
              <Settings size={15} className="text-chart-4" /> 高级设置
            </h3>

            {/* 标签 */}
            <div>
              <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
                <Tag size={14} className="text-chart-4" /> 商品标签
              </h4>
              <div className="flex flex-wrap gap-2 mb-3">
                {tags.map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                    {tag}
                    <button onClick={() => setTags(tags.filter((tt) => tt !== tag))} className="hover:text-rose-500"><X size={12} /></button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text" value={tagInput} onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
                  placeholder="输入标签后回车添加"
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <Button size="sm" variant="outline" onClick={addTag}><Plus size={14} />添加</Button>
              </div>
            </div>
          </div>
        </div>

        {/* 右：发布检查 + 快速预览 */}
        <div className="space-y-5">
          <div id="publish-check" className="rounded-2xl border border-border bg-card p-5 scroll-mt-28">
            <h3 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold text-ink">
              {allChecksPass ? <CheckCircle2 size={15} className="text-success" /> : <AlertCircle size={15} className="text-warning" />}
              发布检查
            </h3>
            <div className="space-y-2">
              {publishChecks.map((c) => (
                <div key={c.label} className="flex items-center gap-2 text-sm">
                  {c.pass ? <CheckCircle2 size={14} className="shrink-0 text-success" /> : <AlertCircle size={14} className="shrink-0 text-muted-foreground" />}
                  <span className={c.pass ? "text-foreground" : "text-muted-foreground"}>{c.label}</span>
                </div>
              ))}
            </div>
            {allChecksPass && (
              <Button className="mt-4 w-full" size="sm" onClick={() => handleSave(true)} disabled={saving}>
                <Send size={14} className="mr-1.5" /> 立即发布
              </Button>
            )}
          </div>

          {images[0] && (
            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold text-ink">
                <Eye size={15} className="text-chart-4" /> 快速预览
              </h3>
              <div className="overflow-hidden rounded-lg border border-border">
                <img src={images[0]} alt="预览" className="aspect-square w-full object-cover" />
              </div>
              <p className="mt-2 text-sm font-medium text-ink line-clamp-1">{name || "未命名商品"}</p>
              <p className="mt-0.5 font-data text-sm font-semibold text-primary">¥{Number(price || 0).toFixed(2)}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {certifications.slice(0, 4).map((c) => (
                  <span key={c} className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600">{c}</span>
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
              <AlertTriangle size={16} className="text-amber-500" /> 切换店铺
            </AlertDialogTitle>
            <AlertDialogDescription>
              切换店铺会清空当前已填写的<b>站点专属内容</b>（当地语言标题/卖点/详情、站点售价/库存、EAN、合规资料等），公共基础内容保持不变。确定切换吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSwitchShop} className="bg-amber-500 text-white hover:bg-amber-600">确认切换</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ═══ 底部保存栏 ═══ */}
      <div className="sticky bottom-0 flex items-center justify-between rounded-xl border border-border bg-card/95 px-5 py-3 backdrop-blur-md">
        <div className="text-xs text-muted-foreground">
          {isNew ? "新建商品" : `最后更新：${product?.updated_at ? new Date(product.updated_at as string).toLocaleString("zh-CN") : "—"}`}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => handleSave(false)} disabled={saving}>
            {saving ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Save size={14} className="mr-1.5" />}
            保存
          </Button>
          <Button size="sm" onClick={() => handleSave(true)} disabled={saving}>
            {saving ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Send size={14} className="mr-1.5" />}
            保存并发布
          </Button>
        </div>
      </div>
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
