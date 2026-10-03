import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/listing/templates")({
  component: ListingTemplatesPage,
});

const columns: ListColumn[] = [
  { key: "name", label: "名称" },
  { key: "platform", label: "平台" },
  { key: "title_rule", label: "标题规则" },
  { key: "status", label: "状态" }
];

const fields: FormField[] = [
  { key: "name", label: "名称", required: true },
  { key: "platform", label: "平台" },
  { key: "title_rule", label: "标题规则" },
  { key: "desc_rule", label: "描述规则" },
  { key: "price_rule", label: "价格规则" },
  { key: "status", label: "状态", type: "select", options: ["启用", "停用"] }
];

function ListingTemplatesPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="Listing 模板"
      description="管理多平台刊登模板"
      table="listing_templates"
      columns={columns}
      fields={fields}
      exportable
      batchDelete
    />
  );
}
