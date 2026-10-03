import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/fulfillment/split-rules")({
  component: SplitRulesPage,
});

const columns: ListColumn[] = [
  { key: "name", label: "策略名称" },
  { key: "platform", label: "平台" },
  { key: "region", label: "区域" },
  { key: "warehouse", label: "目标仓" },
  { key: "priority", label: "优先级" },
  { key: "status", label: "状态" }
];

const fields: FormField[] = [
  { key: "name", label: "策略名称", required: true },
  { key: "platform", label: "平台" },
  { key: "region", label: "区域" },
  { key: "warehouse", label: "目标仓" },
  { key: "priority", label: "优先级", type: "number" },
  { key: "status", label: "状态", type: "select", options: ["启用", "停用"] }
];

function SplitRulesPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="分仓策略"
      description="按平台 / 区域自动分仓的规则配置"
      table="split_rules"
      columns={columns}
      fields={fields}
    />
  );
}
