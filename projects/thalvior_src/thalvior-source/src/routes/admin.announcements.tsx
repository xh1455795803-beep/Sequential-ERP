import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/admin/announcements")({
  component: Announcements,
});

const columns = [
  { key: "title", label: "common.title" },
  { key: "content", label: "common.content" },
  { key: "status", label: "common.statusLabel" },
  { key: "created_at", label: "common.publishedAt" },
];

const fields: FormField[] = [
  { key: "title", label: "common.title", required: true, placeholder: "adm.ann.titlePh" },
  { key: "content", label: "common.content", placeholder: "adm.ann.body" },
  { key: "status", label: "common.statusLabel", type: "select", options: [{ label: "st.published", value: "已发布" }, { label: "st.draft", value: "草稿" }] },
];

function Announcements() {
  return (
    <DataListPage
      title="admin.announcements"
      description="adm.ann.desc"
      table="announcements"
      columns={columns}
      fields={fields}
      addLabel="adm.ann.publish"
    />
  );
}