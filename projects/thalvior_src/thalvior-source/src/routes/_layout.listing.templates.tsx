import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/listing/templates")({
  component: ListingTemplatesPage,
});

const columns: ListColumn[] = [
  { key: "name", label: "listing.col.name" },
  { key: "platform", label: "listing.col.platform" },
  { key: "title_rule", label: "listing.col.titleRule" },
  { key: "status", label: "listing.col.status" }
];

const fields: FormField[] = [
  { key: "name", label: "listing.col.name", required: true },
  { key: "platform", label: "listing.col.platform" },
  { key: "title_rule", label: "listing.col.titleRule" },
  { key: "desc_rule", label: "listing.col.descRule" },
  { key: "price_rule", label: "listing.col.priceRule" },
  { key: "status", label: "listing.col.status", type: "select", options: [{ label: "st.enabled", value: "启用" }, { label: "st.disabled", value: "停用" }] }
];

function ListingTemplatesPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="listing.page.templates"
      description="listing.templatesDesc"
      table="listing_templates"
      columns={columns}
      fields={fields}
      exportable
      batchDelete
    />
  );
}
