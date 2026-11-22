import { createFileRoute, Link } from "@tanstack/react-router";
import { DataListPage, type FormField } from "@/components/data-list-page";
import { fetchOrders } from "@/lib/data-access";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/orders/after-sale")({
  component: AfterSale,
});

const columns = [
  { key: "order_id", label: "common.relatedOrder" },
  { key: "buyer", label: "orders.col.buyer" },
  { key: "product", label: "orders.col.product" },
  { key: "reason", label: "common.asReason" },
  { key: "status", label: "common.statusLabel" },
];

const fields: FormField[] = [
  {
    key: "order_id", label: "common.relatedOrder", required: true,
    type: "select",
    // 联动：下拉选择真实存在的订单（含买家/商品提示），杜绝手填不存在的订单号
    loadOptions: async () => {
      try {
        const rows = await fetchOrders();
        return rows.slice(0, 300).map((o) => ({ value: o.id, label: `${o.id} · ${o.buyer} · ${o.product} · ${o.channel}` }));
      } catch {
        return [];
      }
    },
  },
  { key: "buyer", label: "orders.col.buyer", placeholder: "orders.ph.buyer" },
  { key: "product", label: "orders.col.product", placeholder: "orders.ph.product" },
  { key: "reason", label: "common.asReason", placeholder: "orders.reasonPh" },
  { key: "status", label: "common.statusLabel", type: "select", options: [{ label: "st.pendingReview", value: "待审核" }, { label: "st.processing", value: "处理中" }, { label: "nav.orders.completed", value: "已完成" }, { label: "st.rejected", value: "已拒绝" }] },
];

function AfterSale() {
  return (
    <DataListPage
      title="nav.orders.aftersale"
      description="orders.aftersaleIndexDesc"
      table="after_sales"
      addLabel="orders.newAftersale"
      columns={columns}
      fields={fields}
    />
  );
}