import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/automation/runs")({
  component: AutomationRuns,
});

const columns: ListColumn[] = [
  { key: "rule_id", label: "规则ID" },
  { key: "status", label: "状态" },
  { key: "result", label: "结果" },
  { key: "duration_ms", label: "耗时(ms)" },
  { key: "trigger_at", label: "触发时间" },
];

const fields: FormField[] = [
  { key: "rule_id", label: "规则ID", required: true },
  { key: "status", label: "状态", type: "select", options: ["成功","失败","跳过"] },
  { key: "result", label: "结果", placeholder: "运行结果描述" },
  { key: "duration_ms", label: "耗时(ms)", type: "number" },
];

function AutomationRuns() {
  return (
    <DataListPage
      title="运行记录"
      description="自动化规则的历史运行明细"
      table="automation_runs"
      columns={columns}
      fields={fields}
      addLabel="记录运行"
      exportable
      batchDelete
    />
  );
}
