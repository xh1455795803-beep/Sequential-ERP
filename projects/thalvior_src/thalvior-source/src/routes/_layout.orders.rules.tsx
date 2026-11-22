import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/orders/rules")({
  component: Rules,
});

const columns = [
  { key: "name", label: "auto.ruleName" },
  { key: "condition", label: "auto.triggerCond" },
  { key: "action", label: "auto.action" },
  { key: "status", label: "common.statusLabel" },
];

const fields: FormField[] = [
  { key: "name", label: "auto.ruleName", required: true, placeholder: "orders.ruleNamePh" },
  { key: "condition", label: "auto.triggerCond", required: true, placeholder: "orders.ruleCondPh" },
  { key: "action", label: "auto.action", required: true, placeholder: "orders.ruleActionPh" },
  { key: "status", label: "common.statusLabel", type: "select", options: [{ label: "st.enabled", value: "启用" }, { label: "st.disabled", value: "停用" }] },
];

function Rules() {
  return (
    <DataListPage
      title="nav.orders.rules"
      description="orders.rulesIndexDesc"
      table="order_rules"
      columns={columns}
      fields={fields}
    />
  );
}