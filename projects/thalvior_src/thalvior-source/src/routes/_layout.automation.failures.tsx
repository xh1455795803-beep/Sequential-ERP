import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/automation/failures")({
  component: AutomationFailures,
});

const columns: ListColumn[] = [
  { key: "rule_id", label: "auto.ruleId" },
  { key: "error", label: "common.error" },
  { key: "retries", label: "auto.retries" },
  { key: "retry_at", label: "auto.retryAt" },
  { key: "created_at", label: "common.createdAt" },
];

const fields: FormField[] = [
  { key: "rule_id", label: "auto.ruleId", required: true },
  { key: "error", label: "common.error", placeholder: "auto.errStack" },
  { key: "retries", label: "auto.retries", type: "number" },
  { key: "retry_at", label: "auto.retryAt", placeholder: "auto.timePh" },
];

function AutomationFailures() {
  return (
    <DataListPage
      title="nav.automation.failures"
      description="auto.failuresDesc"
      table="automation_failures"
      columns={columns}
      fields={fields}
      addLabel="auto.logRunFail"
      exportable
      batchDelete
    />
  );
}
