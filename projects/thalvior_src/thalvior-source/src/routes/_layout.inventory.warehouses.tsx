import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/inventory/warehouses")({
  component: InventoryWarehousesPage,
});

const columns: ListColumn[] = [
  { key: "code", label: "inv.code" },
  { key: "name", label: "listing.col.name" },
  { key: "country", label: "pm.col.country" },
  { key: "city", label: "inv.city" },
  { key: "status", label: "common.statusLabel" }
];

const fields: FormField[] = [
  { key: "code", label: "inv.code" },
  { key: "name", label: "listing.col.name", required: true },
  { key: "country", label: "pm.col.country" },
  { key: "city", label: "inv.city" },
  { key: "address", label: "exc.address" },
  { key: "status", label: "common.statusLabel", type: "select", options: [{ label: "st.enabled", value: "启用" }, { label: "st.disabled", value: "停用" }] }
];

function InventoryWarehousesPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="nav.inventory.warehouses"
      description="inv.locationsDesc"
      table="warehouses"
      columns={columns}
      fields={fields}
      exportable
      batchDelete
    />
  );
}
