import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/inventory/counts")({
  component: InventoryCountsPage,
});

const columns: ListColumn[] = [
  { key: "plan_no", label: "盘点单号" },
  { key: "warehouse", label: "仓库" },
  { key: "sku", label: "SKU" },
  { key: "system_qty", label: "系统数" },
  { key: "actual_qty", label: "实盘数" },
  { key: "diff", label: "差异" },
  { key: "operator", label: "盘点人" },
  { key: "status", label: "状态" }
];

const fields: FormField[] = [
  { key: "plan_no", label: "盘点单号" },
  { key: "warehouse", label: "仓库" },
  { key: "sku", label: "SKU" },
  { key: "system_qty", label: "系统数", type: "number" },
  { key: "actual_qty", label: "实盘数", type: "number" },
  { key: "operator", label: "盘点人" },
  { key: "status", label: "状态", type: "select", options: ["待盘点", "盘点中", "已完成"] }
];

function InventoryCountsPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="库存盘点"
      description="盘点计划与差异记录"
      table="stock_takes"
      columns={columns}
      fields={fields}
      exportable
      batchDelete
    />
  );
}
