import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/inventory/skus")({
  component: InventorySkusPage,
});

const columns: ListColumn[] = [
  { key: "sku", label: "SKU" },
  { key: "product_id", label: "商品ID" },
  { key: "attributes", label: "属性" },
  { key: "price", label: "价格" },
  { key: "stock", label: "库存" }
];

const fields: FormField[] = [
  { key: "sku", label: "SKU", required: true },
  { key: "product_id", label: "商品ID" },
  { key: "attributes", label: "属性" },
  { key: "price", label: "价格", type: "number" },
  { key: "stock", label: "库存", type: "number" }
];

function InventorySkusPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="SKU 管理"
      description="管理商品 SKU 与库存数量"
      table="product_variants"
      columns={columns}
      fields={fields}
      exportable
      batchDelete
    />
  );
}
