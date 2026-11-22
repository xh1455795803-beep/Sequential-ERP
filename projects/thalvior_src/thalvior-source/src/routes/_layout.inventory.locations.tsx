import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/inventory/locations")({
  component: InventoryLocationsPage,
});

const columns: ListColumn[] = [
  { key: "warehouse_code", label: "inv.whCode" },
  { key: "zone", label: "inv.zone" },
  { key: "shelf", label: "inv.shelf" },
  { key: "bin", label: "inv.bin" },
  { key: "capacity", label: "variant.axis.capacity" },
  { key: "used", label: "inv.used" },
  { key: "status", label: "common.statusLabel" }
];

const fields: FormField[] = [
  { key: "warehouse_code", label: "inv.whCode" },
  { key: "zone", label: "inv.zone" },
  { key: "shelf", label: "inv.shelf" },
  { key: "bin", label: "inv.bin" },
  { key: "capacity", label: "variant.axis.capacity", type: "number" },
  { key: "used", label: "inv.used", type: "number" },
  { key: "status", label: "common.statusLabel", type: "select", options: [{ label: "st.enabled", value: "启用" }, { label: "st.disabled", value: "停用" }] }
];

function InventoryLocationsPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="nav.inventory.locations"
      description="inv.locationsDesc2"
      table="locations"
      columns={columns}
      fields={fields}
      exportable
      batchDelete
    />
  );
}
