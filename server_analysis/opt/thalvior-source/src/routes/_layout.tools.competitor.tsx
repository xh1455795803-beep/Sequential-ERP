import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/tools/competitor")({
  component: CompetitorTool,
});

const columns = [
  { key: "name", label: "竞品名称" },
  { key: "platform", label: "平台" },
  { key: "url", label: "链接" },
  { key: "price", label: "价格" },
  { key: "sales", label: "销量" },
  { key: "status", label: "状态" },
];

const fields: FormField[] = [
  { key: "name", label: "竞品名称", required: true, placeholder: "如：某品牌无线耳机" },
  { key: "platform", label: "平台", type: "select", options: ["Amazon", "eBay", "TikTok Shop", "Shopify", "Walmart", "Etsy"] },
  { key: "url", label: "商品链接", placeholder: "https://..." },
  { key: "price", label: "价格", type: "number" },
  { key: "sales", label: "销量", type: "number" },
  { key: "status", label: "状态", type: "select", options: ["监控中", "已下架", "已超越"] },
];

function CompetitorTool() {
  return (
    <DataListPage
      title="竞品监控"
      description="记录竞品链接、价格与销量，持续跟踪竞品动态"
      table="competitor_tracks"
      columns={columns}
      fields={fields}
      addLabel="新增竞品"
      exportable
      batchDelete
    />
  );
}