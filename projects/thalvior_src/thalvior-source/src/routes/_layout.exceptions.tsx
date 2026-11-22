import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/exceptions")({
  component: ExceptionsLayout,
});

function ExceptionsLayout() {
  return <Outlet />;
}
