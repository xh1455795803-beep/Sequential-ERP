import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/automation/failures")({
  component: AutomationFailures,
});

const columns: ListColumn[] = [
  { key: "rule_id", label: "规则ID" },
  { key: "error", label: "错误" },
  { key: "retries", label: "重试次数" },
  { key: "retry_at", label: "重试时间" },
  { key: "created_at", label: "创建时间" },
];

const fields: FormField[] = [
  { key: "rule_id", label: "规则ID", required: true },
  { key: "error", label: "错误", placeholder: "错误堆栈/原因" },
  { key: "retries", label: "重试次数", type: "number" },
  { key: "retry_at", label: "重试时间", placeholder: "如：2026-10-03 18:00" },
];

function AutomationFailures() {
  return (
    <DataListPage
      title="失败任务"
      description="执行失败待重试的自动化任务"
      table="automation_failures"
      columns={columns}
      fields={fields}
      addLabel="登记失败"
      exportable
      batchDelete
    />
  );
}
