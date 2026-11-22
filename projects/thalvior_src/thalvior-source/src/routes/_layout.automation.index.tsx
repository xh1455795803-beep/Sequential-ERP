import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";
import { useLanguage } from "@/i18n/LanguageContext";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/automation/")({
  component: AutomationIndex,
});

const TRIGGERS = ["订单创建", "库存低于阈值", "物流异常", "新售后单", "定时任务", "Webhook到达", "自动审单"];

function AutomationIndex() {
  const { t } = useLanguage();

  // 触发器列走 t() 管道翻译（EN 模式无 CJK）；未知值原样展示
  const columns: ListColumn[] = [
    { key: "name", label: "auto.ruleNameShort", render: (row) => <span className="text-fg-muted">{t(String(row.name ?? ""))}</span> },
    { key: "trigger", label: "auto.trigger", render: (row) => <span className="text-fg-muted">{TRIGGERS.includes(String(row.trigger)) ? t(String(row.trigger)) : String(row.trigger ?? "")}</span> },
    { key: "status", label: "common.statusLabel" },
    { key: "last_run_at", label: "auto.lastRun" },
  ];

  const fields: FormField[] = [
    { key: "name", label: "auto.ruleNameShort", required: true, placeholder: "auto.namePh" },
    { key: "trigger", label: "auto.trigger", type: "select", options: TRIGGERS },
    { key: "condition", label: "common.condition", placeholder: "auto.condPh" },
    { key: "action", label: "listing.col.action", placeholder: "auto.actionPh" },
    { key: "workflow_def", label: "auto.workflowDef", placeholder: "auto.workflowJsonHint" },
    { key: "status", label: "common.statusLabel", type: "select", options: [{ label: "st.enabled", value: "启用" }, { label: "st.disabled", value: "停用" }, { label: "st.exception", value: "异常" }] },
  ];

  return (
    <DataListPage
      title="nav.automation.rules"
      description="auto.indexDesc"
      table="automation_rules"
      columns={columns}
      fields={fields}
      addLabel="auto.newRule"
      exportable
      batchDelete
      stats={[
        { label: "st.enabled", countBy: { field: "status", value: "启用" }, tone: "success" },
        { label: "st.disabled", countBy: { field: "status", value: "停用" }, tone: "warning" },
        { label: "st.exception", countBy: { field: "status", value: "异常" }, tone: "primary" },
      ]}
    />
  );
}
