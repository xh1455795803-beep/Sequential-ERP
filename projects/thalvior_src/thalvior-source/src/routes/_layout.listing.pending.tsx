import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/listing/pending")({
  component: ListingPendingPage,
});

const columns: ListColumn[] = [
  { key: "product", label: "listing.col.product" },
  { key: "source", label: "listing.col.source" },
  { key: "target_platforms", label: "listing.col.targetPlatforms" },
  { key: "status", label: "listing.col.status" },
  { key: "created_at", label: "listing.col.createdAt" }
];

const fields: FormField[] = [
  { key: "product", label: "listing.col.product" },
  { key: "source", label: "listing.col.source" },
  { key: "target_platforms", label: "listing.col.targetPlatforms" },
  { key: "status", label: "listing.col.status", type: "select", options: [{ label: "nav.listing.pending", value: "待刊登" }, { label: "nav.listing.publishing", value: "刊登中" }, { label: "nav.listing.published", value: "已刊登" }, { label: "orders.sync.col.failed", value: "失败" }] }
];

function ListingPendingPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="nav.listing.pending"
      description="listing.pendingDesc"
      table="listing_tasks"
      columns={columns}
      fields={fields}
      filter={{ field: "status", value: "待刊登" }}
      exportable
      batchDelete
    />
  );
}
