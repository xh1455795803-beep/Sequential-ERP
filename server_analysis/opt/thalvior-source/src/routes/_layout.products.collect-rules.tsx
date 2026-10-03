import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/products/collect-rules")({
  component: CollectRulesPage,
});

const columns = [
  { key: "name", label: "规则名称" },
  { key: "platform", label: "平台" },
  { key: "source_type", label: "来源类型" },
  { key: "interval_hours", label: "间隔(小时)" },
  { key: "status", label: "状态" },
];

const fields: FormField[] = [
  { key: "name", label: "规则名称", required: true },
  { key: "platform", label: "平台" },
  { key: "source_type", label: "来源类型", type: "select", options: ["关键词", "链接", "店铺"] },
  { key: "source_value", label: "来源值(关键词/链接/店铺名)" },
  { key: "category", label: "归属分类" },
  { key: "interval_hours", label: "采集间隔(小时)", type: "number" },
  { key: "status", label: "状态", type: "select", options: ["启用", "停用"] },
];

function CollectRulesPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="采集规则"
      description="配置商品自动采集规则"
      table="collect_rules"
      columns={columns}
      fields={fields}
    />
  );
}
