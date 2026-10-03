import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/purchase")({
  component: PurchaseLayout,
});

function PurchaseLayout() {
  return <Outlet />;
}
