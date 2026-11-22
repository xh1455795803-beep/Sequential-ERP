import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/fulfillment/shipping-tasks")({
  component: Page_FulfillmentShippingTasks,
});

const columns: ListColumn[] = [
    {key: "order_id", label: "orders.col.orderNo"},
    {key: "sku", label: "SKU"},
    {key: "qty", label: "outbound.qty"},
    {key: "warehouse", label: "outbound.warehouse"},
    {key: "carrier", label: "common.carrier"},
    {key: "status", label: "common.statusLabel"},
    {key: "shipped_at", label: "ful.col.shipTime"},
  ];

const fields: FormField[] = [
    {key: "order_id", label: "orders.col.orderNo", required: true},
    {key: "sku", label: "SKU"},
    {key: "qty", label: "outbound.qty", type: "number"},
    {key: "warehouse", label: "outbound.warehouse"},
    {key: "carrier", label: "common.carrier"},
    {key: "status", label: "common.statusLabel", type: "select", options: [{ label: "st.toPick", value: "待拣货" }, { label: "st.picking", value: "拣货中" }, { label: "st.toPack", value: "待打包" }, { label: "st.toOutbound", value: "待出库" }, { label: "st.outbound", value: "已出库" }]},
  ];

function Page_FulfillmentShippingTasks() {
  return (
    <DataListPage
      addLabel="common.add"
      title="nav.fulfillment.shippingTasks"
      description="ful.tasksDesc"
      table="shipping_tasks"
      columns={columns}
      fields={fields}
      exportable
      batchDelete
    />
  );
}
