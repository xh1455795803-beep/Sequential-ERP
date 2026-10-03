import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/inventory/locked")({
  component: InventoryLockedPage,
});

const columns: ListColumn[] = [
  { key: "sku", label: "SKU" },
  { key: "name", label: "商品" },
  { key: "warehouse", label: "仓库" },
  { key: "available", label: "可用库存" },
  { key: "locked", label: "锁定库存" }
];

const fields: FormField[] = [
  { key: "locked", label: "锁定库存", type: "number" }
];

function InventoryLockedPage() {
  return (
    <DataListPage
      title="锁定库存"
      description="锁定中的库存明细（锁定数量 > 0），可调整锁定数"
      table="inventory"
      filter={{ field: "locked", value: 0, op: "gt" }}
      columns={columns}
      fields={fields}
    />
  );
}
