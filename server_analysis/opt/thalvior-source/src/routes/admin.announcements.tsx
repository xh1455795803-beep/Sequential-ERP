import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField } from "@/components/data-list-page";

export const Route = createFileRoute("/admin/announcements")({
  component: Announcements,
});

const columns = [
  { key: "title", label: "标题" },
  { key: "content", label: "内容" },
  { key: "status", label: "状态" },
  { key: "created_at", label: "发布时间" },
];

const fields: FormField[] = [
  { key: "title", label: "标题", required: true, placeholder: "如：系统维护通知" },
  { key: "content", label: "内容", placeholder: "公告正文" },
  { key: "status", label: "状态", type: "select", options: ["已发布", "草稿"] },
];

function Announcements() {
  return (
    <DataListPage
      title="系统公告"
      description="向全部卖家推送站内公告"
      table="announcements"
      columns={columns}
      fields={fields}
      addLabel="发布公告"
    />
  );
}