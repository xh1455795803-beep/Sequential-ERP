// 根布局：Provider 放这里；页面路由在 src/routes/ 下单独建文件，勿堆进 index.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LegalFooter } from "../components/legal-footer";
import {
  Outlet,
  Navigate,
  createRootRouteWithContext,
  useRouterState,
} from '@tanstack/react-router';
import { Toaster } from "@/components/ui/sonner";
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/LanguageContext';

function NotFoundComponent() {
  const { t } = useLanguage();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname === '/') return null;
  // 404 原地提示，不跳回 /（/ 是营销落地页，会把登录用户"踢出"应用）
  return (
    <div className="flex h-[60vh] w-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-warning-bg text-warning">
        <AlertTriangle size={26} />
      </div>
      <h1 className="text-lg font-semibold text-foreground">{t("errors.notFoundTitle")}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{t("errors.notFoundDesc", { path: pathname })}</p>
      <Button variant="outline" onClick={() => { window.location.href = '/dashboard'; }}>
        {t("errors.backToDashboard")}
      </Button>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  const { t } = useLanguage();
  console.error(error);
  const message = error instanceof Error ? error.message : String(error);
  // 页面出错时原地展示错误，不再跳回 /（/ 是落地页，会把用户"踢出"应用）
  return (
    <div className="flex h-[60vh] w-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-danger-bg text-destructive">
        <AlertTriangle size={26} />
      </div>
      <h1 className="text-lg font-semibold text-foreground">{t("errors.errorTitle")}</h1>
      <p className="max-w-md break-all text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" onClick={() => reset()}>
        {t("errors.retry")}
      </Button>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      {/* 全局 toast 容器：此前缺失导致全站 toast.error/success 静默丢失（按钮点了"没反应"的主因之一） */}
      <Toaster position="top-center" closeButton />
      {/* 合规页脚：备案号 / 主体资质（wave B 20261117），真实值经 .env 的 VITE_* 注入，见 src/lib/company.ts */}
      <LegalFooter />
    </QueryClientProvider>
  );
}
