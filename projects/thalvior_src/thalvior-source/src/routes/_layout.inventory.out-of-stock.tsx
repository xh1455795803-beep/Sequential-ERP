import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/inventory/out-of-stock")({
  component: InventoryOutOfStockPage,
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

function InventoryOutOfStockPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="nav.inventory.outOfStock"
      description="inv.outOfStockDesc"
      table="inventory"
      columns={columns}
      fields={fields}
      filter={{ field: "status", value: "缺货" }}
      exportable
      batchDelete
    />
  );
}
