import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/fulfillment/shipping-tasks")({
  component: Page_FulfillmentShippingTasks,
});

const columns: ListColumn[] = [
    {key: "order_id", label: "订单号"},
    {key: "sku", label: "SKU"},
    {key: "qty", label: "数量"},
    {key: "warehouse", label: "仓库"},
    {key: "carrier", label: "承运商"},
    {key: "status", label: "状态"},
    {key: "shipped_at", label: "发货时间"},
  ];

const fields: FormField[] = [
    {key: "order_id", label: "订单号", required: true},
    {key: "sku", label: "SKU"},
    {key: "qty", label: "数量", type: "number"},
    {key: "warehouse", label: "仓库"},
    {key: "carrier", label: "承运商"},
    {key: "status", label: "状态", type: "select", options: ["待拣货", "拣货中", "待打包", "待出库", "已出库"]},
  ];

function Page_FulfillmentShippingTasks() {
  return (
    <DataListPage
      addLabel="common.add"
      title="发货任务"
      description="拣货/打包/出库任务（待拣货/拣货中/待打包/待出库/已出库）"
      table="shipping_tasks"
      columns={columns}
      fields={fields}
      exportable
      batchDelete
    />
  );
}
