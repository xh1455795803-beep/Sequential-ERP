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
const PACKAGE_VERSION = "1.2.0";
const EXT_MARKER = "data-thalvior-collector";
const AGREE_KEY = "meoo.dock.pluginAgreed";

type InstallStep = { title: string; desc: string };
type BrowserProfile = {
  key: string;
  name: string;
  tag?: string;
  /** 该浏览器对应的安装步骤模板 */
  steps: "chromium" | "qqnew" | "unpacked" | "store";
};

/** 支持的浏览器：识别规则参考各厂商 UA，步骤参考各浏览器官方扩展安装路径 */
const BROWSERS: BrowserProfile[] = [
  { key: "chrome", name: "谷歌 Chrome", tag: "推荐", steps: "chromium" },
  { key: "edge", name: "微软 Edge", tag: "推荐", steps: "chromium" },
  { key: "qq", name: "QQ 浏览器", steps: "qqnew" },
  { key: "360ee", name: "360 极速浏览器", steps: "unpacked" },
  { key: "360se", name: "360 安全浏览器", steps: "unpacked" },
  { key: "sogou", name: "搜狗浏览器", steps: "unpacked" },
  { key: "ziniao", name: "紫鸟浏览器", steps: "store" },
  { key: "feikua", name: "飞跨浏览器", steps: "store" },
  { key: "other", name: "其他 Chromium 内核", steps: "unpacked" },
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

function buildSteps(kind: BrowserProfile["steps"], b: BrowserProfile): InstallStep[] {
  if (kind === "chromium") {
    return [
      { title: "下载安装包（ZIP，无需解压）", desc: `点击下方按钮下载 ${PACKAGE_NAME}，记住文件所在位置即可，不要解压` },
      { title: "打开扩展管理页", desc: b.key === "edge" ? "地址栏输入 edge://extensions 并回车" : "地址栏输入 chrome://extensions 并回车" },
      { title: "开启开发者模式", desc: "打开页面右上角的「开发者模式」开关" },
      { title: "把 ZIP 直接拖进去", desc: "将下载好的 ZIP 文件拖拽到扩展管理页空白处，弹窗中点「添加扩展程序」" },
      { title: "回到本页刷新即可", desc: "安装完成后刷新 ERP 页面，本面板会自动显示「已安装」" },
    ];
  }
  if (kind === "qqnew") {
    return [
      { title: "下载安装包", desc: `下载 ${PACKAGE_NAME}（QQ 浏览器 13.0 以下需先解压，13.0 及以上无需解压）` },
      { title: "打开应用中心", desc: "地址栏输入 qqbrowser://extensions/manage 并回车" },
      { title: "拖入安装", desc: "把文件拖入应用中心页面，弹窗中点「添加拓展程序」" },
      { title: "确认启用并开放权限", desc: "在扩展列表中确认插件「已启用」状态开启，并勾选开放所有权限" },
      { title: "回到本页刷新即可", desc: "刷新 ERP 页面后本面板会自动显示「已安装」" },
    ];
  }
  if (kind === "store") {
    return [
      { title: "下载安装包", desc: `下载 ${PACKAGE_NAME}，跨境专用浏览器通常不允许外部商店安装，请用本地安装方式` },
      { title: "打开浏览器应用中心", desc: `进入 ${b.name} 的「应用中心 / 扩展管理」页面` },
      { title: "选择本地安装", desc: "选择「本地安装」「加载本地扩展」或同类入口，指向下载好的文件（若要求文件夹则先解压）" },
      { title: "确认已启用", desc: "安装后在扩展列表中确认启用状态，并允许访问所有站点" },
      { title: "回到本页刷新即可", desc: "刷新 ERP 页面后本面板会自动显示「已安装」" },
    ];
  }
  return [
    { title: "下载并解压安装包", desc: `下载 ${PACKAGE_NAME} 并解压，得到 thalvior-collect-extension 文件夹` },
    { title: "打开扩展管理页", desc: "地址栏输入 chrome://extensions（或该浏览器的扩展管理页）并回车" },
    { title: "开启开发者模式", desc: "打开右上角的「开发者模式」开关" },
    { title: "加载已解压的扩展程序", desc: "点左上角「加载已解压的扩展程序」，选择刚解压出的文件夹" },
    { title: "回到本页刷新即可", desc: "刷新 ERP 页面后本面板会自动显示「已安装」" },
  ];
}

const TROUBLES = [
  { q: "提示「无法从该网站添加应用」", a: "浏览器选错或版本过低：Chrome/Edge 用 ZIP 拖拽；360、搜狗、QQ 属于另一套安装通道。请切换上方浏览器查看对应步骤。" },
  { q: "装了插件，页面仍提示未安装", a: "① 旧版插件没删干净会冲突 —— 到扩展管理页移除所有旧版 Thalvior 插件后重装；② 插件装完必须刷新 ERP 页面才会生效。" },
  { q: "无痕模式下采集按钮不出来", a: "Chrome 无痕模式默认禁用第三方扩展，需到扩展详情页单独开启「在无痕模式下启用」。" },
  { q: "Mac 装不上", a: "Mac 环境仅支持正版谷歌 Chrome 与 Edge，其他浏览器在 macOS 上无法加载本地扩展。" },
  { q: "商品页点了采集没反应", a: "先在插件里完成登录（账号 + 密码），插件保持登录态后才能入库；再到货源平台商品页刷新一次重试。" },
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

  useEffect(() => {
    let alive = true;
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
  const steps = buildSteps(current.steps, current);

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
          aria-label="关闭"
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
          <div className="mt-5 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <ShieldCheck size={20} className="text-emerald-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-emerald-800">
                {t("dock.installed")} · v{installedVersion}
              </p>
              <p className="text-xs text-emerald-700/80">{t("dock.installedDesc")}</p>
            </div>
            {checking && <Loader2 size={14} className="animate-spin text-emerald-600" />}
          </div>
        ) : (
          <div className="mt-5 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <AlertTriangle size={20} className="text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-amber-800">{t("dock.notInstalled")}</p>
              <p className="text-xs text-amber-700/80">{t("dock.notInstalledDesc")}</p>
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
                <span className="font-medium">{current.name}</span>
                {current.tag && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{current.tag}</span>
                )}
                {installedVersion && <Check size={14} className="text-emerald-600" />}
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
                    <span>{b.name}</span>
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
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">v{PACKAGE_VERSION}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{t("dock.formatZip")}</span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("dock.extensionDesc")}</p>
            </div>
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
            {t("dock.stepsFor")} · {current.name}
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
                  <span className="font-medium">{item.q}</span>
                  <ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${troubleOpen === String(i) ? "rotate-180" : ""}`} />
                </button>
                {troubleOpen === String(i) && (
                  <p className="border-t border-border bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">{item.a}</p>
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
