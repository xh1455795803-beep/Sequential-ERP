// 根布局：Provider 放这里；页面路由在 src/routes/ 下单独建文件，勿堆进 index.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  Navigate,
  createRootRouteWithContext,
  useRouterState,
} from '@tanstack/react-router';
import { Toaster } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

function NotFoundComponent() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname === '/') return null;
  // 404 原地提示，不跳回 /（/ 是营销落地页，会把登录用户"踢出"应用）
  return (
    <div className="flex h-[60vh] w-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-500">
        <AlertTriangle size={26} />
      </div>
      <h1 className="text-lg font-semibold text-foreground">页面不存在（404）</h1>
      <p className="max-w-md text-sm text-muted-foreground">访问的路径 {pathname} 不存在，请从左侧菜单进入功能页面。</p>
      <Button variant="outline" onClick={() => { window.location.href = '/dashboard'; }}>
        返回工作台
      </Button>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  const message = error instanceof Error ? error.message : String(error);
  // 页面出错时原地展示错误，不再跳回 /（/ 是落地页，会把用户"踢出"应用）
  return (
    <div className="flex h-[60vh] w-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-rose-500">
        <AlertTriangle size={26} />
      </div>
      <h1 className="text-lg font-semibold text-foreground">页面出错了</h1>
      <p className="max-w-md break-all text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" onClick={() => reset()}>
        重试
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
      <Toaster position="top-center" richColors closeButton />
    </QueryClientProvider>
  );
}
