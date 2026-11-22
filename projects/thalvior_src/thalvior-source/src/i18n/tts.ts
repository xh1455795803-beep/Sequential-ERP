// 组件外 t() 快照：模块级常量渲染时使用（随 setTtsLang 同步）
import { translate, tIfKey, type Lang } from "./translations";

let _lang: Lang = "zh";
if (typeof window !== "undefined") {
  _lang = localStorage.getItem("thalvior_lang") === "en" ? "en" : "zh";
}

export function setTtsLang(l: Lang) {
  _lang = l;
}

export function tt(key: string, vars?: Record<string, string | number>): string {
  return translate(key, _lang, vars);
}

// 动态值翻译（组件外快照）：值为字典 key 时按当前语言翻译，否则原样返回
export function tk(value: string | null | undefined, vars?: Record<string, string | number>): string {
  return tIfKey(value, _lang, vars);
}

// 通知正文渲染：DB 存 "key::[json数组]"（参数化 i18n key，DB 函数写入）时
// 解析为 key + {v1}..{vN} 插值；兼容存量纯 key（tk 管道）与纯文本（原样返回）
export function tkContent(value: string | null | undefined): string {
  if (!value) return "";
  const i = value.indexOf("::");
  if (i === -1) return tk(value);
  const key = value.slice(0, i);
  let arr: unknown[] = [];
  try {
    const parsed = JSON.parse(value.slice(i + 2));
    if (Array.isArray(parsed)) arr = parsed;
  } catch {
    arr = [];
  }
  const vars: Record<string, string> = {};
  arr.forEach((x, idx) => {
    // 变量值过 tIfKey：DB 预置状态值（如「已生成」）可双语，用户数据未命中原样
    vars[`v${idx + 1}`] = x == null ? "-" : tIfKey(String(x), _lang);
  });
  return translate(key, _lang, vars);
}
