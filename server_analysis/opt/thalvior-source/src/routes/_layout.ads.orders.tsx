import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/ads/orders")({
  component: AdsOrdersPage,
});

const columns: ListColumn[] = [{ key: "order_no", label: "订单号" }, { key: "campaign", label: "Campaign" }, { key: "platform", label: "平台" }, { key: "amount", label: "订单金额" }, { key: "currency", label: "币种" }, { key: "date", label: "日期" }, { key: "status", label: "状态" }];

const fields: FormField[] = [{ key: "order_no", label: "订单号", required: true }, { key: "campaign", label: "Campaign" }, { key: "platform", label: "平台", type: "select", options: ["Amazon US", "Amazon JP", "TikTok Shop", "Temu", "Shopee", "Etsy"] }, { key: "amount", label: "订单金额", type: "number", required: true }, { key: "currency", label: "币种", type: "select", options: ["USD", "EUR", "GBP", "JPY", "CNY"] }, { key: "date", label: "日期" }, { key: "status", label: "状态", type: "select", options: ["已成交", "待付款", "已取消"] }];

function AdsOrdersPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="广告订单"
      description="广告带来的成交订单登记"
      table="ad_orders"
      columns={columns}
      fields={fields}
    />
  );
}
