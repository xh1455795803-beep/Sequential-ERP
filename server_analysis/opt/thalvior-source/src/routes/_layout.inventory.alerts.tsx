import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/inventory/alerts")({
  component: InventoryAlertsPage,
});

const columns: ListColumn[] = [
  { key: "sku", label: "SKU" },
  { key: "warehouse", label: "仓库" },
  { key: "level", label: "级别" },
  { key: "current_qty", label: "当前量" },
  { key: "threshold", label: "阈值" },
  { key: "status", label: "状态" },
  { key: "created_at", label: "时间" }
];

const fields: FormField[] = [
  { key: "sku", label: "SKU" },
  { key: "warehouse", label: "仓库" },
  { key: "level", label: "级别", type: "select", options: ["严重", "警告", "提示"] },
  { key: "current_qty", label: "当前量", type: "number" },
  { key: "threshold", label: "阈值", type: "number" },
  { key: "status", label: "状态", type: "select", options: ["未处理", "已处理", "已忽略"] },
  { key: "resolved_note", label: "处理说明" }
];

function InventoryAlertsPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="库存预警"
      description="库存预警与处理"
      table="stock_alerts"
      columns={columns}
      fields={fields}
      exportable
      batchDelete
    />
  );
}
