import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/automation/workflow")({
  component: AutomationWorkflow,
});

const columns: ListColumn[] = [
  { key: "name", label: "规则名" },
  { key: "trigger", label: "触发器" },
  { key: "status", label: "状态" },
  { key: "last_run_at", label: "最近运行" },
];

const fields: FormField[] = [
  { key: "name", label: "规则名", required: true, placeholder: "如：库存预警自动补货" },
  { key: "trigger", label: "触发器", type: "select", options: ["订单创建","库存低于阈值","新售后单","定时任务","Webhook到达"] },
  { key: "condition", label: "条件", placeholder: "如：可用库存 < 安全库存" },
  { key: "action", label: "动作", placeholder: "如：生成采购建议" },
  { key: "workflow_def", label: "工作流定义", placeholder: "JSON 形式的工作流步骤" },
  { key: "status", label: "状态", type: "select", options: ["启用","停用","异常"] },
];

function AutomationWorkflow() {
  return (
    <DataListPage
      title="工作流"
      description="编排中的自动化工作流"
      table="automation_rules"
      columns={columns}
      fields={fields}
      filter={{ field: "status", value: "启用" }}
      addLabel="新建规则"
      exportable
      batchDelete
    />
  );
}
