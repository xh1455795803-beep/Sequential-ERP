// 对话式智能助手：右下角悬浮入口
import { useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { Bot, X } from "lucide-react";
import { AgentChat } from "@/components/agent-chat";
import { useLanguage } from "@/i18n/LanguageContext";

export function AgentFab() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  return (
    <>
      {/* 悬浮按钮 */}
      <button
        onClick={() => setOpen(true)}
        aria-label={t("agent.fab.label")}
        className="fixed bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-float transition-transform hover:scale-105 hover:bg-primary/90 active:scale-95 sm:bottom-6 sm:right-6 sm:h-14 sm:w-14"
      >
        <Bot size={22} className="sm:hidden" />
        <Bot size={24} className="hidden sm:block" />
      </button>

      {/* 对话面板（打开时覆盖悬浮按钮，避免重叠） */}
      {open && (
        <div className="fixed bottom-4 right-4 z-50 h-[min(560px,calc(100dvh-5rem))] w-[min(380px,calc(100dvw-2rem))] sm:bottom-6 sm:right-6 sm:h-[560px] sm:w-[380px]">
          <AgentChat open={open} onClose={() => setOpen(false)} page={location.pathname} />
        </div>
      )}
    </>
  );
}
