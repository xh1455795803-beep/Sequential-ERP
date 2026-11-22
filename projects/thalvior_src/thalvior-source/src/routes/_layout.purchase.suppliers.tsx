import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/purchase/suppliers")({
  component: Page_PurchaseSuppliers,
});

const columns: ListColumn[] = [
    {key: "name", label: "listing.col.name"},
    {key: "contact", label: "common.contact"},
    {key: "phone", label: "common.phone"},
    {key: "status", label: "common.statusLabel"},
  ];

const fields: FormField[] = [
    {key: "name", label: "listing.col.name", required: true},
    {key: "contact", label: "common.contact"},
    {key: "phone", label: "common.phone"},
    {key: "status", label: "common.statusLabel", type: "select", options: [{ label: "st.enabled", value: "启用" }, { label: "st.disabled", value: "停用" }]},
  ];

function Page_PurchaseSuppliers() {
  return (
    <DataListPage
      addLabel="common.add"
      title="nav.purchase.suppliers"
      description="pur.suppliersDesc"
      table="suppliers"
      columns={columns}
      fields={fields}
      exportable
      batchDelete
    />
  );
}
