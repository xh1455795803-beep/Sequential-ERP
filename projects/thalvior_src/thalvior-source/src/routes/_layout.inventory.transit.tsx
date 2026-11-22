import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/inventory/transit")({
  component: InventoryTransitPage,
});

const columns: ListColumn[] = [
  { key: "sku", label: "SKU" },
  { key: "name", label: "orders.col.product" },
  { key: "warehouse", label: "outbound.warehouse" },
  { key: "available", label: "dash.stock" },
  { key: "in_transit", label: "nav.inventory.transit" }
];

const fields: FormField[] = [
  { key: "in_transit", label: "nav.inventory.transit", type: "number" }
];

function InventoryTransitPage() {
  return (
    <DataListPage
      title="nav.inventory.transit"
      description="inv.transitDesc"
      table="inventory"
      filter={{ field: "in_transit", value: 0, op: "gt" }}
      columns={columns}
      fields={fields}
    />
  );
}
