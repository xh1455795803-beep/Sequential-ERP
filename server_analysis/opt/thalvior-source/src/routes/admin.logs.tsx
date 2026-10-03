import { createFileRoute } from "@tanstack/react-router";
import { DataListPage } from "@/components/data-list-page";

export const Route = createFileRoute("/admin/logs")({
  component: Logs,
});

const columns = [
  { key: "action", label: "操作" },
  { key: "module", label: "模块" },
  { key: "detail", label: "详情" },
  { key: "created_at", label: "时间" },
];

const fields = [
  { key: "action", label: "操作", required: true, placeholder: "如：登录" },
  { key: "module", label: "模块", placeholder: "如：订单管理" },
  { key: "detail", label: "详情", placeholder: "操作详情" },
];

function Logs() {
  return (
    <DataListPage
      title="全局日志"
      description="所有卖家操作日志与 API 调用记录"
      table="operation_logs"
      columns={columns}
      fields={fields}
      addLabel="新增日志"
      exportable
    />
  );
}