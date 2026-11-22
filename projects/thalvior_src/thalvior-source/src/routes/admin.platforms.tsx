import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField } from "@/components/data-list-page";

import { tt, tk } from "@/i18n/tts";
export const Route = createFileRoute("/admin/platforms")({
  component: Platforms,
});

const columns = [
  { key: "name", label: "common.platformName", render: (row: any) => tk(String(row.name ?? "")) },
  { key: "region", label: "auth.region" },
  { key: "auth_type", label: "adm.plat.authType" },
  { key: "type", label: "common.type", render: (row: any) => tk(String(row.type ?? "")) },
  { key: "status", label: "common.statusLabel" },
];

const fields: FormField[] = [
  { key: "name", label: "common.platformName", required: true, placeholder: "orders.ph.channel" },
  { key: "region", label: "auth.region", placeholder: "adm.plat.regionPh" },
  {
    key: "auth_type",
    label: "adm.plat.authType",
    type: "select",
    options: [
      { label: "adm.plat.oauthOneClick", value: "oauth" },
      { label: "adm.plat.apiManual", value: "manual" },
    ],
  },
  { key: "type", label: "common.type", type: "select", options: [{ label: "common.crossBorder", value: "跨境平台" }, { label: "log.forwarderChannel", value: "货代渠道" }, { label: "auth.src.groupTitle", value: "货源渠道" }] },
  { key: "api_key", label: "API Key", placeholder: "adm.plat.apiKey" },
  { key: "status", label: "common.statusLabel", type: "select", options: [{ label: "st.enabled", value: "启用" }, { label: "st.disabled", value: "停用" }] },
];

function Platforms() {
  return (
    <DataListPage
      title="admin.platforms"
      description="adm.plat.desc"
      table="platform_configs"
      columns={columns}
      fields={fields}
      addLabel="adm.plat.add"
    />
  );
}