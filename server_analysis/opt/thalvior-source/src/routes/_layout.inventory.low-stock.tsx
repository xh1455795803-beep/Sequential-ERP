import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/inventory/low-stock")({
  component: InventoryLowStockPage,
});

const columns: ListColumn[] = [
  { key: "sku", label: "SKU" },
  { key: "name", label: "名称" },
  { key: "warehouse", label: "仓库" },
  { key: "available", label: "可用" },
  { key: "safety_stock", label: "安全库存" },
  { key: "status", label: "状态" }
];

const fields: FormField[] = [
  { key: "sku", label: "SKU" },
  { key: "name", label: "名称" },
  { key: "warehouse", label: "仓库" },
  { key: "available", label: "可用", type: "number" },
  { key: "safety_stock", label: "安全库存", type: "number" }
];

function InventoryLowStockPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="库存偏低"
      description="可用量低于安全库存的 SKU"
      table="inventory"
      columns={columns}
      fields={fields}
      filter={{ field: "status", value: "偏低" }}
      exportable
      batchDelete
    />
  );
}
