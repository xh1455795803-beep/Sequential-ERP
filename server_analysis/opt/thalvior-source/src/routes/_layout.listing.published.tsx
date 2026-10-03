import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/listing/published")({
  component: ListingPublishedPage,
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

function ListingPublishedPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="已刊登"
      description="已成功刊登的 Listing"
      table="listing_tasks"
      columns={columns}
      fields={fields}
      filter={{ field: "status", value: "已刊登" }}
      exportable
      batchDelete
    />
  );
}
