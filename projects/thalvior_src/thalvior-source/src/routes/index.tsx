import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  component: LandingRedirect,
});

/**
 * SPA 根路由重定向（2026-10-11）：
 * - 对外品牌落地页由 nginx 静态站提供（location = / 命中 /var/www/landing，本路由仅在 SPA 客户端导航时触发，
 *   典型场景：登录后点侧边栏顶部 logo）
 * - 登录用户 → 工作台；未登录 → 登录页
 * - 旧版 SPA 落地页（含"为什么选择 Thalvior / 50+ 平台"等宣传口径）已退役，
 *   对外形象统一由静态落地页承担，避免两套页面口径不一致。
 */
function LandingRedirect() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }
  return user ? <Navigate to="/dashboard" replace /> : <Navigate to="/login" replace />;
}
