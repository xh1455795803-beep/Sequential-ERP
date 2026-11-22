import { createFileRoute, Outlet } from "@tanstack/react-router";

// 授权管理布局壳：渲染子路由
// - /auth             → index 路由（店铺授权管理页，见 _layout.auth.index.tsx）
// - /auth/source      → 货源授权管理页（_layout.auth.source.tsx）
// - /auth/callback    → OAuth 回调页（_layout.auth.callback.tsx）
// 使用 Outlet 后子路由才能正常渲染（此前缺失 Outlet 导致点击菜单 URL 变化但页面不变）

export const Route = createFileRoute("/_layout/auth")({
  component: AuthLayout,
});

function AuthLayout() {
  return <Outlet />;
}
