import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/inventory/alerts")({
  component: InventoryAlertsPage,
});

const columns: ListColumn[] = [
  { key: "sku", label: "SKU" },
  { key: "warehouse", label: "outbound.warehouse" },
  { key: "level", label: "exc.level" },
  { key: "current_qty", label: "inv.currentQty" },
  { key: "threshold", label: "inv.threshold" },
  { key: "status", label: "common.statusLabel" },
  { key: "created_at", label: "orders.sync.col.time" }
];

const fields: FormField[] = [
  { key: "sku", label: "SKU" },
  { key: "warehouse", label: "outbound.warehouse" },
  { key: "level", label: "exc.level", type: "select", options: [{ label: "exc.sevCritical", value: "严重" }, { label: "exc.sevWarning", value: "警告" }, { label: "exc.tip", value: "提示" }] },
  { key: "current_qty", label: "inv.currentQty", type: "number" },
  { key: "threshold", label: "inv.threshold", type: "number" },
  { key: "status", label: "common.statusLabel", type: "select", options: [{ label: "st.unhandled", value: "未处理" }, { label: "st.processed", value: "已处理" }, { label: "st.ignored", value: "已忽略" }] },
  { key: "resolved_note", label: "exc.handlingNote" }
];

function InventoryAlertsPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="nav.inventory.alerts"
      description="inv.alertsDesc"
      table="stock_alerts"
      columns={columns}
      fields={fields}
      exportable
      batchDelete
    />
  );
}
