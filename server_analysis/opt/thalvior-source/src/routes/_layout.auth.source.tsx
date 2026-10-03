import { createFileRoute, Navigate } from "@tanstack/react-router";

// 货源授权已合并到 /auth 页面 Tabs（店铺授权 / 货源授权），旧链接重定向保持兼容
export const Route = createFileRoute("/_layout/auth/source")({
  component: () => <Navigate to="/auth" />,
});
