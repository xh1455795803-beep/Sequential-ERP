import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/listing/batch")({
  component: ListingBatchPage,
});

const columns: ListColumn[] = [
  { key: "product", label: "商品" },
  { key: "source", label: "来源" },
  { key: "target_platforms", label: "目标平台" },
  { key: "status", label: "状态" },
  { key: "created_at", label: "时间" }
];

const fields: FormField[] = [
  { key: "product", label: "商品", required: true },
  { key: "source", label: "来源" },
  { key: "target_platforms", label: "目标平台" },
  { key: "status", label: "状态", type: "select", options: ["待刊登", "刊登中", "已刊登", "失败", "已下架"] }
];

function ListingBatchPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="批量操作"
      description="勾选 Listing 后可批量发布 / 下架 / 同步"
      table="listing_tasks"
      columns={columns}
      fields={fields}
      batchDelete
      batchActions={[
        { label: "批量发布", status: "已刊登" },
        { label: "批量下架", status: "已下架" },
        { label: "批量同步", status: "刊登中" }
      ]}
    />
  );
}
