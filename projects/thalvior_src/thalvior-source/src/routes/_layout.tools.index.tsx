import { createFileRoute, redirect } from "@tanstack/react-router";

// /tools 入口重定向到默认工具，避免直接 404
export const Route = createFileRoute("/_layout/tools/")({
  beforeLoad: () => {
    throw redirect({ to: "/tools/price-calc" });
  },
});
