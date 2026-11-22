import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/inventory/skus")({
  component: InventorySkusPage,
});

const columns: ListColumn[] = [
  { key: "sku", label: "SKU" },
  { key: "product_id", label: "inv.productId" },
  { key: "attributes", label: "pd.attrs" },
  { key: "price", label: "products.col.price" },
  { key: "stock", label: "products.col.stock" }
];

const fields: FormField[] = [
  { key: "sku", label: "SKU", required: true },
  { key: "product_id", label: "inv.productId" },
  { key: "attributes", label: "pd.attrs" },
  { key: "price", label: "products.col.price", type: "number" },
  { key: "stock", label: "products.col.stock", type: "number" }
];

function InventorySkusPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="nav.inventory.skus"
      description="inv.skusDesc"
      table="product_variants"
      columns={columns}
      fields={fields}
      exportable
      batchDelete
    />
  );
}
