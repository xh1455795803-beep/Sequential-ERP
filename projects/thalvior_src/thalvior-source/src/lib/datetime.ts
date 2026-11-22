// 统一的日期时间格式化（跟随界面语言）
// 中文环境固定输出 yyyy/MM/dd（与列表时间一致），避免裸 toLocaleString() 在英文环境/无头浏览器下渲染成美式 MM/dd/yyyy。

export type Lang = "zh" | "en";

const ZH_DATE = { year: "numeric", month: "2-digit", day: "2-digit" } as const;
const ZH_DATETIME = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
} as const;

function toDate(v: string | number | Date | null | undefined): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/** 日期：中文 yyyy/MM/dd；英文跟随 en-US */
export function fmtDate(v: string | number | Date | null | undefined, lang: Lang = "zh"): string {
  const d = toDate(v);
  if (!d) return "—";
  return d.toLocaleDateString(lang === "en" ? "en-US" : "zh-CN", ZH_DATE);
}

/** 日期时间：中文 yyyy/MM/dd HH:mm（24 小时制）；英文跟随 en-US */
export function fmtDateTime(v: string | number | Date | null | undefined, lang: Lang = "zh"): string {
  const d = toDate(v);
  if (!d) return "—";
  return d.toLocaleString(lang === "en" ? "en-US" : "zh-CN", ZH_DATETIME);
}
