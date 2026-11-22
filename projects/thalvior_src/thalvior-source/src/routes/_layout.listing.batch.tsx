import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/listing/batch")({
  component: ListingBatchPage,
});

const columns: ListColumn[] = [
  { key: "product", label: "listing.col.product" },
  { key: "source", label: "listing.col.source" },
  { key: "target_platforms", label: "listing.col.targetPlatforms" },
  { key: "status", label: "listing.col.status" },
  { key: "created_at", label: "listing.col.createdAt" }
];

const fields: FormField[] = [
  { key: "product", label: "listing.col.product", required: true },
  { key: "source", label: "listing.col.source" },
  { key: "target_platforms", label: "listing.col.targetPlatforms" },
  { key: "status", label: "listing.col.status", type: "select", options: [{ label: "nav.listing.pending", value: "待刊登" }, { label: "nav.listing.publishing", value: "刊登中" }, { label: "nav.listing.published", value: "已刊登" }, { label: "orders.sync.col.failed", value: "失败" }, { label: "st.delisted", value: "已下架" }] }
];

function ListingBatchPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="nav.listing.batch"
      description="listing.batchDesc"
      table="listing_tasks"
      columns={columns}
      fields={fields}
      batchDelete
      batchActions={[
        { label: "listing.batchPublish", status: "已刊登" },
        { label: "products.batchDelist", status: "已下架" },
        { label: "listing.batchSync", status: "刊登中" }
      ]}
    />
  );
}
