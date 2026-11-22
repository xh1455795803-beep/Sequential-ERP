import { createFileRoute, redirect } from "@tanstack/react-router";

// 采购模块默认页：旧 /purchase 曾是供应商管理页（与 /purchase/suppliers 重复），统一重定向到采购单列表
export const Route = createFileRoute("/_layout/purchase/")({
  beforeLoad: () => {
    throw redirect({ to: "/purchase/orders" });
  },
});
