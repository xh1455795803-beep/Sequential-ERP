import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/inventory/locations")({
  component: InventoryLocationsPage,
});

const columns: ListColumn[] = [
  { key: "warehouse_code", label: "仓库编码" },
  { key: "zone", label: "区" },
  { key: "shelf", label: "货架" },
  { key: "bin", label: "货位" },
  { key: "capacity", label: "容量" },
  { key: "used", label: "已用" },
  { key: "status", label: "状态" }
];

const fields: FormField[] = [
  { key: "warehouse_code", label: "仓库编码" },
  { key: "zone", label: "区" },
  { key: "shelf", label: "货架" },
  { key: "bin", label: "货位" },
  { key: "capacity", label: "容量", type: "number" },
  { key: "used", label: "已用", type: "number" },
  { key: "status", label: "状态", type: "select", options: ["启用", "停用"] }
];

function InventoryLocationsPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="库位管理"
      description="管理仓库内库位与容量"
      table="locations"
      columns={columns}
      fields={fields}
      exportable
      batchDelete
    />
  );
}
