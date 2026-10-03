import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField } from "@/components/data-list-page";

export const Route = createFileRoute("/admin/services")({
  component: Services,
});

const columns = [
  { key: "service_name", label: "服务名称" },
  { key: "service_key", label: "能力标识" },
  { key: "model", label: "模型" },
  { key: "unit_price", label: "单价" },
  { key: "unit", label: "计费单位" },
  { key: "status", label: "状态" },
];

const fields: FormField[] = [
  { key: "service_name", label: "服务名称", required: true, placeholder: "如：AI自动选品" },
  { key: "service_key", label: "能力标识", required: true, placeholder: "如：ai_select" },
  { key: "model", label: "模型", placeholder: "如：qwen3.6-plus" },
  { key: "unit_price", label: "单价", type: "number", placeholder: "如：0.02" },
  { key: "unit", label: "计费单位", placeholder: "如：次" },
  { key: "status", label: "状态", type: "select", options: ["启用", "停用"] },
];

function Services() {
  return (
    <DataListPage
      title="增值服务配置"
      description="配置图片翻译等 AI 服务的单价与模型"
      table="service_pricing"
      columns={columns}
      fields={fields}
      addLabel="新增服务"
    />
  );
}