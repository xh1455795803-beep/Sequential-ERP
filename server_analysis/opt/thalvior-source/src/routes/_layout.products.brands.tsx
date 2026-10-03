import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/products/brands")({
  component: BrandsPage,
});

const columns = [
  { key: "name", label: "名称" },
  { key: "country", label: "国家" },
  { key: "status", label: "状态" },
];

const fields: FormField[] = [
  { key: "name", label: "名称", required: true },
  { key: "logo", label: "Logo 链接" },
  { key: "country", label: "国家" },
  { key: "status", label: "状态", type: "select", options: ["启用", "停用"] },
];

function BrandsPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="品牌"
      description="管理商品品牌"
      table="brands"
      columns={columns}
      fields={fields}
    />
  );
}
