// 全站图表统一主题：主蓝唯一强调数据主线，辅助系列静色降饱和
// 暗色模式：系列色由 CSS 变量 --chart-* 提供（useChartPalette 响应 <html> class 切换）
import { useEffect, useState } from "react";

/** 主色板：对应 --chart-1..8（主蓝唯一强调，辅助系列静色降饱和） */
export const CHART_COLORS = {
  blue: "var(--chart-1)",
  teal: "var(--chart-2)",
  orange: "var(--chart-3)",
  gold: "var(--chart-4)",
  violet: "var(--chart-5)",
  red: "var(--danger)",
  green: "var(--success)",
} as const;

/** 分类色板：多系列/饼图用，8 色相固定（暗色只提亮，不换色相） */
export const CHART_CATEGORICAL = [
  "var(--chart-cat-1)",
  "var(--chart-cat-2)",
  "var(--chart-cat-3)",
  "var(--chart-cat-4)",
  "var(--chart-cat-5)",
  "var(--chart-cat-6)",
  "var(--chart-cat-7)",
  "var(--chart-cat-8)",
] as const;

// 统一 tooltip：用 CSS 变量取色，亮/暗自动适配
export const CHART_TOOLTIP = {
  contentStyle: {
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--popover)",
    fontSize: 12,
    color: "var(--card-foreground)",
    boxShadow: "var(--elev-lift)",
  },
  labelStyle: { color: "var(--muted-foreground)", fontWeight: 500, marginBottom: 2 },
  itemStyle: { color: "var(--card-foreground)", padding: "2px 0" },
} as const;

// 系列色取自 token（--chart-1..5 / --chart-grid|axis|cursor|dot-stroke），暗色模式整体提亮一档
// 用 MutationObserver 监听 <html> class，切换时返回新色值触发重渲染
export function useChartPalette() {
  const read = () => {
    if (typeof window === "undefined")
      return {
        c1: CHART_COLORS.blue,
        c2: CHART_COLORS.teal,
        grid: "var(--chart-grid)",
        axis: "var(--chart-axis)",
        cursor: "var(--chart-cursor)",
        dotStroke: "var(--chart-dot-stroke)",
      };
    const cs = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
    return {
      c1: v("--chart-1", CHART_COLORS.blue),
      c2: v("--chart-2", CHART_COLORS.teal),
      grid: v("--chart-grid", "var(--chart-grid)"),
      axis: v("--chart-axis", "var(--chart-axis)"),
      cursor: v("--chart-cursor", "var(--chart-cursor)"),
      dotStroke: v("--chart-dot-stroke", "var(--chart-dot-stroke)"),
    };
  };
  const [colors, setColors] = useState(read);
  useEffect(() => {
    const ob = new MutationObserver(() => setColors(read()));
    ob.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => ob.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return colors;
}
