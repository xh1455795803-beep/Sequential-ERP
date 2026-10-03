import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/fulfillment")({
  component: FulfillmentLayout,
});

function FulfillmentLayout() {
  return <Outlet />;
}
