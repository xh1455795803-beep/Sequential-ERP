import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/inventory/strategies")({
  component: InventoryStrategiesPage,
});

const columns: ListColumn[] = [
  { key: "sku", label: "SKU" },
  { key: "warehouse", label: "outbound.warehouse" },
  { key: "min_qty", label: "inv.minQty" },
  { key: "max_qty", label: "inv.maxQty" },
  { key: "reorder_point", label: "inv.reorderPoint" },
  { key: "lead_time", label: "inv.leadTime" },
  { key: "status", label: "common.statusLabel" }
];

const fields: FormField[] = [
  { key: "sku", label: "SKU" },
  { key: "warehouse", label: "outbound.warehouse" },
  { key: "min_qty", label: "inv.minQty", type: "number" },
  { key: "max_qty", label: "inv.maxQty", type: "number" },
  { key: "reorder_point", label: "inv.reorderPoint", type: "number" },
  { key: "lead_time", label: "inv.leadTime", type: "number" },
  { key: "status", label: "common.statusLabel", type: "select", options: [{ label: "st.enabled", value: "启用" }, { label: "st.disabled", value: "停用" }] }
];

function InventoryStrategiesPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="nav.inventory.strategies"
      description="inv.strategiesDesc"
      table="stock_strategies"
      columns={columns}
      fields={fields}
      exportable
      batchDelete
    />
  );
}
