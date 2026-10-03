import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/listing/logs")({
  component: ListingLogsPage,
});

const columns: ListColumn[] = [
  { key: "product", label: "商品" },
  { key: "platform", label: "平台" },
  { key: "action", label: "动作" },
  { key: "result", label: "结果" },
  { key: "message", label: "信息" },
  { key: "created_at", label: "时间" }
];

const fields: FormField[] = [
  { key: "product", label: "商品" },
  { key: "platform", label: "平台" },
  { key: "action", label: "动作" },
  { key: "result", label: "结果", type: "select", options: ["成功", "失败"] },
  { key: "message", label: "信息" }
];

function ListingLogsPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="刊登日志"
      description="Listing 刊登操作日志"
      table="listing_logs"
      columns={columns}
      fields={fields}
      exportable
      batchDelete
    />
  );
}
