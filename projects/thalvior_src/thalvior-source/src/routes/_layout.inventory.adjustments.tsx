import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/inventory/adjustments")({
  component: InventoryAdjustmentsPage,
});

const columns: ListColumn[] = [
  { key: "sku", label: "SKU" },
  { key: "warehouse", label: "outbound.warehouse" },
  { key: "type", label: "common.type" },
  { key: "qty", label: "outbound.qty" },
  { key: "reason", label: "exc.reason" },
  { key: "created_at", label: "orders.sync.col.time" }
];

const fields: FormField[] = [
  { key: "sku", label: "SKU" },
  { key: "warehouse", label: "outbound.warehouse" },
  { key: "type", label: "common.type", type: "select", options: [{ label: "inv.adjust.typeCount", value: "盘点调整" }, { label: "inv.adjust.overage", value: "报溢" }, { label: "inv.adjust.loss", value: "报损" }, { label: "inv.adjust.transfer", value: "移库" }] },
  { key: "qty", label: "outbound.qty", type: "number" },
  { key: "reason", label: "exc.reason" },
  { key: "note", label: "sub.usage.col.note" }
];

function InventoryAdjustmentsPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="nav.inventory.adjustments"
      description="inv.adjust.desc"
      table="stock_adjustments"
      columns={columns}
      fields={fields}
      exportable
      batchDelete
    />
  );
}
