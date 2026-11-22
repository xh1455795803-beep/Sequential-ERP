import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/finance")({
  component: FinanceLayout,
});

function FinanceLayout() {
  return <Outlet />;
}
