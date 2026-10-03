import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/ads/creatives")({
  component: AdsCreativesPage,
});

const columns: ListColumn[] = [{ key: "name", label: "广告名称" }, { key: "campaign", label: "所属 Campaign" }, { key: "platform", label: "平台" }, { key: "type", label: "类型" }, { key: "status", label: "状态" }, { key: "impressions", label: "展示" }, { key: "clicks", label: "点击" }, { key: "spend", label: "花费" }];

const fields: FormField[] = [{ key: "name", label: "广告名称", required: true }, { key: "campaign", label: "所属 Campaign" }, { key: "platform", label: "平台", type: "select", options: ["Amazon US", "Amazon JP", "TikTok Shop", "Temu", "Shopee", "Etsy"] }, { key: "type", label: "类型", type: "select", options: ["商品广告", "品牌广告", "展示广告", "视频广告"] }, { key: "status", label: "状态", type: "select", options: ["投放中", "暂停", "已结束"] }, { key: "impressions", label: "展示量", type: "number" }, { key: "clicks", label: "点击量", type: "number" }, { key: "spend", label: "花费", type: "number" }];

function AdsCreativesPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="广告创意"
      description="广告素材与投放表现登记"
      table="ad_ads"
      columns={columns}
      fields={fields}
    />
  );
}
