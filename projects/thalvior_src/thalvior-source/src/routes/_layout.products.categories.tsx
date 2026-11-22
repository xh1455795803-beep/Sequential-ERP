import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/products/categories")({
  component: CategoriesPage,
});

const columns = [
  { key: "name", label: "listing.col.name" },
  { key: "sort", label: "pm.col.sort" },
  { key: "status", label: "listing.col.status" },
];

const fields: FormField[] = [
  { key: "name", label: "listing.col.name", required: true },
  { key: "sort", label: "pm.col.sort", type: "number" },
  { key: "status", label: "listing.col.status", type: "select", options: [{ label: "st.enabled", value: "启用" }, { label: "st.disabled", value: "停用" }] },
];

function CategoriesPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="nav.products.categories"
      description="pm.cat.desc"
      table="categories"
      columns={columns}
      fields={fields}
    />
  );
}
