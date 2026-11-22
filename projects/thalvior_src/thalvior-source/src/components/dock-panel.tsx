// 扩展坞（Dock）面板 —— 采集插件安装中心
//
// 对标成熟 ERP（妙手 / 店小秘）的插件交付标准，而不是「给开发者一个 ZIP 就完事」：
//   1. 实时检测插件是否已安装（content script 注入 DOM 标记，轮询自动刷新状态）
//   2. 自动识别当前浏览器 + 允许切换，按浏览器给出专属安装路径与格式说明
//   3. 未勾选用户协议不允许下载
//   4. 常见问题排错清单（旧插件冲突 / 无痕模式 / 未刷新 / Mac / 权限）
//
// 安装包是构建期打包进 public/downloads 的静态资源，真实可下载。
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Dock, Download, X, Puzzle, Inbox, Check, ChevronDown, Loader2,
  ShieldCheck, RefreshCw, AlertTriangle, Keyboard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n/LanguageContext";

const PACKAGE_URL = "/downloads/thalvior-collect-extension.zip";
const PACKAGE_NAME = "thalvior-collect-extension.zip";
const PACKAGE_VERSION = "2.1.0";
const EXT_MARKER = "data-thalvior-collector";
const AGREE_KEY = "meoo.dock.pluginAgreed";

type InstallStep = { title: string; desc: string };
type BrowserProfile = {
  key: string;
  nameKey: string;
  tagKey?: string;
  /** 该浏览器对应的安装步骤模板 */
  steps: "chromium" | "qqnew" | "unpacked" | "store";
};

/** 支持的浏览器：识别规则参考各厂商 UA，步骤参考各浏览器官方扩展安装路径 */
const BROWSERS: BrowserProfile[] = [
  { key: "chrome", nameKey: "dock.browser.chrome", tagKey: "dock.browser.tagReco", steps: "chromium" },
  { key: "edge", nameKey: "dock.browser.edge", tagKey: "dock.browser.tagReco", steps: "chromium" },
  { key: "qq", nameKey: "dock.browser.qq", steps: "qqnew" },
  { key: "360ee", nameKey: "dock.browser.360ee", steps: "unpacked" },
  { key: "360se", nameKey: "dock.browser.360se", steps: "unpacked" },
  { key: "sogou", nameKey: "dock.browser.sogou", steps: "unpacked" },
  { key: "ziniao", nameKey: "dock.browser.ziniao", steps: "store" },
  { key: "feikua", nameKey: "dock.browser.feikua", steps: "store" },
  { key: "other", nameKey: "dock.browser.other", steps: "unpacked" },
];

