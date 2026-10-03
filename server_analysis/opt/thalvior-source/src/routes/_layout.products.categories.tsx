import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/products/categories")({
  component: CategoriesPage,
});

const columns = [
  { key: "name", label: "名称" },
  { key: "sort", label: "排序" },
  { key: "status", label: "状态" },
];

const fields: FormField[] = [
  { key: "name", label: "名称", required: true },
  { key: "sort", label: "排序", type: "number" },
  { key: "status", label: "状态", type: "select", options: ["启用", "停用"] },
];

function CategoriesPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="分类与属性"
      description="管理商品分类与属性"
      table="categories"
      columns={columns}
      fields={fields}
    />
  );
}
