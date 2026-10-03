import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/inventory/logs")({
  component: InventoryLogsPage,
});

const columns: ListColumn[] = [
  { key: "sku", label: "SKU" },
  { key: "warehouse", label: "仓库" },
  { key: "biz_type", label: "业务类型" },
  { key: "change_qty", label: "变动数" },
  { key: "after_qty", label: "结存数" },
  { key: "operator", label: "操作人" },
  { key: "created_at", label: "时间" }
];

const fields: FormField[] = [
  { key: "sku", label: "SKU" },
  { key: "warehouse", label: "仓库" },
  { key: "biz_type", label: "业务类型" },
  { key: "change_qty", label: "变动数", type: "number" },
  { key: "after_qty", label: "结存数", type: "number" },
  { key: "operator", label: "操作人" }
];

function InventoryLogsPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="库存流水"
      description="库存变动流水明细"
      table="stock_logs"
      columns={columns}
      fields={fields}
      exportable
      batchDelete
    />
  );
}
