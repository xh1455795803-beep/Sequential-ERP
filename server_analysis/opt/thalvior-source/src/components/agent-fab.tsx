// 对话式智能助手：右下角悬浮入口
import { useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { Bot, X } from "lucide-react";
import { AgentChat } from "@/components/agent-chat";

export function AgentFab() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  return (
    <>
      {/* 悬浮按钮 */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Thalvior 智能助手"
        className="fixed bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-xl shadow-indigo-500/30 transition-transform hover:scale-105 active:scale-95 sm:bottom-6 sm:right-6 sm:h-14 sm:w-14"
      >
        <Bot size={22} className="sm:hidden" />
        <Bot size={24} className="hidden sm:block" />
      </button>

      {/* 对话面板（打开时覆盖悬浮按钮，避免重叠） */}
      {open && (
        <div className="fixed bottom-4 right-4 z-50 h-[min(560px,calc(100vh-5rem))] w-[min(380px,calc(100vw-2rem))] sm:bottom-6 sm:right-6 sm:h-[560px] sm:w-[380px]">
          <AgentChat open={open} onClose={() => setOpen(false)} page={location.pathname} />
        </div>
      )}
    </>
  );
}
