import { createFileRoute } from "@tanstack/react-router";
import { DataListPage } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/admin/logs")({
  component: Logs,
});

const columns = [
  { key: "action", label: "common.actions" },
  { key: "module", label: "common.module" },
  { key: "detail", label: "common.detail" },
  { key: "created_at", label: "orders.sync.col.time" },
];

const fields = [
  { key: "action", label: "common.actions", required: true, placeholder: "adm.log.modulePh" },
  { key: "module", label: "common.module", placeholder: "adm.log.actionPh" },
  { key: "detail", label: "common.detail", placeholder: "adm.log.detail" },
];

function Logs() {
  return (
    <DataListPage
      title="admin.logs"
      description="adm.log.desc"
      table="operation_logs"
      columns={columns}
      fields={fields}
      addLabel="adm.log.add"
      exportable
    />
  );
}