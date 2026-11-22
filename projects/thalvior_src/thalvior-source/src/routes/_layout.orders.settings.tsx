import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/orders/settings")({
  component: Page_OrdersSettings,
});

const columns: ListColumn[] = [
    {key: "key", label: "orders.settings.item"},
    {key: "value", label: "orders.settings.value"},
    {key: "description", label: "publish.col.message"},
    {key: "status", label: "common.statusLabel"},
  ];

const fields: FormField[] = [
    {key: "key", label: "orders.settings.item", required: true},
    {key: "value", label: "orders.settings.value"},
    {key: "description", label: "publish.col.message"},
    {key: "status", label: "common.statusLabel", type: "select", options: [{ label: "st.enabled", value: "启用" }, { label: "st.disabled", value: "停用" }]},
  ];

function Page_OrdersSettings() {
  return (
    <DataListPage
      title="nav.orders.settings"
      description="orders.settingsDesc"
      table="order_settings"
      columns={columns}
      fields={fields}
    />
  );
}
