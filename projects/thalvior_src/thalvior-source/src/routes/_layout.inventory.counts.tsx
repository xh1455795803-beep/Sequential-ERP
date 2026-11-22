import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/inventory/counts")({
  component: InventoryCountsPage,
});

const columns: ListColumn[] = [
  { key: "plan_no", label: "inv.countNo" },
  { key: "warehouse", label: "outbound.warehouse" },
  { key: "sku", label: "SKU" },
  { key: "system_qty", label: "inv.systemQty" },
  { key: "actual_qty", label: "inv.countedQty" },
  { key: "diff", label: "log.diff" },
  { key: "operator", label: "inv.counter" },
  { key: "status", label: "common.statusLabel" }
];

const fields: FormField[] = [
  { key: "plan_no", label: "inv.countNo" },
  { key: "warehouse", label: "outbound.warehouse" },
  { key: "sku", label: "SKU" },
  { key: "system_qty", label: "inv.systemQty", type: "number" },
  { key: "actual_qty", label: "inv.countedQty", type: "number" },
  { key: "operator", label: "inv.counter" },
  { key: "status", label: "common.statusLabel", type: "select", options: [{ label: "st.toCount", value: "待盘点" }, { label: "st.counting", value: "盘点中" }, { label: "nav.orders.completed", value: "已完成" }] }
];

function InventoryCountsPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="nav.inventory.counts"
      description="inv.countsDesc"
      table="stock_takes"
      columns={columns}
      fields={fields}
      exportable
      batchDelete
    />
  );
}