/** 根据 UA 猜当前浏览器；猜不出就落到「其他」 */
function detectBrowserKey(): string {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "edge";
  if (/QQBrowser/.test(ua)) return "qq";
  if (/360EE|QIHU 360EE/i.test(ua)) return "360ee";
  if (/360SE|QIHU 360SE/i.test(ua)) return "360se";
  if (/SE 2\.X MetaSr|SogouMobileBrowser|SE 2/i.test(ua)) return "sogou";
  if (/Chrome\//.test(ua)) return "chrome";
  return "other";
}

type Translate = (key: string, vars?: Record<string, string>) => string;

function buildSteps(kind: BrowserProfile["steps"], b: BrowserProfile, t: Translate): InstallStep[] {
  if (kind === "chromium") {
    return [
      { title: t("dock.step.chromium.dl.title"), desc: t("dock.step.chromium.dl.desc", { file: PACKAGE_NAME }) },
      { title: t("dock.step.chromium.open.title"), desc: b.key === "edge" ? t("dock.step.chromium.open.desc.edge") : t("dock.step.chromium.open.desc.chrome") },
      { title: t("dock.step.chromium.dev.title"), desc: t("dock.step.chromium.dev.desc") },
      { title: t("dock.step.chromium.drag.title"), desc: t("dock.step.chromium.drag.desc") },
      { title: t("dock.step.chromium.done.title"), desc: t("dock.step.chromium.done.desc") },
    ];
  }
  if (kind === "qqnew") {
    return [
      { title: t("dock.step.qq.dl.title"), desc: t("dock.step.qq.dl.desc", { file: PACKAGE_NAME }) },
      { title: t("dock.step.qq.open.title"), desc: t("dock.step.qq.open.desc") },
      { title: t("dock.step.qq.drag.title"), desc: t("dock.step.qq.drag.desc") },
      { title: t("dock.step.qq.perm.title"), desc: t("dock.step.qq.perm.desc") },
      { title: t("dock.step.qq.done.title"), desc: t("dock.step.qq.done.desc") },
    ];
  }
  if (kind === "store") {
    return [
      { title: t("dock.step.store.dl.title"), desc: t("dock.step.store.dl.desc", { file: PACKAGE_NAME }) },
      { title: t("dock.step.store.open.title"), desc: t("dock.step.store.open.desc", { browser: t(b.nameKey) }) },
      { title: t("dock.step.store.local.title"), desc: t("dock.step.store.local.desc") },
      { title: t("dock.step.store.enable.title"), desc: t("dock.step.store.enable.desc") },
      { title: t("dock.step.store.done.title"), desc: t("dock.step.store.done.desc") },
    ];
  }
  return [
    { title: t("dock.step.unpacked.dl.title"), desc: t("dock.step.unpacked.dl.desc", { file: PACKAGE_NAME }) },
    { title: t("dock.step.unpacked.open.title"), desc: t("dock.step.unpacked.open.desc") },
    { title: t("dock.step.unpacked.dev.title"), desc: t("dock.step.unpacked.dev.desc") },
    { title: t("dock.step.unpacked.load.title"), desc: t("dock.step.unpacked.load.desc") },
    { title: t("dock.step.unpacked.done.title"), desc: t("dock.step.unpacked.done.desc") },
  ];
}

const TROUBLES = [
  { qKey: "dock.faq.1.q", aKey: "dock.faq.1.a" },
  { qKey: "dock.faq.2.q", aKey: "dock.faq.2.a" },
  { qKey: "dock.faq.3.q", aKey: "dock.faq.3.a" },
  { qKey: "dock.faq.4.q", aKey: "dock.faq.4.a" },
  { qKey: "dock.faq.5.q", aKey: "dock.faq.5.a" },
];

export function DockPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [agreed, setAgreed] = useState(false);
  const [browserKey, setBrowserKey] = useState("chrome");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [troubleOpen, setTroubleOpen] = useState<string | null>(null);
  const [installedVersion, setInstalledVersion] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  // 安装包体积从服务端真实读取，避免写死数字过期失真
  const [packageSize, setPackageSize] = useState<string>("");
  const [packageVersion, setPackageVersion] = useState<string>(PACKAGE_VERSION);

  useEffect(() => {
    let alive = true;
    fetch("/downloads/version.txt")
      .then((r) => (r.ok ? r.text() : ""))
      .then((t) => {
        const v = t.trim();
        if (alive && /^\d+\.\d+\.\d+$/.test(v)) setPackageVersion(v);
      })
      .catch(() => {
        /* 服务端没有版本文件就显示构建内置版本 */
      });
    fetch(PACKAGE_URL, { method: "HEAD" })
      .then((r) => {
        const len = Number(r.headers.get("content-length") || 0);
        if (alive && len > 0) setPackageSize(`${Math.max(1, Math.round(len / 1024))} KB`);
      })
      .catch(() => {
        /* 取不到就不显示大小 */
      });
    return () => {
      alive = false;
    };
  }, []);

  // 首次打开时识别当前浏览器 + 读取已同意的协议状态
  useEffect(() => {
    if (!open) return;
    setBrowserKey(detectBrowserKey());
    try {
      setAgreed(localStorage.getItem(AGREE_KEY) === "1");
    } catch {
      setAgreed(false);
    }
  }, [open]);

  // 插件安装检测：content script 会往 <html> 注入标记，面板打开期间轮询，
  // 用户切出去装完再回来，状态自动变绿
  useEffect(() => {
    if (!open) return;
    const read = () => setInstalledVersion(document.documentElement.getAttribute(EXT_MARKER));
    read();
    const onReady = (e: Event) => {
      const v = (e as CustomEvent<{ version?: string }>).detail?.version;
      if (v) setInstalledVersion(v);
    };
    window.addEventListener("thalvior:collector-ready", onReady);
    const timer = setInterval(read, 1500);
    return () => {
      clearInterval(timer);
      window.removeEventListener("thalvior:collector-ready", onReady);
    };
  }, [open]);

  const current = BROWSERS.find((b) => b.key === browserKey) ?? BROWSERS[BROWSERS.length - 1];
  const steps = buildSteps(current.steps, current, t);

  function toggleAgree() {
    const next = !agreed;
    setAgreed(next);
    try {
      localStorage.setItem(AGREE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="glass relative max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={t("dock.common.ariaClose")}
        >
          <X size={16} />
        </button>

        {/* 标题 */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink text-white">
            <Dock size={18} />
          </div>
          <div>
            <h3 className="font-display font-semibold">{t("dock.title")}</h3>
            <p className="text-xs text-muted-foreground">{t("dock.desc")}</p>
          </div>
        </div>

        {/* 安装状态条：插件 content script 注入标记，这里实时读取 */}
        {installedVersion ? (
          <div className="mt-5 flex items-center gap-3 rounded-xl border border-success/30 bg-success-bg px-4 py-3">
            <ShieldCheck size={20} className="text-success" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-success">
                {t("dock.installed")} · v{installedVersion}
              </p>
              <p className="text-xs text-success/80">{t("dock.installedDesc")}</p>
            </div>
            {checking && <Loader2 size={14} className="animate-spin text-success" />}
          </div>
        ) : (
          <div className="mt-5 flex items-center gap-3 rounded-xl border border-warning/30 bg-warning-bg px-4 py-3">
            <AlertTriangle size={20} className="text-warning" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-warning">{t("dock.notInstalled")}</p>
              <p className="text-xs text-warning/80">{t("dock.notInstalledDesc")}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => { setChecking(true); setTimeout(() => setChecking(false), 800); }}>
              <RefreshCw size={13} className={checking ? "mr-1 animate-spin" : "mr-1"} />
              {t("dock.recheck")}
            </Button>
          </div>
        )}

        {/* 浏览器选择 */}
        <div className="mt-5">
          <label className="text-xs font-semibold text-muted-foreground">{t("dock.chooseBrowser")}</label>
          <div className="relative mt-1.5">
            <button
              onClick={() => setPickerOpen((v) => !v)}
              className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5 text-sm transition-colors hover:bg-muted/50"
            >
              <span className="flex items-center gap-2">
                <span className="font-medium">{t(current.nameKey)}</span>
                {current.tagKey && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{t(current.tagKey)}</span>
                )}
                {installedVersion && <Check size={14} className="text-success" />}
              </span>
              <ChevronDown size={15} className={`text-muted-foreground transition-transform ${pickerOpen ? "rotate-180" : ""}`} />
            </button>
            {pickerOpen && (
              <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                {BROWSERS.map((b) => (
                  <button
                    key={b.key}
                    onClick={() => { setBrowserKey(b.key); setPickerOpen(false); }}
                    className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/60 ${
                      b.key === browserKey ? "bg-muted/50 font-medium" : ""
                    }`}
                  >
                    <span>{t(b.nameKey)}</span>
                    <span className="text-[11px] text-muted-foreground">{t("dock.formatZip")}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">{t("dock.autoDetected")}</p>
        </div>

        {/* 安装包卡片 */}
        <div className="mt-4 rounded-xl border border-border bg-card/60 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Puzzle size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{t("dock.extensionCard")}</p>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">v{packageVersion}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{t("dock.formatZip")}</span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("dock.extensionDesc")}</p>
            </div>
          </div>

          {/* 插件暂下架（2026-10-17：功能未完善，待完善并测试后恢复下载。恢复方法：还原 /tmp/dock-panel.pre-offshelf.tsx 的本区域 + 将 zip 放回 public/downloads/） */}
          <div className="mt-4 rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center">
            <p className="text-sm font-medium">{t("dock.pausedTitle")}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("dock.pausedBody")}</p>
          </div>

          {/* 协议勾选 */}
          <label className="mt-4 flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={agreed}
              onChange={toggleAgree}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
            />
            <span>{t("dock.agreeText")}</span>
          </label>

          {agreed ? (
            <a href={PACKAGE_URL} download={PACKAGE_NAME} className="mt-3 block">
              <Button className="w-full" type="button">
                <Download size={15} className="mr-2" />
                {t("dock.download")}
                {packageSize && <span className="ml-2 text-xs opacity-70">{packageSize}</span>}
              </Button>
            </a>
          ) : (
            <Button className="mt-3 w-full" type="button" disabled>
              <Download size={15} className="mr-2" />
              {t("dock.download")}
              {packageSize && <span className="ml-2 text-xs opacity-70">{packageSize}</span>}
            </Button>
          )}
          <p className="mt-2 text-center text-[11px] text-muted-foreground">{t("dock.downloadHint")}</p>
        </div>

        {/* 按浏览器渲染的安装步骤 */}
        <div className="mt-5">
          <p className="text-xs font-semibold text-muted-foreground">
            {t("dock.stepsFor")} · {t(current.nameKey)}
          </p>
          <ol className="mt-2 space-y-2.5 text-sm">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="font-data flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {i + 1}
                </span>
                <div>
                  <p className="font-medium">{s.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{s.desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* 常见问题排错 */}
        <div className="mt-5 border-t border-border pt-4">
          <p className="text-xs font-semibold text-muted-foreground">{t("dock.troubleTitle")}</p>
          <div className="mt-2 divide-y divide-border overflow-hidden rounded-lg border border-border">
            {TROUBLES.map((item, i) => (
              <div key={i}>
                <button
                  onClick={() => setTroubleOpen(troubleOpen === String(i) ? null : String(i))}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs transition-colors hover:bg-muted/50"
                >
                  <span className="font-medium">{t(item.qKey)}</span>
                  <ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${troubleOpen === String(i) ? "rotate-180" : ""}`} />
                </button>
                {troubleOpen === String(i) && (
                  <p className="border-t border-border bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">{t(item.aKey)}</p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 底部工具入口 */}
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onClose();
              navigate({ to: "/products/collect" });
            }}
          >
            <Inbox size={14} className="mr-1.5" />
            {t("dock.openCollect")}
          </Button>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Keyboard size={13} />
            {t("dock.shortcut")}
          </span>
        </div>
      </div>
    </div>
  );
}
