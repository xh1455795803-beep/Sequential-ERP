import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField } from "@/components/data-list-page";

export const Route = createFileRoute("/admin/platforms")({
  component: Platforms,
});

const columns = [
  { key: "name", label: "平台名称" },
  { key: "region", label: "区域" },
  { key: "auth_type", label: "授权类型" },
  { key: "type", label: "类型" },
  { key: "status", label: "状态" },
];

const fields: FormField[] = [
  { key: "name", label: "平台名称", required: true, placeholder: "如：Amazon US" },
  { key: "region", label: "区域", placeholder: "如：美国站 / 东南亚 / 独立站" },
  {
    key: "auth_type",
    label: "授权类型",
    type: "select",
    options: [
      { label: "OAuth 一键", value: "oauth" },
      { label: "API 手动", value: "manual" },
    ],
  },
  { key: "type", label: "类型", type: "select", options: ["跨境平台", "货代渠道", "货源渠道"] },
  { key: "api_key", label: "API Key", placeholder: "对接密钥" },
  { key: "status", label: "状态", type: "select", options: ["启用", "停用"] },
];

function Platforms() {
  return (
    <DataListPage
      title="API 平台配置"
      description="新增/修改跨境平台、货代、货源渠道对接参数"
      table="platform_configs"
      columns={columns}
      fields={fields}
      addLabel="新增平台"
    />
  );
}