import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/listing/mappings")({
  component: ListingMappingsPage,
});

const columns: ListColumn[] = [
  { key: "local_platform", label: "本地平台" },
  { key: "target_platform", label: "目标平台" },
  { key: "field_map", label: "字段映射" },
  { key: "status", label: "状态" }
];

const fields: FormField[] = [
  { key: "local_platform", label: "本地平台" },
  { key: "target_platform", label: "目标平台" },
  { key: "field_map", label: "字段映射" },
  { key: "status", label: "状态", type: "select", options: ["启用", "停用"] }
];

function ListingMappingsPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="平台映射"
      description="本地字段与目标平台字段映射"
      table="listing_mappings"
      columns={columns}
      fields={fields}
      exportable
      batchDelete
    />
  );
}
