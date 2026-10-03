import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/listing/publishing")({
  component: ListingPublishingPage,
});

const columns: ListColumn[] = [
  { key: "product", label: "商品" },
  { key: "source", label: "来源" },
  { key: "target_platforms", label: "目标平台" },
  { key: "status", label: "状态" },
  { key: "created_at", label: "时间" }
];

const fields: FormField[] = [
  { key: "product", label: "商品" },
  { key: "source", label: "来源" },
  { key: "target_platforms", label: "目标平台" },
  { key: "status", label: "状态", type: "select", options: ["待刊登", "刊登中", "已刊登", "失败"] }
];

function ListingPublishingPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="刊登中"
      description="正在刊登的 Listing 任务"
      table="listing_tasks"
      columns={columns}
      fields={fields}
      filter={{ field: "status", value: "刊登中" }}
      exportable
      batchDelete
    />
  );
}
