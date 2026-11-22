import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/products/brands")({
  component: BrandsPage,
});

const columns = [
  { key: "name", label: "listing.col.name" },
  { key: "country", label: "pm.col.country" },
  { key: "status", label: "listing.col.status" },
];

const fields: FormField[] = [
  { key: "name", label: "listing.col.name", required: true },
  { key: "logo", label: "pm.brand.logoLink" },
  { key: "country", label: "pm.col.country" },
  { key: "status", label: "listing.col.status", type: "select", options: [{ label: "st.enabled", value: "启用" }, { label: "st.disabled", value: "停用" }] },
];

function BrandsPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="nav.products.brands"
      description="pm.brand.desc"
      table="brands"
      columns={columns}
      fields={fields}
    />
  );
}
