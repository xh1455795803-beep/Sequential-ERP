import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/subaccounts")({
  component: SubAccounts,
});

const columns = [
  { key: "name", label: "sub.name" },
  { key: "email", label: "common.email" },
  { key: "role", label: "sub.role" },
  { key: "status", label: "common.statusLabel" },
];

const fields: FormField[] = [
  { key: "name", label: "sub.name", required: true, placeholder: "subaccounts.namePh" },
  { key: "email", label: "common.email", placeholder: "subaccounts.emailPh" },
  { key: "role", label: "sub.role", type: "select", options: [{ label: "sub.roleOps", value: "运营" }, { label: "sub.roleSupport", value: "客服" }, { label: "exc.catFinance", value: "财务" }, { label: "sub.roleAdmin", value: "管理员" }] },
  { key: "status", label: "common.statusLabel", type: "select", options: [{ label: "st.enabled", value: "启用" }, { label: "st.disabled", value: "停用" }] },
];

function SubAccounts() {
  return (
    <DataListPage
      title="nav.subaccounts"
      description="sub.indexDesc"
      table="sub_accounts"
      columns={columns}
      fields={fields}
      addLabel="sub.newSub"
      exportable
      batchDelete
      stats={[
        { label: "st.enabled", countBy: { field: "status", value: "启用" }, tone: "success" },
        { label: "st.disabled", countBy: { field: "status", value: "停用" }, tone: "warning" },
      ]}
    />
  );
}