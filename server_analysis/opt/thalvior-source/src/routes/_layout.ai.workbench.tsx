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
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Sparkles, Loader2, Send, Coins, ImagePlus, UploadCloud,
  Wand2, Languages, Type, Scissors, AlertTriangle, Copy, Check, RefreshCw,
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
} from "@/services/aiService";
import { useAuth } from "@/lib/auth";

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
  if (error) throw new Error(`图片上传失败：${error.message}`);
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
        {uploading ? "上传中…" : "选择图片"}
      </Button>
    </>
  );
}

function ImagePreview({ url, onClear }: { url: string | null; onClear: () => void }) {
  if (!url) return null;
  return (
    <div className="relative mt-3 overflow-hidden rounded-xl border border-border/70 bg-muted/40">
      <img src={url} alt="预览" className="max-h-64 w-full object-contain" />
      <Button type="button" variant="outline" size="sm" className="absolute right-2 top-2" onClick={onClear}>
        <AlertTriangle size={12} /> 移除
      </Button>
    </div>
  );
}

/* ───────── 文生图面板 ───────── */
function Text2ImagePanel({ pool }: { pool: PoolBalances["workbench"] | undefined }) {
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
    if (!user) { toast.error("请先登录"); return; }
    if (!prompt.trim()) { toast.error("请输入画面描述"); return; }
    setBusy(true); setResultUrl(null); setCost(null);
    const balanceBefore = pool?.total;
    try {
      const resp = await generateImage(prompt, "qwen-image-2.0", undefined, { serviceKey: "image_process" });
      const url = extractImageUrl(resp);
      if (!url) throw new Error("图片生成失败，请重试");
      setResultUrl(url);
      toast.success("生成完成");
      const after = await getPoolBalances().catch(() => null);
      const c = balanceBefore !== undefined && after ? balanceBefore - after.workbench.total : null;
      if (c !== null && c > 0) setCost(c);
      try {
        await saveAiHistory({ serviceKey: "image_process", serviceName: "文生图", inputText: prompt, outputText: url, cost: c ?? 0 });
      } catch { /* 静默 */ }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "生成失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Wand2 size={14} className="text-primary" />
        {pricing ? formatPricing(pricing) : "每次按积分计费"}
        <span className="text-muted-foreground/70">· 从「AI 工作台」积分池扣除</span>
      </div>
      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="描述你想生成的画面，例如：白色背景下的无线蓝牙耳机产品图，简洁电商风格，高清"
        rows={4}
      />
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">支持商品图、场景图、主图素材等</p>
        <Button onClick={run} disabled={busy || !prompt.trim()}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {busy ? "生成中…" : "生成图片"}
        </Button>
      </div>
      {resultUrl && (
        <div className="rounded-xl border border-border/70 bg-card p-3">
          <img src={resultUrl} alt="生成结果" className="max-h-96 w-full rounded-lg object-contain" />
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>{cost !== null ? `本次消耗 ${cost} 积分` : "已生成"}</span>
            <a href={resultUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">在新窗口打开</a>
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
  const { user } = useAuth();
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [cost, setCost] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [pricing, setPricing] = useState<ServicePricing | null>(null);
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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
    }
  };

  const run = async () => {
    if (!user) { toast.error("请先登录"); return; }
    if (!imagePath) { toast.error("请先选择图片"); return; }
    setBusy(true); setOutput(""); outRef.current = ""; setCost(null);
    const balanceBefore = pool?.total;
    try {
      const { data: blob } = await supabase.storage.from(STORAGE_BUCKET_ID).download(imagePath);
      const base64 = blob ? await blobToBase64(blob) : imageUrl!;
      const messages = [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: [
          { type: "image_url", image_url: { url: base64 } },
          { type: "text", text: userPromptTemplate },
        ] },
      ];
      await requestVisionStream(messages, (chunk) => {
        outRef.current += chunk;
        setOutput(outRef.current);
      }, { serviceKey });
      toast.success("生成完成");
      const after = await getPoolBalances().catch(() => null);
      const c = balanceBefore !== undefined && after ? balanceBefore - after.workbench.total : null;
      if (c !== null && c > 0) setCost(c);
      try {
        await saveAiHistory({ serviceKey, serviceName, inputText: imageUrl, outputText: outRef.current, cost: c ?? 0 });
      } catch { /* 静默 */ }
    } catch (e) {
      setOutput((prev) => prev + "\n\n⚠️ " + (e instanceof Error ? e.message : "处理失败")) ;
      toast.error(e instanceof Error ? e.message : "处理失败");
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
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {serviceKey === "image_translate" ? <Languages size={14} className="text-primary" /> : <Type size={14} className="text-primary" />}
        {pricing ? formatPricing(pricing) : "每次按积分计费"}
        <span className="text-muted-foreground/70">· 从「AI 工作台」积分池扣除</span>
      </div>
      <div className="flex items-center gap-3">
        <ImageUploadButton uploading={uploading} disabled={busy} onFile={onFile} />
        {imageUrl && <span className="text-xs text-muted-foreground">已选择图片，点击「开始处理」</span>}
      </div>
      <ImagePreview url={imageUrl} onClear={() => { setImagePath(null); setImageUrl(null); setOutput(""); }} />
      {imageUrl && (
        <div className="flex items-center justify-end">
          <Button onClick={run} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {busy ? "处理中…" : "开始处理"}
          </Button>
        </div>
      )}
      {output && (
        <div className="rounded-xl border border-border/70 bg-card">
          <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              {title}结果{cost !== null ? ` · 本次消耗 ${cost} 积分` : ""}
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={copy}>
              {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
              {copied ? "已复制" : "复制"}
            </Button>
          </div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed text-ink">{output}</pre>
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
    img.onerror = () => reject(new Error("图片加载失败"));
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
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("透明 PNG 生成失败"))), "image/png")
  );
}

function CutoutPanel({ pool }: { pool: PoolBalances["workbench"] | undefined }) {
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
      toast.error(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
    }
  };

  const run = async () => {
    if (!user) { toast.error("请先登录"); return; }
    if (!imagePath) { toast.error("请先选择图片"); return; }
    setBusy(true); setResultUrl(null); setCost(null);
    const balanceBefore = pool?.total;
    try {
      // 1. 后端生成绿屏图：传 storage 路径（公开 URL 在本部署不可靠），服务端下载转 base64 后调 qwen-image-3.0
      const resp = await generateImage("", "qwen-image-3.0", undefined, {
        serviceKey: "image_matting",
        images: [imagePath],
      });
      const greenUrl = extractImageUrl(resp);
      if (!greenUrl) throw new Error("抠图处理失败，请重试");
      // 2. 通过 supabase client 下载（无跨域），canvas 色度键去绿 → 透明 PNG
      const greenPath = storagePathFromPublicUrl(greenUrl);
      let imgBlob: Blob;
      if (greenPath) {
        const { data, error } = await supabase.storage.from(STORAGE_BUCKET_ID).download(greenPath);
        if (error || !data) throw new Error(error?.message || "读取绿屏图失败");
        imgBlob = data;
      } else {
        const resp2 = await fetch(greenUrl);
        if (!resp2.ok) throw new Error("读取绿屏图失败");
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
      if (upErr) throw new Error(`结果上传失败：${upErr.message}`);
      const { data } = supabase.storage.from(STORAGE_BUCKET_ID).getPublicUrl(path);
      setResultUrl(data.publicUrl);
      toast.success("抠图完成");
      const after = await getPoolBalances().catch(() => null);
      const c = balanceBefore !== undefined && after ? balanceBefore - after.workbench.total : null;
      if (c !== null && c > 0) setCost(c);
      try {
        await saveAiHistory({ serviceKey: "image_matting", serviceName: "AI 抠图", inputText: imageUrl, outputText: data.publicUrl, cost: c ?? 0 });
      } catch { /* 静默 */ }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "抠图失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Scissors size={14} className="text-primary" />
        {pricing ? formatPricing(pricing) : "每次按积分计费"}
        <span className="text-muted-foreground/70">· 从「AI 工作台」积分池扣除</span>
      </div>
      <div className="flex items-center gap-3">
        <ImageUploadButton uploading={uploading} disabled={busy} onFile={onFile} />
        {imageUrl && <span className="text-xs text-muted-foreground">已选择图片，点击「开始抠图」</span>}
      </div>
      <ImagePreview url={imageUrl} onClear={() => { setImagePath(null); setImageUrl(null); setResultUrl(null); }} />
      {imageUrl && (
        <div className="flex items-center justify-end">
          <Button onClick={run} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
            {busy ? "抠图中…" : "开始抠图"}
          </Button>
        </div>
      )}
      {resultUrl && (
        <div className="rounded-xl border border-border/70 bg-card p-3">
          <div
            className="flex items-center justify-center rounded-lg border border-border/60"
            style={{ backgroundImage: "linear-gradient(45deg,#e5e7eb 25%,transparent 25%,transparent 75%,#e5e7eb 75%),linear-gradient(45deg,#e5e7eb 25%,transparent 25%,transparent 75%,#e5e7eb 75%)", backgroundSize: "16px 16px", backgroundPosition: "0 0,8px 8px" }}
          >
            <img src={resultUrl} alt="抠图结果" className="max-h-96 w-full object-contain" />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>{cost !== null ? `本次消耗 ${cost} 积分` : "已生成透明底 PNG"}</span>
            <a href={resultUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline" download>下载透明图</a>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────── 主页面 ───────── */
function AiWorkbench() {
  const [pools, setPools] = useState<PoolBalances | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    getPoolBalances().then(setPools).catch(() => setPools(null));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  const wb = pools?.workbench;

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI 工作台"
        description="高频 AI 工具集中入口，消耗「AI 工作台」积分池（每日赠送 20，当日清零不累计）"
      />

      {/* 工作台积分池 */}
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-border/70 bg-card p-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
          <Coins size={20} className="text-primary" />
        </div>
        <div>
          <p className="text-sm font-medium text-ink">AI 工作台积分</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            余额 <span className="text-base font-semibold text-primary">{wb?.total ?? "—"}</span>
            <span className="mx-2 text-border">|</span>
            今日赠送 {wb?.freeToday ?? 0}（当日清零）
            <span className="mx-2 text-border">|</span>
            充值 {wb?.purchased ?? 0}（永久有效）
          </p>
        </div>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => setRefreshKey((k) => k + 1)}>
          <RefreshCw size={13} /> 刷新余额
        </Button>
      </div>

      <Tabs defaultValue="text2img" className="w-full">
        <TabsList className="grid w-full max-w-xl grid-cols-4">
          <TabsTrigger value="text2img"><Wand2 size={14} className="mr-1.5" />文生图</TabsTrigger>
          <TabsTrigger value="cutout"><Scissors size={14} className="mr-1.5" />抠图</TabsTrigger>
          <TabsTrigger value="translate"><Languages size={14} className="mr-1.5" />图片翻译</TabsTrigger>
          <TabsTrigger value="title"><Type size={14} className="mr-1.5" />图生标题</TabsTrigger>
        </TabsList>

        <TabsContent value="text2img" className="mt-4">
          <div className="rounded-2xl border border-border/70 bg-card p-5">
            <Text2ImagePanel pool={wb} />
          </div>
        </TabsContent>

        <TabsContent value="cutout" className="mt-4">
          <div className="rounded-2xl border border-border/70 bg-card p-5">
            <CutoutPanel pool={wb} />
          </div>
        </TabsContent>

        <TabsContent value="translate" className="mt-4">
          <div className="rounded-2xl border border-border/70 bg-card p-5">
            <ImageLlmPanel
              title="图片翻译"
              serviceKey="image_translate"
              serviceName="图片翻译"
              systemPrompt="你是跨境电商图片翻译助手。识别图片中的文字内容，翻译为简体中文；保留数字、型号、单位等关键信息，按图片原意流畅翻译，直接输出翻译结果，不要解释过程。"
              userPromptTemplate="请识别并翻译这张图片中的文字。"
              pool={wb}
            />
          </div>
        </TabsContent>

        <TabsContent value="title" className="mt-4">
          <div className="rounded-2xl border border-border/70 bg-card p-5">
            <ImageLlmPanel
              title="图生标题"
              serviceKey="image_parse"
              serviceName="图生标题"
              systemPrompt="你是跨境电商商品标题专家。根据商品图片生成 5 个高质量商品标题：中文 3 个、英文 2 个；突出核心卖点、材质、适用场景、人群，长度 80-120 字符，直接输出标题列表，每个一行。"
              userPromptTemplate="请根据这张商品图片生成 5 个商品标题（中文 3 个、英文 2 个）。"
              pool={wb}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
