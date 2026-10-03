import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/inventory/adjustments")({
  component: InventoryAdjustmentsPage,
});

const columns: ListColumn[] = [
  { key: "sku", label: "SKU" },
  { key: "warehouse", label: "仓库" },
  { key: "type", label: "类型" },
  { key: "qty", label: "数量" },
  { key: "reason", label: "原因" },
  { key: "created_at", label: "时间" }
];

const fields: FormField[] = [
  { key: "sku", label: "SKU" },
  { key: "warehouse", label: "仓库" },
  { key: "type", label: "类型", type: "select", options: ["盘点调整", "报溢", "报损", "移库"] },
  { key: "qty", label: "数量", type: "number" },
  { key: "reason", label: "原因" },
  { key: "note", label: "备注" }
];

function InventoryAdjustmentsPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="库存调整"
      description="登记库存调整单据"
      table="stock_adjustments"
      columns={columns}
      fields={fields}
      exportable
      batchDelete
    />
  );
}
