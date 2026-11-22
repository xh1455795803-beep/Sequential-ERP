import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/inventory/locked")({
  component: InventoryLockedPage,
});

const columns: ListColumn[] = [
  { key: "sku", label: "SKU" },
  { key: "name", label: "orders.col.product" },
  { key: "warehouse", label: "outbound.warehouse" },
  { key: "available", label: "dash.stock" },
  { key: "locked", label: "nav.inventory.locked" }
];

const fields: FormField[] = [
  { key: "locked", label: "nav.inventory.locked", type: "number" }
];

function InventoryLockedPage() {
  return (
    <DataListPage
      title="nav.inventory.locked"
      description="inv.lockedDesc"
      table="inventory"
      filter={{ field: "locked", value: 0, op: "gt" }}
      columns={columns}
      fields={fields}
    />
  );
}
