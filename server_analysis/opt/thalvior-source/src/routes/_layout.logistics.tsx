import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/logistics")({
  component: LogisticsLayout,
});

function LogisticsLayout() {
  return <Outlet />;
}
