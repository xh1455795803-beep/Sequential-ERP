import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/open/logs")({
  component: OpenLogs,
});

const columns: ListColumn[] = [
  { key: "method", label: "方法" },
  { key: "path", label: "路径" },
  { key: "status_code", label: "状态码" },
  { key: "ip", label: "IP" },
  { key: "called_at", label: "调用时间" },
];

const fields: FormField[] = [
  { key: "method", label: "方法", type: "select", options: ["GET","POST","PUT","DELETE"] },
  { key: "path", label: "路径", required: true, placeholder: "/v1/orders" },
  { key: "status_code", label: "状态码", type: "number" },
  { key: "ip", label: "IP", placeholder: "调用方IP" },
];

function OpenLogs() {
  return (
    <DataListPage
      title="调用日志"
      description="开放接口调用明细"
      table="api_logs"
      columns={columns}
      fields={fields}
      addLabel="添加日志"
      exportable
      batchDelete
    />
  );
}
