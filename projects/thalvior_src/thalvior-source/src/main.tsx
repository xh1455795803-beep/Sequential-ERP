// 应用入口：样式在 ./styles.css（Tailwind v4 + design token），路由见 ./router.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";
import { initRevealEngine } from "./lib/reveal-engine";
import { initNotifySoundUnlock } from "./lib/notify-sound";
import { LanguageProvider } from "./i18n/LanguageContext";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "./styles.css";

// 全局滚动渐入引擎：业务元素只需加 class="reveal"（详见 lib/reveal-engine.ts），勿删
initRevealEngine();

// 通知叮咚音：首次用户交互（pointerdown/keydown）后解锁播放权（autoplay 政策），未解锁前静默跳过
initNotifySoundUnlock();

const router = getRouter();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider>
      <RouterProvider router={router} />
    </LanguageProvider>
  </React.StrictMode>
);
