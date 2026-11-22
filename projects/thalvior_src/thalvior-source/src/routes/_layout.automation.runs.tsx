import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";
import { fetchTable } from "@/lib/data-access";
import { useLanguage } from "@/i18n/LanguageContext";

import { tt, tkContent } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/automation/runs")({
  component: AutomationRuns,
});

function AutomationRuns() {
  const { t } = useLanguage();
  // 规则名映射：rule_id → 规则名（不再裸露 UUID）；rule_id 为空 = 自动审单引擎汇总记录
  const [ruleMap, setRuleMap] = useState<Record<string, string>>({});
  useEffect(() => {
    fetchTable("automation_rules")
      .then((rows) => setRuleMap(Object.fromEntries(rows.map((r) => [String(r.id), String(r.name ?? "")]))))
      .catch(() => {});
  }, []);

  const columns: ListColumn[] = [
    {
      key: "rule_id",
      label: "auto.rule",
      render: (row) => {
        const rid = String(row.rule_id ?? "");
        if (!rid) return <span className="text-fg-muted">{t("evt.orderAudit")}</span>;
        return <span className="text-fg-muted">{t(ruleMap[rid] || rid.slice(0, 8))}</span>;
      },
    },
    { key: "status", label: "common.statusLabel" },
    { key: "result", label: "tools.result", render: (row) => tkContent(String(row.result ?? "")) },
    { key: "duration_ms", label: "auto.durationMs" },
    { key: "trigger_at", label: "auto.triggeredAt" },
  ];

  const fields: FormField[] = [
    { key: "rule_id", label: "auto.ruleId", required: true },
    { key: "status", label: "common.statusLabel", type: "select", options: [{ label: "orders.sync.status.ok", value: "成功" }, { label: "orders.sync.col.failed", value: "失败" }, { label: "ship.result.skipped", value: "跳过" }] },
    { key: "result", label: "tools.result", placeholder: "auto.runResultDesc" },
    { key: "duration_ms", label: "auto.durationMs", type: "number" },
  ];

  return (
    <DataListPage
      title="nav.automation.runs"
      description="auto.historyDesc"
      table="automation_runs"
      columns={columns}
      fields={fields}
      addLabel="auto.logRun"
      exportable
      batchDelete
    />
  );
}
