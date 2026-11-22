import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/fulfillment/split-rules")({
  component: SplitRulesPage,
});

const columns: ListColumn[] = [
  { key: "name", label: "ful.rule.name" },
  { key: "platform", label: "collect.platformCol" },
  { key: "region", label: "auth.region" },
  { key: "warehouse", label: "ful.rule.targetWh" },
  { key: "priority", label: "ful.rule.priority" },
  { key: "status", label: "common.statusLabel" }
];

const fields: FormField[] = [
  { key: "name", label: "ful.rule.name", required: true },
  { key: "platform", label: "collect.platformCol" },
  { key: "region", label: "auth.region" },
  { key: "warehouse", label: "ful.rule.targetWh" },
  { key: "priority", label: "ful.rule.priority", type: "number" },
  { key: "status", label: "common.statusLabel", type: "select", options: [{ label: "st.enabled", value: "启用" }, { label: "st.disabled", value: "停用" }] }
];

function SplitRulesPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="nav.fulfillment.split"
      description="ful.rulesDesc"
      table="split_rules"
      columns={columns}
      fields={fields}
    />
  );
}
