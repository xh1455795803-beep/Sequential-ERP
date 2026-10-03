import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/ads/attribution")({
  component: AdsAttributionPage,
});

const columns: ListColumn[] = [{ key: "order_no", label: "订单号" }, { key: "campaign", label: "Campaign" }, { key: "keyword", label: "关键词" }, { key: "type", label: "归因类型" }, { key: "click_date", label: "点击日期" }, { key: "order_date", label: "下单日期" }, { key: "amount", label: "订单金额" }];

const fields: FormField[] = [{ key: "order_no", label: "订单号", required: true }, { key: "campaign", label: "Campaign" }, { key: "keyword", label: "关键词" }, { key: "type", label: "归因类型", type: "select", options: ["直接归因", "间接归因"] }, { key: "click_date", label: "点击日期" }, { key: "order_date", label: "下单日期" }, { key: "amount", label: "订单金额", type: "number" }];

function AdsAttributionPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="归因记录"
      description="点击-成交归因明细（直接 / 间接）"
      table="ad_attributions"
      columns={columns}
      fields={fields}
    />
  );
}
