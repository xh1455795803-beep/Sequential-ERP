import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/inventory/transit")({
  component: InventoryTransitPage,
});

const columns: ListColumn[] = [
  { key: "sku", label: "SKU" },
  { key: "name", label: "商品" },
  { key: "warehouse", label: "仓库" },
  { key: "available", label: "可用库存" },
  { key: "in_transit", label: "在途库存" }
];

const fields: FormField[] = [
  { key: "in_transit", label: "在途库存", type: "number" }
];

function InventoryTransitPage() {
  return (
    <DataListPage
      title="在途库存"
      description="调拨在途的库存明细（在途数量 > 0），到仓后可调整"
      table="inventory"
      filter={{ field: "in_transit", value: 0, op: "gt" }}
      columns={columns}
      fields={fields}
    />
  );
}
