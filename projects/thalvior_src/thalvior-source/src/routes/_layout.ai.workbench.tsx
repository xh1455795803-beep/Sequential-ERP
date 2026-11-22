/**
 * /ai/workbench — AI 工作台
 *
 * 高频 AI 工具集中入口（双积分池·工作台池计费）：
 * 1. 文生图：提示词 → 生成商品图/场景图（image_process，15 积分/张）
 * 2. 抠图：参考图编辑（后端启用编辑模型后可用）
 * 3. 图片翻译：识别图中文字并翻译（image_translate，2 积分/次）
 * 4. 图生标题：看图生成商品标题（image_parse，4 积分/次）
 *
 * 全部消耗「AI 工作台」积分池（每日赠送 20 + 充值永久积分，先赠送后充值）。
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Sparkles, Loader2, Send, Coins, ImagePlus, UploadCloud,
  Wand2, Languages, Type, Scissors, AlertTriangle, Copy, Check, RefreshCw, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { supabase } from "@/supabase/client";
import {
  generateImage, extractImageUrl, requestVisionStream,
  getPoolBalances, getServicePricing, formatPricing,
  saveAiHistory,
  type PoolBalances, type ServicePricing,
  getTranslatePacks, translateImage, TRANSLATE_TARGET_LANGS,
} from "@/services/aiService";
import { useAuth } from "@/lib/auth";
import { useLanguage } from "@/i18n/LanguageContext";
import { translate, type Lang } from "@/i18n/translations";

// 模块级工具函数（无 hook 上下文）用的翻译：与 LanguageContext 的 localStorage 口径一致
function tt(key: string, vars?: Record<string, string | number>): string {
  let lang: Lang = "zh";
  if (typeof window !== "undefined") lang = localStorage.getItem("thalvior_lang") === "en" ? "en" : "zh";
  return translate(key, lang, vars);
}

// 本部署 storage 的 bucket 名称解析失效（storage-api v1.74 与 schema 不匹配），
// 所有读写必须使用 bucket UUID，name 一律 404/400。
const STORAGE_BUCKET_ID = "d1439de1-7fc8-470b-93ba-152887a05385";

export const Route = createFileRoute("/_layout/ai/workbench")({
  component: AiWorkbench,
});

/* ───────── 通用：上传图片到 storage → 公开 URL ───────── */
async function uploadImage(file: File): Promise<{ path: string; url: string }> {
  const ext = (file.name.match(/\.\w+$/) ?? [".png"])[0];
  const path = `workbench/${crypto.randomUUID()}${ext}`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET_ID).upload(path, file, { upsert: false });
  if (error) throw new Error(tt("ai.wb.err.upload", { msg: error.message }));
  const { data } = supabase.storage.from(STORAGE_BUCKET_ID).getPublicUrl(path);
  return { path, url: data.publicUrl };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/* ───────── 通用：图片选择按钮 ───────── */
function ImageUploadButton({
  uploading, disabled, onFile,
}: {
  uploading: boolean;
  disabled?: boolean;
  onFile: (f: File) => void;
}) {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}
        {uploading ? t("ai.wb.uploading") : t("ai.wb.chooseImage")}
      </Button>
    </>
  );
}

function ImagePreview({ url, onClear }: { url: string | null; onClear: () => void }) {
  const { t } = useLanguage();
  if (!url) return null;
  return (
    <div className="relative mt-3 overflow-hidden rounded-xl border border-border/70 bg-surface-sunken/40">
      <img src={url} alt={t("ai.wb.alt.preview")} className="max-h-64 w-full object-contain" />
      <Button type="button" variant="outline" size="sm" className="absolute right-2 top-2" onClick={onClear}>
        <AlertTriangle size={12} /> {t("ai.wb.remove")}
      </Button>
    </div>
  );
}

