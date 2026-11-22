import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/admin/plans")({
  component: Plans,
});

const columns = [
  { key: "name", label: "adm.plan.name" },
  { key: "plan_key", label: "adm.plan.code" },
  { key: "price", label: "adm.plan.price" },
  { key: "period", label: "adm.plan.period" },
  { key: "quota", label: "adm.plan.aiQuota" },
  { key: "max_shops", label: "adm.plan.shopLimit" },
  { key: "max_products", label: "adm.plan.productLimit" },
  { key: "status", label: "common.statusLabel" },
];

const fields: FormField[] = [
  { key: "name", label: "adm.plan.name", required: true, placeholder: "adm.plan.namePh" },
  { key: "plan_key", label: "adm.plan.code", required: true, placeholder: "adm.plan.codePh" },
  { key: "price", label: "adm.plan.price", type: "number", placeholder: "adm.plan.pricePh" },
  { key: "period", label: "adm.plan.period", type: "select", options: [{ label: "sub.period.month", value: "月" }, { label: "ai.res.yearSuffix", value: "年" }] },
  { key: "quota", label: "adm.plan.aiQuotaYuan", type: "number", placeholder: "adm.plan.aiQuotaPh" },
  { key: "max_shops", label: "adm.plan.shopLimitCol", type: "number", placeholder: "adm.plan.unlimitedHint" },
  { key: "max_products", label: "adm.plan.productLimitCol", type: "number", placeholder: "adm.plan.unlimitedHint" },
  { key: "description", label: "adm.plan.descLabel", placeholder: "adm.plan.descPh" },
  { key: "sort_order", label: "pm.col.sort", type: "number", placeholder: "adm.plan.sortHint" },
  { key: "status", label: "common.statusLabel", type: "select", options: [{ label: "st.enabled", value: "启用" }, { label: "st.disabled", value: "停用" }] },
];

function Plans() {
  return (
    <DataListPage
      title="admin.plans"
      description="adm.plansDesc"
      table="subscription_plans"
      columns={columns}
      fields={fields}
      addLabel="adm.plan.add"
    />
  );
}
