import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/ads/budgets")({
  component: AdsBudgetsPage,
});

const columns: ListColumn[] = [{ key: "campaign", label: "Campaign" }, { key: "platform", label: "平台" }, { key: "period", label: "预算周期" }, { key: "budget", label: "预算额" }, { key: "spent", label: "已花费" }, { key: "status", label: "状态" }];

const fields: FormField[] = [{ key: "campaign", label: "Campaign" }, { key: "platform", label: "平台", type: "select", options: ["Amazon US", "Amazon JP", "TikTok Shop", "Temu", "Shopee", "Etsy"] }, { key: "period", label: "预算周期", type: "select", options: ["日预算", "周预算", "月预算", "总预算"] }, { key: "budget", label: "预算额", type: "number", required: true }, { key: "spent", label: "已花费", type: "number" }, { key: "status", label: "状态", type: "select", options: ["正常", "接近上限", "已超支"] }, { key: "note", label: "备注" }];

function AdsBudgetsPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="广告预算"
      description="Campaign 预算与消耗监控"
      table="ad_budgets"
      columns={columns}
      fields={fields}
    />
  );
}
