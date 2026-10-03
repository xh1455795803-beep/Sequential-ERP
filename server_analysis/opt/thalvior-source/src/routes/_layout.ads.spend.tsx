import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/ads/spend")({
  component: AdsSpendPage,
});

const columns: ListColumn[] = [{ key: "date", label: "日期" }, { key: "campaign", label: "Campaign" }, { key: "platform", label: "平台" }, { key: "amount", label: "花费" }, { key: "currency", label: "币种" }, { key: "note", label: "备注" }];

const fields: FormField[] = [{ key: "date", label: "日期" }, { key: "campaign", label: "Campaign" }, { key: "platform", label: "平台", type: "select", options: ["Amazon US", "Amazon JP", "TikTok Shop", "Temu", "Shopee", "Etsy"] }, { key: "amount", label: "花费", type: "number", required: true }, { key: "currency", label: "币种", type: "select", options: ["USD", "EUR", "GBP", "JPY", "CNY"] }, { key: "note", label: "备注" }];

function AdsSpendPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="花费记录"
      description="广告花费明细流水"
      table="ad_spend"
      columns={columns}
      fields={fields}
    />
  );
}
