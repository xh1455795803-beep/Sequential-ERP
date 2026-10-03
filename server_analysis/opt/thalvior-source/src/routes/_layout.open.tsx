import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/open")({
  component: OpenLayout,
});

function OpenLayout() {
  return <Outlet />;
}
