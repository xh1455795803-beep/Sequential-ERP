import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/ads")({
  component: AdsLayout,
});

function AdsLayout() {
  return <Outlet />;
}
