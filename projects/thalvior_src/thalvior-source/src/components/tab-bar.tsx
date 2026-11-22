// vV1-T3：可关闭多标签带（tab bar）
// ---------------------------------------------------------------------------
// 位置：Topbar 之下、内容区之上，固定 32px（h-8）。
// 视觉：条带沿用侧栏轨道色（T1 后为深墨蓝），激活标签 = 白底（rail 上的白卡），
//       非激活 = 半透明白，与侧栏轨道成一套。
// 交互：单击切换并 navigate；× 关闭；右键菜单（关闭其他 / 关闭全部 / 刷新）。
// 同步：路由 pathname 变化 → syncPath（⌘K、直接改 URL、浏览器前进后退都会补开标签）；
//       侧栏点击 → openTab（见 sidebar.tsx）。
// 持久化：由 @/stores/tabs 负责（localStorage "thalvior.openTabs"）。
// 说明：本组件取代已归档的 horizontal-nav.tsx（批量 6 已删除，见 sidebar.tsx 注释），
//       横向导航的「多开 + 关闭」语义在此落地为真实可交互标签带。
import { useEffect, useRef } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/LanguageContext";
import { HOME_PATH, tabsApi, useTabs, type Tab } from "@/stores/tabs";
import { hiddenPages, menu } from "@/components/sidebar";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

// 新增短语不占 i18n 字典（translations.ts 不在本波文件清单内）：就近双语兜底
const LOCAL: Record<"zh" | "en", Record<"closeOthers" | "closeAll" | "home" | "closeTab", string>> = {
  zh: { closeOthers: "关闭其他", closeAll: "关闭全部", home: "首页", closeTab: "关闭标签" },
  en: { closeOthers: "Close others", closeAll: "Close all", home: "Home", closeTab: "Close tab" },
};

// path → 现成 i18n key，数据源与侧栏完全同源（menu + hiddenPages），零新 key
const PATH_LABEL_KEYS: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const item of menu) if (!item.external && item.path) map[item.path] = item.labelKey;
  for (const item of menu)
    for (const c of item.children ?? []) if (!(c.path in map)) map[c.path] = c.labelKey;
  for (const p of hiddenPages) if (!(p.path in map)) map[p.path] = p.labelKey;
  return map;
})();

/** 标签标题：精确命中 → 模块名；详情页 → 最长已知前缀模块名；兜底 → 末段原文 */
export function titleForPath(path: string, t: (key: string) => string): string {
  const direct = PATH_LABEL_KEYS[path];
  if (direct) return t(direct);
  const segs = path.split("/").filter(Boolean);
  for (let i = segs.length; i > 0; i--) {
    const probe = "/" + segs.slice(0, i).join("/");
    const key = PATH_LABEL_KEYS[probe];
    if (key) return t(key);
  }
  return segs[segs.length - 1] ?? path;
}

export function TabBar() {
  const { tabs, activePath, closeTab, syncPath } = useTabs();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { t, lang } = useLanguage();
  const L = LOCAL[lang === "en" ? "en" : "zh"];
  const barRef = useRef<HTMLDivElement | null>(null);

  // 路由 → 标签：单向同步，避免与侧栏 openTab 双向打架
  useEffect(() => {
    if (!pathname) return;
    syncPath({ path: pathname, title: pathname === HOME_PATH ? L.home : titleForPath(pathname, t) });
    // lang 变化时用新语言重算标题；t 每帧新建不入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, lang]);

  // 激活标签滚入视野（标签多于可视宽度时）
  useEffect(() => {
    const el = barRef.current?.querySelector<HTMLElement>(`[data-tab-path="${CSS.escape(activePath)}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activePath]);

  const go = (path: string) => {
    if (path !== pathname) navigate({ to: path });
  };

  const handleClose = (t2: Tab) => {
    const next = closeTab(t2.path);
    go(next);
  };

  return (
    <div
      ref={barRef}
      className="no-scrollbar flex h-8 shrink-0 items-stretch gap-1 overflow-x-auto border-b border-sidebar-border bg-sidebar px-2"
      role="tablist"
      aria-label={t("nav.menu")}
    >
      {tabs.map((tab) => {
        const active = tab.path === activePath;
        return (
          <ContextMenu key={tab.path}>
            <ContextMenuTrigger asChild>
              <div
                data-tab-path={tab.path}
                role="tab"
                aria-selected={active}
                tabIndex={0}
                onClick={() => {
                  tabsApi.setActive(tab.path);
                  go(tab.path);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    tabsApi.setActive(tab.path);
                    go(tab.path);
                  }
                  if (e.key === "Delete" && tab.closable) handleClose(tab);
                }}
                className={cn(
                  "group flex h-full shrink-0 cursor-pointer items-center gap-1.5 rounded-t-[3px] px-2.5 text-[12.5px] whitespace-nowrap transition-colors outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring",
                  active
                    ? "bg-card font-medium text-fg shadow-soft"
                    : "text-sidebar-muted hover:bg-white/10 hover:text-sidebar-foreground",
                )}
              >
                {active ? (
                  <span className="h-3.5 w-[2px] shrink-0 rounded-full bg-sidebar-primary" aria-hidden />
                ) : null}
                <span className="max-w-40 truncate">{tab.title}</span>
                {tab.closable ? (
                  <button
                    type="button"
                    aria-label={L.closeTab}
                    title={L.closeTab}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleClose(tab);
                    }}
                    className={cn(
                      "-mr-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] transition-colors",
                      active
                        ? "text-fg-muted hover:bg-surface-hover hover:text-destructive"
                        : "text-sidebar-muted/70 hover:bg-white/15 hover:text-white",
                    )}
                  >
                    <X size={12} aria-hidden />
                  </button>
                ) : null}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-40">
              <ContextMenuItem onSelect={() => go(tabsApi.closeOthers(tab.path))}>
                {L.closeOthers}
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => go(tabsApi.closeAll())}
                disabled={!tabs.some((x) => x.closable)}
              >
                {L.closeAll}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                onSelect={() => {
                  tabsApi.refresh(tab.path);
                  go(tab.path);
                }}
              >
                {t("common.refresh")}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </div>
  );
}
