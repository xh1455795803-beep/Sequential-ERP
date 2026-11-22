import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/inventory/logs")({
  component: InventoryLogsPage,
});

const columns: ListColumn[] = [
  { key: "sku", label: "SKU" },
  { key: "warehouse", label: "outbound.warehouse" },
  { key: "biz_type", label: "inv.bizType" },
  { key: "change_qty", label: "inv.changeQty" },
  { key: "after_qty", label: "inv.balanceQty" },
  { key: "operator", label: "inv.operator" },
  { key: "created_at", label: "orders.sync.col.time" }
];

const fields: FormField[] = [
  { key: "sku", label: "SKU" },
  { key: "warehouse", label: "outbound.warehouse" },
  { key: "biz_type", label: "inv.bizType" },
  { key: "change_qty", label: "inv.changeQty", type: "number" },
  { key: "after_qty", label: "inv.balanceQty", type: "number" },
  { key: "operator", label: "inv.operator" }
];

function InventoryLogsPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="nav.inventory.logs"
      description="inv.logsDesc"
      table="stock_logs"
      columns={columns}
      fields={fields}
      exportable
      batchDelete
    />
  );
}
