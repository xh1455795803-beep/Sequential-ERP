import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/ads/groups")({
  component: AdsGroupsPage,
});

const columns: ListColumn[] = [{ key: "name", label: "组名称" }, { key: "campaign", label: "所属 Campaign" }, { key: "platform", label: "平台" }, { key: "budget", label: "预算" }, { key: "status", label: "状态" }];

const fields: FormField[] = [{ key: "name", label: "组名称", required: true }, { key: "campaign", label: "所属 Campaign" }, { key: "platform", label: "平台", type: "select", options: ["Amazon US", "Amazon JP", "TikTok Shop", "Temu", "Shopee", "Etsy"] }, { key: "budget", label: "预算", type: "number" }, { key: "status", label: "状态", type: "select", options: ["启用", "暂停", "归档"] }];

function AdsGroupsPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="广告组"
      description="按 Campaign 组织广告组"
      table="ad_groups"
      columns={columns}
      fields={fields}
    />
  );
}
