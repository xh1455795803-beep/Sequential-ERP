// 语言状态管理：全局 Context + localStorage 持久化
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { translate, type Lang } from "./translations";

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

const STORAGE_KEY = "thalvior_lang";

function getInitialLang(): Lang {
  if (typeof window === "undefined") return "zh";
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === "en" ? "en" : "zh";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getInitialLang);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

  const setLang = (l: Lang) => setLangState(l);
  const toggleLang = () => setLangState((prev) => (prev === "zh" ? "en" : "zh"));
  const t = (key: string, vars?: Record<string, string | number>) => translate(key, lang, vars);

  return (
    <LanguageContext.Provider value={{ lang, setLang, toggleLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLanguage 必须在 LanguageProvider 内使用");
  }
  return ctx;
}