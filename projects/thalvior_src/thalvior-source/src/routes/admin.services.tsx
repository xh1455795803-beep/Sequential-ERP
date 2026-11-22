import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/admin/services")({
  component: Services,
});

const columns = [
  { key: "service_name", label: "adm.svc.name" },
  { key: "service_key", label: "adm.svc.key" },
  { key: "model", label: "adm.svc.model" },
  { key: "unit_price", label: "orderDetail.unitPrice" },
  { key: "unit", label: "adm.svc.unit" },
  { key: "status", label: "common.statusLabel" },
];

const fields: FormField[] = [
  { key: "service_name", label: "adm.svc.name", required: true, placeholder: "adm.svc.namePh" },
  { key: "service_key", label: "adm.svc.key", required: true, placeholder: "adm.svc.capPh" },
  { key: "model", label: "adm.svc.model", placeholder: "adm.svc.modelPh" },
  { key: "unit_price", label: "orderDetail.unitPrice", type: "number", placeholder: "adm.svc.pricePh" },
  { key: "unit", label: "adm.svc.unit", placeholder: "adm.svc.unitPh" },
  { key: "status", label: "common.statusLabel", type: "select", options: [{ label: "st.enabled", value: "启用" }, { label: "st.disabled", value: "停用" }] },
];

function Services() {
  return (
    <DataListPage
      title="admin.services"
      description="adm.svc.desc"
      table="service_pricing"
      columns={columns}
      fields={fields}
      addLabel="adm.svc.add"
    />
  );
}