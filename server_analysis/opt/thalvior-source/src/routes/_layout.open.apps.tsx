import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/open/apps")({
  component: OpenApps,
});

const columns: ListColumn[] = [
  { key: "name", label: "名称" },
  { key: "client_id", label: "Client ID" },
  { key: "status", label: "状态" },
  { key: "redirect_uri", label: "回调地址" },
  { key: "created_at", label: "创建时间" },
];

const fields: FormField[] = [
  { key: "name", label: "名称", required: true },
  { key: "client_id", label: "Client ID", required: true },
  { key: "client_secret", label: "Client Secret", placeholder: "应用密钥" },
  { key: "redirect_uri", label: "回调地址", placeholder: "https://..." },
  { key: "status", label: "状态", type: "select", options: ["启用","停用"] },
];

function OpenApps() {
  return (
    <DataListPage
      title="应用"
      description="管理 OAuth 第三方应用"
      table="oauth_apps"
      columns={columns}
      fields={fields}
      addLabel="新建应用"
      exportable
      batchDelete
    />
  );
}
