import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/inventory/warehouses")({
  component: InventoryWarehousesPage,
});

const columns: ListColumn[] = [
  { key: "code", label: "编码" },
  { key: "name", label: "名称" },
  { key: "country", label: "国家" },
  { key: "city", label: "城市" },
  { key: "status", label: "状态" }
];

const fields: FormField[] = [
  { key: "code", label: "编码" },
  { key: "name", label: "名称", required: true },
  { key: "country", label: "国家" },
  { key: "city", label: "城市" },
  { key: "address", label: "地址" },
  { key: "status", label: "状态", type: "select", options: ["启用", "停用"] }
];

function InventoryWarehousesPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="仓库管理"
      description="管理仓储节点"
      table="warehouses"
      columns={columns}
      fields={fields}
      exportable
      batchDelete
    />
  );
}
