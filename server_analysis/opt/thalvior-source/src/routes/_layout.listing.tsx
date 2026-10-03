import { Outlet, createFileRoute } from "@tanstack/react-router";

// /listing 布局：原文件是完整刊登页且无 <Outlet />，导致 /listing/* 子路由渲染不出。
// 列表已迁移到 _layout.listing.index.tsx，本文件改为纯布局（与 orders 同一修复模式）。
export const Route = createFileRoute("/_layout/listing")({
  component: () => <Outlet />,
});
