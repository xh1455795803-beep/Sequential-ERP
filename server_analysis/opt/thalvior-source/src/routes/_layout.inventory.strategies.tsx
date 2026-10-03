import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/inventory/strategies")({
  component: InventoryStrategiesPage,
});

const columns: ListColumn[] = [
  { key: "sku", label: "SKU" },
  { key: "warehouse", label: "仓库" },
  { key: "min_qty", label: "最小量" },
  { key: "max_qty", label: "最大量" },
  { key: "reorder_point", label: "补货点" },
  { key: "lead_time", label: "提前期" },
  { key: "status", label: "状态" }
];

const fields: FormField[] = [
  { key: "sku", label: "SKU" },
  { key: "warehouse", label: "仓库" },
  { key: "min_qty", label: "最小量", type: "number" },
  { key: "max_qty", label: "最大量", type: "number" },
  { key: "reorder_point", label: "补货点", type: "number" },
  { key: "lead_time", label: "提前期", type: "number" },
  { key: "status", label: "状态", type: "select", options: ["启用", "停用"] }
];

function InventoryStrategiesPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="库存策略"
      description="设置补货与安全库存策略"
      table="stock_strategies"
      columns={columns}
      fields={fields}
      exportable
      batchDelete
    />
  );
}
