import { Outlet, createFileRoute } from "@tanstack/react-router";

// /inventory 布局：原文件是完整库存页且无 <Outlet />，导致 /inventory/* 子路由渲染不出（点开仍是库存总览）。
// 列表已迁移到 _layout.inventory.index.tsx，本文件改为纯布局（与 orders 同一修复模式）。
export const Route = createFileRoute("/_layout/inventory")({
  component: () => <Outlet />,
});
