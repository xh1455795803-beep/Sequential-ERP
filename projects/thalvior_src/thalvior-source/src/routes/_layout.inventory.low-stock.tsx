import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/inventory/low-stock")({
  component: InventoryLowStockPage,
});

const columns: ListColumn[] = [
  { key: "sku", label: "SKU" },
  { key: "name", label: "listing.col.name" },
  { key: "warehouse", label: "outbound.warehouse" },
  { key: "available", label: "inv.available" },
  { key: "safety_stock", label: "inv.safetyStock" },
  { key: "status", label: "common.statusLabel" }
];

const fields: FormField[] = [
  { key: "sku", label: "SKU" },
  { key: "name", label: "listing.col.name" },
  { key: "warehouse", label: "outbound.warehouse" },
  { key: "available", label: "inv.available", type: "number" },
  { key: "safety_stock", label: "inv.safetyStock", type: "number" }
];

function InventoryLowStockPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="nav.inventory.lowStock"
      description="inv.lowStockDesc"
      table="inventory"
      columns={columns}
      fields={fields}
      filter={{ field: "status", value: "偏低" }}
      exportable
      batchDelete
    />
  );
}