/* ───────── 文生图面板 ───────── */
function Text2ImagePanel({ pool }: { pool: PoolBalances["workbench"] | undefined }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [pricing, setPricing] = useState<ServicePricing | null>(null);

  useEffect(() => {
    getServicePricing("image_process").then(setPricing).catch(() => setPricing(null));
  }, []);

  const run = async () => {
    if (!user) { toast.error(t("ai.wb.toast.loginRequired")); return; }
    if (!prompt.trim()) { toast.error(t("ai.wb.toast.promptRequired")); return; }
    setBusy(true); setResultUrl(null); setCost(null);
    const balanceBefore = pool?.total;
    try {
      const resp = await generateImage(prompt, "qwen-image-2.0", undefined, { serviceKey: "image_process" });
      const url = extractImageUrl(resp);
      if (!url) throw new Error(t("ai.wb.err.genRetry"));
      setResultUrl(url);
      toast.success(t("ai.wb.toast.genDone"));
      const after = await getPoolBalances().catch(() => null);
      const c = balanceBefore !== undefined && after ? balanceBefore - after.workbench.total : null;
      if (c !== null && c > 0) setCost(c);
      try {
        await saveAiHistory({ serviceKey: "image_process", serviceName: tt('ai.wb.tab.text2img'), inputText: prompt, outputText: url, cost: c ?? 0 });
      } catch { /* 静默 */ }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("ai.wb.toast.genFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-fg-muted">
        <Wand2 size={14} className="text-primary" />
        {pricing ? formatPricing(pricing) : t("ai.wb.payAsYouGo")}
        <span className="text-fg-muted/70">{t("ai.wb.poolDeduct")}</span>
      </div>
      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={t("ai.wb.t2i.placeholder")}
        rows={4}
      />
      <div className="flex items-center justify-between">
        <p className="text-xs text-fg-muted">{t("ai.wb.t2i.support")}</p>
        <Button onClick={run} disabled={busy || !prompt.trim()}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {busy ? t("ai.wb.t2i.running") : t("ai.wb.t2i.btn")}
        </Button>
      </div>
      {resultUrl && (
        <div className="rounded-xl border border-border/70 bg-card p-3">
          <img src={resultUrl} alt={t("ai.wb.alt.result")} className="max-h-96 w-full rounded-xl object-contain" />
          <div className="mt-2 flex items-center justify-between text-xs text-fg-muted">
            <span>{cost !== null ? t("ai.wb.costUsed", { n: cost }) : t("ai.wb.generated")}</span>
            <a href={resultUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">{t("ai.wb.openNew")}</a>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────── 图片→文本 面板（图片翻译 / 图生标题共用） ───────── */
function ImageLlmPanel({
  title, serviceKey, serviceName, systemPrompt, userPromptTemplate,
  pool,
}: {
  title: string;
  serviceKey: string;
  serviceName: string;
  systemPrompt: string;
  userPromptTemplate: string;
  pool: PoolBalances["workbench"] | undefined;
}) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [cost, setCost] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [pricing, setPricing] = useState<ServicePricing | null>(null);
  const [targetLang, setTargetLang] = useState<string>("ru");
  const [resultImage, setResultImage] = useState<string | null>(null);
  const outRef = useRef("");

  useEffect(() => {
    getServicePricing(serviceKey).then(setPricing).catch(() => setPricing(null));
  }, [serviceKey]);

  const onFile = async (f: File) => {
    setUploading(true);
    try {
      const { path, url } = await uploadImage(f);
      setImagePath(path);
      setImageUrl(url);
      setOutput("");
      setResultImage(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("ai.wb.toast.uploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  const run = async () => {
    if (!user) { toast.error(t("ai.wb.toast.loginRequired")); return; }
    if (!imagePath) { toast.error(t("ai.wb.toast.noImage")); return; }
    setBusy(true); setOutput(""); outRef.current = ""; setCost(null); setResultImage(null);
    const balanceBefore = pool?.total;
    if (serviceKey === "image_translate") {
      try {
        const result = await translateImage(imageUrl!, targetLang);
        setResultImage(result);
        toast.success(t("ai.wb.toast.translateDone"));
        try {
          await saveAiHistory({ serviceKey, serviceName, inputText: imageUrl ?? "", outputText: result, cost: 0 });
        } catch { /* 静默 */ }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("ai.wb.toast.translateFailed"));
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      const { data: blob } = await supabase.storage.from(STORAGE_BUCKET_ID).download(imagePath);
      const base64 = blob ? await blobToBase64(blob) : imageUrl!;
      const messages = [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: [
          { type: "image_url" as const, image_url: { url: base64 } },
          { type: "text" as const, text: userPromptTemplate },
        ] },
      ];
      await requestVisionStream(messages, (chunk) => {
        outRef.current += chunk;
        setOutput(outRef.current);
      }, { serviceKey });
      toast.success(t("ai.wb.toast.genDone"));
      const after = await getPoolBalances().catch(() => null);
      const c = balanceBefore !== undefined && after ? balanceBefore - after.workbench.total : null;
      if (c !== null && c > 0) setCost(c);
      try {
        await saveAiHistory({ serviceKey, serviceName, inputText: imageUrl ?? "", outputText: outRef.current, cost: c ?? 0 });
      } catch { /* 静默 */ }
    } catch (e) {
      setOutput((prev) => prev + "\n\n⚠️ " + (e instanceof Error ? e.message : t("ai.wb.toast.procFailed"))) ;
      toast.error(e instanceof Error ? e.message : t("ai.wb.toast.procFailed"));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-fg-muted">
        {serviceKey === "image_translate" ? <Languages size={14} className="text-primary" /> : <Type size={14} className="text-primary" />}
        {serviceKey === "image_translate"
          ? t("ai.wb.packBilling")
          : <>{pricing ? formatPricing(pricing) : t("ai.wb.payAsYouGo")}<span className="text-fg-muted/70">{t("ai.wb.poolDeduct")}</span></>}
      </div>
      {serviceKey === "image_translate" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-fg-muted">{t("ai.wb.targetLang")}</span>
          {TRANSLATE_TARGET_LANGS.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => setTargetLang(l.code)}
              disabled={busy}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                targetLang === l.code
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-fg-muted hover:border-primary/50 hover:text-fg"
              )}
            >
              {t(l.labelKey)}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3">
        <ImageUploadButton uploading={uploading} disabled={busy} onFile={onFile} />
        {imageUrl && <span className="text-xs text-fg-muted">{serviceKey === "image_translate" ? t("ai.wb.pickedTranslate") : t("ai.wb.pickedProcess")}</span>}
      </div>
      <ImagePreview url={imageUrl} onClear={() => { setImagePath(null); setImageUrl(null); setOutput(""); setResultImage(null); }} />
      {imageUrl && (
        <div className="flex items-center justify-end">
          <Button onClick={run} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {busy ? (serviceKey === "image_translate" ? t("ai.wb.translating") : t("ai.wb.processing")) : (serviceKey === "image_translate" ? t("ai.wb.startTranslate") : t("ai.wb.startProcess"))}
          </Button>
        </div>
      )}
      {serviceKey === "image_translate" && resultImage && (
        <div className="rounded-xl border border-border/70 bg-card">
          <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
            <span className="text-xs font-medium text-fg-muted">{t("ai.wb.resultImgTitle")}</span>
            <div className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => window.open(resultImage, "_blank")}>
                <ExternalLink size={13} /> {t("ai.wb.newWindow")}
              </Button>
              <a href={resultImage} download target="_blank" rel="noreferrer">
                <Button type="button" variant="ghost" size="sm">
                  <Check size={13} /> {t("ai.wb.downloadResult")}
                </Button>
              </a>
            </div>
          </div>
          <div className="p-3">
            <img src={resultImage} alt={t("ai.wb.alt.translate")} className="max-h-[480px] w-auto rounded-xl border border-border/50 mx-auto" />
          </div>
        </div>
      )}
      {output && (
        <div className="rounded-xl border border-border/70 bg-card">
          <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
            <span className="text-xs font-medium text-fg-muted">
              {title}{t("ai.wb.resultSuffix")}{cost !== null ? t("ai.wb.costUsedPrefix", { n: cost }) : ""}
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={copy}>
              {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
              {copied ? t("ai.wb.copied") : t("ai.wb.copy")}
            </Button>
          </div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed text-fg">{output}</pre>
        </div>
      )}
    </div>
  );
}

/* ───────── 抠图面板 ─────────
 * 链路：上传原图 → ai-image-gen(matting) 生成绿屏图（后端已转存 storage 公开 URL）
 *       → supabase download 取图（无跨域）→ canvas 色度键去绿 → 透明 PNG → 上传 storage → 展示
 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function storagePathFromPublicUrl(url: string): string | null {
  const marker = "/object/public/";
  const idx = url.indexOf(marker);
  if (idx < 0) return null;
  const rest = url.slice(idx + marker.length); // product-images/workbench/xxx.png
  const slash = rest.indexOf("/");
  if (slash < 0) return null;
  return rest.slice(slash + 1); // workbench/xxx.png
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(tt("ai.wb.err.imgLoad")));
    img.src = src;
  });
}

/** 绿屏 → 透明底 PNG：按绿色浓度渐进抠除背景，并做轻微去绿溢出（despill） */
function chromaKeyToTransparent(img: HTMLImageElement, maxSize = 2048): Promise<Blob> {
  const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  const GREEN_TH = 28;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const greenness = g - Math.max(r, b);
    if (greenness > GREEN_TH) {
      // 绿屏区域 → 透明（含半透明边缘渐变）
      const alpha = Math.max(0, Math.min(255, 255 - (greenness - GREEN_TH) * 4));
      d[i + 3] = alpha;
    } else {
      d[i + 3] = 255;
      // 轻微去绿溢出：绿色通道略高时降绿，避免主体边缘泛绿
      if (g > Math.max(r, b)) {
        const spill = Math.min(30, g - Math.max(r, b));
        d[i + 1] = Math.max(0, g - spill);
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(tt("ai.wb.err.pngGen")))), "image/png")
  );
}

function CutoutPanel({ pool }: { pool: PoolBalances["workbench"] | undefined }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [pricing, setPricing] = useState<ServicePricing | null>(null);

  useEffect(() => {
    getServicePricing("image_matting").then(setPricing).catch(() => setPricing(null));
  }, []);

  const onFile = async (f: File) => {
    setUploading(true);
    try {
      const { path, url } = await uploadImage(f);
      setImagePath(path);
      setImageUrl(url);
      setResultUrl(null);
      setCost(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("ai.wb.toast.uploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  const run = async () => {
    if (!user) { toast.error(t("ai.wb.toast.loginRequired")); return; }
    if (!imagePath) { toast.error(t("ai.wb.toast.noImage")); return; }
    setBusy(true); setResultUrl(null); setCost(null);
    const balanceBefore = pool?.total;
    try {
      // 1. 后端生成绿屏图：传 storage 路径（公开 URL 在本部署不可靠），服务端下载转 base64 后调 qwen-image-3.0
      const resp = await generateImage("", "qwen-image-3.0", undefined, {
        serviceKey: "image_matting",
        images: [imagePath],
      });
      const greenUrl = extractImageUrl(resp);
      if (!greenUrl) throw new Error(t("ai.wb.err.cutRetry"));
      // 2. 通过 supabase client 下载（无跨域），canvas 色度键去绿 → 透明 PNG
      const greenPath = storagePathFromPublicUrl(greenUrl);
      let imgBlob: Blob;
      if (greenPath) {
        const { data, error } = await supabase.storage.from(STORAGE_BUCKET_ID).download(greenPath);
        if (error || !data) throw new Error(error?.message || t("ai.wb.err.readGreen"));
        imgBlob = data;
      } else {
        const resp2 = await fetch(greenUrl);
        if (!resp2.ok) throw new Error(t("ai.wb.err.readGreen"));
        imgBlob = await resp2.blob();
      }
      const img = await loadImage(await blobToDataUrl(imgBlob));
      const pngBlob = await chromaKeyToTransparent(img);
      // 3. 上传透明底 PNG
      const path = `workbench/${crypto.randomUUID()}.png`;
      const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET_ID).upload(path, pngBlob, {
        contentType: "image/png",
        upsert: false,
      });
      if (upErr) throw new Error(t("ai.wb.err.resultUpload", { msg: upErr.message }));
      const { data } = supabase.storage.from(STORAGE_BUCKET_ID).getPublicUrl(path);
      setResultUrl(data.publicUrl);
      toast.success(t("ai.wb.toast.cutDone"));
      const after = await getPoolBalances().catch(() => null);
      const c = balanceBefore !== undefined && after ? balanceBefore - after.workbench.total : null;
      if (c !== null && c > 0) setCost(c);
      try {
        await saveAiHistory({ serviceKey: "image_matting", serviceName: tt('ai.res.cutoutTitle'), inputText: imageUrl ?? "", outputText: data.publicUrl, cost: c ?? 0 });
      } catch { /* 静默 */ }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("ai.wb.toast.cutFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-fg-muted">
        <Scissors size={14} className="text-primary" />
        {pricing ? formatPricing(pricing) : t("ai.wb.payAsYouGo")}
        <span className="text-fg-muted/70">{t("ai.wb.poolDeduct")}</span>
      </div>
      <div className="flex items-center gap-3">
        <ImageUploadButton uploading={uploading} disabled={busy} onFile={onFile} />
        {imageUrl && <span className="text-xs text-fg-muted">{t("ai.wb.pickedCutout")}</span>}
      </div>
      <ImagePreview url={imageUrl} onClear={() => { setImagePath(null); setImageUrl(null); setResultUrl(null); }} />
      {imageUrl && (
        <div className="flex items-center justify-end">
          <Button onClick={run} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
            {busy ? t("ai.wb.cutRunning") : t("ai.wb.startCutout")}
          </Button>
        </div>
      )}
      {resultUrl && (
        <div className="rounded-xl border border-border/70 bg-card p-3">
          <div
            className="flex items-center justify-center rounded-xl border border-border/60"
            style={{ backgroundImage: "linear-gradient(45deg,var(--border) 25%,transparent 25%,transparent 75%,var(--border) 75%),linear-gradient(45deg,var(--border) 25%,transparent 25%,transparent 75%,var(--border) 75%)", backgroundSize: "16px 16px", backgroundPosition: "0 0,8px 8px" }}
          >
            <img src={resultUrl} alt={t("ai.wb.alt.cutout")} className="max-h-96 w-full object-contain" />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-fg-muted">
            <span>{cost !== null ? t("ai.wb.costUsed", { n: cost }) : t("ai.wb.transparentPng")}</span>
            <a href={resultUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline" download>{t("ai.wb.downloadTransparent")}</a>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────── 主页面 ───────── */
function AiWorkbench() {
  const { t } = useLanguage();
  const [pools, setPools] = useState<PoolBalances | null>(null);
  const [packLeft, setPackLeft] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    getPoolBalances().then(setPools).catch(() => setPools(null));
    getTranslatePacks().then((rows) => setPackLeft(rows.reduce((acc, p) => acc + (p.remaining ?? 0), 0))).catch(() => setPackLeft(null));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  const wb = pools?.workbench;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("ai.wb.title")}
        description={t("ai.wb.desc")}
      />

      {/* 工作台积分池 */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border/70 bg-card p-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
          <Coins size={20} className="text-primary" />
        </div>
        <div>
          <p className="text-sm font-medium text-fg">{t("sub.quota.workbench")}</p>
          <p className="mt-0.5 text-xs text-fg-muted">
            {t("ai.wb.balance")} <span className="text-base font-semibold text-primary">{wb?.total ?? "—"}</span>
            <span className="mx-2 text-border">|</span>
            {t("ai.wb.freeToday", { n: wb?.freeToday ?? 0 })}
            <span className="mx-2 text-border">|</span>
            {t("ai.wb.purchased", { n: wb?.purchased ?? 0 })}
          </p>
        </div>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => setRefreshKey((k) => k + 1)}>
          <RefreshCw size={13} /> {t("ai.wb.refresh")}
        </Button>
      </div>

      <Tabs defaultValue="text2img" className="w-full">
        <TabsList className="grid w-full max-w-xl grid-cols-4">
          <TabsTrigger value="text2img"><Wand2 size={14} className="mr-1.5" />{t("ai.wb.tab.text2img")}</TabsTrigger>
          <TabsTrigger value="cutout"><Scissors size={14} className="mr-1.5" />{t("ai.wb.tab.cutout")}</TabsTrigger>
          <TabsTrigger value="translate"><Languages size={14} className="mr-1.5" />{t("ai.wb.tab.translate")}</TabsTrigger>
          <TabsTrigger value="title"><Type size={14} className="mr-1.5" />{t("ai.wb.tab.titleGen")}</TabsTrigger>
        </TabsList>

        <TabsContent value="text2img" className="mt-4">
          <div className="rounded-xl border border-border/70 bg-card p-5">
            <Text2ImagePanel pool={wb} />
          </div>
        </TabsContent>

        <TabsContent value="cutout" className="mt-4">
          <div className="rounded-xl border border-border/70 bg-card p-5">
            <CutoutPanel pool={wb} />
          </div>
        </TabsContent>

        <TabsContent value="translate" className="mt-4">
          <div className="rounded-xl border border-border/70 bg-card p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-sunken/50 px-3 py-2 text-xs">
              <span className="text-fg-muted">{t("ai.wb.packNote")}</span>
              <span className="text-fg-muted">
                {t("ai.wb.remainingPre")} <b className={cn("text-fg", (packLeft ?? 0) > 0 && "text-primary")}>{packLeft ?? "—"}</b> {t("ai.wb.unitImg")}
                <Link to="/ai/resources" className="ml-2 text-primary underline-offset-2 hover:underline">{t("ai.wb.buyManage")}</Link>
              </span>
            </div>
            <ImageLlmPanel
              title={t("ai.wb.tab.translate")}
              serviceKey="image_translate"
              serviceName={tt('ai.res.imgTrans')}
              systemPrompt={tt('ai.wb.prompt.translate')}
              userPromptTemplate={tt('ai.wb.prompt.translateUser')}
              pool={wb}
            />
          </div>
        </TabsContent>

        <TabsContent value="title" className="mt-4">
          <div className="rounded-xl border border-border/70 bg-card p-5">
            <ImageLlmPanel
              title={t("ai.wb.tab.titleGen")}
              serviceKey="image_parse"
              serviceName={tt('ai.wb.tab.titleGen')}
              systemPrompt={tt('ai.wb.prompt.titleGen')}
              userPromptTemplate={tt('ai.wb.prompt.titleGenUser')}
              pool={wb}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
