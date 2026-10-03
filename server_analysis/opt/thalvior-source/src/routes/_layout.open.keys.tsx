import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/open/keys")({
  component: OpenKeys,
});

const columns: ListColumn[] = [
  { key: "name", label: "名称" },
  { key: "scope", label: "权限范围" },
  { key: "status", label: "状态" },
  { key: "last_used_at", label: "最近使用" },
  { key: "created_at", label: "创建时间" },
];

const fields: FormField[] = [
  { key: "name", label: "名称", required: true, placeholder: "如：内部服务密钥" },
  { key: "key_value", label: "密钥", required: true, placeholder: "sk-xxxx（请妥善保管）" },
  { key: "scope", label: "权限范围", type: "select", options: ["read","write","admin"] },
  { key: "status", label: "状态", type: "select", options: ["启用","停用"] },
  { key: "expires_at", label: "过期时间", placeholder: "如：2027-10-03" },
];

function OpenKeys() {
  return (
    <DataListPage
      title="API Key"
      description="管理开放接口访问密钥"
      table="api_keys"
      columns={columns}
      fields={fields}
      addLabel="创建密钥"
      exportable
      batchDelete
    />
  );
}
