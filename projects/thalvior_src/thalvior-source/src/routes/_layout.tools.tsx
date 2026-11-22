import { createFileRoute, Outlet } from "@tanstack/react-router";

// 工具箱父路由：正常渲染子路由
export const Route = createFileRoute("/_layout/tools")({
  component: () => <Outlet />,
});
