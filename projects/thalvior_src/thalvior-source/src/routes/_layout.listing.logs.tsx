import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/listing/logs")({
  component: ListingLogsPage,
});

const columns: ListColumn[] = [
  { key: "product", label: "listing.col.product" },
  { key: "platform", label: "listing.col.platform" },
  { key: "action", label: "listing.col.action" },
  { key: "result", label: "listing.col.result" },
  { key: "message", label: "listing.col.message" },
  { key: "created_at", label: "listing.col.createdAt" }
];

const fields: FormField[] = [
  { key: "product", label: "listing.col.product" },
  { key: "platform", label: "listing.col.platform" },
  { key: "action", label: "listing.col.action" },
  { key: "result", label: "listing.col.result", type: "select", options: [{ label: "orders.sync.status.ok", value: "成功" }, { label: "orders.sync.col.failed", value: "失败" }] },
  { key: "message", label: "listing.col.message" }
];

function ListingLogsPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="nav.listing.logs"
      description="listing.logsDesc"
      table="listing_logs"
      columns={columns}
      fields={fields}
      exportable
      batchDelete
    />
  );
}
