import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/listing/mappings")({
  component: ListingMappingsPage,
});

const columns: ListColumn[] = [
  { key: "local_platform", label: "listing.col.localPlatform" },
  { key: "target_platform", label: "listing.col.targetPlatforms" },
  { key: "field_map", label: "listing.col.fieldMap" },
  { key: "status", label: "listing.col.status" }
];

const fields: FormField[] = [
  { key: "local_platform", label: "listing.col.localPlatform" },
  { key: "target_platform", label: "listing.col.targetPlatforms" },
  { key: "field_map", label: "listing.col.fieldMap" },
  { key: "status", label: "listing.col.status", type: "select", options: [{ label: "st.enabled", value: "启用" }, { label: "st.disabled", value: "停用" }] }
];

function ListingMappingsPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="nav.listing.mappings"
      description="listing.mappingsDesc"
      table="listing_mappings"
      columns={columns}
      fields={fields}
      exportable
      batchDelete
    />
  );
}
