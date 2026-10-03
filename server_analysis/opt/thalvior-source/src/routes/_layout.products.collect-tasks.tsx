import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/products/collect-tasks")({
  component: CollectTasksPage,
});

const columns = [
  { key: "name", label: "商品名" },
  { key: "platform", label: "平台" },
  { key: "category", label: "分类" },
  { key: "status", label: "状态" },
  { key: "claimed_shop", label: "认领店铺" },
];

const fields: FormField[] = [
  { key: "name", label: "商品名", required: true },
  { key: "platform", label: "平台" },
  { key: "category", label: "分类" },
  { key: "status", label: "状态" },
  { key: "claimed_shop", label: "认领店铺" },
];

function CollectTasksPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="采集任务"
      description="商品采集任务（待认领 / 已认领 / 采集中）"
      table="collect_items"
      columns={columns}
      fields={fields}
    />
  );
}
